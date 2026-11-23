# cc27 system reference: layers, parameters, measurements, gaps (19 Nov 2026)

Purpose: one place for every layer and every parameter of the cc27 map, with its source line and its status. No design
decision is made here. A design for the overlay (way-back line and grey streets) waits until the gaps in section 6 are
closed.

Status of a value: **M** measured on the unit; **H** computed or tested on the computer only; **D** a design or code value
with no measurement; **?** not known.

## 1. One map frame on the unit

| Step | Task | Code | What it does | Limit | Status |
|---|---|---|---|---|---|
| 1 | GUI task (`AppGUIManage`) | stock map draw | Clears the canvas and asks for the map blocks | — | D (the 18 Nov cores show this task) |
| 2 | GUI task | `tramp_iter` (literal `0x42049678`) → `cc_iter` (`firmware/mapdraw/map.c:201`) | Draws one map block: star lines, fills, levels 0 to 4, signals, names | 400 ms for each block call (`MAP_FRAME_US`, `map.c:12`), checked only between passes (`map.c:228`, `:235`, `:250`, `:255`) | D |
| 3 | GUI task | stock projection → `tramp_line` (literal `0x4205bd98`) → `cc_line` (`map.c:127`) | Draws one entry: own raster (`rs_line`, `rs_fill`) when the block has `F_OWN`, else LVGL | entries whose box misses the canvas + 16 px are skipped (`CLIP_M`, `map.c:11`) | D |
| 4 | GUI task | `tramp_rt` (literal `0x420496b8`) → `wb_rt` → stock `cc_rt` (`firmware/wayback/wb_device.c:223`) | Stock route line, turn arrows, route dots (LVGL) | — | D |
| 5 | GUI task | `wbd_frame` (`wb_device.c:180`) | Off the route: way-back line, grey streets, text. On the route: nothing (the lens chart runs from the stock overlay call, section 2.6) | see section 2 | D |

How often step 1 runs (frames per second), and how many `cc_iter` calls one frame makes: **?**

Every off-route frame does all the work again: open the route file, read the section table, mount the way-back data,
find the street, walk the path, read 32 line points, place 4 grey anchors, read the grey cells, draw, close
(`wb_device.c:1-4`: "No writable globals"). Nothing is kept from one frame to the next.

## 2. Layers

### 2.1 Canvas and view

| Parameter | Value | Source | Status |
|---|---|---|---|
| Canvas | 240 x 256 px, RGB565, 122,880 B (PSRAM) | `js/map_budget.js:11`, `firmware/common/fw.h:83-86` | D |
| Scale | 2.5 m per px | host checks; the 100 m bar on the 19 Nov photos agrees | H |
| Orientation | heading-up (north-up only before the first movement) | owner, 18 Nov; stock `0x4204dfe0` | M |
| Screen in the rider frame | about 600 m wide, 520 m ahead, 100 m behind | 18 Nov estimate; zoom field near `0x3c388cfc` not mined | ? |

### 2.2 Map blocks (route file map section, stock format C4 with the styled entries)

| Parameter | Value | Source | Status |
|---|---|---|---|
| Range from the route, by class | main roads 1,000 m; minor streets 550 m; service 350 m; paths 300 m; cycleways 350 m; rail and tram 450 m; water lines 450 m | `js/mapsec.js:311` (`SR`) | D |
| Range of areas (built-up, green, water) | 600 m | `js/mapsec.js:312` (`AREA_R`) | D |
| "Far" style (thinner, lighter) | minor and service runs more than 150 m from the route | `js/mapsec.js:322`, `:347` (`FAR`, `runIsFar`) | D |
| Block length along the route | 1,500 m | `js/mapsec.js:312` (`BLOCK_LEN`) | D |
| Block limits | serialized 65,536 B; decoded 57,344 B; projection calls 1,400; projected points 7,000; fill vertices 2,304; names 384 B | `js/map_budget.js:5-9` | H (page gate) |
| Block change limit | 245,760 B | `js/map_budget.js:10` | H |
| Largest block, 70 km route | 64,747 B serialized (99 % of the limit); 50,616 B decoded; 1,043 calls; 6,745 points (96 %) | release record, budget | H |
| Codec | `d` (`js/map_codec.js`) | `js/mapsec.js:239` | D |
| Bytes per map point | 0.9 to 1.7 B | section 4 | H |
| Draw order in one block | star lines, fills (built-up, green, water, water lines, then the 1 px outline of green and water), then for each level 0 to 4: rail, path, cycleway, road edges, road cores, tram; then signals; then names | `map.c:165-168`, `:229-265` | D |
| Block switches | last entry, class 15: `F_OWN` 1, `F_TEXT` 2, `F_ROUTE` 4 | `js/mapsec.js:331-332`, `firmware/common/types.h` | D |
| Names | at most 12 boxes, 56 characters each | `map.c:95`, `:107` | D |
| Map time text | `m<ms>` at (6, 24): the time of **one** `cc_iter` call; the last call of the frame is the one that stays visible | `map.c:189-199`, `:271` | D |

