# Native replay collector: concrete test-build design

2026-11-14. This is an offline design, not an implemented collector or a device
observation. The installed v18 image is unchanged. Private GNU disassembly and
range hashes are under `.local/native-capture-analysis/`. The replay, submit,
adapter, and publication ranges inspected here match stock and v18 byte for
byte. See [runtime ownership](navigation-runtime-extraction.md),
[lifecycle](lifecycle-audit.md), [activation](../current/native-replay-contract.md), and
[acceptance schema](../current/repeatable-validation.md).

The practical next step is a separate, explicitly named test firmware with
bounded RAM telemetry. Neither serial printf nor repeated debugger halts can
supply the requested queue timing. A halt after capture has frozen can export
RAM; a halt during capture invalidates that capture's latency claim.

## Activation without personal recovery files

A test build can use a fresh disposable activity instead of the stock recovery
route. At `0x42042605`, the STARTING continuation has `mov.n a10,a3` (2 bytes),
then `l32r a8,0x4203dc18` (3 bytes, literal value `0x420b5764`), then
`callx8 a8` at `0x4204260a` (3 bytes). The ordinary argument is zero. The smallest
**test-image-only** change is the two-byte `movi.n a10,1`. It leaves the stock
activation wrapper's allocation, configuration-ID-0, unchanged-state, source
open and open-failure guards in place. It changes behavior for every new activity
in that test image; it is unsuitable for the ordinary installed image. A
caller-selective wrapper plus an explicit armed marker is preferable if the
image is to remain installed for more than one controlled activity.

Before that call, this continuation invokes calculation helper `0x42143b0c`,
`0x4203cdb0(context=0x3c383e50)`, `0x4203d184(context)`, waits 100 ticks, stores
ride state 3, and calls `0x4203b8bc`. This bounded sequence alone does not prove
that recording file creation succeeded. Instrument and check the recording
start result/file handle in the enclosing path before arming; do not label
"state 3" as checked recording success. Navigation setup continues after replay
activation, so the first fix can precede that setup. The test report must retain
this ordering. Stock ENDING/ENDWITHOUTFIT calls still request deactivation.

This avoids constructing or resuming `RealSession.db`, whose normal recovery
path can truncate FIT/lap files. It remains a firmware change requiring its own
build, review and controlled installation; this document performs none.

## Exact stock boundaries and ABI

Arguments below use callee `a2...` registers for a windowed function, or caller
`a10...` immediately before `callx8`/`call8`.

| Boundary | Concrete instruction contract | Collector information |
| --- | --- | --- |
| Replay allocation | `0x420b58e6`: `movi.n a10,52`; `58eb`: call heap allocator `0x403763e0`, caps `0x404`; `58ee`: store returned GPS pointer at `0x3fca27e4` | Initialize collector allocation before publishing this pointer |
| Active wrapper | Entry `0x420b5764`: `entry a1,32` (3 B), `l32r a3,...` (3 B), `extui a2,a2,0,8` (3 B), `l32i.n a7,a3,0` (2 B), `beqz a7,...` (3 B) | Request is not outcome: log active byte after completed wrapper |
| FIT record assembly | `0x420b5125` record-message-20 branch copies previous 100 B, then current 100 B at `0x420b514d`; source is decode buffer, destination state base `+668` | Increment source ordinal at the actual current-record copy, not once per pump call |
| Decode completion | `0x420b5068` entry `entry a1,48` (3 B), `movi.n a3,1` (2 B), `beqz a2,...` (3 B), `l32r a4,...` (3 B), `l32i.n a5,a4,0` (2 B), `beqz a5,...` (3 B) | Return/result and decoder-state distinguish successful record from terminal/error |
| GPS submit | `0x420b5d2a`: pointer to caller `a11`; `5d2c`: length 52; `5d2e`: type 8; `5d31`: `call8 0x420b3964` (3 B) | Unique submission ID; current source ordinal; actual 52 bytes before enqueue |
| Submit body | Entry `0x420b3964`: `entry a1,48`, `extui a4,a4,0,16`, `bnez a3,0x420b39b4`, `l32r a2,...`, `l32i a2,a2,0` — five 3 B instructions | Arguments `(source_type, pointer, uint16 length)`; result 0/1/2 |
| Descriptor | `39b4`: `s16i a4,a1,8`; `39b7/39b9`: type and pointer at stack +0/+4; queue send at `3a01`, zero wait | 12 B copied, payload is not copied; bytes +10/+11 are not initialized by this sequence |
| Raw receive | `0x420b3478`: queue receive into consumer stack +64, zero wait; result 1 branches to `0x420b3549` | Capture descriptor, including an explicit test token, before forwarding |
| Ingest call | `3549..3555`: `a10=type`, `a11=pointer`, `a12=0x3c3ae95c`; call `0x42143724` | Descriptor length and padding are not passed to this adapter |
| Type 8 adapter | `0x42143795`: reads pointer +24 speed; `437c4..cb`: sets 44 B copy from pointer to input +80 after speed check | Observe raw payload at entry and actual input copy; rejected speed leaves prior input |
| Process | `0x420b3487`: call `0x42143e70(100)` after raw queue is empty | Give each invocation a processing ID; bind it to last input actually copied |
| Publication | `0x421457ac..bb`: five 3 B instructions load state `0x3c3aedbc`, exported `0x3c3aeae8`, size 724, memcpy pointer, then call | Increment generation only **after** original copy returns; capture exported type-15 bytes +472 |
| Redirect | Getter `0x420eeaa8` checks `0x420b4fcc()` and obtains GPS pointer from `0x420b51c0()` only when active | Deactivation evidence must include active false and getter selecting live buffer |

