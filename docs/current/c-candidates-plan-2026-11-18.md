# Device Candidates cc25 and cc26: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two firmware candidates that stay on the unit and get fixes on the same base:
- **cc25:** a compact map block format (scheme D). The 70 km map becomes 0.34 of today's size.
- **cc26 (on cc25):** way-back file version 2 with 8-byte nodes, a street window around the rider, and a line cache. The way-back line is used again while the nearest street piece stays the same.

**Architecture (owner rule: minimal hooks, small modules, no bloat):** each candidate is **one hook word plus one small C module**.
- cc25 replaces the literal of the stock map-entries decode callback (one word). The module decodes a scheme D block into exactly the structures that the stock decoder makes. So the drawing code, the free code and the budgets do not change. Old blocks go on to the stock callback.
- cc26 replaces the way-back literal (one word, as cc23wb does). The core gets one shared cell scan. The window module keeps the street pieces and the last line in RTC slow memory.
- The route file is the switch. A route without the new data runs today's code.

**Tech Stack:** Freestanding C11 (no float in the core and the decoder; no library call; memory only through the firmware's `heap_caps_malloc`). `~/xtensa-esp-elf/bin/xtensa-esp32s3-elf-gcc` 13.2.0, `-Os -mlongcalls -mtext-section-literals -ffreestanding -fno-builtin -nostdlib -ffunction-sections`. Python 3 `-I` builders. Node.js `node:test`.

**Spec:** `.local/study/out/fw-study.md` sections 2, 4 and 8 (stock decode path, RTC memory; private), `.local/study/out/c-study.md` (B1, B2), `firmware/wayback/README.md`, `docs/current/budget-plan-2026-11-16.md`, `AGENTS.md`.

## How this plan keeps the unit stable (for the owner)

1. **The same C runs on the Mac first**, with address and undefined-behaviour checks, on every block of real route files, on broken files and on random bytes.
2. **Exact comparison:** for each real block, the module's output must equal the stock decoder's structures (style, centre, count, every point), field by field. For cc26, the cached line must equal the line of today's full search at every test point.
3. **Each builder changes only named bytes** of one exact base image, as for cc22 and cc23.
4. **The route file is the switch.** Old routes use the stock path. If the new path fails, make the route again with the old firmware choice. No reflash.
5. **A fault in the data never crashes the unit:** the modules check every length. On any error, cc25 leaves an empty, consistent block, and cc26 shows the stock off-route display.
6. **One device test for each candidate** with hypothesis, observation, duration and restore, approved by the owner. Then fixes go on the same base (cc25.1, cc25.2 …).

## Measured numbers that this plan uses (host, 18 Nov)

| Item | Value | Source |
|---|---:|---|
| 70 km map, today's records (step 1 build) | 3,824,867 B, 75 blocks | `docs/research/map-economy-step1-2026-11-18.md` |
| 70 km map, scheme D | 1,293,208 B (0.338) | B2 |
| City map, scheme D | 77,464 B (0.336) | B2 |
| Entries per 70 km block, median / max | 409 / 728 | per-block study |
| Points per block, median / max | 3,241 / 4,353 | per-block study |
| Allocations per block, median / max | 411 / 730 | per-block study |
| Stock nanopb callbacks per block, median / max | 3,596 / 4,752 | per-block study |
| Block bytes, protobuf vs D, median | 49.5 KB vs 16.8 KB | per-block study |
| Way-back 2 km / 3 km, version 2 (8 B nodes) | 916,812 B / 1,401,584 B | B1 |
| 70 km file, scheme D + 2 km way-back, unit estimate | 2,720,906 B | B2 |
| 17 Nov ride: frames with a line / frames on the same nodes as before | 440 / 278 (63%) | `linechange.mjs` |
| 17 Nov ride: file reads per off-route frame, p50 / p90 | 179 / 270 | `linechange.mjs` |

## Stock facts this plan uses (mined 18 Nov, `fw-study.md` sections 4 and 8)

- Block load `0x420494d0` (kind 1 path `0x4204959c`): reads the block, frees the old entries (each `pts`, then the array at `0x3fc9fbe8`, which it sets to 0), clears the message struct `0x3c3887bc` (12 B: count, callback, argument), sets the entries callback from the literal `0x4203e3ec` (value `0x42049368`, used once), calls `pb_decode` (`0x4203a8e0`) with descriptor `0x3c1ee408`, then writes header `0x3c3887d4` +20 = count (only if count ≠ 0) and +28 = loaded.
- Entries callback `0x42049368(stream, field, void **arg)`, `*arg` = header: allocates the array once (`28 × count`, caps `0x404`, zeroed) at `0x3fc9fbe8` and header +24; decodes one entry into `0x3c3887a0`; copies 20 B to `array + 24 × n`. The point callback allocates `pts` = `8 × cnt` and copies 8 B per point. It returns true.
- Entry record (24 B stride): `n, style, lat, lon, cnt, pts` (`ent_t` in `../cc700-patch/src/fw.h`).
- Stream: `{callback, state, bytes_left, errmsg}`; a buffer stream has callback `0x421cfe20` and `state` = current byte pointer.
- Descriptors: block = fields 1 (uvarint) and 2 (callback); entry = fields 1 to 6; point = fields 1 and 2. An unknown field is skipped.
- Stock faults that the new path avoids: no check of `n` against the count; a block with count 0 leaves header +20/+24 at the freed old entries. No real build has an empty block today (0 of 75, 4 and 104 blocks).
- RTC slow memory `0x50000000..0x50002000` (8,192 B): the RTC `.bss` clear in `call_start_cpu0` (`0x40375028`) has start = end = `0x50000000`. No other code reference. No ULP code. Its content stays across a software reset and is random after power-on.
- Map heading: `float` degrees at `0x3c388d08`.
- Draw operations of the v21 table (`../cc700-patch/src/map.c`): 14 = 4 px `0x3b1f6e`, 17 = 7 px `0xffffff`, 30 = 4 px `0x9a9ea3`. **No 3 px `0x7a7e83` operation exists**, so the window uses operation 30. A new operation would need a change of the base table.

## Decisions

- **E1 scheme D block (version 1).** The outer message stays protobuf, so stock code reads it without fault:
  `field 1 = N` (N ≥ 1), then **one** `field 2` record whose bytes are `08 00 10 00 28 00 7A` + `uvarint(len)` + payload.
  The stock entry decoder reads this as entry 0 (n 0, style 0, cnt 0) and skips field 15 (`7A`). So **old firmware draws an empty block and does not crash**.
- **E2 payload:** `01` (version) `uvarint N`, then N entries: `uvarint style`, `uvarint cnt`, `zz(centre lat − previous centre lat)`, `zz(centre lon − previous centre lon)` (previous = 0 for entry 0), then `cnt` pairs: for class 12 (labels) the two raw words as `zz`; for every other class `zz(point − previous point)`, previous = the centre for point 0. All in int32 with wraparound. `zz` = zigzag 32-bit, varints at most 5 bytes.
- **E3 empty block:** N = 1 with one entry `style 0, cnt 0, centre 0,0`. The new format never writes count 0.
- **E4 module `mapdec` (cc25):** `int cc_entries(pb_istream_t *s, const void *field, void **arg)` at `0x421de800` (IROM tail, at most 1,024 B of the 4,376 B usable; the 1,768 B reserve stays). Hook: the literal `0x4203e3ec` → `cc_entries`. Version text `CC700_V1.414-cc25`. Rules:
  1. If `s->callback != 0x421cfe20`, or the bytes do not start with the E1 prefix, tail-call the stock `0x42049368`.
  2. Else decode the payload directly from `s->state`, check `version == 1` and `N == *(uint32_t *)0x3c3887bc`.
  3. Allocate the array exactly as stock (`28 × N`, caps `0x404`, zeroed), store it at `0x3fc9fbe8` and header +24. For each entry, allocate `pts` = `8 × cnt` (none when cnt = 0) and fill `n = i, style, lat, lon, cnt, pts`.
  4. Limits: `cnt ≤ 4096`, and before each allocation `bytes_left ≥ 2 × cnt`. Every varint read checks the end.
  5. On a data error: stop, keep the entries made so far (the rest stay zero), consume the rest, return false.
  6. On an allocation failure: set header +20 = 0, header +24 = 0, `0x3fc9fbe8` = 0 and the message count = 0, then return false. The stock iterator and free loop then see an empty block.
  7. On success: `s->state += bytes_left; s->bytes_left = 0;` return true.
- **E5 page choice:** a third value `patch25` of the `fw` select ("Patch cc25+"). Only `patch25` writes scheme D blocks and, from Task D1, way-back version 2. The other two choices write today's files.
- **E6 one codec module on the page:** `js/map_codec.js` has `encodeBlockD(entries)` and `decodeBlockD(bytes)`. The generator, `preview.js` `readFile` and `map_budget.js` `auditMapSection` use it. The budgets stay as today (the serialized-byte check uses today's protobuf size, which is larger, so it is conservative).
- **E7 CCWB version 2 node (cc26), 8 B, one little-endian `u64`:** bits 0–18 `X/2`, bits 19–37 `Y/2` (1/16 m units, stored halved: 1/8 m, at most 65.5 km on each axis), bits 38–50 `next − index` as signed 13 bits (0 = no next: `WB_NIL`), bits 51–62 ride distance in whole metres (0 to 4,095), bit 63 = grey flag of the piece from this node to `next` (D1b: set by the page from the map, `js/wayback_grey.js`; a node without `next` has bit 63 = 0). An extra record (lenflags): bits 0–12 length in 0.1 m (at most 8,191 dm), bit 13 = grey flag, bits 14–15 `toA`, `toB`. Header (64 B, version field = 2), cells (12 B) and extras (8 B) as version 1; no exception lists. Measured on the 70 km 2 km file: 0 `next` out of range, largest distance 4,000 m, 916,812 B. The 3 km file (largest distance 6,000 m) does not fit version 2 since D1b: a node that does not fit gives no version 2 file (the page goes on with its reach fallback). Reach as today: 2 km, then 1.5 km.
- **E8 cc26 code place:** the second code area `0x4237b134..0x42380000` (20,172 B, constants through `0x3c37b134`). The image builder moves DRAM segment 1 to the file end, extends DROM segment 0 by the code, and adds one 16 B padding segment (load address 0). Hook: the existing way-back literal `0x420496b8` (base value `0x421dd920`, `cc_rt`). Version text `CC700_V1.414-cc26`.
- **E9 shared cell scan in the core (cc26):** `wb_tick` and the window refresh use one function `wb_scan`. It visits the street pieces of a cell rectangle in the order of today's `wb_tick` (rows `cy` up, cells `cx` up, in each cell the tree pieces, then the extra pieces). The near filter becomes a box: `wb_out(v, lo, hi) = v - lo + WB_NEAR > (hi - lo) + 2 * WB_NEAR` (unsigned). `wb_out(v, c, c)` equals today's `wb_far(v, c)`. So `wb_tick` = `wb_scan` of the 3 × 3 cells with the box = the rider point, and its output does not change.
- **E10 piece id (cc26), `u32`:** bits 0–22 record index (node index of a tree piece, or extra index), bit 23 = extra piece, bits 24–28 window slot 0–29, bit 29 = draw (the grey flag of the piece, E7 bit 63 or the extra bit 13; D1b, R-GREY). `WB_PIECE(id) = id & 0x00FFFFFF` is the core's id.
- **E11 window and cache (cc26):** 128 m cells (2,048 units). The window has 5 cells across and 6 along the heading: 1 behind, the rider's cell, 4 ahead. Quadrant `q = (uint32_t)((h + 45) / 90) & 3` with `h` = the heading in degrees; NaN or outside 0 to 360 gives q = 0. q 0 = north (+Y), 1 = east (+X), 2 = south, 3 = west. The window is clamped at cell 0.
  Cache at `0x50000000`, one struct `wbw_cache` of at most 8,192 B: header 80 B, line store 276 B, 640 pieces of 12 B (7,680 B): 8,036 B. Pieces keep the order of `wb_scan`. A cache whose `wbw_valid` fails is rebuilt.
- **E12 off-route frame (cc26 adapter):**
  1. Take the position. Compute `src` = {FNV-1a 32 of the route path in the open-file table, the firmware's route file handle}. This needs no file call.
  2. If the cache is valid and `src` is equal: `wbw_nearest`. The answer is HIT (a piece within 15 m, and the rider's 3 × 3 cells are inside the window), NONE (3 × 3 inside, no piece within 15 m) or MISS (3 × 3 not inside the window).
  3. HIT and the piece id = the line store id: use the stored points 1 to n−1, compute point 0 and the distance from the cached piece. **No file call.**
  4. HIT with another id: open the file, mount, check the route identity against the cache, `wb_tick_piece`, read 32 points, store the line.
  5. MISS, or an invalid cache: open the file, mount, `wbw_refresh` (at most 160 reads), then step 2 again (one time).
  6. NONE: no line; the window is drawn.
  7. A cache with more than 640 pieces is FULL: the line comes from `wb_tick` as today; the 640 stored pieces are drawn.
  8. Draw, only off route: the window pieces with the draw bit, nearest ring first, at most 400, operation 30, stop when 60 ms have passed since the draw start; then the line (operation 17, then 14); then the text.
  9. Limits as cc23wb: stack 3,360 B, 300 ms file work per frame.
- **E13 text (cc26):** at the top left, as cc23wb: `123m 45 130` (distance, ms, reads), with `c` at the end when the line came from the line store (`123m 2 0c`). Codes `wb2`…`wb9` as today. The on-route text `wb3` is removed.
- **E14 restoration (cc26):** a route without way-back version 2 data shows the stock off-route display. Power-off clears nothing that matters: the cache is checked before use.

## Global Constraints

- No command that opens a USB or serial device (`esptool`, `flash.sh`, `run_test.py install*`). Builders write only to `.local/`.
- Do not edit `../cc700-patch`. Edit only the files that a task names.
- Stage only the named files. Never `git add -A`, `git add .` or `git commit -a`. Commit to `main`. Never push.
- Public repository: no coordinates, ride data or `.local/` content in committed files. Host tests use synthetic data near latitude 51, longitude 7. Real route files are read from `.local/` by scripts that print counts only.
- Docs and commit messages in ASD-STE100. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not change a number in "Decisions". If a step fails and the fix is not in this plan, stop and report. Do not weaken a test.
- Every size and count in a doc comes from a command you ran.
- Host C builds: `cc -std=c11 -O1 -g -DHOST -fsanitize=address,undefined -fno-sanitize-recover=all`.

## Review Focus

1. **Truncated payload in the middle of a varint, a point list or an entry header:** no read past the end; the block stays consistent. Test in Task C2 (every truncation length of a real block).
2. **N in the payload differs from field 1:** refused. Test in Task C2.
3. **An old-format block after a scheme D block and the other way round:** the free and the next decode work (no stale array, no double free). Test in Task C2 with a host model of the load sequence.
4. **A cache with random bytes and a correct magic** (power-on, bit flip): no read outside the struct, no wrong line. Test in Task D3 (`wbw_valid` and 10,000 random caches).
5. **The rider at the window edge, at cell 0, or after a U-turn:** the cached nearest piece equals `wb_tick`'s piece, or the answer is MISS. Test in Task D3 (every rider point of the fixture, all four quadrants).

## File Structure

| File | Responsibility |
|---|---|
| `js/map_codec.js`, `tools/test_map_codec.mjs` | `encodeBlockD`, `decodeBlockD`, `isBlockD` (C1). |
| `js/mapsec.js`, `js/preview.js`, `js/map_budget.js`, `js/route.js`, `js/app.js`, `index.html`, `sw.js` | Use the codec for `patch25` (C1, C3). |
| `firmware/mapdec/mapdec.h`, `mapdec.c`, `mapdec.ld`, `README.md` | The cc25 module and its contract (C2, C4). |
| `tools/mapdec_host.c`, `tools/test_mapdec.mjs` | Host build, exact compare, truncation and random tests (C2). |
| `tools/cc25_build.py`, `tools/test_cc25_build.py` | cc25 image (C4). |
| `docs/releases/cc25-2026-11-18.md` | cc25 release record and device test (C5). |
| `js/wayback_format.js`, `js/wayback.js`, `tools/wayback_build.mjs` | CCWB version 2 (D1). |
| `firmware/wayback/wayback.c`, `wayback.h`, `README.md` | Version 2 reader, `wb_scan`, `wb_tick_piece`, grid helpers (D2). |
| `firmware/wayback/wb_window.h`, `wb_window.c`, `tools/wb_window_host.c`, `tools/test_wb_window.mjs` | Window, cache and line store (D3). |
| `tools/area2_image.py`, `tools/test_area2_image.py` | Second code area in the image (D4). |
| `firmware/wayback/wb_device.c`, `wb_area2.ld`, `tools/cc26_build.py`, `tools/test_cc26_build.py`, `tools/wayback_device_host.c`, `tools/test_wayback_device.mjs` | cc26 adapter and image (D5). |
| `docs/releases/cc26-2026-11-18.md` | cc26 release record and device test (D6). |

---

## Part C: cc25 (scheme D map blocks)

### Task C1: Page codec

**Files:** Create `js/map_codec.js`, `tools/test_map_codec.mjs`. Modify `tools/validate_local.py` (add the test to the node list), `sw.js` (add `js/map_codec.js` to `FILES`).

**Interfaces:**
- Produces: `encodeBlockD(entries) -> number[]`: `entries` = array of `{style, lat, lon, pts}` (`lat`, `lon` int32 semicircles; `pts` = array of `[a, b]` int32 pairs; for class 12 the pairs are the label words). Returns the whole outer message bytes of E1 (field 1, field 2 with prefix and payload). An empty array gives the E3 block.
- Produces: `decodeBlockD(bytes) -> entries | null`: `null` when the bytes are not an E1 block. Throws `Error('scheme D: <reason>')` on a bad payload.
- Produces: `isBlockD(bytes) -> boolean`.

- [ ] **Step 1: Failing tests:** round trip of random entries (seed fixed: 200 entries, styles of every class 1 to 15, counts 0 to 60, coordinates across the int32 limit, label words negative); `decodeBlockD` of a protobuf block returns `null`; every truncation of an encoded block throws; a payload N that differs from field 1 throws; the empty array round-trips to one `style 0` entry; the first 7 bytes of the field-2 record body are `08 00 10 00 28 00 7A`, then the payload length.
- [ ] **Step 2: Run:** `node --test tools/test_map_codec.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** E1, E2, E3 with `uv`, `zz` from `js/pb.js`. Use `| 0` for the int32 wraparound.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Size check on the real 70 km build:** convert every block of `.local/study/out/t70S1.bin` with the codec (a 20-line script in `.local/study/`). Expected: total within 2% of 1,293,208 B (B2 `D_exact`). Write the number in the commit message.
- [ ] **Step 6: Commit.**

### Task C2: The `mapdec` module on the host

**Files:** Create `firmware/mapdec/mapdec.h`, `mapdec.c`, `firmware/mapdec/README.md`, `tools/mapdec_host.c`, `tools/test_mapdec.mjs`.

**Interfaces:**

```c
/* mapdec.h */
typedef struct { uint32_t n, style; int32_t lat, lon; uint32_t cnt; int32_t *pts; } md_ent;   /* = ent_t, 24 B */
typedef struct pb_istream_s { int (*callback)(struct pb_istream_s *, uint8_t *, uint32_t); const uint8_t *state; uint32_t bytes_left; const char *errmsg; } pb_istream_t;
int cc_entries(pb_istream_t *s, const void *field, void **arg);   /* E4 */
```

Device addresses come from macros in `mapdec.c` (`MD_BUF_READ 0x421cfe20`, `MD_STOCK_CB 0x42049368`, `MD_MSG 0x3c3887bc`, `MD_ARRAY 0x3fc9fbe8`, `MD_MALLOC 0x403763e0`, caps `0x404`). With `-DHOST` they map to host variables and stubs, as `tools/wayback_device_host.c` does.

`tools/mapdec_host.c` models the stock load sequence: free the old entries as `0x4204944c` does, clear the message, call `cc_entries` (or a host model of the stock callback for protobuf blocks), then set header +20 and +28 as `0x42049655..0x42049660` does. It prints JSON: entries (style, lat, lon, cnt, points), live allocations, errors.

- [ ] **Step 1: Failing tests** in `tools/test_mapdec.mjs`:
  - **Exact compare:** for every block of `.local/study/out/cityS1.bin` and `.local/study/out/t70S1.bin` (skip with a message when the files are absent), encode with `encodeBlockD` (from the JS parse of the protobuf block) and decode with the host module. The entries equal the JS parse of the protobuf block field by field. Print the block count compared.
  - **Synthetic exact compare** (always runs): the random entries of Task C1.
  - **Truncation:** every length from 0 to the full size of three real blocks (or synthetic ones): no sanitizer error, and the header is consistent (array null and count 0, or array with N zeroed-or-filled entries).
  - **Random bytes after the prefix:** 10,000 cases, fixed seed: no sanitizer error.
  - **Allocation failure** at the array and at the k-th `pts`: E4 rule 6 holds; no leak.
  - **Sequence:** protobuf block → D block → protobuf block → D block: no leak, no double free (host allocator counts).
  - **Fallback:** a protobuf block reaches the stock-model callback; a stream with another `callback` reaches it too.
- [ ] **Step 2: Run:** `node --test tools/test_mapdec.mjs`. Expected: FAIL (sources missing).
- [ ] **Step 3: Implement** `mapdec.c` to E4. No writable globals. No float.
- [ ] **Step 4: Run** again. Expected: PASS, with the compared block count printed.
- [ ] **Step 5: Size:** compile for Xtensa with entry `cc_entries` and `--gc-sections`. Expected: at most 1,024 B, `nm -u` empty. Write the size in `firmware/mapdec/README.md`.
- [ ] **Step 6: README:** normal behaviour, admission (E1 prefix, version, N), unavailable state (stock path), fallback (rules 5 and 6), restoration (an old-format route).
- [ ] **Step 7: Commit.**

### Task C3: The page writes scheme D for `patch25`

**Files:** Modify `index.html` (`fw` select), `js/app.js:29-43` and `:81-100`, `js/route.js` (pass `map.codec`), `js/mapsec.js:285` and `:469` (block assembly), `js/preview.js` (`readFile`), `js/map_budget.js` (`auditMapSection`). Test: `tools/test_map_contract.mjs`, `tools/test_preview.mjs`, `tools/test_app_offline.mjs`, `tools/test_map_budget.mjs`.

**Interfaces:** Consumes `encodeBlockD`, `decodeBlockD`, `isBlockD` (C1). Produces: route option `map.codec` (`'d'` or absent).

- [ ] **Step 1: Failing tests:** the same route built with `codec: 'd'` and without gives deep-equal `readFile` blocks and the same `auditMapSection` costs except the serialized bytes; the D file is smaller; `patch25` exists, saves to `localStorage`, and sets `styled` and `codec: 'd'`; an empty block in D mode is the E3 block.
- [ ] **Step 2: Run** and see the failures.
- [ ] **Step 3: Implement.** In the block assembly: with `opt.codec === 'd'`, parse each entry body (`parse` from `js/pb.js`) to `{style, lat, lon, pts}` and call `encodeBlockD`. Else today's code. `readFile` and `auditMapSection`: `isBlockD` first, then today's parser.
- [ ] **Step 4: Run** the map test list of the earlier plan (Task A2 Step 8) plus the new tests. Expected: all PASS.
- [ ] **Step 5: Measure:** build `t70.gpx` with `codec: 'd'` (env `CODEC=d` in `.local/study/m90/build.mjs`). Write the file size. Expected: map within 2% of Task C1 Step 5.
- [ ] **Step 6: Commit.**

### Task C4: cc25 image

**Files:** Create `firmware/mapdec/mapdec.ld`, `tools/cc25_build.py`, `tools/test_cc25_build.py`.

Copy the structure of `tools/wayback_device_build.py`:

| Item | Value |
|---|---|
| Base | only `d225e17970940be7b153c524aebcfc60f4ca7ae8cd74696ef2282396e461ce04` (cc23 + trampoline fix) |
| Code | `mapdec.c`, entry `cc_entries`, at `0x421de800`, text + constants ≤ 1,024 B, constants through the `0x3c` alias as in `../cc700-patch/src/patch.ld` |
| Hook | the word at `0x4203e3ec`: base value `0x42049368`, new value = address of `cc_entries` |
| Called entries | `0x42049368` and `0x403763e0` must begin with an `entry` instruction |
| Version | `CC700_V1.414-cc25` |
| Output | `.local/cc25/ota_1_cc25.bin`, `manifest.json` with `device_written: false` |

- [ ] **Step 1: Failing tests:** wrong base refused; only `0x421de800..end`, `0x4203e3ec..+4`, the version text, the checksum and the digest change; the hook word is the ELF address of `cc_entries`; `nm -u` empty; size ≤ 1,024 B.
- [ ] **Step 2 to 4:** run (fail), implement, run (pass).
- [ ] **Step 5: Build** the candidate. Write the SHA-256 in the commit message.
- [ ] **Step 6: Commit** the three files.

### Task C5: cc25 release record and device test

**Files:** Create `docs/releases/cc25-2026-11-18.md`.

- [ ] **Step 1:** Write: what changed, image SHA-256 and size, host test results, and the device test:
  - **Hypothesis:** cc25 draws a scheme D route as cc23 draws the same route in today's format, and old routes as before.
  - **Old-firmware check (before the flash, on the installed image):** open route 2 for 1 minute. Expected: the map area is empty, no restart. This proves E1 on the stock decoder.
  - **Observation:** route 1 = a GPX made with `patch`; route 2 = the same GPX made with `patch25`. Open each for 2 minutes, stationary, same place, photos. Ride 10 minutes on route 2 through two block changes. No restart; `/ABNORMAL/` empty.
  - **Duration:** 35 minutes.
  - **Restore:** install `.local/mining/ota_1_cc23trampfix.bin` (`d225e179…`); delete route 2.
- [ ] **Step 2: Commit.** Do not flash. The owner approves each device step in chat.

---

## Part D: cc26 (way-back version 2, street window, line cache), on cc25

### Task D1: CCWB version 2 in the generator

**Files:** Modify `js/wayback_format.js`, `tools/wayback_build.mjs` (`--format 2`), `js/wayback.js` (version 2 for `patch25`), `js/app.js` (pass the format). Test: `tools/test_wayback_format.mjs`, `tools/test_wayback_page.mjs`.

**Interfaces:**
- Produces: `encodeWaybackV2(model, routeId) -> Uint8Array` per E7. Throws `Error('node does not fit version 2: <field>')` with field `x`, `y`, `next` or `dist`.
- Produces: `decodeWayback(bytes)` reads versions 1 and 2. A version 2 node gives `{x, y, next, distM}` with `x`, `y` in 1/16 m (even values).
- Produces: `waybackFromSnapshot(..., {format: 2})` and `addWayback(routeBytes, {format: 2})`.

- [ ] **Step 1: Failing tests:** round trip of the fixture model (positions within 1 unit, distance within 0.5 m, `next` exact); refusal for X = 2^20, distance 8,192 m, `next − index` = 4,096; file size = `64 + 12 × (cells + 1) + 8 × nodes + 8 × extras`; version field = 2; `patch25` with the way-back option writes version 2, `patch` writes version 1.
- [ ] **Step 2: Run:** `node --test tools/test_wayback_format.mjs tools/test_wayback_page.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** E7. Distance in whole metres: `Math.round(dist_dm / 10)`.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Measure:** `node .local/study/m90/wb70.mjs --format 2` for 2 km and 3 km. Expected: 916,812 B and 1,401,584 B (within 1%). Write both in the commit message.
- [ ] **Step 6: Commit.**

### Task D2: Core: version 2 reader, shared scan, `wb_tick_piece`

**Files:** Modify `firmware/wayback/wayback.c`, `wayback.h`, `README.md`, `tools/wayback_host.c`. Test: `tools/test_wayback_core.mjs`, `tools/test_wayback_replay.mjs`.

**Interfaces (add to `wayback.h`):**

```c
typedef struct { int32_t lat0_e7, lon0_e7; uint32_t lat_u, lon_u, lat_e, lon_e; } wb_grid;          /* 24 B */
typedef struct { uint32_t id, a, b, da, db, len, bits, vn, xa, ya, xb, yb; } wb_cand;              /* id per E10, bits 0-23 */
typedef int (*wb_visit)(void *ctx, const wb_cand *);                                               /* 0 = stop */
void wb_grid_get(const wb_engine *, wb_grid *);
int  wb_units(const wb_grid *, int32_t lat_e7, int32_t lon_e7, uint32_t *x, uint32_t *y);         /* 0 = outside */
void wb_point(const wb_grid *, uint32_t x, uint32_t y, int32_t e7[2]);
int  wb_scan(wb_engine *, uint32_t cx0, uint32_t cy0, uint32_t cx1, uint32_t cy1,
             uint32_t x0, uint32_t y0, uint32_t x1, uint32_t y1, wb_visit, void *ctx);          /* 1 = done, 0 = read failed */
void wb_tick_piece(wb_engine *, const wb_input *, uint32_t id, wb_output *);
void wb_line_info(const wb_engine *, uint32_t info[3]);                                         /* end_dm, len, end_first of the line */
```

`wb_output` gets one more field at the end: `uint32_t piece` (the id of the chosen piece, bits 0–23; `WB_NIL` when there is no line).

- [ ] **Step 1: Failing tests:**
  - `wb_mount` accepts a version 2 file and refuses version 1 (`WB_NO_FILE`).
  - The existing core tests on version 2 files: points within 2 units, distance within 6 dm of version 1.
  - A `next` out of range gives `WB_READ`.
  - `wb_out(v, c, c) == wb_far(v, c)` for 100,000 random pairs plus the edges 0, `WB_NEAR`, `2^32 − 1`.
  - For every rider point of the fixture: `wb_tick` gives the same state, reason, distance, `piece` and points before and after the refactor (record the old output first in a JSON fixture under `tools/`, synthetic data only).
  - `wb_tick_piece(out.piece)` gives the same output and points as `wb_tick` at the same rider point. A piece farther than 15 m gives `WB_NO_STREET`.
  - `wb_scan` of a 5 × 6 rectangle visits every piece that `wb_tick` can choose in those cells, in the order of E9.
  - Replay on the 1,500 rider points: same state and point count, distance within 1 m.
- [ ] **Step 2: Run:** `node --test tools/test_wayback_core.mjs tools/test_wayback_replay.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - `node_parse` reads one `u64` (E7). `WB_NODE_BYTES` = 8. Distance in decimetres = metres × 10.
  - Move the cell loop of `wb_tick` into `wb_scan` (row buffer: at most 8 cell records). Move the end choice ("changed" branch to the end of `wb_tick`) into `static void wb_commit(wb_engine *, const wb_cand *, uint32_t d2, uint32_t t, uint32_t chunk, wb_output *)`.
  - `wb_tick` = `wb_scan` of cells `cx−1..cx+1`, `cy−1..cy+1` (clamped at 0) with the box `X, Y, X, Y`, a visitor that measures and keeps the best, then `wb_commit`.
  - `wb_tick_piece`: load the piece by id (tree piece: node a, then its next b; extra piece: the extra record, then both nodes), measure, then `wb_commit`.
  - `wb_line_info` copies `end_dm`, `len` and `end_first` of the engine. `wbw_line_store` (Task D3) uses it.
  - `wb_grid_get`, `wb_units`, `wb_point` use the engine fields and the code of `wb_scale` and `wb_to_e7`. `wb_tick` itself uses `wb_units`.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: README:** version 2 admission, `wb_scan`, `wb_tick_piece`, the new `piece` field.
- [ ] **Step 6: Commit.**

### Task D3: Window, cache and line store

**Files:** Create `firmware/wayback/wb_window.h`, `wb_window.c`, `tools/wb_window_host.c`, `tools/test_wb_window.mjs`.

**Interfaces:**

```c
#define WBW_PIECES 640u
#define WBW_MAGIC  0x31575743u                                     /* "CWW1" */
enum { WBW_MISS = 0, WBW_HIT = 1, WBW_NONE = 2, WBW_FULL = 3 };
typedef struct { int16_t ax, ay, bx, by; uint32_t id; } wbw_piece;                     /* 12 B, positions: units - origin */
typedef struct { uint32_t id, n, end_dm, len, end_first; int32_t pt[32][2]; } wbw_line; /* 276 B, id WB_NIL = empty */
typedef struct {
  uint32_t magic, src[2]; uint8_t route[16];
  uint32_t cx0, cy0, cx1, cy1, count, ox, oy;                      /* window cells (inclusive), origin in units */
  wb_grid g;                                                       /* 24 B */
  wbw_line line; wbw_piece p[WBW_PIECES];
} wbw_cache;                                                       /* 8,036 B; _Static_assert <= 8,192 */
int      wbw_valid(const wbw_cache *, const uint32_t src[2]);
uint32_t wbw_quadrant(float heading_deg);
int      wbw_refresh(wb_engine *, wbw_cache *, const uint32_t src[2], const uint8_t route[16],
                     uint32_t x, uint32_t y, uint32_t quadrant);    /* WBW_HIT = stored, WBW_FULL, WBW_MISS = read failed */
int      wbw_nearest(const wbw_cache *, uint32_t x, uint32_t y, uint32_t *index, uint32_t *d2, uint32_t *t);
int      wbw_line_reuse(const wbw_cache *, uint32_t index, uint32_t t, int32_t pt0[2], uint32_t *dist_dm);
void     wbw_line_store(wbw_cache *, uint32_t id, const wb_engine *, const wb_output *, const int32_t (*pts)[2], uint32_t n);
uint32_t wbw_select(const wbw_cache *, uint32_t x, uint32_t y, uint16_t *out, uint32_t max);
```

Rules:
- `wbw_valid`: magic, `src` equal, `count ≤ 640`, `cx1 − cx0 ≤ 5`, `cy1 − cy0 ≤ 5`, `line.n ≤ 32`, every slot ≤ 29. Else 0.
- `wbw_refresh`: window per E11, origin = the window corner in units (`cx0 × 2048`, `cy0 × 2048`). `wb_scan` of the window with the box = the window rectangle. Store each piece in scan order with id per E10; the draw bit = the piece's grey flag (E7 bit 63 of its node, or extra bit 13). Not `da` and `db` (D1b, R-GREY): the unit has no distance rule. A piece with flag 0 is never selected by `wbw_select`. Clear the line store. More than 640 pieces: keep the first 640, `count` = 641, return `WBW_FULL`. A piece position outside `int16`: skip the piece and count it in the host output.
- `wbw_nearest`: MISS when the rider's 3 × 3 cells (clamped at 0) are not inside `cx0..cx1`, `cy0..cy1`, or when `count > 640`. Else scan the pieces in order, only slots of the 3 × 3 cells, with `wb_out` against the rider and the arithmetic of `wb_measure`, strict `<`. HIT when the best `d2 ≤ 57,600`, else NONE.
- `wbw_line_reuse`: 1 when `line.id == WB_PIECE(p[index].id)` and `line.n ≥ 2`; it computes point 0 as `wb_tick` does, and the distance as `way + end_dm`.
- `wbw_select`: pieces with the draw bit, by ring (`max(|dx|, |dy|)` in cells from the rider's cell), ring 0 first, at most `max`.
- Pure C: no float except in `wbw_quadrant`, no heap, no library call.

- [ ] **Step 1: Failing tests** (`tools/test_wb_window.mjs`, host build of `wb_window.c` + `wayback.c`):
  - `sizeof(wbw_cache) ≤ 8192`.
  - Quadrants: 0, 44.9, 45, 135, 225, 315, 359.9, NaN, 720, −1 give 0, 0, 1, 2, 3, 0, 0, 0, 0, 0.
  - Window cells for each quadrant at a synthetic rider cell, and the clamp at cell 0.
  - **Same piece as the core:** for every rider point of the fixture and each quadrant: refresh at the first point; then for each point, if `wbw_nearest` gives HIT, its piece equals `wb_tick`'s `piece`; NONE only when `wb_tick` gives `WB_NO_STREET`; else MISS.
  - **Same line:** `wbw_line_reuse` point 0 and distance equal `wb_tick` at the same rider point (exact), and the stored points equal `wb_read_point`.
  - At most 400 selected, ring order kept, only pieces with the draw bit.
  - A refresh that fails at read k (k = 1, 5, 20) returns MISS, and `wbw_valid` is 0 after it.
  - Another `src` or another route identity: `wbw_valid` 0.
  - 10,000 random caches with a correct magic and `src`: no sanitizer error in `wbw_valid`, `wbw_nearest`, `wbw_select`, `wbw_line_reuse`.
- [ ] **Step 2: Run:** `node --test tools/test_wb_window.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the rules above.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Measure on private files** (skip with a message when absent), with a replay script `.local/study/out/d3_replay.mjs` that prints counts only:
  - 70 km, 2 km version 2 file, 1,500 rider points: pieces per window p50 / p90 / max, share of FULL windows, refresh reads p50 / p90.
  - 17 Nov ride (inputs of `.local/study/out/linechange.mjs`): share of frames with no file call, mean and p90 reads per frame, against 179 / 270 today.
  - **Gates:** refresh reads p90 ≤ 160; FULL ≤ 5% of refreshes; frames with no file call ≥ 60%. If a gate fails, stop and report the numbers. Do not change a limit.
  - Write the numbers in `.local/study/out/c-study.md` and in the commit message.
- [ ] **Step 6: Commit.**

### Task D4: Second code area in the image

**Files:** Create `tools/area2_image.py`, `tools/test_area2_image.py`.

**Interfaces:** Produces `add_area2(base: bytes, code: bytes) -> bytes` per E8.

- [ ] **Step 1: Failing tests:** the output has 6 segments; DROM, IROM, IRAM and both DRAM segments keep their load addresses and data; the IROM file offset ≡ `0x20` mod 65,536; the code is at load address `0x3c37b134`; a code of 20,173 B is refused; checksum and digest valid.
- [ ] **Step 2 to 4:** run (fail), implement, run (pass).
- [ ] **Step 5: Commit.**

### Task D5: cc26 adapter and image

**Files:** Modify `firmware/wayback/wb_device.c`, `tools/wayback_device_host.c`, `tools/test_wayback_device.mjs`. Create `firmware/wayback/wb_area2.ld`, `tools/cc26_build.py`, `tools/test_cc26_build.py`.

**Interfaces:** Consumes Task D2 and Task D3 functions, `add_area2` (D4). The hook function stays `void wb_rt(uint32_t part)`.

| Item | Value |
|---|---|
| Base | only the cc25 output of Task C4 (its SHA-256 from the C4 manifest) |
| Code | `wayback.c`, `wb_window.c`, `wb_device.c` with `-DWB_NO_FWD`, in the second area from `0x4237b134` |
| Cache | `#define WBD_CACHE ((wbw_cache *)0x50000000)`; on the host a static buffer |
| Hook | the word at `0x420496b8`: base value `0x421dd920`, new value = address of `wb_rt` |
| Version | `CC700_V1.414-cc26` |
| Output | `.local/cc26/ota_1_cc26.bin`, `manifest.json` with `device_written: false` |

- [ ] **Step 1: Failing tests** (`tools/test_wayback_device.mjs`, host build of the adapter):
  - On route: no text, no file call, `line.id` set to `WB_NIL`.
  - Off route, first frame: one file open, a refresh, a line; text `NNNm T R`.
  - Off route, next frame on the same piece: **no file open**, the same line points 1 to n−1, text ends with `c`.
  - Off route, a new piece in the window: one file open, no refresh (reads below 60).
  - Rider leaves the window: one refresh.
  - Another route path or handle: refresh.
  - Codes `wb2`, `wb4`, `wb5`, `wb7`, `wb8`, `wb9` as today.
  - The window is drawn before the line; at most 400 pieces with operation 30; the draw stops when the host clock passes 60 ms.
  - Random bytes in the cache before the first frame: no sanitizer error, a refresh.
- [ ] **Step 2: Run** and see the failures.
- [ ] **Step 3: Implement** E12 and E13 in `wb_device.c`. Keep the existing helpers (`wbd_pos`, `wbd_path`, `wbd_read`, `wbd_line`, `wbd_text`).
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Builder tests** (`tools/test_cc26_build.py`): wrong base refused; only the hook word, the version text, the second area segment, the moved DRAM segment, the padding segment, the checksum and the digest change; `nm -u` empty; the code fits 20,172 B; the called firmware entries (`0x421dd920`, `0x421dd218`, `0x421b85b0`, `0x421b7de0`, `0x421b8848`, `0x421b8818`, `0x4204c1bc`, `0x420dbcd0`) begin with an `entry` instruction.
- [ ] **Step 6: Build** the candidate. Write the size and the SHA-256 in the commit message.
- [ ] **Step 7: Commit.**

### Task D6: cc26 release record and device test

**Files:** Create `docs/releases/cc26-2026-11-18.md`.

- [ ] **Step 1:** Write: what changed, image SHA-256 and size, host test results, the D3 numbers, and the device test:
  - **Hypothesis:** cc26 boots, runs code from the second area, draws the window and the line off route within 300 ms, and draws most frames on the same piece with no file call.
  - **Observation:** an old route for 2 minutes (normal map, no text). A `patch25` route with way-back data: 15 minutes with two planned detours of at least 500 m; photos of the text in each detour. Expected: texts with `c`, reads 0 on those frames, no restart, `/ABNORMAL/` empty.
  - **Duration:** 45 minutes.
  - **Restore:** install the cc25 image over USB (SHA-256 from the C4 manifest).
- [ ] **Step 2: Commit.** Do not flash. The owner approves each device step in chat.

## Not in this plan

- The stock log writer for refusal codes (the cc24 diagnostic used `0x421434dc`; its contract is not mined).
- Pool layout, the 0.25 m grid and zoom-out (tier 2).
- Way-back reach of 3 km on the page (the Overpass box grows; 3.21 MB unit estimate with scheme D). Since D1b the 3 km version 2 file does not fit (distance field 12 bits); the page uses the 1.5 km fallback. Measured with the D1b writer: the 70 km 3 km file fails with `node does not fit version 2: dist`.
- **One allocation per block (cc25.1 option, only with device evidence):** the module puts the entry array and all points in one allocation and marks it in the 4 spare bytes per entry; a trampoline over the free routine `0x4204944c` (0x27 B body) skips the per-entry frees for a marked block. Allocations per block 411 median / 730 max → 1. Start it only if the cc25 test shows slow block loads or heap fragmentation.
- Rejected: a compact decoded form (int16 points) with a new iterator (needs hooks in the iterator, `arrow.c` and the label code; decoded RAM is not the binding limit), and raw scheme D without the protobuf wrapper (saves 12 B per block, loses the old-firmware safety).