### 2.3 Own raster (`firmware/raster`)

No anti-aliasing. Map lines (with `F_OWN`), every fill, the grey streets and the way-back line (with `F_OWN`) are written
straight into the canvas. The stock route line, arrows and dots stay with LVGL. Cost for each pixel on the unit: **?**

### 2.4 Way-back line (section type 1, version 3)

| Parameter | Value | Source | Status |
|---|---|---|---|
| Reach | 1 km: air 1,000 m, ride 2,000 m; 2 km: 2,000 / 4,000 m; 3 km: 3,000 / 6,000 m | `js/wayback_tree.js:11` | D |
| Query box | route box + air reach + 200 m; the page refuses a box over 600 km² or 1° per side and steps down 3 → 2 → 1 km | `js/wayback.js:17`, `:46`, `:105-107` | D |
| Street policy | bicycle-usable ways only: a footway or path without a bicycle tag is mostly not in the data | `js/wayback.js:37` (`wayPolicy`); 19 Nov count near the test place: footway 157 of 621 nodes, path 73 of 292, `path bicycle=designated` 481 of 481 | H |
| Units | 1/16 m | `js/wayback_format.js:11` | D |
| Distance to the route | 2 m steps, at most 8,190 m | `js/wayback_format.js:15` | D |
| Longest piece | 1,700 units (106 m) on one axis | `js/wayback_format.js:12` | D |
| Street limit | the position must be within 15 m of a street piece, or `wb4` | `firmware/wayback/wayback.c:11`, `:386`, `:438` | D; **M** (`wb4` indoors) |
| Line drawn | the first 32 points from the rider; `+` after the distance when the line is cut | `wb_device.c:9`, `:172` | D |
| File work limit | 300 ms for each frame; a later read fails (`wb5`) | `wb_device.c:10`, `:65` | D |
| Stack needed | 3,968 B before any file call (`wb8`) | `wb_device.c:11` | D |
| Read size | 192 B (24 nodes) | `wayback.c:14` | D |
| Size limit | 1,536 KB for each file | `js/wayback.js:16` | D |
| Size | about 9.3 B per node (A: 52,796 B for 5,606 nodes; B: 196,492 B for 21,125 nodes) | section 4 | H |
| Codes | `wb2` no GPS position or the navigation lock busy; `wb4` no street within 15 m; `wb5` read failed or late; `wb6` file lock busy; `wb7` no data; `wb8` stack low; `wb9` open failed; `wb11` no heap | `wayback.h:7`, `wb_device.c:13`, `:23-29` | D |

### 2.5 Grey streets (section type 2, layer version 2)

| Parameter | Value | Source | Status |
|---|---|---|---|
| Which pieces are grey | a way-back piece is grey unless 2 of its 3 sample points (ends, middle) are within 10 m of a map street line of class 5, 6, 7, 8 or 10 | `js/wayback_grey.js:1-14` | D |
| Cells | 256 m (4,096 units); points on a 0.5 m grid; simplify 2.5 m; 2 to 32 points per line; at most 2,048 B per cell body; at most 16,384 cells | `js/wayback_grey_layer.js:9-14` | D |
| Screen caps (page proof) | 60,000 px and 2,048 points per screen, checked on a 64 m grid with 16 headings and at most 20 cells; the shortest dead ends go first when over a cap | `js/wayback_grey_layer.js:16`, `js/screen_proof.js:7` | H |
| Unit | reads the cells of the screen (`GL_CELLS` 20) into a 4,096 B heap buffer (PSRAM) for each frame; line width 4 px; drawn only when a way-back line is found; under the line | `wb_grey.h:12-14`, `wb_grey_draw.c:4`, `wb_device.c:149-158`, `:173` | D |
| Size | about 3.8 B per point | section 4 | H |

