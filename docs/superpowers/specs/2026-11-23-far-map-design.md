# Far map: a budget map where the detail map ends (design, 23 Nov 2026)

## Intent

Off the route, and outside the detail-map corridor, the rider must see the shape of the surroundings: the own way, which
branch is which at a fork, and the normal map colours (water, forest, green, main roads). Today the unit shows one grey
line per street, only ways that the cycling access rule admits, and only while the violet line shows (owner: "off route
behaviour"; 21 Nov ride: forest tracks had no violet and no grey).

## Evidence (own checks, 23 Nov; Codex weekend review used only as leads)

- 576 of 615 off-route fixes with no line on route_11211526 were on ways removed only for "needs explicit bicycle
  access" (574 `highway=track`, grade 2-3). Ride area: 550 of 804 km of tracks and 551 of 1,085 km of paths are removed
  that way. The grey uses the same graph (`js/wayback.js:60`). Scripts: `.local/grey-flicker/`.
- Grey on/off: the line is present in 85 % of off-route fixes; no one-frame drop. The grey depends on the stock
  off-route state (`wb_device.c:280`) and on a line (`:149`).
- Cost study on the ride (`.local/far-map/study.mjs`, `land.mjs`; 7,948 screens along the real track; caps 60,000 work,
  2,048 points):

| Layer | Storage (2 km) | Work p50 / p90 / max | Over a cap |
|---|---|---|---|
| Grey today | 140 KB | 7,413 / 32,859 / 55,876 | 0 |
| Riding set, grey widths | 115 KB | 3,317 / 17,154 / 37,560 | 0 |
| Riding set, edge + core on main and minor | 115 KB | 4,264 / 36,232 / 72,098 | 52 |
| Green and water outlines (12 m, >= 0.5 ha) | about 13 KB (+ cut at cells) | fill only | - |
| Rivers and streams | about 13 KB | lines | - |

## Goals

1. A far-map layer, built on the page, that shows every riding-relevant way with its class, plus green and water.
2. Drawn by position in every map frame, on and off the route, under the detail map. No on/off with the off-route state.
3. No visible edge where the detail map ends: the same colour family, lines joined at the reach of their class, areas
   under the detail fills.
4. Exit edges: when the rider is on a track or path that the access rule does not admit, the violet line leads out of it
   to the admitted streets. It never leads into such a way.
5. Within the current limits: file guard 4.0 MB, map frame stop 400 ms, 0 B extra heap outside the existing PSRAM buffer,
   area 2 code room (14,684 of 18,404 B used).

## Non-goals

- No change of the cycling access rule for the violet line (owner decision open; exit edges need no legal assumption).
- No rejoin-target change (forward visit). That is the next project.
- No drawing speed work (render cache). Measure first; owner: "drawing work optimisation will be made later".
- No change of the phone-side generation cost in this project. Recorded as a later study (owner: generation on the
  phone costs too much; phones have capable graphics).

## Anti-goals

- Clutter: service ways, footways and small areas (< 0.5 ha) are not in the far map.
- A far map that slows the detail map: the far map has its own time stop and caps; when it stops, the detail map draws
  as today.

## Design

### Data (page, generation time)

- Ways: all `highway` ways of the routing snapshot (already fetched for way-back data), independent of the access rule.
  Classes: main (motorway..tertiary and links), minor (residential, unclassified, living_street, road), cycle
  (cycleway), track, path (path, bridleway), water line (waterway river, stream, canal).
- A way piece is in the far map when it is inside the reach and outside the detail reach of its class
  (`SR` in `js/mapsec.js:311`: main 1,000 m, minor 550 m, cycle 350 m, path and track 300 m, water line 600 m). A piece
  that leaves the detail reach starts at the last detail point, so the line continues without a gap.
- Areas: water (natural=water, waterway=riverbank, landuse reservoir/basin), forest (landuse=forest, natural=wood),
  green (grass, meadow, park, garden, scrub, heath, cemetery, allotments, orchard, recreation ground, village green).
  Areas >= 0.5 ha, simplified 12 m, clipped to each 256 m cell. Areas are not cut at the detail reach: they draw under
  the detail fills, so the two fill in the same colour where they overlap.
- The area tags come with the routing query (one Overpass request, the same box).
- Fit: the screen proof of the grey layer (all screens, 16 headings) with the class widths; while a screen is over a cap,
  remove the shortest dead-end line in its cells (as today). Areas count as fill work, not line work.

### Format: section type 4 "CCFM", version 1

- The grey v2 structure (header, directory, key table, bodies; 256 m cells, 0.5 m grid) with a new body.
- Body: varint group count; each group: u8 class, varint item count, items. Line items as grey v2 lines (2..32 points).
  Area items (class >= 8): varint ring point count (3..64), points as for lines; one ring per item (holes are separate
  items of the ground class 15 = no fill: not used in version 1, the area is drawn without holes when the hole is
  < 0.5 ha).
- Header caps: line work cap, point cap, fill pixel cap.

### Unit (firmware, area 2)

- `wb_far(cb, P)` is called at the start of `cc_iter`, after the projection setup and before `draw_fills`, when the open
  route file has a type 4 section. Order: areas, then lines by class (path, track, cycle, minor, main edge, main core,
  water line), then the detail map draws over it.
- The view comes from the own projection P (block flag 64) or from the 4 anchors (today's grey path) without it.
- Cells: `gl_cells` with the screen box made larger for the real 540 m ahead.
- Stops: header caps, and a time stop FAR_US (60 ms) checked between groups. A stop or a read error ends the far map for
  that frame; the detail map draws as today.
- Off-route frame: when the file has a type 4 section, `wbd_grey` does not draw (the far map already shows).
- Test text (F_TEXT): the map text adds `f<ms>` and `+` when the far map stopped.

### Exit edges (page, way-back data)

- Ways that fail the access rule only with "highway-needs-explicit-bicycle-access" and have `highway` track, path or
  bridleway become exit edges. An explicit prohibition (bicycle=no, access=no or private) stays excluded.
- In tree A, a node gets its next step over an exit edge only when it has no admitted edge. So a rider on a track gets a
  line along the track to the first admitted node and then on admitted streets; a rider on a street never gets a line
  into a track.
- The unit core does not change (data only).

## Normal behaviour, admission, fallback, restoration (AGENTS.md)

- Normal: far map in every map frame where the screen has far cells; detail map and route on top.
- Admission: the type 4 section passes its header and table checks; each body read passes its bounds checks.
- Fallback: no type 4 section -> today's behaviour (grey type 2 off route). Any far failure -> no far map in that
  frame, detail map unchanged.
- Restoration: firmware `restore-v1` (variant 1 image) and the route files of `.local/cc28-flag64/pack`.
  New route files with type 4 have no grey type 2 section: old firmware shows no grey with them.

## Budget target (owner, 23 Nov): 3 km reach on a 70 km route

- Test data: the 21 Nov ride (route_11211526, 47 km track, forest and city) for look and per-screen cost; the 70 km
  route (C2) for the file budget.
- Estimate for 70 km at 3 km (scaled from the ride, 34.73 km route): far lines about 380 KB, areas and water lines about
  85 KB, way back about 1.40 MB (19 Nov build), map and route about 1.07 MB: about 2.95 MB without grey type 2, under the
  4.0 MB guard. To be measured on the C2 build.
- Gap: a 70 km route at 3 km has a query box of 654 km², over the 600 km² bound, so the page steps down to 2 km today.
  Proposed fix in this project: query a corridor of smaller boxes along the route (their sum is much less than the
  bounding box), so 3 km stays the default.

## Limits and open measurements

- Unit time of far reads, line work and fill: one stationary measurement with `f<ms>` (owner yes per write).
- The screen box model is an estimate (540 m ahead at 2.5 m/px; auto zoom not mined).
- Phone generation time and memory grow with the area query: measure on the computer page first.

## Approaches considered

- A: one grey with class widths. Cheapest, no colour. Kept as the fallback style constant.
- B: light colours with edge and core on main and minor: over the cap on 0.7 % of screens. Rejected as the default.
- **Chosen: B-lite** (edge and core only on main roads, other classes single lines in detail-map colours) plus areas.
- C with a coarse land mask (32 m squares, 31 KB): blocky edges or new smoothing code. Rejected for outlines (13 KB).
- Wider detail corridor: map blocks have no room (N1: 151 B free of 64 KB). Rejected.
