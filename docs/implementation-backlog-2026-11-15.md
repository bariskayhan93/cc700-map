# Implementation backlog after the map evaluation

Status: ordered implementation scope, not a claim of completed work or a blanket
promise that undecoded native features are feasible. This list carries the user's
reliability-first priorities into bounded releases. Detailed implementation plans
belong to each work package once its interfaces are established.

Evidence baseline: [evaluation report](map-evaluation-report-2026-11-15.md),
[reliability contract](map-reliability-contract.md),
[measurement contract](stationary-map-measurement-contract.md), and
[feature ledger](feature-capability-ledger.md).

## Approach and order

Use small end-to-end releases, with measured resource constraints shared across
them. Expanding all layers uniformly would spend resources without establishing
recovery usefulness. A large combined firmware/generator rewrite would make
regressions difficult to attribute. Instead, preserve the working baseline,
repair existing navigation failures, measure the device, then introduce bounded
selection and recovery changes separately.

| Order | Work package | Concrete result | Release condition |
|---|---|---|---|
| 1 | Existing navigation correctness | Stable turn decisions and truthful off-route/distance guidance | Known failures reproduced, fixes pass independent maneuver/state oracles and preserve established route behavior |
| 2 | Target measurement | Repeatable stationary frame/load/lock/allocation capture and ordinary-firmware restoration | Verified ABI, bounded collector, matched workload identities, measured overhead, successful rollback |
| 3 | Resource model calibration | Workload-specific limits based on measured costs and margin | Predictions checked against held-out workloads; uncertainty and concurrent-subsystem effects reported |
| 4 | Production adaptive map selection | Independent admission of useful detail with protected near-route semantics | Encoded audits, visual checks, native isolation, seam checks and target performance gates pass |
| 5 | Complete recovery feasibility | Demonstrated access-valid way back from representative origins up to 3 km away | Complete-enough graph, reachable paths, honest unsupported cases and feasible storage/runtime/UX envelope |
| 6 | Recovery implementation | On-device recovery guidance, local context and correct return to normal navigation | End-to-end detour/rejoin state tests, target measurements and bounded physical confirmation |
| 7 | Further feature releases | Individually justified additions from the feature ledger | Each has a verified mechanism, useful UI, explicit marginal cost and its own acceptance tests |

Packages 1 and 2 lead the work; package 1 must not wait for a performance
collector to fix generator-only defects. Recovery source feasibility can be
investigated before package 4 finishes, but cannot bypass correctness or target
resource gates. These are dependencies, not a requirement to keep all work idle
until the previous row is fully released.

## 1. Existing navigation correctness

- [ ] Reproduce the historical noisy and sparse maneuver failures from exact
  source/input identities. Record the current 25/3 versus 15-turn observations
  as failures, not desired output counts.
- [ ] Build maneuver oracles from junction topology, travel direction and intended
  route progression. Test genuine close turns, noisy straights, roundabouts,
  parallel roads, hairpins and crossings. Do not fix noise merely by suppressing
  turns until a count matches.
- [ ] Trace the off-route, paused, poor-fix, reverse and rejoin states and their
  ownership. Separate visible basemap availability from valid route guidance.
- [ ] Specify and implement when ordinary maneuver cues must stop being shown as
  current. Test hysteresis, stale fixes and repeated enter/exit transitions.
- [ ] Verify native remaining-distance sentinels and formatting. Keep unavailable
  values explicit; do not manufacture remaining or recovery distance from a
  straight-line estimate. Distinguish remaining distance from ridden distance.
- [ ] Verify close-turn caption production and native display activation on a
  device-ready fixture; byte equality alone does not prove the third line exists.

Likely code boundaries: `js/route.js`, `js/preview_guidance.js`, historical route
tests, behavior/replay tools and private patch sources. Change only the layers
implicated by reproduced evidence. Preserve the current opaque route color.

## 2. Target measurement and restoration

- [ ] Establish current image identity and fresh byte-exact rollback before any
  test installation; preserve stock ota_0 and ride/route storage.
- [ ] Prove clock, heap and hook ABIs against the exact firmware. Implement the
  owned, bounded collector described in the measurement contract, including
  allocation failure, overflow, coherent publication and cleanup.
- [ ] Verify collector layout, code/stack requirements and host failure tests.
  Measure collector overhead; export outside timed intervals.
- [ ] Capture cold/warm city, village, forest, polygon crossing, repeated block
  changes and off-route redraw. Record heading, zoom, recording/radio state,
  full-frame and component timing, mutex wait/hold, capability-specific heap
  free/largest/minimum and observed stack margin.
- [ ] Restore the ordinary image, boot automatically, verify identity and record
  that test activation and telemetry are disabled.

No debugger halt or serial printing inside timing intervals. USB boot output is
not evidence of frame latency. If a boundary cannot be measured, report that
channel as missing and constrain only the changes its absence actually blocks.

## 3. Calibrated resource model

- [ ] Reconcile encoded/decoded/scratch/transition calculations with target
  allocation phases, including allocator overhead and contiguous capability
  requirements.
