# One release: stable map, grey streets and the four features (design)

Status: design for the owner's approval, 19 Nov 2026. It changes no code. The numbers are host numbers unless
they are marked "unit". The host models are private: `.local/study/release/budget70.mjs` (70 km route and
17 Nov city ride) and `.local/study/release/r4ideas.mjs`. A pixel number is pixel work in a model, not time.

## 1. Intent

The owner wants to see streets on the navigation map everywhere in the detour reach, at least as grey lines.
The picture must behave like a drawn map: the same position and heading give the same picture in each frame.
The budget must be proven on the PC before the ride. All features come in one release: one image, one page
version, one device session. The patch code must have a clear structure: few modules, one job for each, no
new hooks.

Unit observations, 18 and 19 Nov (cc26, build mark 112a91b):

- Main roads change from yellow to black and back. Cause: the 400 ms frame stop B
  (`firmware/mapdraw/map.c:10`, `:257`) stops a frame after the dark edge passes and before the core passes.
  So some map frames take more than 400 ms.
- Grey streets show in different places in each frame. Cause: the grey draw starts at the nearest cell and
  stops at 400 segments, 60 ms or 220 ms (`firmware/wayback/wb_device.c:10-13`, `:174`).
- R4, 1.6 km off the route, text `1601m+ 216 133`: the way-back work took 216 ms with 133 file reads.
- Three restarts in the map view, two of them at the first open of the navigation tab off the route. The cause
  is not known. Both read cores stop in the LVGL fill loop under a map line draw. The USB port gets no panic
  text (`rst:0x3 (RTC_SW_SYS_RST)`).

## 2. Goals

- **G1** Stable picture. No time stop in a normal frame. An emergency stop happens only at a boundary that keeps
  each road class whole.
- **G2** Grey streets under the whole screen, out to the reach, also in the city.
- **G3** One 70 km route with a reach of 1, 2 or 3 km (page choice) in one file.
- **G4** Better street-name positions, and landmark names (drinking water, church, supermarket), inside 12
  names per block.
- **G5** An elevation graph of the next 1 km in a strip of the map.
- **G6** The page can switch off each new part, with no reflash.
- **G7** A test text measures the frame times on the first ride.
- **G8** Clear patch structure: each module has one job and one header; all stock addresses are in one file.

## 3. Non-goals

- No change to the near map content (contract R2, R3). The owner is happy with the 300 to 500 m detail.
- No new stock hook.
- No cell cache (W2) and no grey streets in the map blocks (W3) in this release (section 6).
- No change to the line search `wb_tick`, except the distance unit.
- No higher working limit from host numbers. A limit that changes its unit (segments to pixel work) starts
  below today's worst work.
- No movement smoothing between GPS fixes. It needs stored state and an own timer, which the hooks do not have.
  The release makes the map smoother only through shorter frames and no flicker.

## 4. Anti-goals

- A picture that depends on timing.
- A feature that shows a guess. No elevation without trusted progress. A grey street is context, not a
  recovery route (contract R10).
- Loss of crash evidence.
- A patch that adds a side channel or a stock address outside `fw.h`.

## 5. Constraints

- The 9 stock hooks are frozen. New code uses W1 (frame), M1 (decoder) and the existing `cc_iter` and
  `cc_line` trampolines.
- Second code area: 20,172 B, of which 10,652 B are used (cc26 112a91b). It has no data and no bss, so no
  global state. The code reserve for one later stability fix is 1,768 B.
- Free stack at the hook: 3,968 B or more (`wb8` guard). No large buffer on the stack.
- One live format per layer. A successor replaces the old format after it passes on the unit.
- Block limits stay: 65,536 B serialized, 57,344 B decoded, 1,400 calls, 7,000 points, 2,304 fill vertices,
  384 B names, 245,760 B transition.
- Page guard 4,000,000 B. Way-back cap 1,536 KB. Free storage on the unit after the cc26 pack: about
  4,108 KB (estimate).
- Device time is the scarcest resource: one session, and each write needs the owner's yes.

## 6. Approaches considered

Grey streets, weighted (stable picture 30, proof on the PC 25, unit time and reads 15, firmware 15,
storage 10, device time 5):

