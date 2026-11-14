# Map evaluation: results and release decision

The evaluation infrastructure, baseline, targeted research and offline policy
comparison are complete. **The experimental selection policy is not released
as the Pages default.** It passes the scoped local structural checks, but lacks
both target runtime evidence and the complete recovery capability that motivates
3 km context. Current generator behavior and installed firmware are preserved.
This is a completed evaluation with an explicit withheld-policy decision, not a
claim that all target/feature gaps have been closed.

## What was built

- [Reliability contract and matrix](map-reliability-contract.md): protected
  semantics, native-record isolation, independent resource checks, offline
  fallback, actual block-boundary probes and honest failure/evidence accounting.
- `tools/map_benchmark_cases.mjs`: twelve reproducible synthetic cases covering
  terrain, density, water crossings, parallel roads, overlap, mixed transitions,
  competing layers, sparse/noisy tracks and protected overload.
- `tools/map_benchmark.mjs`: production generation plus encoded readback,
  independent feature/style probes, native record/name comparison, per-block
  costs and class counts, transitive source fingerprints and per-case comparisons.
- `tools/map_policy_study.mjs`: guarded **in-memory** instrumentation of the
  existing generator, comparing shared-radius and independent-layer admission at
  1/2/3 km. It never writes production JS or device files. Its reference output
  is tested byte-identical except the generation timestamp.
- [Feature capability ledger](feature-capability-ledger.md): the complete supplied
  idea list, separating implemented primitives, traced mechanisms and hypotheses.
- [Targeted primary-source research](map-selection-research-2026-11-14.md) and
  [stationary measurement contract](stationary-map-measurement-contract.md).

The standard local validator now runs the new checks. Production `js/`, map
palette, resolutions, service worker and firmware are unchanged in this release.

## What the layers tell us

| Layer | Established now | Remaining limitation |
|---|---|---|
| Source acquisition | Separate mandatory navigation and optional display sources; offline fallback tests | New cached data preserves original ways, but complete cycling graph/access/restrictions over a recovery region are unverified. Production optional source reach remains 1 km. |
| Representation/file | Exact map record bytes and target decoded payload layout; actual native-record equality | The 4 MB app guard is policy, not a measured flash/file maximum. Future graph/leg formats and native consumers need their own contracts. |
| Map selection | Shared-radius bottleneck reproduced; independent-layer prototype tested | Feature usefulness is not captured by a class percentage or sample count. Prototype class-order thresholds are experimental cost-mix heuristics, not validated city/forest recognition. |
| RAM | Per-block/transition payload, projection and iterator scratch calculable | Allocator overhead, largest contiguous capability-specific block, task stacks and concurrent subsystems remain unmeasured. |
| CPU/display | Projection, projected-point, fill-vertex and label-payload work bounded | Rasterized pixel cost, native text/line time, locks and display flush are not calibrated to milliseconds. |
| Navigation | Optional map context does not change encoded route/name records in tested cases | Off-route cue replacement, rejoin association, live rerouting and reliable return paths remain separate feature work. |
| Firmware/UI | Current patch/format/asset interfaces have scoped evidence | A string, font or hook is not an end-to-end feature. Screen space, shared descriptors, code page and activation/restoration also constrain features. |

The working targets remain unchanged. They are not hardware maxima.
For the **extended city** reference, the busiest block needs **1,374 projection
callbacks of the 1,400 target**, with **25,884 B decoded payload of the 57,344 B
target**. Memory is available while callback headroom is small. The corresponding
forest reference has at most 16 callbacks and 488 B decoded payload. Other forest
geometry could be much more expensive; these are workload observations, not a
universal terrain classifier.

This is why a single percentage, entry count, or spare-RAM number cannot decide
which feature fits. Keep resource constraints separate from navigation priorities.

## Strategy comparison

Synthetic and private comparison builds use the existing blank name-image test
stub. Their native record/caption bytes are compared, not actual name-bitmap
glyphs; these generated artifacts are not device-ready ride fixtures.

All six candidate runs generated eleven cases and explicitly rejected the one
labelled protected-overload case. No tested required feature, bridge/tunnel
style, native-record or boundary gate failed.

| Candidate representation | Matched optional drawable probes | Recovery routing |
|---|---:|---|
| Reference | 13 | Not implemented |
| Shared-radius 1 km | 13 | Not implemented |
| Independent layers 1 km | 14 | Not implemented |
| Shared-radius 2 km | 22 | Not implemented |
| Independent layers 2 km | 25 | Not implemented |
| Shared-radius 3 km | 31 | Not implemented |
| Independent layers 3 km | 36 | Not implemented |

**These are capacity probes, not navigation-quality scores.** Extended fixtures
add three sparse synthetic ways at about 900/1,900/2,900 m. They do not represent
a complete 3 km city network, reachable graph, validated return path or source
completeness. Their usefulness cannot be inferred from the table.

