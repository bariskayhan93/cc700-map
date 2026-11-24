# Map layers: costs, limits and work packages (24 Nov)

Status: research. No firmware or page code changed. The lab scripts are in `tools/lab/` (see its README).
Page with the same content and the charts: https://claude.ai/artifact/6kaA1rZBNeoLTA4fr9SCk7 (private until shared).

Evidence tags: **M** = measured on the unit. **S** = simulated in the lab; counts are exact for the two lab routes.
**E** = estimate from ESP32-S3 code that the cross compiler made with the build flags (`-Os`), at 1 to 1.5 cycles for each
instruction at 240 MHz, and 0.3 to 0.6 µs for each PSRAM cache miss.

Lab routes: Bayreuth (rural, 12.07 km, GraphHopper `north-bayreuth.osm.gz`) and Monaco (city, 3.51 km,
`monaco.osm.gz`). Both are less dense than the NRW routes. Do the runs again on NRW files before you set caps.

## 1. Summary

1. The far map spends its 60 ms on file reads and setup, not on drawing. Drawing is about 5 to 8 ms at p90 (S, E).
2. A far cell cache across frames cuts far reads from 17 to 18 per frame to 0 (median) and 2 (p90), also when the rider
   stands or turns (S). This fixes the flicker at 2.2 km. It needs one RAM word that stays between frames (open since
   18 Nov).
3. Own projection (`F_PROJ`, 20 Nov) costs about 0.2 µs for each point. The stock projection cost 20 to 50 µs (E). The
   block budgets of 14 Nov (1,400 calls, 7,000 points) and the city frames of 391 to 452 ms (19 Nov) are from the stock
   projection. No on-route frame was timed after 20 Nov.
4. In the rural detail map the fill loop of `rs_fill` is the largest drawing cost. A band fill does 88 % less loop work
   and gives the same pixels on 1,600 screens (S).
5. The way-back line is the largest measured cost: w204 to 224 ms for 162 to 171 reads (M). 85 % of its reads are
   8 B node reads and 4 B binary-search steps (S). A 192 B page cache removes them after the first frame (S).
6. The detail map and the far map draw the same areas: 99 % of the far fill near the route is hidden (S). Root cause:
   the coverage floor 600 / 800 / 1000 m that widens every class.
7. The green outline is 14 % of the projected points but well under 1 ms with own projection (E).

## 2. Measured values (M)

| Value | Where | Source |
|---|---|---|
| w204–224, r162–171 | way-back line, 2.2 to 4.7 km off route | photos 24 Nov |
| 1.15–1.38 ms for each read | way-back, 192 B reads | the same |
| f60+ to f64+ | far map, all 6 photos, one with almost nothing drawn | the same |
| m8–9 | detail map, off route | the same |
| m391–452 | detail map, city, on route | 19 Nov, stock projection |
| 524 ms and about 1.5 s | frames that did not restart the unit | 19 Nov |

## 3. Limits

| Limit | Value | Origin | Verdict |
|---|---|---|---|
| Draw cadence | about 1 s | stock timer (mined) | upper bound of a frame |
| Watchdog | unknown | — | not the binding limit (524 ms and 1.5 s frames survived) |
| `WBD_TIME_US` | 300 ms | 16 Nov guard | keep; the violet redesign lowers the work |
| `MAP_FRAME_US` | 400 ms | 18 Nov, "not measured" | keep as emergency stop; time again with own projection |
| `FAR_US` | 60 ms | copied from the cc26 grey layer | too tight for an uncached frame; fine with a cache |
| R-RIDE 220 / 80 ms | — | cc26 | retired since cc27 |
| Block calls / points | 1,400 / 7,000 | 14 Nov, stock projection | projection part now about 20 times cheaper; test again |
| Block bytes, decoded, fill vertices, labels | 65,536 / 57,344 / 2,304 / 384 B | 14 Nov targets | keep as guards |
| Coverage floor | 600 / 800 / 1000 m for all classes | 14 Nov | remove (B) |
| Far caps work / points / fill | 150k / 4,096 / 61,440 | 24 Nov | the unit does not enforce the fill cap; prove fill pixels on the page |
| Way-back section gate | 1,536 KB | not documented | a 70 km route at 3 km is over it in every option |