- [ ] Measure the effects of projections, line style passes, fill vertices,
  rasterized area, text and label density separately where possible. Do not
  assume additive CPU cost without checking residuals and interactions.
- [ ] Split calibration and held-out cases. Include rotation, clipping, zoom,
  overlap, cold loads and concurrent recording/radio workloads.
- [ ] Establish explicit frame/load/lock acceptance values from working-baseline
  measurements and navigation needs before releasing increased workload. Publish
  the rationale and safety margin; observed maxima are not worst-case guarantees.

Keep RAM, CPU, storage, code-page and screen-space constraints separate. The
existing 1,400 callback and other targets stay conservative policy until evidence
supports a change; spare bytes alone cannot justify more drawing.

## 4. Production selection and display consistency

- [ ] Promote the useful independent-layer mechanism out of study-only source
  instrumentation into an explicit production interface.
- [ ] Define protected geometry and semantic priorities first. Rank optional
  candidates by navigation utility and marginal resource cost, without fixed
  city/forest percentages or counting more entries as better quality.
- [ ] Keep stable feature identity/order, deterministic admission and compatible
  shared context across block boundaries. Preserve bridge/tunnel separation,
  shoreline/border fidelity, cycleway distinction and near-route continuity.
- [ ] Optimize source indexing/generation only after profiling the expensive
  searches; retain original graph source separately from simplified display data.
- [ ] Compare device-ready renders at 240×320 / 240×256 map dimensions, including
  rotations and occluded HUD regions. Keep Pages/README rendering synchronized
  with the measured device renderer; document remaining pixel-parity limits.
- [ ] Gate production on real-source geometry oracles, native-record isolation,
  independent final-byte audits, arbitrary block transitions and target captures.

Release this separately from recovery if its own gates pass. Wider optional map
context does not constitute a return-routing feature.

## 5. Complete 3 km recovery feasibility

The feature goal is a usable way back from a reachable origin around 3 km away,
not a promise that every point within a circle has a valid cycling connection.
Specify whether any stated distance is lateral coverage, network distance or
remaining recovery distance; do not interchange them.

- [ ] Define rejoin-current-route, reverse/backtrack and return-to-start as
  distinct operations with explicit destination/progress semantics.
- [ ] Construct and audit a cycling graph from original nodes/ways: junctions,
  direction/access rules, barriers, bridges/tunnels and applicable restrictions.
  Mark missing source, ambiguous access and disconnected regions.
- [ ] Compare bounded on-device graph lookup/routing, generation-time prepared
  paths with indexed reachable origins, and a hybrid. Choose using actual origin
  coverage, route validity, bytes, RAM, code and runtime measurements.
- [ ] Test reachable origins near 0.5/1/2/3 km in dense city, village, forest,
  river/bridge, parallel-road and disconnected cases. Validate whole paths and
  destination association independently of display simplification.
- [ ] Cost the graph/path encoding, spatial index, local drawable context and
  transitions together. Geohashing may accelerate candidate lookup; it cannot
  supply missing edges, legal access or a valid connection to a nearby road.
- [ ] Produce an explicit feasible envelope and fallback policy before choosing
  the device format. If full 3 km origin coverage cannot fit, state where usable
  recovery is supported rather than drawing a misleading direct line.

## 6. Recovery implementation and acceptance

- [ ] Version the chosen recovery payload/index and reject malformed, mismatched
  or unsupported data without damaging ordinary navigation.
- [ ] Implement off-route activation, reachable-origin selection, recovery cues,
  recovery-distance semantics and relevant local map context as one feature.
- [ ] Implement rejoin association and restoration of normal guidance; include
  reverse travel, overlapping passes, repeated detours, missed recovery turns,
  source limits, stale GPS, pause/resume and phone reroute invalidation.
- [ ] Run deterministic end-to-end replay using actual patch logic and measured
  runtime captures. Identify native scheduler/GPS behavior that replay cannot
  establish instead of claiming full device simulation.
- [ ] Release generator and firmware as a compatible pair, verify Pages assets
  and installed image, then perform one focused physical acceptance session for
  the remaining sensor/live-state questions.

## 7. Further features and reprioritization

Keep the supplied feature list in the capability ledger as options. Each promoted
feature needs a small end-to-end design, measured marginal costs and a release
gate. Straightforward captions/landmarks may precede recovery if they preserve
cue priority and pass their own tests; they must not displace reliability work.
Native basemap downloads, climb/workout formats and other undecoded interfaces
remain bounded research targets rather than promised deliverables.

Reprioritize immediately for data corruption, crashes, lost recording, incorrect
route association or an allocation/lifecycle failure. A newly verified native
capability can change the architecture after a short proof and regression check.
Cosmetic additions and promising strings alone do not reorder the program.

## Evidence attached to every released package

Record exact source/input/image identities, observed failing test and passing
fix, independent readback, target evidence where relevant, known limitations,
deployment/install verification and rollback instructions. Keep private ride
coordinates and binaries out of public reports. Report packages as complete,
blocked by a named gate, or not started; do not convert a documented gap into a
completed implementation checkbox.
