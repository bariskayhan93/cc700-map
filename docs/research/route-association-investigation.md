# Route association investigation — 2026-11-14

The initial investigation was read-only. The concrete follow-up now preserves
original navigation source in `js/navsource.js` and `js/osm.js`, with synthetic
tests in `tools/test_navsource.mjs`. Route generation, route files and device
state were not changed. Diagnostics
live in `.local/route-association/`; they contain private source geometry and
must remain private. The measurements below use relative metric geometry only.

## Finding

The remaining false prompt is a path-association failure. The generator asks
whether *some nearby arm* can justify a noisy track angle, without establishing
which incoming and outgoing map edges the route actually traverses. Local
heading fixes cannot reliably repair that missing fact. Neither preserving the
old turn vector nor matching an old aggregate count establishes correctness.

The simplest sound policy is: a map-supported maneuver must describe an
associated path through a connected junction. Its taken exit must have evidence
from the track on both sides. Passing along the main road cannot become a turn
because a noisy chord points away from it. An association that is ambiguous or
contradicts the available map must remain explicitly uncertain; it must not be
silently converted into proof that a shape event is either real or false.

This policy needs a small sequential path matcher, plus preserved navigation
topology. It is not another threshold in `judge()`. Source preservation is implemented;
the matcher and navigable graph remain future work.

## Current data flow and where information is lost

1. `osm.js/buildCell` has OSM node references and original way geometry. Its
   `generalize()` removes paths, marks parallel cycling paths as detail,
   constructs dual-carriageway centrelines, and runs two Chaikin smoothing
   passes. `flat()` quantizes positions to 1e-5 degree. The cache stores only
   generalized coordinates, flags, kind, name and way ID. Node identity,
   directional/access details and original geometry were lost. `loadOSM()`
   still drops the retained way ID from display lines. The new optional
   `navigationSource` field preserves those original source facts separately;
   existing cached cells explicitly lack that capability.
2. `buildRoute()` removes fixes closer than 1 m, simplifies to 2.5 m, and retains
   the resulting recording geometry for distance and encoded output. Its
   `decisionPoints()` samples that geometry every 2 m.
3. Each sample independently chooses one undirected line using distance plus
   local 2 m heading error. It has no predecessor, connectivity, direction,
   along-edge progress or alternative-path score. Only line indices survive;
   even the winning projection is discarded. Six-metre line runs create
   candidates, but short real connector edges cannot qualify as runs.
4. `judge()` builds arms from all ridable lines within 8 m of the current noisy
   position. The taken direction is still a raw 15 m recording chord. Arm
   exclusion is angular proximity to that chord, rather than selected exit
   identity. Even the main road can count as an alternative.
5. Shape events are accepted if *any* probe within ±10 m returns a judgment.
   `matched()` merely checks that nearby samples found some road. It does not
   establish continuity or confidence. A shape event can borrow a neighboring
   street to justify a direction the route never takes.
6. The separate `matchRoads()` matcher plus majority name smoothing controls
   names/section cuts; it cannot repair maneuver association. Three notions of
   a road/path therefore coexist without a common traversal record.

An additional caveat: `runs` can bridge unmatched samples when the next matched
sample has the previous line identity, because unmatched samples do not close a
run. A production path matcher must explicitly represent unknown intervals.

## The synthetic 383.956 m event is geographically at the 300 m street

The deterministic side-street fixture was reproduced with a private instrumented
copy of the current source. Its only prompt is SLIGHT_LEFT at cumulative
recording distance **383.956268 m**, with shape angle **−53.371561°**. Its actual
metric position is **(4.977128, 297.073290) m**, where the main road runs along
x=0 and the last side street meets it at y=300. At the accepting −4 m and −2 m
probes, positions are (2.554, 293.885) and (3.765, 295.479) m. There is no
383-versus-300 indexing error: accumulated distance follows the noisy recording.
The processed route is **517.967660 m**, versus the intended 400 m straight road.
It retains 50 points from 81 noisy fixes. No network decision point is inserted;
this is a shape event borrowing a nearby junction.

