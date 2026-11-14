# Map reliability and context-selection evaluation

## Intent and scope

User-approved sequence: define the reliability contract; assemble representative
benchmarks; measure the reference; research unresolved decisions; compare simple
strategies; verify correctness and stability; release only against explicit
acceptance criteria. Deliver one final findings/implementation report. User feature
ideas are inputs and hypotheses, not an implementation queue or priority ranking.
Compare the representation cost at 1/2/3 km under the same resource envelope.
User clarification: 3 km matters only as part of a usable connected retour/rejoin
feature. Drawable far roads do not count as completion or demonstrated navigation
benefit. Preserve that full feature dependency chain in the acceptance decision.

This phase builds a reusable evaluation system and offline policy candidates.
It does not assume that an algorithm change must ship. If the release criteria
are not met, retaining the current generator is a valid, explicit result.
Device instrumentation is a separate change with its own proof and restoration;
USB availability alone does not establish frame-time or heap measurements.

## Reliability contract

1. Existing enabled route-near line context within 300 m keeps its geometry,
   class, layer, bridges/tunnels and surface distinctions. Areas retain their
   existing 600 m minimum window; outer clipping must not erase protected edges.
2. Optional display candidates cannot change native route points, matching,
   names, captions or rough-route association. Compare serialized records, not
   only aggregate maneuver counts.
3. Enforce every existing resource target independently on encoded readback,
   including overlays and arbitrary old/new block transitions. Retain the 4 MB
   app guard. No ceiling increase is justified by host timing or total free heap.
4. Identical inputs produce identical encoded map bytes. Shared source junctions
   and distinct levels stay distinct. Block-boundary feature availability is
   tested on both sides, not inferred from one screenshot.
5. Missing optional source cells preserve offline baseline navigation and expose
   incomplete map coverage. Unsupported guidance/return routing stays explicit.
6. Expected overloaded-minimum rejection is counted separately from successful
   generation. Missing fixture/telemetry is incomplete, never a pass.

## Approaches

- Current shared-radius expansion: reference, simple but one expensive layer can
  stop expansion of unrelated cheap layers.
- Independent layer expansion: prototype using the same source preparation,
  encoded cost estimator and protected reference entries. Spend remaining
  resources separately on transport, water/context and areas; ordering is explicit.
- Essential network context: prototype selected distant transport groups at
  1/2/3 km while preserving nearby detail. Distance is not network connectivity;
  no return/rejoin route is claimed without access/topology validation.

Compare first. Do not introduce percentage quotas or a large city/forest ruleset
without evidence that it improves the acceptance matrix. Any adaptive ordering
must use observable input properties and have stable, deterministic tie breaks.

## Evaluation harness

Create reusable synthetic fixtures for urban density, village connecting roads,
forest forks, water/bridge/tunnel combinations, parallel roads/hairpins,
round-trip overlap, a distant context excursion, mixed-density transitions,
sparse/noisy tracks, and explicit protected overload. Source data and oracle
probes are independently specified in local metres; do not publish ride coordinates.

Generate production route files and decode their actual map blocks. Record exact
serialized/payload costs, projection/fill/label work estimates, per-class entry and
point counts, transition bound, context selections, file bytes, section/block
counts, and host generation duration. Host duration is diagnostic only.

Probe hand-labelled protected feature positions and styles in the block selected
at specified along-route distances. Probe optional distant context separately.
These are structural checks, not pixel legibility or full network-recall claims.
Include negative controls that remove a protected road, alter a bridge layer,
allow optional navigation contamination, and suppress an expected rejection.

Record source fingerprints and schema versions. Comparisons require identical
fixture identities and source inputs. Public baseline JSON contains deterministic
costs and contract results; volatile time/provenance is separate. CLI outputs go
into an explicitly selected ignored directory, never device storage.

## Evidence and instrumentation

Reuse the actual host C sanitizer/iterator checks and existing offline, native
record, label, geometry and source tests. Research primary MapLibre, LVGL and
ESP-IDF documentation for visibility separation, redraw work and heap measurement.
Measure stationary target components only with a verified collector and known
workload; serial observation without frame/lock instrumentation cannot supply
those measurements. Keep measured, calculated, transcribed and unknown evidence
separate. Record recording/radio/replanning concurrency gaps.

## Release criteria

No protected-feature or native-record regression, no new unexpected suite failure,
all resource checks fit, deterministic output, and a useful gain across the
representative workload without hiding losses in another scenario. Report per-case
tradeoffs, not just an average. Increased on-device drawing workload requires
target timing/allocator evidence; otherwise the candidate stays offline.

Keep v21 and existing device routes restored/preserved after any controlled test.
Do not implement POI/workout/climb/WiFi/return-path features during this phase.