The decode buffer is 512 B (`0x3fca27f0`); replay state is 884 B
(`0x3fca27ec`); filename table is 7682 B (`0x3fca27e8`); GPS allocation is 52 B
(`0x3fca27e4`). Additional replay sensor buffers are 2, 2 and 20 B. All these
allocations use PSRAM caps `0x404`. A pointer is retained globally; ownership is
not transferred by the raw queue.

## Carry lineage through the queue, including reused pointers

Do not match a consume event by pointer, timestamp, coordinates, or a hash alone.
The same native GPS buffer is reused, duplicate records are legitimate, and
multiple descriptors can be pending. A side FIFO attached only before/after
`xQueueSend` has a race: a consumer may run before enqueue returns, and other
producers may interleave. Logging an enqueue return does not identify its queue
slot.

A narrow test-build solution is a nonzero uint16 submission token stored in
**descriptor padding +10** before sending. Preserve type, pointer, length,
queue size 12, original zero-wait behavior and the original GPS buffer. Read the
token from received descriptor stack +74. The normal consumer only forwards the
first two words, so this does not change that local adapter ABI. Limit a capture
to fewer than 65535 submissions, reserve zero for untracked producers, and refuse
capture when device state 12 selects the alternate queue. A retained token table
maps token to source ordinal and submit bytes/result. Publish its pending entry
before queue send; accept consume-before-send-return in the binary journal and
resolve acceptance offline. Timestamp submit at send entry; timestamp its result
separately. Do not reorder measured times to disguise concurrent behavior.

This proposal changes two descriptor padding bytes. Before implementation is
accepted, bounded cross-reference/control-flow verification must establish all
consumers of this particular queue and exclude a consumer that inspects the
padding. If that cannot be established, instrument the RTOS queue's actual
slot-copy linearization (send and receive) and record queue handle plus storage
slot/wrap generation. A guessed FIFO order is not a substitute. A second option
is attaching a token to a new queue item layout, but that requires changing every
producer/consumer and is substantially broader.

At ingest, distinguish "descriptor consumed" from "input updated". Associate a
publication with the last successful type-8 input copy in that processing
invocation, not merely the last dequeued GPS descriptor. For a speed-rejected
final record, delivery may be observed while the checker's final-input snapshot
requirement remains unmet. Keep that as a separate negative/filter case rather
than falsely correlating the old coordinates with the rejected input.

There is an additional mutable-buffer race **inside** the adapter: it loads
speed before floating-point conversion and later copies 44 B. An entry-time
52-byte sample alone is not proof of coherent bytes throughout that interval.
Instrument producer write-begin/write-end, adapter entry, the speed-load value,
and the completed input copy. Reject an acceptance claim when an adapter read
interval overlaps a producer write, or when the sampled first 44 B differ from
the completed copy. Include deactivation's buffer clearing as a writer. Do not
silently introduce locking or per-submission replacement GPS buffers: either
would change the ownership behavior being measured. A whole-program writer
claim remains beyond these bounded ranges; unaccounted writes make evidence
incomplete.

## Storage, synchronization and capacity

Use an enlarged test-only GPS allocation with its original 52-byte prefix.
Place a fixed header at `GPSbase+52` (4-byte aligned), followed by bounded
journals. Keep the global and getter returning `GPSbase`. The allocator hook
requests the whole size, zeros/initializes the header and sets magic/version
**before** publishing the global. Hooks must not probe beyond an ordinary
52-byte allocation; an instrumentation build cookie and initialization path are
required. Do not borrow arbitrary stock RAM or map scratch words.

