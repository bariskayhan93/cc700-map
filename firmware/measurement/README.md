# Bounded test-only target measurement

`probe.c` is the actual target probe. It owns one sample on each invocation's
stack, with no dynamic allocation, writable globals, persistent pointer or
borrowed buffer. By default it measures during boot microseconds 0 through
119,999,999. The builder accepts `--window-seconds` from 1 through 600 and
records the compiler defines and interval in its manifest. Outside that window
native work still executes. It checks the
native system-timer peripheral and conversion callback before activating.
Ordinary v21 does not contain this probe. A second runtime gate checks the
current task's stack before heap/export helpers: at least 3072 bytes before
capture and 2048 bytes inside the export helper. This is a conservative local
margin gate, not a proof of an unobserved native callee's maximum stack use.

The current core comes from PRID bit 13, matching native code at `0x4038298c`.
Core selection and `0x403832e0()` current-TCB lookup run in a short level-3
interrupt-masked section; the prior PS is restored immediately afterward. This
prevents task migration between core selection and lookup. The getter's identity is independently proved by native interrupt dispatch:
`0x40380c11..0x40380c1b` saves current SP at the selected TCB's first word and
`0x40380c4d..0x40380c57` restores SP from that same TCB. Both use per-core active
TCBs at `0x3fc9ef64`, also used by the getter and task-creation publication.
The TCB, stack base
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

An earlier ABI identification was wrong: `0x403829dc(core)` returns the per-core
idle-task handle from `0x3fc9ecbc`, not the active task. A real startup diagnostic
showed its 1536-byte idle stack did not contain the GUI's SP. The bounds guard
returned zero before any stack-fill scan, so those candidates emitted no normal
capture records. The earlier current-task identity claim is withdrawn. Native
idle-task creation and active context save/restore now establish the distinction;
current candidates use `0x403832e0()`. An actual mismatched idle-pointer/SP fixture
is retained in the host bounds test. Current GUI stack margins still require a
new observed startup diagnostic after this correction.

Build separate modes with `python3 tools/target_measurement_build.py --mode
iterator|navigation|composition|block --output NEW_DIRECTORY`. The builder pins the exact
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
- Navigation: iterator telemetry followed by a separate checksummed `CC7N1`
  scalar observation. Raw clock brackets surround fixed scalar reads only:
  navigation/ride/arrival states, matched point/road/flags, section, display
  indices and producer snapshot threshold. No live object pointer is followed.
  Repeated navigation state, matched point and threshold values can expose some
  races; equal repeats are **not** a coherent/atomic snapshot. The producer
  threshold is not the live widget threshold. This record is not a performance
  sample, does not include position or ride baseline and cannot identify the
  file without an external receipt. Export is after iterator timing, adds load
  to subsequent frames, and is bounded to 188 bytes including NUL. Native scalar
  sources are documented in the ABI receipt and grey-route state report.
- Composition: wraps the unchanged native `0x4204da24` call at `0x420516a7`.
  Its trampoline occupies the remainder of the already replaced iterator
  body, `0x4204968c..0x420496a0`. This excludes preceding canvas preparation and
  later GUI flush; it is not a complete navigation frame. Iterator telemetry
  is absent in this mode, so nested serial export does not pollute the interval.
- Block: wraps the actual existing `cc_blk` implementation, preserving all
  returns, arguments and ordinary allocation failure behavior. It includes
  cached/no-op loads and reports requested type/road, not a proven loaded block
  offset. Before/after heap snapshots do not measure peak overlap phases.

The timing clock is the no-argument 64-bit raw system timer at `0x403779f4`. GNU
inspection follows its coherent 52-bit hardware latch read and installed
right-shift-by-four conversion. The output wraps at 48 bits; captures must not
span reset, wrap or timer reinitialization. Use `0x40377954` only for activation-window gating: initialization computes
its offset from RTC-now minus saved RTC-at-app-start minus raw counter. Native
raw timer initialization enables the counter without establishing a reset to
zero, so raw counter age is not a justified boot-window clock. Timing intervals
continue to use raw values exclusively. Avoid wall clock `0x42005f38`. The probe reports a pair of clock reads per
sample; this is an observed clock-pair cost, not the full collector overhead.

