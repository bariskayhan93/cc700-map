# Navigation rendering practices applied to CC700

Research/mining, 2026-11-14. No application, route-format or device firmware
change is deployed by this report. Navigation consistency/reliability is the
first priority; generation time is secondary. Rendering savings should buy
useful navigation information, rather than a less readable baseline.

## What mature implementations actually do

| Established pattern | Primary evidence | CC700 adaptation / limit |
| --- | --- | --- |
| Separate data preparation from drawing | [MapLibre Native architecture](https://github.com/maplibre/maplibre-native/blob/main/ARCHITECTURE.md) separates layout/data preparation from render work | Do expensive geometry repair, classification, ranking and shared-chain simplification on the phone. Do not transplant its GPU pipeline or thread counts. |
| Use explicit semantic/scale rules | [Mapsforge theme specification](https://github.com/mapsforge/mapsforge/blob/master/docs/Rendertheme.md) has zoom ranges, class rules, multiple drawing instructions and label priorities | One coherent theme across road, urban, rural and forest routes. Promote route-relevant forks/crossings; simplify low-value background representation. Road casings are a legitimate tool, not inherently wasted work. |
| Use mode-specific information priorities | [OsmAnd default rendering source](https://github.com/osmandapp/OsmAnd-resources/blob/master/rendering_styles/default.render.xml) distinguishes bicycle-mode road ordering, surface/access overlays and POIs | Separate road class, cycling designation, surface and access. Unknown stays unknown. A single dash/color must not ambiguously encode all of them. |
| Preserve recognizable road hierarchy and grade separation | [Organic Maps road rules](https://github.com/organicmaps/organicmaps/blob/master/data/styles/default/include/Roads.mapcss) vary visibility/width by scale and distinguish path/cycle/bridge/tunnel cases | Translate relationships into a few RGB565/integer-pixel styles; copying mobile zoom numbers, fractional widths or alpha layers does not establish a good device style. |
| Prioritize labels and reject collisions deterministically | [Organic Maps overlay tree](https://github.com/organicmaps/organicmaps/blob/master/libs/drape/overlay_tree.cpp) uses priority, stable IDs and projected rectangles; Mapsforge has if-space placement | Stable feature/anchor IDs, conservative font bounds, a bounded screen collision pass, and reserved HUD/position/maneuver areas. Stable tie-breaks and controlled updates reduce popping. |
| Prepare adjacent geometry consistently | [MapLibre source specification](https://maplibre.org/maplibre-style-spec/sources/#vector) documents edge artifacts and buffer requirements | Simplify shared chains before splitting into blocks. Keep identical overlap coordinates, classes and ordering; establish a consistent dash origin. Their tile-buffer defaults are not device limits. |
| Generalize with the appropriate topology guarantee | [PostGIS topology-preserving simplification](https://postgis.net/docs/ST_SimplifyPreserveTopology.html) explicitly excludes shared polygon boundaries; [coverage simplification](https://postgis.net/docs/ST_CoverageSimplify.html) handles valid polygon coverages | Protect network junctions, semantic transitions, parallel roads and shared edges. Per-way RDP or individually valid polygons do not prove whole-map topology. Raw OSM landuse is not automatically a valid coverage. |
| Cull and reuse the right intermediate results | [Bangle map library](https://github.com/espruino/BangleApps/blob/master/apps/openstmap/openstmap.js) bounds visible tile work; [Mapsforge DatabaseRenderer](https://github.com/mapsforge/mapsforge/blob/master/mapsforge-map/src/main/java/org/mapsforge/map/layer/renderer/DatabaseRenderer.java) separates way and label processing | Retain map-space bounds/classification and skip irrelevant geometry early. Bangle is a raster-tile example, not a vector throughput benchmark. |
| Separate base-map and moving-overlay updates | [Bangle map app](https://github.com/espruino/BangleApps/blob/master/apps/openstmap/app.js) has a separate marker and controlled recentering; [LVGL 8 drawing](https://docs.lvgl.io/8.3/overview/drawing.html) tracks invalidated areas | Reuse retained base preparation when appropriate; restore old overlay regions. Course-up rotation changes the whole camera, so a final raster cannot simply be reused unchanged. |
| Measure several costs, not primitive count alone | [Mapbox performance guidance](https://docs.mapbox.com/help/troubleshooting/mapbox-gl-js-performance/) distinguishes sources/layers/vertices and update costs | Measure our decode, projection, raster, text and flush stages separately. Its GPU/WebGL cost model and performance numbers do not transfer to our software renderer. |

## The whole navigation display contract

The theme should maintain the same meanings across route types. The active route,
position and next decision come first; connected alternatives and crossings must
remain understandable. Land/water provide context; POIs and names compete for
limited space by navigation value. Keep the current green/grey fills as requested.

More detail does not have to mean more decoration everywhere. Useful additions
can be nearby branch geometry, the next street name, a cycle barrier, crossing,
steps or a water crossing. Each needs reliable source semantics and predictable
visibility. A dense collection of unrelated names/symbols can consume both screen
space and render time without helping the navigation decision.

Scale bands should have explicit tasks: overview, normal riding and maneuver
context. Their thresholds must come from the actual device metres-per-pixel
mapping and native-size checks. The existing 550 m minor-road / 300 m path
corridors are generation policies, not established best-practice thresholds or
hardware limits. Do not switch semantic colors merely because the route enters
an urban or rural region.

For consistency: lock junctions/semantic changes during simplification, simplify
shared display chains once, then clip to overlapping blocks on a common coordinate
grid. Validate protected decision geometry after quantization. Choose label
anchors before block-local clipping where possible; keep stable IDs across block
switches and resolve projected collisions with stable priorities.

Our device draws **one loaded basemap block at a time**. It does not currently
combine several tiles with 12 labels each. The current cap is 12 labels in the
active block; collisions can still occur within that set after zoom/rotation, and
anchors can change when the block switches. A large multi-tile placement engine
is unnecessary for that small candidate set.

Original navigation source is now preserved separately, but `buildRoute` still
uses generalized display lines for matching. An independent topology-aware
navigation matcher remains future work. Rendering changes must not be presented
as having solved that separate reliability gap.

## Local mining: reduce repeated work before removing visual information

The actual `map.c` iterator has one initial entry pass, four fill-class passes,
55 class/level line passes, one symbol pass and one label pass when styled scratch
allocation succeeds: **62 full-array inspections per entry per invocation**.
This repeats selection work even when most entries do not belong to that pass.

A research prototype groups entries without changing the semantic draw order:

- Keep stable order within each class/level road bucket.
- Ignore level for filled areas and labels, where the renderer ignores it.
- Keep traffic signals and stops in one stable group, preserving interleaving.
- Preserve the entire class-15 overlay subsequence.
- Retain the existing pass order, core/edge operations and glyph lookup content.
- Detect canonical ordering; old unsorted route files require the legacy path.

The JavaScript pass-selection model produced identical dispatch sequences for
all four acquired blocks, 100 independently randomized cases and the complete
4,096 class/level/flag combinations. A peer review caught an initial correlated
synthetic generator; it was corrected before reporting broad coverage. Flags
include bridges, tunnels, roughness, outline suppression and far-road styling.

| Block entries | Current modeled inspections | Bucket selection model | Same projection dispatches |
| ---: | ---: | ---: | ---: |
| 787 | 48,794 | 3,106 | 1,234 |
| 836 | 51,832 | 3,153 | 1,241 |
| 963 | 59,706 | 3,551 | 1,499 |
| 571 | 35,402 | 2,577 | 928 |

This is **not** an optimized firmware implementation or a frame-time saving.
The model assumes successful styled scratch allocation and does not emulate
allocation failure, decoder metadata, locking or full arrow execution. It counts
entry inspections, including binary searches—not machine instructions or memory
transactions. Raster/projection work and decoded geometry are unchanged. Target
benefit may be modest if those other stages dominate. This is nevertheless a
better first optimization candidate than deleting useful street borders.

## Cache correctness and separate resource budgets

Map-space coordinates, bounds, class and style-independent source identity can
survive camera motion. Screen coordinates and screen collisions cannot survive
arbitrary changes in heading, zoom, center or viewport. Final raster reuse needs
an unchanged camera/theme/data state; north-up strip updates are a different
problem from course-up rotation. A small moved marker still requires restoring
its old background.

LVGL dirty-region handling cannot refund CPU time already spent rebuilding the
entire canvas. The stock frame caller may already suppress some updates: measure
actual calls before adding another scheduling/cache layer. Loading the same
map offset is also unsafe to skip based on offset alone after reroutes or route
replacement; lifecycle/source identity must be part of any cache contract.

The memory budgets must not be mixed:

- The installed v18 has 8,600 bytes of executable mapped flash tail available.
- RAM/PSRAM is a separate resource. One 240 × 256 RGB565 surface is 122,880 bytes;
  an additional retained surface needs that much RAM plus metadata.
- One 1-bit screen mask is 7,680 bytes. That arithmetic proves neither speed nor
  available contiguous memory.
- Nominal PSRAM is 2 MiB; current worst-case free/contiguous headroom is unmeasured.

Bigger caches therefore need code-size, lifecycle and live heap measurements
separately. Reuse existing owned surfaces where safe before adding full bitmaps.

## Recommended order for CC700

1. Establish one shared style/visibility contract for generator, device and Pages
   preview; keep supported approximations and experimental styles explicit.
2. Protect shared geometry, seams and label anchors during phone preprocessing.
   Use source topology, not solely per-feature simplification validity.
3. Implement and verify selection bucketing/culling without changing pixels or
   dropping detail. Measure actual frame components and worst-case heap/loads.
4. Improve fill correctness and bounded label placement. Palette changes can
   reuse current operations; label halos and dashed-path segmentation need their
   own cost measurements.
5. Spend demonstrated savings on selected navigation-relevant detail. Preserve
   safe headroom for recording, radio, replanning and block transitions.
6. Keep negative-space urban filling as an optional candidate until it passes
   the same semantic/topology/consistency tests and target timing measurements.

The earlier [representation experiment](map-representation-study-2026-11-14.md)
showed that phone optimization can make a hybrid geometry-competitive, while
still increasing the current scanline edge-check component. Neither fill-only
nor the conventional renderer has been declared universally optimal.

Acceptance views: dense junctions, forest forks, sparse rural roads, water and
grade-separated crossings, close parallel roads/hairpins, long/edge labels,
block switches, zoom changes and course-up rotation. Compare the same view and
measure navigation-relevant legibility, projected/filled/stroked/text work,
load/frame distributions and peak/contiguous heap. A stationary device benchmark
can establish the rendering budget; a ride is for physical navigation acceptance.

## Evidence retained

Downloaded primary source snapshots and their URL/SHA-256 manifest are under
`.local/navigation-research/sources/`. The two topic memos and reproducible
`bucket_audit.mjs` / `bucket-audit.json` are beside them. They contain no new
on-device observations. No device connection, test GPS injection, app publication
or firmware write was performed for this research.