The intended path is independently labelled: advance along x=0 through all
three junctions and never take a side street. A path matcher should select main
road → main road; its map angle is zero. No prompt follows, regardless of how
the raw recording's local chord rotates. Original encoded recording geometry
and its cumulative distance can remain unchanged.

## Independent examination of historical decisions

These labels are interpretations of supplied geometry and cached map, not a
claim of fresh survey ground truth. Diagnostics never fetch. The local fixture
and cache provide enough evidence for the first close pair, but cannot settle
every short movement at the second junction below.

### Decisions at 852.000003 m and 879.496216 m

**Retain LEFT then RIGHT, 27.496 m apart.** The source route arrives roughly
westward, traverses a real southwest/south connector, and leaves roughly
westward. At the first event, 15 m approach and departure chord headings are
−72.122° and −139.933°. At the second (probe at 879 m), they are −159.534° and
−92.298°. These are two opposite movements, not oscillation around one road.
The track's middle leg moves about 12 m west and 20 m south before its second
corner. Nearby cached cycleway pieces follow that connector and meet the
outgoing cycleway. This supports the independently labelled close pair.

Some connector pieces have fewer than 6 m of arm length. The current branch
extractor returns no arms for them. A matcher that demands a fixed run length
on every chosen way would remove legitimate topology here. It should retain
short connected edges in the traversed path even when an entire edge fits
between two association samples. The pair must also survive name changes and
segmentation of the same geometry into additional ways.

### SLIGHT_RIGHT at 3558.608725 m — corrected with recovered original topology

**Retain the right branch choice.** The initial cache-only diagnosis identified
an ambiguous 6 m excursion and could not settle whether it was recording jitter.
A subsequently recovered local Overpass response resolves that ambiguity. The
original source contains the actual short cycleway connector and separate
outgoing path that display generalization hid.

The incoming residential way ends at a node within **0.014 m** of the source
route corner. A cycleway crossing shares that same node, travels about 1.8 m
north to the first connector node, then a **5.6 m** cycleway continues to the
second shared node about 7.35 m from the corner. A separate designated path
starts at that second node and heads northwest. The source GPX follows this
connected sequence. This is a real selection of a northward branch followed by
a very short connector, not a fabricated map connection inferred from proximity.

The competing residential road also begins at the first junction and heads
northwest. Its raw `bicycle=use_sidepath` tag is further evidence that treating
its generated centreline as the selected cycling path is unsound. These are
preserved raw tags, not a complete legal access determination. The old cached
map's incoming/outgoing main-road arms imply a −11.128° continuation, but those
arms describe the competing road instead of the actual selected short path.
The cached display suppressed the separate path as detail, and its branch
extractor ignores the 5.6 m stub. Both losses explain why a nearest-arm
normalization or ±16 m same-line test removes this valid right prompt.

This establishes the **right branch choice** near the retained event. It does
not independently certify the exact SLIGHT_RIGHT-versus-RIGHT icon or whether
the following short alignment change merits an additional prompt. A future
matcher must trace the short path and evaluate its maneuvers explicitly.

The raw response's OSM base timestamp is **2026-11-04T18:37:50Z**. The legacy
processed cells were cached on 2026-11-13; their cache-write timestamp does not
establish their OSM source date. They must not be presented as one synchronized
map snapshot. Nonetheless, shared original node identities and sub-centimetre
route-corner agreement establish local overlap, and the short path explains
the actual GPX movement. Private node/way identifiers and coordinates remain
in `.local/route-association/raw-at-*.json`.

The recovered source also confirms the close 852/879 m connector as a chain of
shared-node designated paths. The final south connector joins the westbound
outgoing path at a common original node. Thus both opposite turns remain
supported independently of the 15-turn baseline count.

Exact-vector preservation protected a valid branch in this case, although it
remains a change detector rather than a universal correctness oracle. The
failure was interpreting generalized display roads as navigation topology.

## Smallest counterexamples the replacement policy must satisfy

