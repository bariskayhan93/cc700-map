# cc25 map block decoder (`mapdec`)

The module decodes one scheme D map block (version 1) into the same entry records that the stock
block decoder makes. The drawing, free and budget code do not change.

## Contract

- **Hook.** The entries callback literal `0x4203e3ec` changes from `0x42049368` (stock) to the address of
  `cc_entries`. The stock callback is called with its own address `0x42049368`.
- **Entry.** `cc_entries(pb_istream_t *s, const void *field, void **arg)`, at `0x421de800`, the start of the
  IROM tail (4,376 B free in the cc23 image). `*arg` is the block header (`0x3c3887d4`).
- **Device addresses** (`mapdec.c`): buffer read callback `0x421cfe20`, stock callback `0x42049368`,
  message `0x3c3887bc` (count), entry array `0x3fc9fbe8`, allocator `0x403763e0` (size, caps), free
  `0x40376398`. Caps `0x404` for the array and for each `pts`.

## Normal behaviour

A scheme D block is a protobuf message. Field 1 holds the count `N` (1 or more). Field 2 holds one record
whose body starts with the 7 bytes `08 00 10 00 28 00 7A` (entry 0: n 0, style 0, count 0, field 15), then
`uvarint(len)`, then the payload. The payload is `01` (version), `uvarint N`, then `N` entries. Each entry
has `uvarint style`, `uvarint cnt`, `zz` lat delta, `zz` lon delta, then `cnt` point pairs as `zz` deltas.
Label entries (class 12) store raw words.

The module:

1. Accepts only a buffer stream (`callback == 0x421cfe20`) whose first 7 bytes are the prefix.
   Any other input goes to the stock callback.
2. Reads `N` from field 1 and allocates the array as the stock code does: `28 × N` bytes, caps `0x404`,
   zeroed. It stores the array at `0x3fc9fbe8` and in the header at +24.
3. Decodes each entry. Before each `pts` allocation it checks that `2 × cnt` bytes remain. It allocates
   `pts` as `8 × cnt` (caps `0x404`), or none when `cnt` is 0. It writes `n` (the index), `style`, `lat`,
   `lon`, `cnt` and `pts`.
4. On success it consumes the record and returns 1.

## Admission

- The prefix must match exactly. The record must end after the payload.
- The payload version must be 1. Its `N` must equal field 1. `N` must be 1 or more and at most 2^26 − 1.
- `cnt` must be at most 4096. Every varint is at most 5 bytes and is checked against the end of the data.
- Trailing bytes after the last entry are refused.

## Unavailable state and fallback

- **Stock path.** A stream with another callback, or a record without the prefix, goes to the stock
  callback (rule 1). A protobuf block therefore draws as today.
- **Data error (rule 5).** Entries already made stay. The entry that failed is not kept, and its `pts` is
  freed. The rest of the array stays zero. The record is consumed and the function returns 0. A zero
  entry has count 0. The expected drawing is nothing; this is not tested on a unit. The header keeps the count `N`, so the iterator finds a
  consistent block.
- **Allocation failure (rule 6).** Every allocation made by this call is freed: the entries made so far
  and their `pts`, and the array. Header +20 and +24 are cleared, the array pointer `0x3fc9fbe8` is
  cleared, and the message count is cleared. The stock iterator then sees an empty block. The function
  returns 0.
- **Empty count.** A count of 0 takes the rule 6 path without an allocation. The header is cleared.

## Restoration

A route without scheme D data (an old-format route, from the existing `patch` choice of `index.html`)
uses the stock path for every block. To go back, make the route again with the old firmware choice. No
flash is needed for that step.

## Host tests

`node --test tools/test_mapdec.mjs` builds `tools/mapdec_host.c` with `firmware/mapdec/mapdec.c`
(`-DHOST`, `-fsanitize=address,undefined`). The host build uses an 8-byte pointer, so the entry stride is 32
(`MD_STRIDE`). The device stride is 24.

- Exact compare: 79 stored blocks (75 of the 70 km route, 4 of the city route) against the protobuf parse,
  field by field.
- Synthetic compare: random entries across classes 1 to 15 and the int32 limits.
- Truncation: every length of three synthetic blocks (0 to full length). No fault, and a consistent header.
- Random bytes after the prefix: 10,000 cases. No sanitizer error. The array and count agree.
- Allocation failure at every allocation of one block. Count 0, no array, no live allocation.
- Sequence protobuf, scheme D, protobuf, scheme D. No leak and no double free (the allocator aborts on a
  double free).
- Fallback: a protobuf block and another stream callback reach the stock model.
- A payload `N` that differs from field 1 is refused. The count is kept and no entry is made.

## Size (device build)

`cc -Os -mlongcalls -mtext-section-literals -ffreestanding -fno-builtin -nostdlib -ffunction-sections`
with `xtensa-esp32s3-elf-gcc`, linked with `--gc-sections` at `0x421de800`, entry `cc_entries`:

- `.text` 939 B, `.xt.lit` 8 B. Text and constants 947 B, under the 1,024 B limit.
- `nm -u` on the object and on the linked file: empty.

## Gaps

- No device test. The stock callback address, the free and malloc addresses and the caps are from the
  disassembly of the base image (`.local/mining/cc23_irom.bin`). They are not checked on a unit.
- The host stock model is an approximation for protobuf entries. It is used only for the fallback and
  sequence tests.
- A block with field 1 and no entry record (a truncated file) leaves the stock iterator with a count and
  no array. The host harness clears the count in that case (`guard`). The device has no such guard. The
  page does not write such a block.
- A count of 0 leaves the stale header count on the stock path. The new path clears it.
- The point callback (stock) and the free loop (`0x4204944c`) are not replaced.