Heap information at `0x42003b50` accepts a 28-byte output followed by a capability
mask. It locks individual heap regions; the aggregate snapshot is not globally
atomic. Its free/largest/minimum fields are at bytes 0/8/12. The narrow probe
makes no internal-heap or total-allocation-margin claim.

Export occurs only after the final timestamp. The native USB Serial/JTAG byte
callback at `0x420074ec` receives `(fd, byte)` exactly as its caller at
`0x420073e4..0x420073ea` does. GNU inspection proves hardware FIFO writes,
raw-clock polling with a 50,000-microsecond timeout, and no allocation or retained
source pointer. The probe checks that the live native TX callback still equals
that address. Its bounded caller-owned line is exported one byte at a time;
then bit 0 at `0x60038004` is set, exactly matching the native newline flush.
No printf, application logger buffer, mutex initialization or shared-storage
commandeering is involved.

This deliberately bypasses the native VFS writer's lazy mutex initialization,
whose allocation failure can assert. Concurrent native console output may
interleave; each measurement payload has an FNV-1a checksum and damaged lines
must be rejected. The checksum excludes the prefix, so analysis must also
require channel agreement with the pinned build manifest. The iterator line is
at most 233 bytes including its NUL; other modes use at most 206. Export and heap
calls perturb subsequent frames. No global sequence counter exists, so a
checksum detects damaged lines but cannot prove zero sample loss. Runtime USB
sink observation remains necessary. `tools/target_measurement.py` parses
observed axes only and explicitly preserves these limitations.

An earlier ROM-printf candidate produced no telemetry in its controlled trial.
That establishes no performance observation. The valid S3 internal-DRAM range
is `0x3fc88000..0x3fd00000` per the
[official SoC definitions](https://github.com/espressif/esp-idf/blob/v4.4/components/soc/esp32s3/include/soc/soc.h).
The earlier conservative `0x3fce0000` cutoff incorrectly rejected some valid
stacks; a regression now exercises that upper region. This is a confirmed gate
bug, but the actual trial's runtime TCB/stack addresses were not observed, so it
cannot be claimed as the cause of missing output. Hook activity, window timing,
other guards and ROM routing were not distinguished by that trial. Current
USB-byte builds remove the ROM-routing ambiguity and correct the DRAM gate.

Every current test build includes a once-per-GUI-task startup diagnostic. Only
the existing creator literal at `0x420009a4` changes from the original entry
`0x42009318` to a `void(void *)` wrapper. The wrapper preserves its argument,
emits `CC7D1`, then calls the unchanged original entry. No writable marker flag
or private RAM is needed: task-entry lifetime bounds the diagnostic to one call.
Its separate no-inline temporary stack frame returns before the original GUI
loop; the persistent wrapper frame is 32 bytes.

`CC7D1` reports separate timer-device, timer-conversion, USB-registry, stack and
capture-window gates, plus both clocks and own-task stack metadata. The normal
capture window, stack policy and stdout registry do not suppress this startup
marker. The initialized raw timer ABI remains essential because the native USB
byte callback itself calls that timer. A diagnostic is never a performance
sample. `parse_diagnostic_line` and CLI `startup_diagnostics` decode it separately.
A host regression verifies a raw counter of 9,000,000,000 microseconds with a
boot clock of 60,000,000 still activates capture. Another verifies startup output
outside the window despite a different stdout registry callback, while
preserving the original task-entry argument and making no heap observations.

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

A manual bench session can use `--window-seconds 600` to allow time for physical
power-on and reopening navigation after the test reboot. Default builds retain
the first 120 seconds. Both include the initial map draw: a stationary device
may not redraw during a delayed window. Host capture/restoration remains
separately bounded; a window with no map invocation is not a timing sample.
The operator must confirm navigation visibility **after** the test reboot;
visibility on ordinary firmware before installation does not establish test
workload activity. App-load output does not establish that the screen is on.
