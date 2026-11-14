# Route generator: bounded closure, 2026-11-14

The generator has a narrow, tested correction for recording jitter and self-road
arms. General noisy-recording and decimated-export robustness remain open. This
is not a claim that the historical generator acceptance suite is green.

## Changes retained

* A decision requires at least three distinct road-arm headings (the existing
  20-degree branch distinction). A road's own forward and backward arms cannot
  supply a choice when the recording heading drifts away from the mapped road.
* Shape-angle probes use a short distance-based average at `d-6`, `d`, `d+6`
  with weights 1:2:1. This only changes heading analysis; it does not snap or
  replace supplied coordinates, elevation or accumulated route distance.
* Matched shape bends below the existing 160-degree U-turn threshold require
  a junction choice. The old exemption for angles of 100 degrees or more also
  admitted sharp noise spikes and a labelled 120-degree road bend.

No firmware, device state, route format or map source was changed. These changes
have no new network dependency and add no scan over all map vertices and track
segments. The existing matching and output-geometry pipeline remains in place.

## Test-first evidence

`tools/test_route_decisions.mjs` contains only synthetic metric fixtures; no
private ride coordinates or road names. The labelled assertions check direction
and turn distance (12 m tolerance), not just counts. Before production edits:

* the single-road judge incorrectly returned approximately -56 degrees;
* deterministic 3 m noise on a curved road produced 17 prompts;
* deterministic 3 m noise while passing three side streets produced 19 prompts,
  including a false U-turn;
* a mapped 120-degree bend without a choice produced a false RIGHT prompt.

Each failing assertion was executed before the corresponding correction. The
final suite preserves a RIGHT followed by LEFT 22 m apart, a LEFT followed by
RIGHT 27 m apart, a true reversal, a 25-degree fork, a true 120-degree junction,
and three interior turns on a closed round trip. A separate decoded-geometry
oracle compares both route corridors within 0.1 m and route lengths within 0.01 m
when heading analysis has map context versus no map context.

Final public run:

```
node --test tools/test_preview.mjs tools/test_route_decisions.mjs
19 tests: 18 pass, 0 fail, 1 TODO, 0 skipped
```

The TODO is an actual executed failing assertion: the side-street recording
still produces one SLIGHT_LEFT where the independently labelled answer is no
prompt. It is not skipped and its expected result was not relaxed. An exit-zero
public run must therefore not be described as all 19 cases passing.

`node --check` for both changed JavaScript files and `git diff --check` passed.
There is no package-level test command; the existing route CLI additionally
needs input/output arguments and can fetch maps, so historical validation used
the explicitly offline harness instead.

## Historical replay and preservation

The recovered harness was run against
`.local/cc700-evidence-20261113/local-validation/edge-input.json`, using cached
OSM cells. Its `fetch` stub throws and its cache writer also throws; no fetch or
cache population was permitted. Command:

```
node .local/cc700-evidence-20261113/local-validation/recovered-edge.mjs \
  .local/cc700-evidence-20261113/local-validation/edge-input.json
```

Result: **10/12 pass; exit 1**. Every readback, point-gap, section-size, map-block,
length and waypoint check passed. The two turn-count acceptance failures remain:

| Case | HEAD baseline | Retained patch | Result |
| --- | ---: | ---: | --- |
| Outbound reference | 15 | 15 | pass |
| GPS recording, 3 m noise | 46 | 25 | FAIL, tolerance is reference ±2 |
| Planner export, every eighth point | 5 | 3 | FAIL, tolerance is reference ±2 |

Other retained-patch results: return 13 turns; closed round trip 28; out-and-back
18; no elevation and duplicate points 15 each; short and two-point inputs zero;
waypoint input 15 with both waypoint texts; no map data 12.

An independent comparison imported `git show HEAD:js/route.js` as a separate
module and built the same private outbound fixture with the same cached map.
The complete 15-element `{distance, direction}` vector matched with strict deep
equality, without rounding or count tolerance; total route distance also matched
exactly. This preserves the historical close pair that a broader candidate
removed. Encoded files were not asserted byte-identical: their timestamp field
is generated at build time.

The minimum-arm guard alone already reduces the sparse fixture from five
prompts to three. Neither count is a labelled ground-truth turn set. This
regression in aggregate count remains disclosed; the guard is justified by the
independent single-road oracle, not by tuning toward a historical count.

## Rejected additions

Map-arm angle normalization made the synthetic noisy-side-street oracle green,
but removed a historical turn 27 m after its preceding opposite turn and changed
other outbound decisions. It was removed. A heading-average variant inside the
network judge failed to resolve the remaining side-street oracle and was also
removed. The previous broad shared-vertex corner inference was not restored.
No expected turn counts were adjusted to make the historical harness pass.

## Sparse-input boundary

The private every-eighth-point export reduces 238 input points to 31. Preserved
measurements show a maximum sparse chord of about 160 m and original geometry
up to 49 m away from the exported polyline; five original points lie more than
30 m away. Those turns cannot generally be recovered from track geometry alone.
A sparse chord can bypass a junction entirely, and different legal road paths
can share the same sparse endpoints.

The current generator interprets supplied geometry; it has no defined policy
for reconstructing a unique road path through such gaps. Adding nearby-junction
prompts without proving the intended path can invent turns or erase close pairs.
Until there is a validated reconstruction policy, retain corner points or use a
more detailed export. Do not treat a target count of 15 as a correctness oracle
for an input whose geometry has been discarded. Dense local tests and cached-map
replays can validate future work without requiring a new ride after each edit.

## Bounded follow-up on the remaining side-street oracle

A second local investigation traced the remaining synthetic false prompt rather
than treating its final SLIGHT_LEFT classification as proof of a small angle.
The shape event is at 383.956268 m of the synthetic noisy track, with shape angle
-53.371561 degrees. It is not an inserted network decision point. At a judge
probe 4 m before it, the incoming recording heading is 16.156368 degrees and
`tk` is -42.138783 degrees. Relative map-arm headings are -16.156368 (main road
forward), 163.843632 (main road backward), and 73.843632 (side street). The main
road's forward arm falls more than 20 degrees from the noisy outgoing recording
heading and incorrectly counts as an alternative.

Removing the nearest outgoing arm from the alternative set avoids that probe,
but the next probe still accepts the false shape event: at 381.956268 m,
`tk = -56.846690` and the actual side street is at 64.526020 degrees relative to
the incoming recording. The existing ten-degree comparison treats that street
as similarly straight. Removing the manufactured +/-25-degree fallback for
`|tk| < 20` therefore cannot fix this concrete failure: the keeping probe has a
real measured `|tk|` above 20, albeit caused by recording noise.

A second spike also required the selected map arms to imply straight travel and
the matched road identity 16 m before and after to agree. That made all synthetic
assertions green, but the independent exact historical vector check failed:
it removed one existing SLIGHT_RIGHT decision. It was rejected. Both spikes and
all diagnostic logging were removed; `js/route.js` was verified byte-for-byte
against the safe source snapshot taken before this follow-up. The final status
remains 18 public passes plus one executed TODO, and the retained patch remains
the one evaluated in the historical 10/12 run above.