A concrete useful finding is narrower: an optional 2,600-vertex green polygon
causes the shared-radius policy to stop before including a cycleway at 950 m.
The independent-layer study retains that cycleway while rejecting the polygon's
extra cost. Protected nearby geometry remains in the tested output. The added
line's decoded payload is 36 B in this synthetic block; its projection allowance
is one callback. That is an actual marginal-cost example, not a terrain-wide quota.

Six cached-real-source builds also pass: reference and independent-layer 1 km for
outbound, reverse and out-and-back. All native navigation/name bytes are identical
between policies. Independent Python decoding agrees with every allocation/work
metric in all **70** map blocks, including the conservative overlay allowance.

| Cached case | Reference bytes | Independent-layer 1 km bytes |
|---|---:|---:|
| Outbound | 524,288 | 557,056 |
| Reverse | 520,192 | 552,960 |
| Out-and-back | 999,424 | 1,060,864 |

These files have no independently labelled feature oracle. More bytes are not
proof of better navigation. Full-source 3 km expansion on the private data was
stopped after more than five minutes without a completed result; it is recorded
as aborted, not a successful comparison or a target performance measurement.
That experiment also lacked verified complete 3 km source/recovery data. We did
not spend further effort optimizing that disconnected feature scenario.

## The complete 3 km feature

The user clarified that the aim is a usable way back from around 3 km away.
The architecture needs to connect these concerns:

```mermaid
flowchart LR
  A[Original source and cycling rules] --> B[Validated connected recovery paths]
  B --> C[Costed sparse legs or network plus spatial index]
  C --> D[Off-route lookup and reachable-path selection]
  D --> E[Recovery cues and drawable local context]
  E --> F[Verified transition back to normal guidance]
  G[RAM, file, code, CPU and screen budgets] -. constrains .-> C
  G -. constrains .-> D
  G -. constrains .-> E
```

A geohash can make lookup economical. It does not create or validate edges.
Sparse prepared recovery paths may cost less than uniformly detailed distant
maps, but require reachable origin coverage and correct activation. The display
and recovery representations can share validated source data while having
separate detail/cost policies. This is the next feature-design context, not an
implemented return planner.

Several supplied “generation-only” ideas actually need firmware/UI work:
conditional detour lines, replacement rejoin distance, generic hazard/POI glyphs
and meaningful heat overlays are not supplied by merely encoding existing map
classes. Vendor WiFi map-download strings do not establish a separately usable
basemap pipeline. These distinctions are preserved in the feature ledger so
future budgets are attached to real mechanisms rather than assumed unlocks.

## Device evidence and validation

The connected USB device supplied two serial captures with ota_1 boot output.
No timing or heap-channel samples were present. Runtime build identity was not
read back. **No firmware/storage writes or GPS injection occurred; no reset was
requested.** No claim is made that boot output establishes a stable active
navigation workload or that opening the port is a zero-disturbance measurement.
A verified target collector is still missing; this evaluation did not silently
install test firmware just to label that gap closed.

- 149 Node tests pass, with one existing noisy-GPS TODO still executed and visible.
- 121 Python tests pass, including actual host-C sanitizer/renderer/loader checks.
- All seven offline probes pass, including stock/styled synthetic 70 km readback.
- Actual ride loader replay: zero absent coverage proxies across 576 samples.
- Browser layout: native aspect ratio/card at three widths.
- Existing historical noisy/sparse maneuver failures remain unchanged (25/3 turns
  versus the 15-turn reference). Combined validation is therefore **incomplete**,
  not a whole-project green certificate.
- Review found incomplete source attribution and missing exact-boundary testing.
  Both were fixed through observed failing tests. A negative control now removes
  a cycle link from just one encoded block and fails the boundary gate despite
  unchanged entry counts. Geometry/protobuf/readback/render dependencies are
  included transitively in the source manifest.

## Release decision and next bounded work

| Criterion | Outcome |
|---|---|
| Scoped protected geometry/style and actual boundary probes | Pass |
| Native navigation isolation in synthetic/private comparisons | Pass |
| Existing byte/work targets and arbitrary block transitions | Pass |
| Reproducible source/input identity and negative controls | Pass |
| No new unexpected suite failure | Pass; prior maneuver failures remain |
| Demonstrated target timing/allocator margin for increased workload | **Open** |
| Complete useful 3 km recovery behavior | **Not implemented** |
| New default selection policy | **Withheld** |

The released change is the evaluation system, evidence and feature/measurement
contracts. The candidate remains offline. The next bounded engineering task is
a reviewed native measurement collector for the identified frame/load/heap
boundaries, followed by a recovery-path feasibility design grounded in an actual
cycling graph and activation contract. Neither requires another full test ride
to begin; physical acceptance remains a later, narrower check.

## Artifacts

- [Deterministic synthetic baseline](mining/map-reliability-baseline.json)
- [Per-case strategy comparisons](mining/map-policy-study-summary.json)
- [Sanitized cached-real-source summary](mining/map-policy-real-source-summary.json)
- [Device observation and explicit missing channels](mining/map-evaluation-device-observation.json)

Private inputs, logs, binaries and detailed run reports remain under ignored
`.local/map-reliability/`. The production and candidate source identities are
captured in the published baseline/comparison artifacts; private positions are
not published.