| Counterexample | Required result | Why local suppression fails |
| --- | --- | --- |
| Straight main road, one perpendicular side street, 3 m recording jitter | No prompt when path stays on main | Nearby branch does not prove selected exit |
| Same T junction, actual turn onto side street | Correct turn | Identical nearby arms; traversal differs |
| Two junctions joined by a 22–27 m connector | Both opposite turns | Long smoothing/dwell windows erase the connector |
| Same junction split across several 2–5 m ways | Same decisions as unsplit graph | Way identity/run length is serialization, not movement |
| Curving road split into two way IDs at a side street | Continue without false turn | Different IDs do not imply a branch choice |
| One way containing a bend and a junction at an interior node | Turn only for selected branch | Same way ID does not prove continuation |
| Grade-separated crossing/parallel cycleway | No transition without connection | Geometric proximity is not topology |
| Deliberate out-and-back on one edge | One U-turn | Same edge identity can still mean reversal |
| Sparse chord with two equally plausible legal paths | Explicit uncertainty | Endpoint geometry cannot identify discarded corners |

The public 25° fork, true 120° junction, no-choice 120° bend and closed round trip
remain necessary labelled controls. Add noisy versions of the *actual turn*
and both close pairs; a negative noisy straight fixture alone can reward
suppressing every maneuver.

## Concrete implementation design

1. **Preserve a navigation graph separately from display lines.** At map ingestion
   retain original node IDs and unsmoothed way geometry, split at shared nodes,
   and retain traversal permissions/direction and original way IDs. Display
   generalization remains a separate product. Cache the graph with a versioned
   optional field; old caches explicitly have geometry-only capability. Do not
   infer connectivity by intersecting polylines: that connects bridges and
   parallel paths incorrectly. Existing cached line endpoints may support a
   bounded prototype, but cannot justify universal correctness.
2. **Associate the observation sequence, not each chord independently.** Keep
   several nearby directed edge/projection candidates plus an explicit unknown
   state. Score lateral fit and consistency between observed displacement and
   legal connected path distance/progress. A predecessor transition can include
   several short graph edges. Do not score 2 m noisy bearings as independent
   decisive evidence. Use the original/simplified track as observations without
   changing exported positions or accumulated distance. Restrict graph searches
   to the local route corridor and plausible path lengths.
3. **Retain alternatives and confidence.** Dynamic programming should expose the
   best path, plausible alternate paths, gaps, and residuals. A confidence rule
   must be calibrated from labelled positive and negative fixtures. A single
   fixed winning path is not evidence when competing paths have similar fit.
   Do not introduce an uncalibrated magic score margin as a correctness claim.
4. **Derive maneuvers from traversed junctions.** Walk the associated directed
   edge chain; determine the incoming and selected outgoing arms and other
   legal connected exits at each traversed junction. Compute the turn from map
   geometry along those chosen arms. Apply existing semantic rules to these
   facts. The chosen forward continuation cannot be an alternative to itself.
   Name-only cuts should reuse this association. Shape events on a confidently
   associated unchanged corridor are suppressed; true reversals remain explicit.
5. **Handle uncertainty deliberately.** Geometry-only/no-map/ambiguous spans may
   keep the documented geometric fallback, but must not claim a verified road
   choice. Do not fabricate sparse-path turns to reach a count. If a user-facing
   quality signal is added later, report uncertain spans without changing route
   geometry. Use the recovered 3558 source topology as a labelled short-connector
   control, not a longer smoothing window or count target.

A smaller, safe first increment is to expose association candidates/projections
and trace why every retained shape turn passed. That makes the architecture
observable, but does not itself close the noisy acceptance failure. A direct
nearest-map-arm substitution can demonstrate the synthetic fix privately; it
cannot establish connectivity, distinguish a nearby parallel path, or settle the
historical short connector and must not ship as the complete policy.

## Offline validation and resource bounds

The private outbound fixture loads **21,456 navigation/display-filtered lines**,
**413,902 polyline segments**, and has **2,092 two-metre association samples**.
It simplifies to 85 route-analysis points after decision insertion. Current
independent matching creates 98 line runs. These numbers rule out any proposal
that scans every map segment for every sample (about 866 million comparisons).
Keep the existing local spatial index or replace it with an equivalent indexed
candidate lookup.