### 2.6 Elevation lens chart (section type 3, version 2; 2026-11-23)

Design: `docs/superpowers/specs/2026-11-23-elevation-bar-design.md`. Replaces the cc29 corner chart and its IROM patch.

| Parameter | Value | Source | Status |
|---|---|---|---|
| Place | map rows y 237..255, full width; text right edge x 232, top y 215 / 217 | `firmware/elev/elev.c` (`el_draw`), `wb_device.c` (`wbd_km_text`) | H |
| Content | one chart of the route; a 96 px lens over the next 3 km at the rider; coarse table (576 cells) for the rest | `elev.h`, `js/elevation_section.js` | H |
| Entry | stock call `0x4204ca2e` → `km_tramp` (`0x4205bdd0`, 0x1c B) → `wb_km`; fallback `fw_km_overlay` (`0x4205bf0c`) | `km_tramp.S`, `tools/cc27_build.py` | B |
| Gates | show_text 1, stack, canvas, selector 0, finite T < 2^24, `0 < U <= T + 50`, own blocks; else the stock overlay | `wb_device.c` (`wbd_trusted`, `wb_km`) | H |
| No elevation | trusted progress, but no v2 section, size mismatch, read or heap failure: plain progress line and text | `el_plain` | H |
| Reads per frame | header and coarse table 1,168 B, then at most 5 blocks (2,250 B), one 4,096 B buffer | `wb_km` | H |
| Code | `elev.o` in the IROM tail from `0x421debac` (2,704 B; 2,500 B free, reserve 1,768 B kept); area 2 17,488 B | build receipt `.local/cc27-lens/manifest.json` | B |

Status H = host tests, B = build checks. No device evidence yet.

### 2.7 File and storage

| Parameter | Value | Source | Status |
|---|---|---|---|
| Section table | `CCWS`, the last 64 B, 1 to 4 sections | `wb_device.c:76-92` | D |
| File guard | 4,000,000 B (the page drops grey first, then steps the reach down) | `js/cc27_file.js:8` | D |
| Storage partition | 7,987,200 B; free after the home pack: 6,412 KB | log of 18 Nov; host trial 19 Nov | M / H |

## 3. Test text

| Place | Off the route | On the route |
|---|---|---|
| (6, 6) | `<dist>m[+] w<ms> r<reads> g<lines>[+]` or `wb<code> w<ms> r<reads> g<lines>` | `e<code> u<U> t<T> w<ms>` |
| (6, 24) | `m<ms>` of one block call | the same |

`w` is the time of the whole off-route step: open, find, walk, grey reads, grey draw, line draw (`wb_device.c:185`,
`:209`). `r` counts every file read of the step, grey reads too (`wb_device.c:64-71`).

## 4. Sizes (19 Nov files, H)

| File | Bytes | Map section | Way-back | Grey | Grey lines / points | Grey B per point | Map B per point |
|---|---:|---:|---:|---:|---:|---:|---:|
| A (1.8 km route, 1 km reach) | 114,688 | 41,168 | 52,796 | 8,520 | 896 / 2,194 | 3.88 | 1.65 |
| B (5 km route, 2 km reach, elevation) | 360,448 | 84,276 | 196,492 | 47,509 | 5,117 / 12,679 | 3.75 | 0.87 |
| City route, 3 km reach | 606,208 | 77,384 | 410,880 | 92,098 | 10,128 / 24,564 | 3.75 | 0.87 |
| 70 km route, 2 km reach | 2,748,416 | 1,282,156 | 944,740 | 225,057 | 22,755 / 58,965 | 3.82 | 1.67 |

The way-back section holds the position of every node, and the grey flag of every piece (node bit 63, extra bit 13:
`wayback.c:18-19`). So the grey layer repeats geometry that the way-back section already has. It is an index by cell for
fast drawing, at 8 % (70 km) to 15 % (city) of the file.

## 5. Unit measurements of 19 Nov (home test, standing, no ride)

