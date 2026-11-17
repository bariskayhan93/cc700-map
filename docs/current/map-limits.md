# Map behavior, tuning controls and calculated budgets

This document preserves the earlier v18 audit snapshot below. Current firmware
is v21; the generator now uses [adaptive resource budgets](../research/adaptive-map-budget-2026-11-14.md).
The old styled 1,150-entry/approximate-byte checks in this snapshot have been
replaced. The formulas and measurement caveats still apply.

2026-11-14 audit snapshot. Installed firmware was v18. This is a practical budget model for
feature work, not a new claim of full device simulation. The new read-only
calculator is `tools/map_budget.py`; it works on existing route files and needs
no device connection.

Verification: the combined run at
`.local/validation/20261114T103306511971Z/` passed 109 Python tests and the
existing Node/offline checks, retaining the documented noise/sparse failures.
[Aggregate calculated costs](../mining/map-budget-observation.json) contain no
private coordinates or route names. No generation settings or device state
were changed for this audit.

## Behavior we can follow

| Stage | Current behavior | What changing it affects |
| --- | --- | --- |
| Map acquisition | Original node/way data is preserved separately from generalized display geometry | Better future path association can use topology without increasing device map detail |
| Route generation | Chooses layers, clips geometry, builds entries and groups sections into map blocks | File size, decoded memory, map coverage, projected geometry and load cost |
| Device block selection | v18 scans route segments, resolves their section to a file/local section and uses a 25 m distance preference for the current section | Which available block follows the position; this does not generate missing map data |
| Block load | Reads serialized bytes, frees the old decoded map, decodes the new map | Temporary overlap and contiguous allocation requirements; no unchanged-offset cache is proven |
| Map frame | Clears canvas, draws map passes and route/arrow overlays | Frame cost depends on geometry, styles, clipping, fonts, dashed lines, filled pixels and locks |
| Off-route | v18 permits the loaded basemap pass while stock off-route notices/planning continue | A valid block can still have insufficient geographic coverage far from the route |

We can replay selection, render actual map C on the host and compare generated
files. Exact whole-device frame duration and concurrency remain measurements.

## Current generation settings: policies, not device ceilings

| Setting | Current value | Important qualification |
| --- | ---: | --- |
| Styled block route span | 1,500 m | Sections are indivisible, so one long section can exceed it |
| Window extension | 400 m behind, 300 m ahead | Smaller blocks repeat more surrounding map data |
| Entry merge threshold | 1,150 | Checked when extending a block, not an absolute cap on its first section; arrows/rough overlays are appended afterward |
| `BLOCK_PTS` | 9,000 | The check is actually **encoded entry bytes / 10**, not a decoded-point count; about 90,000 entry bytes, excluding later envelope/overlay additions |
| Styled line chunk | 60 total line points | Does not limit polygons; acquired blocks have entries with up to 74 stored coordinate pairs |
| Simplification tolerance | 1.5 m for styled line runs | Changes geometric detail and point counts, not just entry counts |
| Minor/service/paths coverage | 550 / 350 / 300 m | Per-class corridor distance; cycleways 350 m |
| Major-road coverage | 1,000 m | Can preserve orientation farther away while small paths disappear sooner |
| Area/rail/tram/waterway coverage | 600 / 450 / 450 / 450 m | Areas also add scanline/pixel work. Since 18 Nov a block with a context cap below 600 m cuts its fills at the cap (a cut ring has no outline) |
| Line chaining (18 Nov) | same style, exact shared end point, at most 60 points | Fewer entries and projection calls; the dash phase runs on across a joint. Results: `docs/research/map-economy-step1-2026-11-18.md` |
| Labels | 12 per block, at most 23 encoded name bytes | Font rendering has a different cost from road projection |
| Route file guard | 4,000,000 bytes | Application guard, not a demonstrated reliable device capacity |

There is no established hard device limit of 1,200 map entries. Historical
hardware drew 1,346; host sanitizer fixtures exercise 4,000. Neither establishes
smooth drawing at those counts. The styled path does not use the app's ordinary
`cap` parameter as its block threshold; changing that debug control alone does
not retune `BLOCK_ENT`.

## Calculable memory and drawing work

For a well-formed decoded block, let N be entries, P stored coordinate pairs,
M the largest styled entry's stored pair count, and S serialized block bytes:

- Decoded allocation payload: **D = 28N + 8P**. The target allocates 28 bytes per
  entry even though callbacks use a 24-byte entry stride.