## 4. Cost of each layer

### 4.1 Detail map by feature (Bayreuth, today's file, S)

| Feature | Entries | Projected points | Beyond 300 m | Pixel work on route | At 700 m |
|---|---:|---:|---:|---:|---:|
| Green fill + 1 px outline | 398 | 7,424 + 3,685 | 71 % | 57 % | 70 % |
| Paths and footways | 710 | 6,791 | 70 % | 5 % | 5 % |
| Minor streets (2 passes) | 232 | 5,084 | 38 % | 19 % | 7 % |
| Built-up fill | 162 | 1,893 | 51 % | 5 % | 1 % |
| River lines | 151 | 1,322 | 63 % | 1 % | 2 % |
| Main roads | 6 | 276 | 33 % | 10 % | 10 % |

Monaco on route: main roads 43 % of pixel work, built-up 28 %, minor 27 %, paths 1 %.

### 4.2 Area fills (worst of 8 headings, S)

| Measure | Rural p50 | Rural p90 | City p90 | Fix |
|---|---:|---:|---:|---|
| `rs_fill` edge checks for each screen | 50k | 123k | 12k | band fill: 5k / 14k / 2k |
| Fill pixels | 51k | 122k | 61k | two pixels for each store (measure on the unit) |
| Fill pixels painted two times | 0 | 60k | 0.7k | union of areas of one colour on the page |
| PSRAM cache misses, whole detail screen | 3.5k | 7.5k | 9.2k | row fills are cache-friendly |
| Far fill checks for each frame | 7.6k | 14.5k | 6.6k | 10 % on areas beside the screen: box check |
| Simplify areas more (1 px) | keeps 92–95 % of points | | | no gain |

### 4.3 Cost for each step on the ESP32-S3 (E)

| Step | Instructions |
|---|---:|
| Own projection, one point | about 35 |
| Old fill, one edge on one row | about 16 |
| Fill, one crossing | about 35 + a divide |
| Fill, one pixel | 5 |
| Code size `rs_fill` old / band | 386 / about 1,000 B |

## 5. Far map

- Reads of one frame (code): trailer, header (`FM_HEAD` + 1,024 B), one record read for each cell row, one body read
  for each cell. `wbd_frame` opens the file again. Nothing stays between frames.
- Model (E): reads 17 to 20 × 1.27 ms = 20 to 28 ms, drawing 5 to 8 ms at p90. The rest of the 60 ms (about 25 to
  35 ms) is setup that is not split yet: file opens, trailer seek, PSRAM allocation, four stock probes.
- Cell cache (S, `farcache.mjs`):

| Case | Today | Cache 24 cells | Cache 40 cells |
|---|---|---|---|
| Riding on the route | p50 17, p90 18 | p50 0, p90 2 | p50 0, p90 2 |
| Riding 700 m / 2.2 km off | p50 17–18 | p50 0, p90 2 | p50 0, p90 2 |
| Turning in place, 2.2 km off | p50 17 | p50 0, p90 2–4 | p50 0, p90 2 |

24 cells of at most 2,048 B = 48 KB PSRAM.

## 6. Fill candidates (S)

`tools/lab/fill/fill_band.c`: bands of 16 rows; one pass over the edges for each band collects the edges that cross it
(stack list of 256); the old loop when edges × rows < 4,096; a box check. Same crossings, same order, same 128 cap,
same hole-bridge cancel. Result: 0 changed pixels on 312 rural and 88 city detail screens and 1,200 far frames.
Stack 320 → 880 B (check the GUI task stack). Host timing is only a hint (rural detail 1.5 to 2 times faster).

## 7. Green outline

| Option | Points saved | Look | Work |
|---|---:|---|---|
| Today: own pass, ring projected again | 0 | seams and edges | — |
| Fused: `rs_line` 1 px on the fill's own points | 3,854 | same pixels | `map.c`: op "fill + outline"; the whole closed ring comes in one `cc_line` call |
| Drop for green and water | 3,854 | edges by colour | page: bit `0x400` on every area |
| Two greens, no outline (forest `#a2d683`, other `#c8e6b0`) | 3,854 | shows which side is forest | page style + one fill op |
| Only shared green edges | about 2,900 | seams only | new line class; 23 % of the outline length is shared (Bayreuth), 0 % (Monaco) |