| Reading | Where | Meaning | Status |
|---|---|---|---|
| `wb4 w89 r64 g0`, `wb4 w88 r65 g0 m391` | route A, indoors | no street within 15 m of the GPS position; 88 ms for 65 reads with no line; one map block 391 ms | M |
| `350m w1116 r100 g98 m391`, `350m w1117 r100 g98` | route A, the same place, later | line and 98 grey lines; the same on two frames | M |
| Host at the street point 33 m from the place | — | `352m r103 g98`, about 2,900 grey pixels | H |
| cc26 (18 Nov) | 350 m off a route | `350m 130 99`: 130 ms, 99 reads, no grey | M |
| GPS position | indoors | about 40 m north of the true place; the earlier saved fix is also 33 m north of the street. Later the same evening the position was correct (owner), so the map draw has no offset | M |
| `352m w100 r87 g0 m391` | route A0 (A with no grey section), after a reset | line step about 100 ms | M |
| `352m w127 r103 g98 m393` | route A, the same place, the same boot | grey step 27 ms, 16 reads | M |
| `wb4 w72 r69 g0 m452` | route A6 (A with flags 6: `F_OWN` off, map lines through the stock LVGL line draw as cc26), the same place | one map block 452 ms: the LVGL lines cost 61 ms (16 %) more than the own drawer (`m391`). 452 ms is over the 400 ms stop, so the passes after the check that saw the time over 400 ms are not drawn | M |
| Line look | A6 and A, the same place | A6 smoother (owner). The own drawer (`rs_line`, `firmware/raster/raster.c`) has no anti-aliasing: stair-step edges, seen as "low resolution". The map data is the same as cc26 | M (owner) |
| Blink | — | only the violet line and the grey streets blink; the map never blinks; the text shows `wb4` while the line is gone | M (owner) |
| Restarts | — | none | M |

## 6. Observations and gaps

| Item | What is known | What is not known | Measurement that closes it |
|---|---|---|---|
| A bike path ends 200 to 400 m from the route | the map draws paths to 300 m and cycleways to 350 m from the route (`SR`); after that only grey can show a street | why that path shows no grey after the edge: a tag the bike policy leaves out (footway, path without a bicycle tag), a parallel map street within 10 m, or the reach | the OSM tags of that way, and its pieces in the A grey layer (host, local data only) |
| The overlay blinks | **closed (M):** the blink frames show `wb4`. Each frame tests the GPS position against the 15 m street limit with no memory of the frame before; indoors the position moves across the limit, so the line and the grey (drawn only with a line) go on and off. A frame with `wb2`, `wb5` or `wb6` would blink the same way | how often this happens on a ride (GPS error outdoors is smaller, but footways and paths outside the bike policy have no street) | ride data: count of `wb4` frames between line frames |
| 1.1 s for line and grey | **measured again (M):** A0 (no grey) `352m w100 r87`, A `352m w127 r103 g98`, map `m391`/`m393`: the grey step costs 27 ms and 16 reads; the line step about 100 ms for 87 reads (1.2 ms per read, as cc26). The earlier `w1116`/`w1117` (same reads, same grey lines, same `m`) were a period of slow file reads, about 10 ms per read; the CPU was not slower (`m` did not change) | the cause of the slow period: flash work of another task (the stock log writes about 340 lines per minute during navigation and rotated a full log file at 22:43 local), or the file system state after the 9 deletions. The log of that period was removed by that rotation | `w` over a longer test; a copy of the log before it rotates |
| Map block time | `m391`/`m393` on two boots: one `cc_iter` call takes about 390 ms, just under the 400 ms stop. It is now the largest measured cost | frames per second; calls per frame; whether some calls reach the stop | a call count and the largest `m` of a frame in the test text |
| Map block time 391 ms | it is one `cc_iter` call; the stop is at 400 ms for each call. With LVGL lines (A6) it is 452 ms, so cc26 (LVGL lines, stop checked between entries) probably cut its map blocks at 400 ms in this place | frames per second; calls per frame; whether blocks reach the stop; how the 391 ms divides between the stock projection and the line pixels | `m` over several frames; a call count in the test text; a host count of projected points and line pixels for this block |
| Smooth lines in the own drawer | LVGL anti-aliased lines cost 61 ms per block here and bring back the 18 Nov crash chain (stock line draw) | the time of an anti-aliased `rs_line` on the unit | a new image with an anti-aliased `rs_line` behind `F_OWN`, A and A6 compared at the same place |
| A safe place for data kept between frames | the patch code has no writable globals | whether a RAM slot exists that the stock code never uses | stock memory map (host mining) |
