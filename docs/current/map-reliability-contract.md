# Map reliability contract and evaluation matrix

This is the acceptance contract for selecting map content and future features.
It complements the existing [native behavior harness](behavior-contract-harness.md),
[budget model](../research/adaptive-map-budget-2026-11-14.md) and
[project status](../reports/project-status-2026-11-14.md). A checked map is not a checked
route planner, sensor system, or complete device simulator.

## Invariants

| ID | Requirement | Evidence/check |
|---|---|---|
| R1 | Optional display context cannot change native route geometry, matching, captions or surface association. | Compare actual record/name bytes from offset 128 to map offset against mandatory-source generation. Existing source-isolation tests also cover optional surface tags. |
| R2 | Enabled nearby line geometry retains its class, level, bridge/tunnel and surface distinctions; no extra simplification to fit. | Independent spatial/style probes at known synthetic positions; existing shared-anchor/parallel-road tests. |
| R3 | Keep the current minimum line context of 300 m and area window of 600 m. Do not erase real near area boundaries by tighter clipping. | Existing protected-outline encoded-equality test; shoreline and bridge probes. Missing source data remains an explicit limitation. |
| R4 | Each byte, payload, scratch, projection, fill and text constraint must fit separately. | Recalculate from encoded map records, including overlays. Check arbitrary block transitions and the 4 MB file guard. These are working policies, not hardware maxima. |
| R5 | The same input and policy produce the same encoded map. | Map-byte fingerprints and repeated-run equality; generation timestamp excluded. |
| R6 | Required context remains present across block transitions and repeated route passes. | Independently positioned probes on the outgoing/return pass and mixed-density route, plus source-anchor contract tests. This is not full pixel-seam proof. |
| R7 | Optional-cell failure must preserve previously usable offline navigation. | Cached endpoint-only sparse GPX and missing optional-cell regressions. |
| R8 | An overloaded protected minimum fails explicitly. | A labelled 2,400-vertex minimum-area fixture; expected rejection is separate from generated success. A candidate that silently removes the area fails. |
| R9 | Reports must expose missing evidence and individual losses. | Empty/duplicate matrices fail; failed generation retains lost-probe status and null unavailable cost deltas. No average can cancel a required-feature loss. |
| R10 | A distant drawable road is not a validated recovery route. | Candidate reports mark connectivity and retour routing unvalidated/unimplemented. No geohash or radius becomes a routing acceptance test. |
| R11 | Increased target workload needs component timing and allocator evidence. | Native timing/contiguous-heap acceptance remains open until a verified collector captures it. Host generation duration is separate. |
| R12 | A measurement session must preserve/restorably return the ordinary device. | Record writes, resets, instrumentation identity and restoration. This evaluation performs serial observation only; no route/flash writes. |

Protected-feature probes check structural geometry within a declared two-metre
(or one-metre parallel-road) tolerance. They do not establish human legibility,
road access, complete source recall or pixel connectivity. Existing raster/label
host-C tests exercise other parts of those questions.

## Representative workloads

| Fixture | What it challenges | Explicit boundary |
|---|---|---|
| Urban | Many streets, intersections and fills | No claim that aggregate entries describe actual junction complexity |
| Village | Local choices plus distant orientation roads | A road in the file does not prove cycling access |
| Forest | Rough paths, cycle links and forks | No white-gap substitution for path/surface semantics |
| Water crossing | Shoreline, cycle bridge and tunnel at different levels | Structural style checks, not complete crossing raster acceptance |
| Parallel/hairpin | Close distinct roads and a tight bend | Existing white cores can merge visually; geometry retention alone is insufficient |
| Out-and-back | Shared road on two passes | Basemap checks do not validate native pass association |
| Detour context | Optional display roads and caption isolation | No recovery-route claim |
| Mixed transition | Dense streets into village/forest geometry | Check individual sections, not a whole-route average |
| Competing layers | Expensive optional fill versus cheap distant cycleway | Exposes the shared-radius admission bottleneck |
| Sparse track | Two-point route with intermediate geometry | Separate cache tests cover missing intermediate source cells |
| Noisy track | Nearby geometry with a noisy GPX | Known maneuver-association failures remain visible elsewhere |
| Protected overload | Minimum content exceeding the work/scratch envelope | Required explicit rejection; not a successfully rendered route |

All public inputs are synthetic. Builds use the existing blank name-image test
stub: caption/record bytes are compared, but bitmap glyph rendering is not
validated and these are not device-ready navigation fixtures. Extended experiments use the exact same source
input at every candidate radius; extra far-road probes measure drawing capacity
only. The fixture fingerprint prevents comparing different source data as an
algorithm improvement.

## Running the checks

```sh
node --test tools/test_map_benchmark.mjs tools/test_map_policy_study.mjs
node tools/map_benchmark.mjs --output .local/my-new-baseline
node tools/map_policy_study.mjs --output .local/my-new-policy-comparison
python3 -I tools/validate_local.py
```

Output directories must be new; CLI tools refuse to overwrite an existing run.
`baseline.json` has deterministic costs, source fingerprints and gate outcomes;
`run.json` separates volatile host timing. Policy comparisons retain per-case
changes, missing required probes, and optional drawable probes. The instrumented
reference is tested byte-exact against the production reference. In-memory study
seams are guarded and fail if the inspected production code shape changes.

## The complete 3 km retour question

The user means a usable way back from around 3 km away, not uniform cartographic
coverage at that radius. Accepting that feature requires all of:

1. Sufficient source graph coverage, original junction identity and cycling access.
2. Correct treatment of barriers, bridges/tunnels, one-way rules and restrictions.
3. A connected, valid rejoin/return path for the actual location and direction.
4. A costed on-device representation: graph, validated precomputed legs, or a
   combination; include lookup tables, labels and transition working memory.
5. Correct off-route activation, cue suppression and transition back to normal
   guidance. Pre-baked map geometry does not supply those behaviors.
6. Defined fallback when the rider is outside covered/reachable components.

Geohashes can reduce spatial lookup work. They cannot certify connectivity,
access or a safe route across a river. A sparse precomputed recovery network
could be more economical than a detailed 3 km map; it still needs an explicit
origin/coverage contract. The map-only experiment does not meet this feature gate.