The bounded initialization and stop paths zero exactly the first 52 B, leaving
this header intact. No GPS free/reallocation is identified in these local replay
functions; scan all pointer writers/frees before relying on cold-boot lifetime.
If teardown later frees the allocation, disable writers and export before that
free. Allocation failure must leave replay unarmed and report incomplete capture.
The existing linker forbids writable `.data/.bss` and has only **8600 bytes**
free in the last IROM page; put telemetry in allocated PSRAM, not flash globals.
Require the linked final image to satisfy the existing page-bound assertion.

Prefer separate bounded journals for replay producer, calculation consumer and
lifecycle producer, with one verified task writer per journal. Each slot has a
sequence, timestamp, stage, lengths, IDs and a commit word written last; use
release/acquire barriers appropriate to Xtensa and PSRAM. Do not assume
`volatile` supplies inter-core ordering. If a task may execute concurrently
with itself or multiple tasks share a journal, use a verified short RTOS-safe
reservation primitive; do not invent an unverified spinlock or mask interrupts
while copying kilobytes. Log lost/overflow counts and stop recording without
wrapping over old evidence. Frozen committed counts define export length.

One concrete conservative allocation is 512 KiB: up to 2048 decoded records
at 128 B each, 4096 submit/consume payload events at 80 B each would **exceed**
that allocation together. Instead fix **1024 decode slots ×128 B =128 KiB**,
**4096 payload slots ×80 B =320 KiB**, and **1024 control/snapshot slots ×48 B
=48 KiB**, total 496 KiB, leaving 16 KiB for header/token bookkeeping. These are
layout budgets, not measured device headroom. Submission tokens require a
bounded compact map; 2048 entries ×8 B already use the entire 16 KiB remainder,
so reduce payload/control slots or enlarge allocation for a real header. A
simpler implementable initial capture uses **960 decode, 3840 payload, 960 control
slots and 2048 token entries**, consuming 492544 B before header; 512 KiB then
leaves 31744 B. Verify packed struct sizes statically. At about one decode,
one submit and one consume per second, payload capacity is about 1920 seconds;
prescans and timestamp reuse change all rates. Capacity must derive from the
actual fixture manifest and maximum submissions, not nominal ride duration.

Hash offline. Save the complete agreed 100-byte decoded-record representation
plus ordinal; save actual 52 GPS bytes at submit/consume and exported 20-byte
position record per publication. Fingerprints of raw FIT bytes and decoded
representations are different contracts. The fixture manifest must explicitly
choose and independently derive its canonical representation. Preserve fixture
file hash, firmware hash, record ordinals and duplicate timestamp IDs. Do not
invent an expected 100-byte struct hash without defining invalid/sentinel and
retained-field semantics of the stock FIT reader.

Use a common free-running hardware microsecond clock for all journals; the
identified `0x403779f4` timer getter returns a 64-bit time via the hardware
conversion callback. Validate its calling convention before using it; RTOS
32-bit tick readings alone lose sub-ms overhead and need wrap handling. Sort
committed events offline using timestamps and explicit causal IDs. Equal-time
causal ordering must be documented. Measure recorder cost using cycle counts
and recorded entry/exit timestamps; retain CPU frequency/core identity and
maximum cost. Run an instrumentation-disabled baseline for perturbation. No
latency budget is defensibly "safe" from this static design.

## Hook relocation and completion gates

The current map trampolines replace complete bodies; the replay collector must
usually preserve the original body. Do not copy their overwrite lengths blindly.
A 3-byte call cannot reach the remote tail; existing code already documents
this call range limitation. At an aligned site a 15-byte inline absolute detour
can contain `j` to +8, padding plus aligned literal at +4, `l32r` at +8 and
`jx` at +11, then padding. Its assembly island preserves live registers,
executes displaced instructions with corrected literals/branches, and rejoins
at an original instruction boundary. Preserve original `entry` exactly once
for an entry hook; preserve `a0` and window state for interior hooks. Verify the
actual assembled bytes, register liveness and every branch landing in the
replaced span. The publication span `0x421457ac..0x421457bb` is exactly 15 B;
its relocated memcpy must finish before generation advances. Decode's shared
copy site needs destination/length discrimination to avoid counting other FIT
message structures.