## 8. All variants on the same frames (S, E)

Frames: route spots every 600 m, rider on the route and 700 m and 2.2 km off, 8 headings. Percent values are against
today (A). "Far drawn" is the share of far pixels whose cell finished before the stop, with 35 ms setup (10 ms with a
cache); the range is for setup 20 to 45 ms (5 to 20 ms with a cache). The way-back line is the same in every row.

**Rural, Bayreuth (456 frames)**

| Variant | File | Detail points p90 | Detail ms p90 | Far reads p50 / p90 | Far ms p90 | Far drawn before 60 ms, worst 10 % | Screen drawn on route | Extra RAM | Extra code |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| A today | 316 KB (±0 %) | 2,729 (±0 %) | 14.0 (±0 %) | 18 / 21 | 66 (±0 %) | 80 % (29–100) | 62 % | — | — |
| A + fused outline | 316 KB (±0 %) | 2,452 (-10 %) | 13.9 (-1 %) | 18 / 21 | 66 (±0 %) | 80 % (29–100) | 62 % | — | +40 B |
| A + no outline (or two greens) | 316 KB (±0 %) | 2,452 (-10 %) | 13.8 (-2 %) | 18 / 21 | 66 (±0 %) | 80 % (29–100) | 62 % | — | — |
| A + band fill | 316 KB (±0 %) | 2,729 (±0 %) | 7.0 (-50 %) | 18 / 21 | 66 (-1 %) | 81 % (29–100) | 62 % | +560 B stack | +600 B |
| A + far cell cache | 316 KB (±0 %) | 2,729 (±0 %) | 14.0 (±0 %) | 0 / 0 | 16 (-76 %) | 100 % (100–100) | 62 % | +48 KB PSRAM | +1,500 B |
| A + firmware set (band, fused, cache) | 316 KB (±0 %) | 2,452 (-10 %) | 6.8 (-51 %) | 0 / 0 | 16 (-76 %) | 100 % (100–100) | 62 % | +48 KB PSRAM, +560 B stack | +2,140 B |
| B handover | 252 KB (-20 %) | 789 (-71 %) | 1.1 (-92 %) | 18 / 22 | 66 (±0 %) | 80 % (28–100) | 63 % | — | — |
| B + merged areas | 252 KB (-20 %) | 789 (-71 %) | 1.1 (-92 %) | 18 / 22 | 66 (±0 %) | 81 % (29–100) | 63 % | — | — |
| B + merged + firmware set | 252 KB (-20 %) | 789 (-71 %) | 1.1 (-92 %) | 0 / 0 | 15 (-78 %) | 100 % (100–100) | 63 % | +48 KB PSRAM, +560 B stack | +2,140 B |

**City, Monaco (120 frames)**

| Variant | File | Detail points p90 | Detail ms p90 | Far reads p50 / p90 | Far ms p90 | Far drawn before 60 ms, worst 10 % | Screen drawn on route | Extra RAM | Extra code |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| A today | 96 KB (±0 %) | 4,396 (±0 %) | 9.1 (±0 %) | 9 / 18 | 61 (±0 %) | 100 % (51–100) | 76 % | — | — |
| A + fused outline | 96 KB (±0 %) | 4,286 (-3 %) | 9.1 (±0 %) | 9 / 18 | 61 (±0 %) | 100 % (51–100) | 76 % | — | +40 B |
| A + no outline (or two greens) | 96 KB (±0 %) | 4,286 (-3 %) | 9.1 (±0 %) | 9 / 18 | 61 (±0 %) | 100 % (51–100) | 76 % | — | — |
| A + band fill | 96 KB (±0 %) | 4,396 (±0 %) | 8.4 (-8 %) | 9 / 18 | 61 (±0 %) | 100 % (51–100) | 76 % | +560 B stack | +600 B |
| A + far cell cache | 96 KB (±0 %) | 4,396 (±0 %) | 9.1 (±0 %) | 0 / 0 | 13 (-78 %) | 100 % (100–100) | 76 % | +48 KB PSRAM | +1,500 B |
| A + firmware set (band, fused, cache) | 96 KB (±0 %) | 4,286 (-3 %) | 8.3 (-8 %) | 0 / 0 | 13 (-78 %) | 100 % (100–100) | 76 % | +48 KB PSRAM, +560 B stack | +2,140 B |
| B handover | 80 KB (-17 %) | 2,659 (-40 %) | 4.4 (-51 %) | 9 / 18 | 61 (+1 %) | 99 % (50–100) | 74 % | — | — |
| B + merged areas | 80 KB (-17 %) | 2,659 (-40 %) | 4.4 (-51 %) | 9 / 18 | 61 (+1 %) | 99 % (50–100) | 74 % | — | — |
| B + merged + firmware set | 80 KB (-17 %) | 2,659 (-40 %) | 4.4 (-51 %) | 0 / 0 | 13 (-78 %) | 100 % (100–100) | 74 % | +48 KB PSRAM, +560 B stack | +2,140 B |

