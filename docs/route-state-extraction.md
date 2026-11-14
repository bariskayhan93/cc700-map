# CC700 route matching and off-route state extraction

The subsequent [geometry audit](geometry-boundary-audit.md) resolves local
zero-coordinate, neighbor-endpoint and fit-division boundaries described as
unextracted below. Exceptional arithmetic and runtime equivalence remain open.

Evidence date: 2026-11-13. Offline extraction from the stock image identified in
[the behavior ledger](navigation-behavior-extraction.md). No device accessed.
This closes specific local branches; it does not close navigation as a whole.

## Where the displayed off-route flag comes from

![Candidate decisions and persistent off-route state](mining/09-offroute-state.png)

The dispatcher at `0x42054684` calls `mg_road_yaw_calculate` at `0x420547dd`,
then copies its entire 148-byte result to `0x3c3894f0` at
`0x420547e0..0x420547ec`. It passes the preceding result as an input, preserving
state between calls. This call uses search mode 0.

The result is consumed by notice logic, progress calculation and display logic.
In particular, `0x42050618` returns whether byte `+145` at `0x3c3894f0` is
nonzero; the existing basemap wrapper uses that getter to skip drawing.
Thus a raw position disagreement and a hidden basemap are separated by the
matching calculation, persistence logic, dispatcher publication and draw call.

| Offset in 148-byte result | Extracted role | Evidence |
|---|---|---|
| `+108`, uint16 | Selected point index, logged as `PIndex` | `0x4204bab3`, `0x4205480f` |
| `+112`, uint32 | Distance to the selected center route point, truncated to unsigned integer | `0x4204bd87..93`, consumed at `0x42052b93` |
| `+132`, uint16 | Separate matching/misjudgment counter | `0x4204ae6b..85` |
| `+136`, uint16 | Candidate-repeat counter | `0x4204bf70`, `0x4204bfa8..cf` |
| `+144`, byte | Special proximity flag consumed by dispatcher reload logic | `0x4204bf8a`, `0x420547c0` |
| `+145`, byte | Committed off-route state | `0x4204bfcf`, getter `0x42050618` |
| `+146`, byte | Set to 1 on normal completion; zeroed before early failure | `0x4204bff5`, initialization `0x4204b1f1..204` |
| `+147`, byte | Previous/current candidate state | `0x4204b220..23`, `0x4204bf68..73` |

The two counters are different mechanisms. The matching counter at `+132`
must not be conflated with the off-route repeat counter at `+136`.

## Search is more than nearest-point lookup

The routine at `0x4204b1e0` first obtains the point count from the list at
`0x3c388cf8`. Its search bounds are established at `0x4204b232..25a`:

| Search mode argument | Point interval |
|---|---|
| 0 | `[0, point_count)` |
| 1 | `[start_index, min(start_index + 10, point_count))` |
| Other nonzero values | Both bounds are initialized to zero in this branch; caller contract unresolved |

For the observed dispatcher mode 0, the raw point pass scans the whole list.
It is not confined to a window around the previous progress index. The loop
uses the list iterator (`0x42049244`, `0x420492c4`, `0x42049290`), rather than
performing an indexed linked-list lookup for every point.

The raw nearest-point comparison at `0x4204b89f..8ef` replaces the best index
on a strictly smaller projected-coordinate distance. An equal distance has
additional exact-coordinate checks and stores an index pair. Consequently,
an arbitrary nearest-point tie policy would not reproduce this pass.

The same pass builds 72-byte candidate records grouped by the point's uint16
field `+40`, retaining nearer points within a group and calculating angular
differences. The field's full route-format meaning is not assigned here.

The helper labelled `RoadPointCalculateMisjudgeHandle`, `0x4204abf4`, can
replace the selected point. The extracted mechanisms include:

- Sorting candidates by distance field `+4`, through comparator `0x4204a380`.
- Considering candidates within the first candidate's distance plus 100.
- Filtering those candidates by angular difference `<= 90`.
- Consulting prior progress, an angle-validity argument and speed `>= 3`
  after division of GPS speed by 1000.
- Applying further angle comparisons against 135 and 225, a separate repeat
  counter, and `SearchLastPointIndex` at `0x4204a39c`.