For a prototype with at most K=6 retained directed candidates per observation,
the dynamic-programming table needs about **75,000 candidate-pair evaluations**
for this fixture, plus bounded local graph searches; storing scores and
predecessors is O(NK). These are proposed bounds, **not measured performance**.
The candidate cap needs a diagnostic when it truncates relevant hypotheses;
unbounded junction/edge searches would invalidate the estimate. Navigation
index construction is O(E) or O(E log E), once per loaded graph, not once per
sample. Benchmark index construction, matching, maneuver generation, map
encoding, peak memory and candidate truncation separately on the target browser.

The isolated reproduction uses a throwing `fetch` stub, `navigator.onLine=false`,
a cache reader rooted in the recovered local cache, and a throwing cache writer.
Its files are `inspect.mjs`, `route-trace.mjs`, `noise.mjs`, `trace.json`,
`inspect.log`, and localized `at-*.json`. `route-trace.mjs` is a private copy of
current production source with only diagnostic exports/hooks and absolute
imports. It is not an implementation candidate. `historical.log` records the
unchanged acceptance harness replay. No map fetch, cache population, device
access or on-road validation was used.


## Implemented source-preservation increment

`buildCell()` now captures every returned highway way before display filtering
or generalization, including short and access-restricted ways. The version-1
`navigationSource` contains original way IDs, node IDs, full-precision
unsmoothed coordinates, and copied raw tags. Retaining all tags avoids dropping
conditional, directional, access, junction, bridge/tunnel or layer facts. It
neither interprets permissions nor connects intersecting geometry. The source
is copied, so subsequent input mutation cannot change the captured observation.

`loadOSM()` merges overlapping cell sources and returns this separate field.
Identical ways merge once; contradictory observations of the same way are
quarantined. Invalid IDs, coordinates, node/geometry alignment, unsupported
source versions, missing legacy fields and contradictory coordinates for a
shared node make `complete` false and expose structured issues. `complete`
means the loaded responses passed source-integrity checks; it does **not**
claim global OSM coverage, synchronized cell dates, complete turn restrictions,
or a navigable graph. Conflicting-node observations remain original source
facts with an incomplete status; consumers must not silently build a confident
graph from them.

The processed cell version is now 8, so an online refresh can populate original
source data. Offline legacy cells remain readable with an explicit
`missing-cell-source` issue and no migration fetch. Missing optional signal/stop
overlays also no longer trigger an offline request. Existing missing mandatory
cell failure behavior remains unchanged.

Thirteen synthetic tests passed after observed failures: split/unsplit shared
nodes, grade-separated crossings with distinct node identities, raw direction
and access tags, roundabout closure without fabricated oneway, short hidden
connectors, source immutability, smoothing separation, invalid alignment and
coordinates, legacy offline cells, duplicate merge/conflict, missing offline
node overlays, contradictory shared-node coordinates, missing raw way geometry, and missing original node IDs. The first nine tests
failed before implementation because source capability was absent; two further tests exposed six attempted offline overlay requests and an undetected coordinate
contradiction, respectively, before their fixes. Malformed-geometry and missing-node tests exposed cell-ingestion exceptions;
those highway inputs are now skipped for display while their source-integrity
issues remain explicit.

Independent before/after `buildCell()` comparison used the recovered 9,791-element
raw response (7,533 original highway ways) for four covered cells. All existing
visual fields deep-equaled the saved pre-change source output, including lines,
areas, water, rails, green, trams and waterways. The optional source was complete
for this response. Private timings were 157–213 ms before and 185–246 ms after
on one local run; these are observations, not a browser performance guarantee.

The combined synthetic run reports **32 tests: 31 passes, one executed known
TODO**, the unchanged noisy side-street failure. The historical 10/12 acceptance
status remains open, with 25 noisy turns and three sparse turns against the
15-turn reference. Source preservation does not change the route matcher or
claim to fix those failures. The original raw response and cached map fixtures
were read only; no network or device access was used.