Turning coverage (earlier simulation, 24 headings): A 31–71 % of frames with at least 70 % of the navigation area
drawn, with a swing of 40 to 60 points; B with a 150 ms emergency stop 98–100 %; B + merged areas 100 %.

## 9. WP 7 at 70 km and 3 km radius

Sizes are scaled from measured builds: 70 km at 2 km (3,411,968 B; way-back 1,328,880; far 506,082) and the 34.7 km
ride at 3 km (2,101,248 B; way-back 1,182,416; far 277,661). Corridor area: 448 km² against 293 and 237 km².

| Section | A today | B handover | WP 7 C |
|---|---:|---:|---:|
| Route part | 0.27 MB | 0.27 MB | 0.27 MB |
| Detail map | about 1.31 MB | about 0.58 MB | about 0.58 MB |
| Way-back | 2.03–2.24 MB | 2.03–2.24 MB | 2.09–2.31 MB |
| Far map | 0.53–0.78 MB | 0.66–0.98 MB | 0.15–0.30 MB |
| **Total** (guard 4.0 MB) | **3.9–4.6 MB** | **3.5–4.1 MB** | **3.1–3.5 MB** |

Reads for each off-route frame (replay of `wayback.c`, `wbreads.mjs`; the city replay gives 128 to 202 against the
measured 162 to 171):

| Part | Today | After WP 2–6 | WP 7 line, cached | WP 7 C, cached |
|---|---:|---:|---:|---:|
| Trailer, header, end record | 3 | 3 | 0 | 0 |
| Cell-table binary search (4 B) | about 45 | about 45 | 0 | 0 |
| Row records | 3 | 3 | 0 | 0 |
| Node blocks, 3 × 3 cells | 10–20 | 10–20 | 0–2 | 0–2 |
| Extra-piece blocks | 4–8 | 4–8 | 0 | 0 |
| Single 8 B node reads | 50–90 | 50–90 | 0–1 | 0–1 |
| Far map | 17–20 | 0–2 | 0–2 | 0 |
| **Total, warm frame** | **135–190** | **115–170** | **0–2** (max about 8) | **0–2** (max about 12) |
| First frame off route (cold) | — | — | 90–130 | 370–830 |
| Extra PSRAM | — | +48 KB | +48 KB | about +110 KB |

C is not possible without a cache. Its cold frame must be spread over frames: line first, then the nearest streets.

## 10. Work packages