The [subsequent arbitration extraction](remaining-extraction-and-device.md)
now resolves the helper's local return paths, separate counter and output-road
behavior, plus normal road advancement. Upstream geometry degeneracies and
runtime interleavings still prevent a crossing simulator from claiming equivalence.

One helper dependency is now resolved: `SearchLastPointIndex` scans from the
start for the **first** point whose uint16 field `+40` and both coordinate
floats exactly equal the previous result's fields. It returns that index;
if none matches, it returns the previous result's stored index `+108`.
It does not select the last occurrence merely because its label says “Last”.
The equalities and fallback are at `0x4204a3fc..0x4204a464`.

## The final candidate decision: exact branch order

The routine constructs a local line from neighboring route points and calculates
a projected position. That geometry path includes boundary omissions and a
least-squares-style calculation; its degeneracies are not yet fully extracted.
The following table starts **after** that construction, where the local branch
logic is now resolved.

Define the values at the final distance/angle decision:

- `P`: unsigned truncation of distance from current position to the selected
  center route point, after index arbitration; also written to result `+112`.
- `Q`: unsigned truncation of distance from current position to the calculated
  projected position.
- `D`: the chosen distance. Initially `Q`; if unsigned `10 * P < Q`, the code
  substitutes that center route-point position and sets `D = P`.
- `A`: signed truncation of `GPS-derived angle - selected-route angle`,
  without circular normalization in this decision block.
- `S`: GPS speed field at `+24`.

The multiplication and comparison use 32-bit unsigned arithmetic. The distance
helper is `0x4204aa9c`; the multiplication/substitution is
`0x4204bd9f..bdb6`. The center coordinate pair is stored in the middle iteration
of the three-neighbor loop at `0x4204bbb8..bbbe`, then read from stack
`+100/+104`; it must not be confused with the earlier raw nearest-point pair.
Exact physical units and exceptional floating-point behavior
remain dependent on the complete geometry/helper contract.

| Ordered condition | Candidate off-route value |
|---|---|
| `D > 99` | 1 |
| Otherwise, `P >= 150` | `abs(A) > 30` |
| Otherwise, `abs(A) <= 150` | 0 |
| Otherwise, unsigned `(A + 209) > 418` | 0 |
| Otherwise | 1 if `S != 0`, else 0 |

Addresses: `0x4204bdb8..0x4204be06`, `0x4204bf49..68`, and
`0x4204bf9c..a3`. The `D > 50` branch substitutes the output position with
the original input position; it only forces off-route once `D > 99`.
For `50 < D <= 99`, it still reaches the angle decision.

This is not the assumed “150 to leave / 60 to rejoin” rule in the older local
simulator. The committed state also depends on the persistence stage below.

## Persistence: candidate is not committed state

For an otherwise normal calculation, let `candidate` be the value from the
table, `previous_candidate = result[147]`, `committed = result[145]`, and
`count = result.uint16[136]`. The local state update is:

```c
if (candidate != previous_candidate) {
    count = 0;
    previous_candidate = candidate;
} else {
    count = (uint16_t)(count + 1);
    if (count >= 10) {
        count = 10;
        committed = candidate;
    }
}
```

A changed candidate resets the counter without committing. Starting at that
change, ten further matching evaluations are required to commit: eleven
evaluations including the change. This describes invocation counts, **not
seconds**. Dispatcher scheduling, skipped updates and initialization still
control the elapsed time and initial conditions.

Both transition directions use this code. Search mode 1 has an additional
counter reset whenever the committed state is 1 (`0x4204bf8d..98`); that
exception must be preserved when auditing other callers.

After persistence, result `+144` is set precisely when the committed state is
1, `D <= 24`, and `P > 150`; otherwise it is cleared. The dispatcher tests
this byte at `0x420547c0` and can enter its route-data reload branch at
`0x42054954`. This is a separate behavior from simply clearing off-route.

An early failure bypasses the normal counter path: a null route list, a
position whose two floats are both zero, or zero point count reaches
`0x4204b2be..2ff`, sets committed byte `+145` to 1 and returns the result.
This path logs `track point num too little!` even when the failed condition is
one of the other guards. That message alone does not identify the cause.