| Way | Score | Result |
|---|---|---|
| W1: read all screen cells in each frame, no state | 79 | **Chosen**, with a cell directory and a pixel budget (8.4). |
| W2: cell cache in RAM | 84 | Rejected. The cache needs a RAM word for its address, and none is known. It saves little more than the directory, because the line search reads about 179 times per frame (17 Nov replay, p50) in both ways. |
| W3: grey streets as map entries | 80 | Rejected for this release. City blocks already use up to 1,089 of 1,400 calls. Storage not measured. More work in `cc_iter`. |

Map lines: LVGL with a time stop (today) against our own drawer with boundary stops (chosen). Own drawer:
4.4 times less pixel work at p50, 3.2 times less at the maximum (section 9).

Grey budget: 400 segments (today) against pixel work (chosen). The segment cap protects against slow stock
calls, not against pixels: in the city, 1,073 segments come in up to 775 lines, and each line is one stock
projection call with a heap allocation.

## 7. Research (19 Nov, targeted)

| Source | Finding | Effect on this design |
|---|---|---|
| [LVGL 8.0 drawing](https://docs.lvgl.io/8.0/overview/drawing.html) | Each skew line is bounded by 4 line masks that form a rectangle. | Confirms the cost model: LVGL work grows with the box area, not the length. Own drawer with no masks. |
| [LVGL issue 6201](https://github.com/lvgl/lvgl/issues/6201) | With an active mask, line drawing goes to the slow software path. | Same. |
| [Zingl, Bresenham](https://github.com/zingl/Bresenham) | Integer line algorithms with adjustable width. | Reference for the integer steps of the raster module. |
| [IceNav-v3](https://github.com/jgauchia/IceNav-v3) | ESP32-S3 vector maps from tiles with delta, zigzag and varint coordinates. | Same coding as scheme D. No change. |
| [NavBoxLib](https://github.com/t413/NavBoxLib) | Fixed memory pool with LRU tile cache; tracks cut to 25 points. | Same kind as W2 and the 32-point line cut. |
| [bike-computer-32](https://github.com/lspr98/bike-computer-32) | One map file: metadata, a pointer for each tile, tile data, roads only. | Same kind as the grey cell table. |

No source shows a heading-up map on a microcontroller. No source gives a better way within these limits. The
sources support the three main choices: a raster with no masks, a cell table with offsets, and fixed caps.

## 8. Design

### 8.1 Structure (firmware, second code area)

| Module | Job | Interface | Stock addresses |
|---|---|---|---|
| `firmware/common/fw.h` | All stock addresses, the patch operation channel (line descriptor dash fields, op 23 anchor return) and their build checks | defines only | All |
| `firmware/raster/` (new) | Pixels into an RGB565 buffer: polygon fill (moved from `map.c` `fill()`), line of width w with round ends, disk, blend | `rs_fill`, `rs_line`, `rs_disk` on a `rs_canvas` {buf, w, h} | None. Host tests run the same C |
| `firmware/view/` (new) | Screen transform from the stock projection | `vw_calibrate`, `vw_map` | Through `fw.h` only |
| `firmware/mapdec/` | Scheme D block decode (versions 1 and 2), block flags into entry 0 | as today | Through `fw.h` |
| `firmware/mapdraw/map.c` | Map passes, frame stops, block flags, map part of the test text | `cc_iter`, `cc_line` | Through `fw.h` |
| `firmware/wayback/wb_device.c` | Frame entry (W1): section table, way-back line, then grey, elevation and text, in this order | `wb_rt` | Through `fw.h` |
| `firmware/wayback/wb_grey_draw.c` (new, from `wb_device.c`) | Grey cells: directory, reads, caps, draw | `grey_draw` | None (gets reads and view from the caller) |
| `firmware/elev/` (new) | Elevation section read and strip draw | `elev_draw` | None (gets reads and progress from the caller) |

Rules: a module calls only the headers of the modules below it in the table. Only `fw.h` has stock addresses.
The `#define fw_…` lines in `wb_device.c` move to `fw.h`. Each module builds on the host with a fake `fw.h`.

### 8.2 Data (page)

- The trailer `CCWT` gets version 2: a section table (type, offset, size) and a flags word. Types: way-back,
  grey layer, elevation. The unit reads the table in one read and finds each section by its type, not by its
  position. Flag `F_TEXT`: test text.
- Map blocks: scheme D payload version 2 adds one flag varint after the entry count. Flag `F_LVGL`: LVGL line
  draw. `mapdec` writes the flags into entry 0 (lat = magic word, lon = flags). Entry 0 draws nothing.
- Reach: the page offers 1, 2 or 3 km. The format is the same for all three: the 12-bit distance field counts
  2 m steps (0 to 8,190 m), and the node stays 8 B. The unit does not read the reach.
- The screen proof and the cost rule live in one page module (`js/screen_proof.js`). A host test runs the C
  rule of `raster` and the JS rule on the same lines and requires equal results.

### 8.3 Own line drawer (`raster`, used by `map.c`)

- `line()` (`map.c:63`) calls `rs_line` on the map canvas, unless the block has `F_LVGL`.
- Width 1: one pixel per step. Width 2 or more: a span fill of the segment rectangle, with the integer span code
  of `rs_fill`. Width 3 or more (today flags `0x0c`): a disk of the line width at each point, for round ends
  and joins.
- Opacity below 255 (tunnels, 115): blend each pixel in the canvas colour format.
- Clip at the canvas. Fix A stays.
- Each line through `cc_line` uses it: map, grey, way-back line, stock route line, turn arrows, dots. Text
  stays with LVGL. No anti-aliasing (owner, 19 Nov).

### 8.4 Stable frame stops (`map.c`)

- Delete the time checks between entries (`LATE()` at `map.c:243`, `:257`, `:264`, `:268`).
- Keep one emergency stop, checked only before the fills, before the outlines and before each level
  (levels 0 to 4). A level draws all of its edge and core passes together. The value stays 400 ms.
- Result: a road never shows its edge without its core.

### 8.5 Grey streets (page and `wb_grey_draw.c`)

Page (`js/wayback_grey_layer.js`):

- Layer version 2. Header with a pixel cap and a point cap (u32 each). A sparse directory: one key for each
  16 cells. Then the cell table and the bodies as today (body 2,048 B or less, 0.5 m steps, 32 points or less
  per line).
- Screen proof. For positions on a 64 m grid over the layer area and for 16 headings, the page selects the
  cells as the unit does (20 or less, nearest first). It adds the unclipped work of each cell (length × 4 px,
  plus the joins), which is an upper bound, and the points. If one screen is over a cap, the page removes lines
  in a fixed order (shortest dead end first) from the cells of that screen, and checks again. The report gives
  the removed length in km.
- Start values: pixel cap 60,000 px, below today's worst grey work (68,556 px, LVGL model, city). Point cap
  2,048 (city maximum 1,848).

Unit:

- `vw_calibrate` sends three reference points, 1 km apart, through `fw_proj` with op 23. `cc_line` gives back
  each screen point (`map.c:175`). `vw_map` maps the grey points with integer math: no stock projection call
  and no heap allocation for grey lines.
- Reads: one directory read per frame, one table read for each cell row, one body read for each cell, into one
  2,048 B heap buffer that goes back at frame end.
- The unit draws all lines of the selected cells. Emergency stops only: the header caps, counted as drawn, and
  the 300 ms read limit. `WBD_GREY_SEGS`, `WBD_GREY_US` and `WBD_GREY_END_US` are no longer normal stops.
- Switch: a file with no grey section has no grey, as today.

### 8.6 Street-name positions and landmark names (page only)

- 12 names and 384 B per block stay.
- Order: names of streets that the route uses or crosses, then landmarks, then other streets by class and
  length. Landmarks: drinking water, church, supermarket (owner, 19 Nov).
- Position: on the street, 20 m or more from the route line and from a junction, at the middle of its longest
  straight run inside 300 m of the route. The unit keeps its collision and edge checks (`map.c:133-156`).
- A landmark name is a class 12 entry with the name (23 B or less) at the landmark position. It replaces a
  lower name in the same block.

### 8.7 Elevation graph (page and `elev`)

- Page: an elevation track for the whole route, from the native route elevation fields only. For each column
  of 4.46 m (224 columns per km), the minimum and the maximum as one byte each; 255 means "no value". Gaps over
  250 m stay empty. 70 km: about 31 KB, as the elevation section, with the route length in its header.
- Unit: progress = route length minus the stock remaining distance. The builder finds the stock field
  (`docs/research/progress-arrival-extraction.md` is the start). `elev_draw` draws the 224 columns of the next
  1 km into a 232 × 32 strip at y = 68, below the 62 px turn card (owner, 19 Nov), with 40 m or more of
  vertical range.
- Unavailable: off the route, no trusted progress, missing values, no section. Then no strip.

### 8.8 Test text

- `cc_iter` writes its frame time. The adapter adds its time and reads, for example `m 120 · w 216 · 133`, at
  the top left. Only with `F_TEXT`. A later page build clears the flag, with no reflash.

### 8.9 Crash evidence

- The coredump partition and its configuration do not change. A read needs the owner's yes.
- The own drawer takes the LVGL fill loop out of the map line path, where both read cores stop. This is a
  hypothesis, not a claim that the restart is fixed.

## 9. Budget: 70 km route

Route files `t70C3D.bin`, `t70-v2-2km-d1b.ccwb`, `t70-v2-3km.ccwb`. 1,500 positions 10 m beside the route,
heading-up. The 17 Nov city ride is the dense case for grey.

| Item | Today (cc26 on the unit) | Release, 3 km reach |
|---|---|---|
| File, host: map, route, way-back, grey, elevation | 1,283,112 + 265,176 + 916,812 (2 km) + 230,489 = 2,695,589 B | 1,283,112 + 265,176 + 1,401,584 + about 346,000 (estimate, scaled by reach) + about 31,000 = **about 3.33 MB**; unit estimate about 3.57 MB |
| Block limits | 50,648 of 57,344 B decoded · 1,044 of 1,400 calls · 6,745 of 7,000 points · 2,304 of 2,304 fill vertices · 238,302 of 245,760 B transition | Same |
| Map line work per frame, px (p50 / p90 / max) | 98,041 / 185,858 / 301,232 (LVGL) | 22,315 / 53,866 / 94,290 (own drawer) |
| Map frame stop | 400 ms, between entries | 400 ms, emergency only, between levels |
| Grey segments under the screen, city (p50 / max) | 474 / 1,073; 53 % of frames over the 400 cap | All drawn; the page proves the caps |
| Grey line work, city maximum | 68,556 px (LVGL, first 400 segments only) | 39,909 px (own drawer, all segments) |
| Grey stock projection calls per frame | one for each line drawn | 3 |
| Grey file reads per frame (70 km p50 / p90; city p50 / p90) | 47 / 65; 50 / 63 | 15 / 20; 20 / 24 |
| Grey heap | 0 B (192 B stack) | 2,048 B per frame, returned at frame end |
| Code | 10,652 of 20,172 B | about 14,700 B (estimate: raster 2,000, view 300, grey 700, elevation 1,000, flags and text 300); reserve 1,768 B kept |

The release adds work in no limit that has a unit measurement. It does less work of each kind: fewer pixels,
no LVGL masks, no grey allocations, fewer reads. The time per pixel and per point on the unit is not measured;
the test text measures it. The 1 km and 2 km reach files are smaller; 1 km is not built yet.

## 10. Device test: one session

- **Hypothesis.** The release draws the same picture in each frame: no black main roads, no grey changes at a
  fixed place. The map frame takes less than 400 ms and the way-back frame less than 300 ms. The unit does not
  restart when the navigation tab opens off the route.
- **Observation.** Test text values and photos: stationary 10 minutes at a fixed place off the route (R3 and
  the 70 km test route), then a 45 minute ride with a detour. Count the restarts.
- **Duration.** About 60 minutes.
- **Restore.** `restore-wb2`, or the cc26 112a91b image from the pack. Page switches (`F_LVGL`, no grey
  section, no elevation section, no `F_TEXT`) need no reflash.
- **Writes.** Flash ota_1 (yes), storage: the new route files, and removal of old test routes if free space
  needs it (yes). RTS boot after each esptool step.

## 11. Decisions

Owner, 19 Nov: elevation strip in the map (A); reach 3 km, with 1, 2 and 3 km on the page; landmarks drinking
water, church, supermarket; no anti-aliasing.

My calls (the owner can change them): grey pixel cap 60,000 px and point cap 2,048; emergency stop 400 ms;
directory key for each 16 cells; removal order "shortest dead end first"; reference points 1 km apart; proof on
a 64 m grid with 16 headings; name position rules in 8.6; section table in the trailer.

Left to the builder, each with a check on the host or in the disassembly before any flash:

1. The order in the map frame `0x4204da24`: `cc_iter` before or after the route call (grey and text on top).
2. The canvas colour format for blending: compare `fw_color_hex` output with a known colour.
3. The stock projection is affine on the screen area: a fourth reference point maps within 1 px. If not, grey
   uses the stock projection and the point cap gets smaller.
4. The stock remaining-distance field and its update path. If it is not found, G5 shows nothing.
5. Code size of each module on the Xtensa build, against the 1,768 B reserve.