Freeze only after terminal decode, all tracked accepted descriptors consumed,
the final successful input's publication observed, explicit stock deactivation
completed, live getter redirection checked, and no further capture writers in
flight. EOF alone does not stop replay: result gates future pumping while the
active flag may remain true, and a terminal decode can still be followed by
submission within its current iteration. Decoder states 2/4/5 are terminal
categories, not proven synonymous with well-formed EOF. Confirm file progress
and decoder terminal semantics for the chosen fixture; retain raw state/result
in the journal and report ambiguity as incomplete.

Export once frozen through a controlled RAM read. On timeout or overflow,
request ordinary stop; preserve failure evidence, do not manufacture missing
consume/snapshot events, and do not reuse a half-frozen buffer. Restore the
verified v18 image and remove only explicitly inventoried disposable test
files/configuration after export. Keep rollback and file preservation manifests
prepared before installation. This design does not authorize or perform those
writes.

The exporter can then build the existing `tools/replay_observation.py` schema:
source ordinal IDs, canonical hashes, unique submission IDs, actual payload
hashes, post-copy publication generation, explicit limits and stop/end counters.
Extra journal evidence remains necessary to substantiate correlation, reader
coherence and overhead; a passing JSON checker cannot supply those proofs.

Verification for this design: 1388 reached instructions across decode, pump,
submit, activation, initialization, consumer and adapter functions were checked
against GNU Xtensa instruction sizes and direct branch targets, with zero
discrepancies. The private `boundary-checks.json` preserves per-function counts;
`evidence.json` preserves range hashes and stock/v18 equality for the initially
inspected ranges. This is instruction-boundary verification, not a proof that
all indirect callers, payload aliases or teardown writers have been found.

## Offline implementation produced after this design

A private, repeatable build now exists at `.local/native-capture-build/build.py`.
It implements the bounded capture core and an **allocator-only** assembly/image
candidate, not the full tracepoint integration. Five HOST test binaries pass
under AddressSanitizer/UndefinedBehaviorSanitizer; the core suite exercises ten
scenarios, with separate reused-buffer and allocation-cleanup regressions. Red
logs precede their implementations. The target ELF has zero writable globals
and no undefined symbols; its build report records exact remaining page space.

The concrete allocation is 512200 bytes of PSRAM plus a separately allocated
24-byte internal-RAM atomic control block. The header at GPSbase+52 roots that
control pointer and three 1024-slot journals; each event is 144 bytes, and 1024
submission entries preserve their original 52-byte payload. All native CAS and
atomic RMW operations target the internal block: Espressif's implementation
explicitly excludes native compare-and-swap on external RAM. See the primary
[CPU compare-and-set implementation](https://github.com/espressif/esp-idf/blob/master/components/esp_hw_support/cpu.c).
The earlier general PSRAM synchronization proposal must be read with this
constraint.

Stop and gate closure are not enough to establish stock-task quiescence. The
implemented seal also requires separate replay-task and calculation-task
safe-point acknowledgements, including an actual empty-queue witness, after
stock deactivation. Those target hooks are still absent. The allocator candidate
preserves original GPSbase/52-byte zeroing and initializes context before global
publication; it is visibly named `CC700_V1.414-capALLOC-only` and has not been
installed. Full lineage transport, adapter/publication correlation, safe points,
clock/overhead collection, EOF semantics and export remain integration work.

The final private package also contains a fourth sanitizer-tested observer
helper, compiled separately and **excluded** from the candidate ELF/image.
A proposed record detour at `0x420b5143..0x420b5152` was rejected because direct
jumps at `0x420b510b`, `0x420b515b`, `0x420b5167`, `0x420b5173` and `0x420b5181`
enter shared memcpy setup `0x420b514a` inside that span. No record/lifecycle hook
was installed in the candidate. `allocator-static-proof.json` checks the actual
allocator overwrite, preserved existing bytes, island/rejoin literals, original
instruction boundaries, image checksum and appended SHA-256. These remain
static checks; the working native collector boundary is the tested core plus
allocator-only candidate, with 5488 bytes left in the v18 IROM page.

Fresh review exposed an error-publication race: an invalidator or failed-entry
reentrancy report could pause before setting its fault while sealing completed.
The private core now reserves internal-RAM publication activity through these
paths, and finalization atomically closes publication only when its in-flight
count is zero. Two controlled pthread interleavings failed before the fix and
pass afterward under ASan/UBSan. The five-binary verification and allocator
static proof were rerun successfully. Final exact budgets are **512200 bytes
PSRAM plus 24 bytes internal RAM**, with **5488 IROM-page bytes remaining**.
The allocator-only integration boundary is unchanged; no target installation
or new tracepoint hook was added.
