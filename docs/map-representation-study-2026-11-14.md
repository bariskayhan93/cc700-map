# Map representation study — reliability before drawing count

2026-11-14. This is an offline experiment, not a new deployed map style or firmware.
The priority is a reliable, consistent navigation display, then bounded device
rendering/memory work. More generation work on the phone is acceptable.

## What the proposed approach means

A street can be the visible gap between surrounding filled regions. That differs
from replacing a cased street with a grey centre line. Where filled surroundings
are absent, a hybrid can retain explicit road strokes or construct a separately
identified neutral context layer. Neutral context must not pretend to be known
buildings, parks or other land use.

The current source contains broad land-use polygons and road centre lines, not
already prepared city-block footprints. A fill-based method therefore needs
buffer/union/difference processing. These are established geometry operations
([QGIS geometry generator example](https://changelog.qgis.org/en/entry/404));
what matters here is their resulting geometry and behavior on our renderer.

## Experiments performed

- Three real cached-route windows, each at 1.25, 2.5 and 5 metres/pixel.
- Six synthetic route types at those same zooms: urban grid, residential streets
  with missing fills, rural roads, forest paths, close parallel roads/hairpins,
  and bridge/tunnel crossings.
- Headings 0, 45 and 90 degrees, native 240 × 256 map canvas.
- Current cased roads; unsafe fill-only control; conservative hybrid; and
  fill gaps with neutral context. An additional optimized real-data hybrid
  uses constrained phone-side geometry simplification.
- 432 Canvas frames generated; representative matrices visually inspected.

Colors and resolution were held constant to isolate representation. The Canvas
fixtures use the consistent-fill study for all variants, including the cased-road
reference. They are not screenshots of the installed firmware. Browser line
rasterization remains approximate; font/telemetry/navigation runtime are not
being validated by these fixtures. Absolute route coordinates stay local/private.

## What the numbers say

These are geometry-component models from clipped cached display shapes, **not
exact production route files, total heap requirements or device milliseconds**.
They exclude unchanged route/label/recording data and do not include production
corridor filtering/RDP. The fill-work proxy counts the edge checks performed by
the current C scanline loop after projection/clipping; it excludes line rasterizer
work, pixel writes, sorting and allocator/scheduling costs.

| Representation | Decoded geometry relative to reference | Fill edge-check work relative to reference |
| --- | ---: | ---: |
| Conservative hybrid | 1.01–1.11× | 1.24–12.13× |
| Constrained simplified hybrid | 0.918–1.076× | 1.21–7.28× |
| Neutral context plus fill gaps | 1.05–1.27× | 5.72–36.04× |

The optimized hybrid is smaller in 6/9 geometry cases, but still increases the
scanline edge-check component. Removing road strokes does not demonstrate a
net speedup. Conversely, this model cannot demonstrate a net slowdown without
measuring how much line work was removed.

At 2.5 m/pixel, the three real samples illustrate the tradeoff:

| Sample | Reference modeled bytes | Naive hybrid | Optimized hybrid | Polygon stored pairs: reference → naive → optimized |
| --- | ---: | ---: | ---: | --- |
| A | 46,192 | 49,332 | 47,052 | 208 → 1,239 → 954 |
| B | 56,620 | 57,160 | 56,280 | 250 → 458 → 348 |
| C | 37,644 | 39,120 | 36,472 | 118 → 564 → 233 |

Phone-side optimization uses tolerance 0.25 screen pixel for each zoom tier and
accepts a simplified polygon only if valid, component/hole counts stay stable,
and protected road cores remain uncovered (minor 4.5 px, service 2.5 px). Rejected
polygons retain original geometry. Mac geometry processing took approximately
6–15 ms per window plus 0.6–2.6 ms simplification/validation. Those are not phone
or device timings.

## Reliability findings

- **Missing fills/rural roads:** fill-only loses road context. The conservative
  hybrid retains all rural-road fallback strokes in the synthetic case.
- **Forest paths and cycling infrastructure:** retain their explicit class and
  surface treatment; a white gap alone cannot communicate those meanings.
- **Bridges/tunnels:** these entries are retained. This is a structural check,
  not proof of correct device layer ordering for every crossing.
- **Parallel roads/hairpins:** two unconnected minor roads 8 m apart can merge
  into one gap at 2.5 and 5 m/pixel. The current 5-pixel white cores can also
  merge there; this is not established as a unique hybrid regression. A complete
  solution needs zoom/generalization decisions tied to the original topology.
- **Rotation and quantization:** a continuous geometric corridor does not prove
  an unbroken or distinguishable pixel corridor after integer projection.
- **Block boundaries:** generated cutouts depend on road width in screen pixels.
  Per-zoom cutouts or a screen-space renderer are needed; arbitrary metre buffers
  cannot preserve fixed pixel widths at every zoom. Neighboring blocks must
  produce matching cutouts. This experiment does not close that boundary.
- **Unknown background:** neutral context can expose roads without inventing land
  use, but its extra polygons are expensive in the current fill-loop model.

Coverage assertions found no omitted hybrid corridor outside known fill minus
water. Geometry validity and coverage are useful checks, but do not establish
full network or pixel-topology preservation.

## Cheapest useful direction for this device

1. Keep the reliable explicit-road method as the reference and default.
2. Improve fill correctness and semantic colors without adding geometry. Palette
   substitutions retain the same operations and payload; fixing doubled-hole
   seams does not require more stored vertices. Target timing remains a check.
3. Continue the optimized hybrid only for suitable urban regions, with mandatory
   fallback for missing context, bridges/tunnels and ambiguous narrow features.
   Do not select it just because it draws fewer strokes.
4. Compare a screen-space alternative before committing to more polygon data.
   One 1-bit 240 × 256 mask is 7,680 bytes (two are 15,360 bytes), but mask creation,
   compositing and contiguous allocation have not been implemented or benchmarked.
   This is a candidate, not an established saving.

Before adopting a new road representation: compare the exact production-encoded
files, check route-relevant connectivity and gap widths after rasterization,
verify cross-block/cross-zoom consistency, then measure stationary device frame
and heap behavior. No test ride is needed to decide the basic rendering budget.

## Local evidence

Scripts and JSON results are under ignored `.local/map-representation/`:
`real_benchmark.py`, `synthetic_benchmark.py`, `optimized_benchmark.py`,
`extra_costs.py`, `real_results.json`, `synthetic_checks.json`,
`optimized_results.json`, `representation_costs.json`, and `optimized_costs.json`.

Representative matrices:

- [Synthetic route types, 2.5 m/px, north-up](../.local/map-representation/synthetic-mpp2.5-h0.png)
- [Real cached shapes, 2.5 m/px, 45°](../.local/map-representation/real-mpp2.5-h45.png)
- [Real optimized hybrid comparison, 2.5 m/px, 45°](../.local/map-representation/optimized-real-mpp2.5-h45.png)

All other zoom/heading matrices and exact fixture/proxy limits are saved beside
them. Nothing in this experiment reads, resets, programs or injects data into the
device. Production app code and the deployed default were not changed.