## Resource and failure behavior newly exposed

The matcher requests `72 * point_count` bytes with capability mask `0x404`
at `0x4204b4d4..4e6`, even for the mode-1 search window. For example, 1000
points request 72000 bytes before allocations inside its helpers. The request
size follows total points, not the number of retained candidate groups.

A null allocation skips candidate-table population but does not immediately
abort the raw nearest-point pass. The misjudgment helper has an explicit
null-table path at `0x4204aeb8`, logs the failure, and supplies fallback index
fields before continuing its later logic. Successful normal completion frees
the main table at `0x4204bffd..0x4204c002`.

The helper also requests a second 72-byte-record table at `0x4204acd4..ace0`.
There is **no null check before the candidate-copy loop**: with a nonzero
candidate count and a candidate passing the `<= 90` angular filter, a failed
allocation can reach the 72-byte copy at `0x4204ad39` with destination zero
for the first accepted candidate. The null check at `0x4204acef` is after
the loop, on a different path. This is a concrete static failure path, not
a reproduced crash on this device. The main-table fallback therefore does
not establish that the complete matcher tolerates low memory.

## Dispatcher modes and scheduling dependency

The mask at `0x42054692..a5` selects dispatcher states **2, 4, 8, 9, 10, 11**
for the branch containing the matcher. States 3 and 5 take a position/display
update branch; states 6 and 7 take a simulated-navigation branch. Values above
11 return immediately. These are numeric states; their complete external names
and lifecycle must still be extracted.

The loop at `0x4204dabc` reads the current state from `0x3fc9fc34`, invokes
the dispatcher when it is at least 2, and brackets the call with
`0x4204c794` / `0x4204c7a8`. It computes a delay using a clock helper,
the literal 1000, elapsed work, and delay helper `0x4038378c`; its overrun
branch passes 100. Clock units, delay units and all wakeup/serialization
behavior have not been verified, so this is still insufficient to label the
commit threshold “ten seconds”.

Two other direct call sites are present: navigation start at `0x4204d97d`
passes the current state, while the extension path at `0x4204cff9` passes
state 3. The latter consequently does not run the matcher. Direct-call
inventory alone does not exclude additional indirect calls.

## What this pass closes, and what it does not

Closed locally: candidate thresholds and branch order, counter/committed-state
separation, normal commit rule, mode-1 exception, special proximity flag,
initial rejection guards, main allocation size and publication to the draw gate.

Still needed before judging replay/simulation coverage:

1. Complete crossing/repeated-road arbitration and all helper return values.
2. Projection degeneracies, zero/duplicate points and helper units/contracts.
3. Every caller, reset and writer of the 148-byte result; actual update cadence.
4. Complete planner/transport contracts and runtime validation of route reload,
   progress and arrival integration; companion reports now extract those local
   control-flow chains.
5. Worst-case execution time, allocation behavior and concurrency on hardware.

The [rejoin/planning report](rejoin-planning-extraction.md) resolves the separate
notice/planning steps and local response/counter branches. The
[runtime report](navigation-runtime-extraction.md) traces queued activation and
route teardown/reload; [progress/arrival](progress-arrival-extraction.md) extracts
their local branches. Planning geometry, crossing arbitration and runtime
validation remain open.

For example, the progress function branches on route-type values 0, 1, 4 and
5 and on current navigation mode; it is not yet justified to replace it with
`remaining = route_length - nearest_point_distance`. Nor does discovering
an endpoint-related branch establish the complete arrival contract.

## Verification and decoder limits

Stock and saved v16 bytes match over half-open ranges
`0x4204b1e0..0x4204c008`, `0x42054684..0x42054b1c`, and
`0x42050c1c..0x42050ccc`, `0x4204a39c..0x4204a46e`,
`0x4204abf4..0x4204b048`, and `0x4204dabc..0x4204db10`.
These include the matcher, observed dispatcher, previous-point search,
misjudgment helper and navigation loop described above.

Local cross-reference traces were checked against GNU Xtensa objdump. GNU
linear disassembly can lose alignment at padding between branch blocks;
the persistence, fallback and angle tail blocks were separately decoded from
their exact branch-target addresses. This matters: accepting a single linear
dump would misdecode several of these paths.