- Iterator float buffer: **8(M+1)** bytes, when M is nonzero.
- Each projection callback temporarily allocates **4 × projected points**.
- Map canvas: **240 × 256 × 2 = 122,880 bytes**, persistent while present.
- Load-overlap payload: **max(D_old + S_new, D_new + S_new)** before adding
  the canvas and other allocations. The calculator includes S's four-byte record
  prefix, so its serialized-buffer estimate is conservative by that prefix.
- The largest individual request must fit one contiguous free block. Total free
  RAM alone cannot establish this.

Allocator metadata/alignment, route points and indices, matcher/planner,
recording, radio and LVGL/display allocations are additional. Thus the result
is a **component payload budget**, not total heap usage or guaranteed headroom.

Projection calls are calculable from styles: a normal cased road projects twice;
a path/rail/cycle bridge adds two base passes; green/water may draw fill and
outline; labels project one anchor but can trigger five text draws. Dashed roads,
filled polygon area and font glyphs prevent converting callback counts directly
into milliseconds. Class-15 arrow/rough overlays run through a separate path.
The calculator has eight boundary/primitive tests; a separate renderer test
compares its call and projected-point totals with the actual unchanged C
iterator across 320 style/level/bridge/tunnel combinations over three frames.

### Acquired 4-block ride route

The actual file is 253,952 bytes with 30 section-index entries. Public figures
below contain no route coordinates or names.

| Block | Entries | Stored pairs | Serialized record bytes | Decoded payload bytes | Basemap projection calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 787 | 3,096 | 56,160 | 46,804 | 1,234 |
| 2 | 836 | 3,471 | 62,075 | 51,176 | 1,241 |
| 3 | 963 | 3,685 | 67,420 | 56,444 | 1,499 |
| 4 | 571 | 1,827 | 35,280 | 30,604 | 928 |

Across any pair of those blocks, the conservative load-overlap payload plus
canvas is **246,744 bytes (~241 KiB)**. The largest modeled single request is
**67,420 bytes (~65.8 KiB)**. Drawing block 3 holds about 57,320 bytes of modeled
block/scratch payload plus the canvas. These figures exclude the allocations
listed above and do not establish current free memory.

Example marginal cost: adding 100 two-point minor-road entries (one centre plus
one stored pair) adds **3,600 decoded payload bytes**, 100 coordinate allocations
and about **200 projection callbacks / 400 projected points** per map iterator.
The CPU cost is not represented by the 3.6 KB alone. Serialized size depends on
coordinate varints, and rasterization depends on projected lengths and clipping.
Likewise, 12 maximum-length labels require at most **624 decoded payload bytes**
before allocator overhead, but can issue **60 text draws** when fully visible
(four halo draws and one foreground draw each). This is a call-count comparison,
not a measured timing ratio.

## How to compare changes

| Change | Expected tradeoff to calculate or test |
| --- | --- |
| Smaller blocks | Lower per-block decoded/draw cost; more overlap duplication, blocks and boundary changes |
| Larger blocks | More geometry and larger contiguous loads; potentially fewer distinct block changes; shared offsets do not guarantee avoided reloads |
| Wider map corridor | Better off-route coverage; more roads/areas, repeated storage and draw work; growth depends on local density and route shape |
| More detail / less simplification | More stored and projected points, larger buffers, heavier dashed/fill work |
| More labels or POIs | Modest coordinate memory can still add substantial text/symbol drawing cost |
| New patch features | Current production v18 has **8,600 bytes** left in its mapped code page; also budget RAM, execution and file-format compatibility |

Generate candidate files locally using the same track and cached map, then run:

```sh
python3 -I tools/map_budget.py candidate-route.bin
python3 -I tools/validate_local.py
```

Compare file bytes, maximum D/S/individual request, projected points/callbacks,
block changes and coverage. Keep generation, selection and drawing as separate
questions; increasing a limit does not guarantee that the generator will choose
the most useful extra detail. The calculator does not change device settings or
route generation.

The next useful hardware budget is a **stationary controlled navigation test**
for frame/lock duration, heap minima and largest free allocation under a few
candidate blocks. Motion is needed later for physical heading and GPS usability,
not for every block-size comparison. We should derive an operational budget from
those measurements with a stated margin, rather than name an unmeasured safe
entry count. Experimental capture allocations are excluded from production v18
budgets; their half-megabyte journal must not silently become the baseline.
