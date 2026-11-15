# Complete recovery feasibility implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** finish segment/access, replay, radius sampling and measured representation decision in one bounded PC pass.
**Architecture:** original-segment spatial index, profile-aware transition graph, projected edge splits with directed ordered targets, deterministic spatial study, actual candidate/CSR encoding.
**Tech Stack:** Node built-ins and existing OSM/route parsers; no new dependencies.
**Spec:** docs/superpowers/specs/2026-11-15-recovery-feasibility-design.md

## Global constraints

PC-only. No blind access widening. Private graph/ride coordinates stay local.
Candidate associations and profile inferences are unvalidated; no device release.
Source, stored bytes, device memory, stack, draw work/time and UI are separate.
Unavailable is normal outside supported evidence/resources. Do not resume
stationary start/finish matching. One final review, one important fix pass.

## Review focus

- Sparse-node roads, parallel roads, grade crossings, adjacent segments and exact junctions.
- Same physical road on reversed/repeated route visits; no invented cross-road edges.
- Explicit denial/conditional semantics versus inferred default access.
- Search target direction after virtual splits, no U-turn laundering.
- Whole-route distance, density sampling bias and codec omission accounting.

### Task 1: original-segment association and study access policy

- [x] RED: sparse segment vs nearby steps, parallel/crossing ambiguity, heading,
  endpoints, spatial-index limits; denied/conditional/motorroad and firm-path policy.
- [x] Implement tools/recovery_association.mjs and tools/recovery_access.mjs;
  optional way policy in existing study graph compiler. Expected: old + new tests pass.

### Task 2: directed ordered route targets and real replay

- [x] RED: projected splits, one-way, restricted turns, directed targets, repeated
  visits/forward windows, same-edge projections and fallback conditions.
- [x] Implement tools/recovery_planner.mjs with bounded route decoding/visits,
  and tools/recovery_feasibility.mjs real replay without future target oracle.
- [x] Compare two access profiles on original inputs; expected explicit candidates
  or unavailable, never an inflated acceptance count.

### Task 3: actual radius samples and representation decision

- [x] RED: deterministic disjoint bands/density strata, source boundary, graph
  packet round-trip, limits, target-search equivalence and private CLI no-overwrite.
- [x] Implement tools/recovery_graph_packet.mjs and spatial/representation study.
- [x] Run real 1/2/3 km bands and synthetic environment controls; measure actual
  arrays/legs plus lookup assumptions, report failed/uncertain samples.
- [x] Fresh review, one important fix pass, final focused tests and real rerun,
  publish sanitized report and recommendation, commit. Expected: reproducible
  feasibility evidence, remaining production gates explicitly recorded.


## Completion record

76 focused checks pass, including native parsing, source ambiguity, directional
splits/turns, repeated visits, exact network origins, spatial bands/density,
binary graph/visit/source-association/leg lookup and overwrite refusal. Known
environment controls preserve 36 connected and three disconnected outcomes.
Six real codec probes preserve targets with <10 cm metric difference.

Actual real replay conservative13/30, NRW9/30; both have five candidate scenarios
without historical recording gaps. Spatial72 samples: 32 generation candidates,
12 under the smaller work cap, with disjoint band totals12/7/13. Full graph and
indices9.02/9.31MB versus37.10/37.24KB exact-origin sampled legs+lookup; coverage
is explicitly different. No legal/physical, arbitrary-GPS or target acceptance.

Review: one Important exhausted near-finish window reproduced RED then fixed to
unavailable. 76-test suite green; complete real summary reproduced exactly.
Deferred minors: baseline motorroad asymmetry; retrospective gap flag scope.
These are documented report caveats, not live or legal acceptance.

Decision: generation-time legs, covered edge portals and bounded device lookup.
The PC milestone is closed. Production edge-coverage/activation and native
resource/safety integration are the next implementation package, not another
unbounded research prerequisite. No device or deployment changes.

Final integration: all 270 registered Node tests pass, no skips; source/packet hashes
and exact file sizes verified. Historical native harness/device gates are not inferred.