| WP | Kind | Change | Files | Accept | Risk |
|---|---|---|---|---|---|
| 1 | Measure | Test text `f<ms> s<setup> r<reads> i<io ms> d<draw ms>`; one on-route city frame with own projection | `wb_device.c`, `map.c` | the far 60 ms split; today's real `m` | none |
| 2 | Firmware | Band fill in `rs_fill` | `raster.c`, `raster_host.c`, `test_raster.mjs` | 0 changed pixels; `m` and `f` not worse | stack 880 B |
| 3 | Firmware / page | Fused outline or two greens | `map.c` (`draw_fills`, OPS, `cc_line`) | identical frame hash in `renderer_host` | none |
| 4 | Mining | One RAM word that stays between frames: GUI task thread-local pointer, canvas object user data, or a spare stock field | stock image (`.local`) | a pointer stays for 1,000 frames and a route change | blocks 5 and 7 |
| 5 | Firmware | Far cell cache: route id, header, rows, 24 bodies LRU, open file | `wb_far.c`, `wb_grey.c`, `wb_device.c` | reads p50 0; `f` under 20 ms; no flicker when standing | free PSRAM; reset on route change |
| 6 | Page | Handover B: coverage floor off, detail to 300 m, far owns areas and exit ways, union of areas, fill-pixel proof | `mapsec.js`, `far_map.js`, `map_budget.js` | file ≤ today; hidden far fill 0 %; turning coverage ≥ 90 % | coarser areas near the route |
| 7 | Design | Way-back page cache; option C streets from way-back with a street class | `wayback.c`, `wb_device.c`, `wb_far.c`, `wayback_format.js` | warm frames 0–2 reads; `w` under 100 ms; 70 km at 3 km ≤ 3.5 MB | way-back gate; cold frame |

## 11. Open items

- The setup part of the far 60 ms (about 25 to 35 ms) is not explained. WP 1 measures it.
- No writable globals: all caches need WP 4 first.
- The PSRAM cost for each cache miss is an assumption.
- `rs_line_aa` (smooth lines) blends edge pixels; its cost is not in the model.
- cc27 saw about 10 ms for each read while the stock log turned over. A cache also protects against this.
- The look of B near the route needs one ride.

## 12. Device calibration (24 Nov, evening)

Images 4f8a07e1 (WP 1-3), 414e987e (`FAR_US` 150 ms), 35602d56 (read probe), 322fb6a3 (draw split); N3/N4 WP 6 files.
Stationary, N3 home (about 1.1 km off) and N4 home (about 2.7 km off), heading north.

| Value | Simulation (section 8) | Unit |
|---|---|---|
| Far total `f` | about 60 ms, stopped | 67-93 ms, complete with the 150 ms stop |
| Setup `s` (open, trailer, header, anchors) | 25-35 ms, assumed reads | 20-40 ms; one 64 B trailer read 11-17 ms |
| Read at the file start (probe `z`) | — | 10-12 ms, the same as the trailer read |
| Reads `r`, file time `i` | 17-20, 1.27 ms each | 13, 1.6-2.4 ms each |
| Draw `d` | 5-8 ms | 20-27 ms |
| Fill time `F`, fill pixels (host, same A/N) | — | 10-11 ms, 64-66 k px: 0.16 µs/px |
| Line time `L`, line pixels (host, same A/N) | — | 13 ms, 22-27 k px: 0.5 µs/px (line work 2 x painted) |
| Pixels written, far frame (host, 312 frames) | — | about 75 k: built-up 50 %, other green 17 %, forest 6 %, street edge 14 %, core 7 % |

Findings: the first reads after an open are slow anywhere in the file; the setup is paid by each of the three file
users of a frame (far map, way-back line, km bar). The draw model of section 4.3 counted instructions and missed the
PSRAM store cost (fill) and the round joins (lines). Setup and reads are about 70 % of the far time: state kept
between frames (WP 4) is the largest lever.

### 12.1 Kept cache, no end seek (24 Nov, late; image c1b45d57, f2ec6fa)

| Value | Split image (before WP 4/5) | Noseek image, N3 / N4 home |
|---|---|---|
| Far total `f` | 67-93 ms | 32 / 32 ms |
| Open `o`, end seek + trailer `e`, header `h` | e 33-35 | o 3, e 0, h 0-3 |
| Reads `r`, file time `i` | 13, 21-31 ms | 0, 0 |
| Draw `d` | 20-27 ms | 25 / 2x ms |
| Way-back `w` | 141-170 ms | 10-11 ms |

Finding: the end seek + `ftell` was the setup (33-35 ms), not the reads. With the size from the kept cache, the far
map is now draw-bound: `d` is about 80 % of `f`. The lazy open is not necessary (`o` 3 ms).
