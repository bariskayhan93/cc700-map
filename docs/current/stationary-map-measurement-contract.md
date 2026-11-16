# Stationary target measurement contract

A connected device is necessary but is not itself a performance measurement.
The current installed renderer has no verified frame/lock/contiguous-heap collector.
Serial observation during this evaluation captured ota_1 boot output; it did not
provide those channels. No flash/route writes, GPS injection or requested reset
were performed. Boot output alone does not prove runtime timing or build identity.

## Required capture identity and workload

- Verified test-image/base-image hashes and restoration receipt.
- Route-file hash, exact block/section identity, selected layers and source identity.
- Camera center, heading and effective zoom; native 240×256 map surface.
- Named workload: city, village, forest, polygon-heavy crossing, repeated block
  loads and off-route redraw. Cold/warm behavior must be separate.
- Recording/radio/replanning state and any sample loss or capture disturbance.

## Instrumentation boundaries

| Component | Boundary to instrument | What an observation would establish |
|---|---|---|
| Map iterator | Entry, mutex-acquired, post-draw and post-unlock around current `cc_iter` | Iterator wall, lock-call duration, draw-under-lock and conservative hold bounds; exact wait/hold need closer boundaries |
| Projection | Native projection callback entry/exit, counts and point totals | Projection component and agreement with calculated work |
| Raster/text | Actual native line/text calls and custom fill component | Component durations; browser drawing does not substitute |
| Block load | Serialized allocation, old decoded free, new decode and serialized free | Peak overlap phases and load duration |
| Heap | Capability-specific free/largest/minimum observations at named phases | Observed allocation margin and fragmentation; not an unobserved worst case |
| Navigation frame | Native frame start/end, separate canvas construction and flush | Full-frame distributions; iterator duration is not full-frame duration |

Use a verified monotonic target clock. If using cycle counts, verify CPU identity,
frequency changes, wrap and preemption accounting. Report observed samples and
maxima rather than claiming worst-case execution time from a short run.

A test collector must have bounded owned storage, initialization/overflow rules,
coherent publication and explicit lifetime across block changes. Allocate it
through a proven interface; do not commandeer an apparently unused global or
unexplained allocation padding. Measure/declare collector overhead. No printf,
file write or debugger halt during a timing interval; exporting after a frozen
capture is distinct from collecting it.

## Acceptance and restoration

The collector needs host boundary/race/failure tests, binary range/ABI verification,
code-page/stack accounting, a fresh exact rollback backup, and guarded installation.
Preserve stock ota_0 and route/ride storage. At the end restore/verify ordinary
v21, automatically boot it and confirm that test activation/telemetry is disabled.

These requirements are the next bounded instrumentation task, not claims that
it has already been implemented. The offline selector candidates remain withheld
from production while this target-runtime gate and the intended recovery feature
contract remain open. This preserves useful current behavior instead of spending
unmeasured capacity based on a map-only radius result.

## Implementation follow-up, 2026-11-15

A bounded collector, startup selftest and calibration tools now exist. The
[combined-phase report](../reports/implementation-phase-2026-11-15.md) separates implemented
code, actual startup observations, corrected native bindings and outstanding
active-workload acceptance. The earlier "missing collector" statements above
refer to the pre-implementation baseline; they are not a workload validation.
