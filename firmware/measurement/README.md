# Bounded test-only target measurement

`probe.c` is the actual target probe. It owns one sample on each invocation's
stack, with no dynamic allocation, writable globals, persistent pointer or
borrowed buffer. It measures only during boot microseconds 120,000,000 through
149,999,999. Outside that window native work still executes. It checks the
native system-timer peripheral and conversion callback before activating.
Ordinary v21 does not contain this probe. A second runtime gate checks the
current task's stack before heap/export helpers: at least 3072 bytes before
capture and 2048 bytes inside the export helper. This is a conservative local
margin gate, not a proof of an unobserved native callee's maximum stack use.

The current core comes from PRID bit 13, matching native code at `0x4038298c`.
Core selection and `0x403829dc(core)` current-TCB lookup run in a short level-3
interrupt-masked section; the prior PS is restored immediately afterward. This
prevents task migration between core selection and lookup. The TCB, stack base
and top must lie within internal DRAM bounds, have valid alignment/order, and
contain this invocation's SP. Only that task's stack is inspected. A bounded
scan reads at most 1024 fill bytes from its base, below its current SP. Output
reports the smaller observed SP-to-base margin at capture/export, plus the
smaller observed A5 prefix. A prefix of 1024 is capped and means at least 1024;
this is not an unbounded scan or a global high-water measurement. Native GUI
task creation proves an actual 8192-byte stack allocation, but other task
invocations must pass their own bounds/margin checks. Telemetry versions are
`CC7M3` (iterator), `CC7F2` (composition), and `CC7B2` (block); parsers retain older
versions for prior host fixtures.

Build separate modes with `python3 tools/target_measurement_build.py --mode
iterator|composition|block --output NEW_DIRECTORY`. The builder pins the exact
stock image, ordinary v21 image and v21 source receipt, verifies unchanged native
ABI ranges, compiles copied sources, enforces the existing code-page/global
linker assertions, and writes disassembly, stack-usage files and a manifest.
It performs no serial or device operations. Each output's `iterator-probe.bin`
is its test firmware, regardless of mode; use its manifest's mode and SHA-256.

- Iterator: four timestamps around the actual block lock/draw/unlock, plus PSRAM
  capability `0x404` free/largest/minimum snapshots before and after. `CC7M3`
  also reports input geometry points, input polygon vertices, and allocated
  label storage bytes, counted in the iterator's existing first scan. These
  are source work totals, not executed projection or raster totals. Saturated
  work counters equal `UINT32_MAX`. The counter update overhead is included.
- Composition: wraps the unchanged native `0x4204da24` call at `0x420516a7`.
  Its trampoline occupies the remainder of the already replaced iterator
  body, `0x4204968c..0x420496a0`. This excludes preceding canvas preparation and
  later GUI flush; it is not a complete navigation frame. Iterator telemetry
  is absent in this mode, so nested serial export does not pollute the interval.
- Block: wraps the actual existing `cc_blk` implementation, preserving all
  returns, arguments and ordinary allocation failure behavior. It includes
  cached/no-op loads and reports requested type/road, not a proven loaded block
  offset. Before/after heap snapshots do not measure peak overlap phases.

The clock is the no-argument 64-bit raw system timer at `0x403779f4`. GNU
inspection follows its coherent 52-bit hardware latch read and installed
right-shift-by-four conversion. The output wraps at 48 bits; captures must not
span reset, wrap or timer reinitialization. Avoid `0x42005f38` and `0x40377954`,
which add mutable clock offsets. The probe reports a pair of clock reads per
sample; this is an observed clock-pair cost, not the full collector overhead.

Heap information at `0x42003b50` accepts a 28-byte output followed by a capability
mask. It locks individual heap regions; the aggregate snapshot is not globally
atomic. Its free/largest/minimum fields are at bytes 0/8/12. The narrow probe
makes no internal-heap or total-allocation-margin claim.

Export occurs only after the final timestamp. ROM `ets_printf` at `0x400005d0`
is used with a caller-owned bounded string, bypassing the application's shared
logger scratch. The address is present in exact stock call sites and in the
[official S3 ROM map](https://github.com/espressif/esp-idf/blob/v4.4/components/esp_rom/esp32s3/ld/esp32s3.rom.ld).
Runtime routing to the connected serial sink remains an installation check.
Output may interleave with native logging: each line has an FNV-1a checksum.
The iterator line is at most 233 bytes including its NUL; other modes use at
most 206. Export and heap calls perturb subsequent frames. No global sequence
counter exists, so a checksum detects damaged lines but cannot prove zero
sample loss. `tools/target_measurement.py` parses observed axes only and
explicitly preserves these limitations.

`journal.c` is a separate host-tested bounded journal for a future capture
owner that can provide verified mutual exclusion. Initialization/reinitialization
and storage destruction must occur exclusively before/after caller publication.
All later operations require the supplied lock, including freeze, snapshot and
close. Snapshot output must be separate storage. Do not reclaim the journal or
synchronization context until every caller has joined. A lock failure is returned
without touching capture data; it cannot safely increment a shared loss count.
Record only after the measured interval. Freeze rejects later writers, and
frozen snapshots remain identical even while writers attempt records. There is
no firmware binding of this journal to arbitrary RAM or allocation padding.

Host tests compile the real C code and exercise bounds, overflow, monotonic
rejection, failed locking, identity copies, block changes, teardown, concurrent
freeze/publication, capture windows, work-counter saturation and no serial/heap
calls inside measured intervals. Xtensa outputs have no unresolved symbols or
writable data/BSS. Final iterator static stack is 592 bytes (ordinary v21: 512),
plus its callees; iterator export adds a 336-byte frame plus wrappers/native callees; composition
and block export use 352 bytes plus 128-byte wrappers.
These figures are accounting, not proof of remaining GUI task stack margin.

Installation still requires a fresh exact rollback backup, guarded install,
readback identity, a named workload/route hash/block-section/camera receipt,
observed serial completeness and disturbance, stack-margin acceptance, and
ordinary-firmware restoration/readback/automatic boot verification. No builder
performs installation or treats an offline build as target acceptance. Missing
full-frame, projection, raster/text, canvas, flush, block-overlap and heap-phase
channels still prevent general resource calibration.
