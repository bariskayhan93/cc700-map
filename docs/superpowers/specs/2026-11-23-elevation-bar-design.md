# Elevation bar with a 3 km magnifier lens (replaces the stock remaining-distance overlay)

Date: 2026-11-23. Status: approved 2026-11-23; amendment A1 (no device state) from the plan, for owner review. Evidence: `docs/mining/map-page-ui-2026-11-23.md`
(second and third pass addenda). Mock-up (option B): https://claude.ai/artifact/NxLuze3j4WowWt51sCUWED

## 1. Intent

The stock remaining distance on the map page is not readable: the stock draws it on the map canvas at 64 % opacity
(0x4205b9f8 sets 163) without a halo. The cc29 corner chart (`elev_chart`, 1 km, 112 x 20 px) is not usable and
its IROM patch (0x420949e3) stops a ride-data-page label, not the map text.

The new bar replaces the full stock overlay (icon, "(km)", number, progress bar, marker) with one elevation chart of
the whole route at the bottom of the map, plus the remaining distance and the climb ahead as readable text. The next
3 km is a magnifier lens that starts at the rider and moves along the chart as the ride goes on: the lens is the
progress marker. The map must stay readable. The owner rejected two separate charts (short and long) as bad UI.

## 2. Goals, non-goals, anti-goals

Goals
- Readable remaining distance at a glance while riding.
- One chart: the next 3 km in detail (about 31 m per px, 1 px columns, full bar height), and the ridden part and the
  rest of the route as context in the same chart.
- Alignment with the stock compass, scale and rider icon (section 5).
- Less code than cc29: remove `elev_chart`, its constants, the per-frame I/O in `wbd_chart`, and the 0x420949e3 patch.

Non-goals
- No change to route matching, progress, or guidance.
- The elevation section (type 3, `js/elevation_section.js`) gets version 2 only to add a coarse whole-route table
  (amendment A1). Block layout stays. A version 1 file gives the "no elevation" state.
- No new settings or options.

Anti-goals (failure even if it works)
- A bar that hides the map more than the stock bar does.
- An invented value: no distance, climb or elevation that the data does not give.
- A missing remaining distance in any state where the stock showed one.

## 3. Constraints

- Canvas 240 x 256 RGB565, drawn in the map frame. Device time is the scarcest resource: no file I/O in a frame
  that does not rebuild the columns.
- The device UI is the OneLap app box layout. The new code can draw only inside the map canvas; the data boxes are
  not ours. Gap: whether another box layout changes the map canvas size or position is not checked on the unit.
- No writable globals, no static memory and no read-only data in the second code area (`wb_area2.ld` ASSERT):
  the device keeps no state between frames, has no lookup tables and builds strings on the stack (amendment A1).
- Code (amendment A2, owner 2026-11-23): area 2 keeps its 18,404 B limit; the lens module `elev.o` runs in the IROM
  tail after the C4 code (0x421debac up to 0x421e0000), where the 1,768 B reserve stays free.
- Each frame reads at most one GL_BUF (4,096 B) of section data; every function frame is 512 B or less.
- Stock fonts only have printable ASCII (code 32..126). No arrow glyph: the climb text is "+46 m".
- IROM patches must check the old bytes (as `tools/cc27_build.py` does now) and be applied only when the feature is
  in the image.
- Commits only before 08:00 or after 19:00 local time. No device action without owner approval.

## 4. Approaches

| | Approach | Trade-off | Result |
|---|---|---|---|
| A | Corner block, 1 km chart above the number (design B) | Small corner, but only 1 km, 84 px wide | Not used |
| C | Linear whole-route profile in the stock bar | Clear map, but 290 m per px on 70 km: a steep 100 m ramp is lost | Not used |
| D | 3 km chart in the corner | 28 px per km, a steep part is 2-3 px | Not used |
| L | Log-scale bar | 11 m per px near, but km positions are not even | Not used |
| Z | Two-zone bar: next 3 km on the left, rest on the right | Two charts side by side: owner rejected as bad UI | Not used |
| 1A | One chart, sliding 3 km lens, one height scale | True heights everywhere; small hills in the lens are 1-2 px on a hilly route | Not used |
| **1B** | **One chart, sliding 3 km lens with its own height scale (magnifier)** | **Next 3 km fills the bar height; heights in and out of the lens are not comparable** | **Owner choice** |
| 1C | One chart, smooth fisheye centred 1.3 km ahead | No edges, but uneven km positions; hardest to read and test | Not used |

## 5. Layout (canvas pixels)

```
 x 0           27                123                                    240
 8 ┌compass┐ y 173-205
   100m  (8, 214)                                          +46 m  12.4 km   y 214-234, right edge x 232
   └──┘ y 228-236           ◉ rider (≈100-140, 196-236)
               ▼ rider mark (y 232-236)
 ░░░░░░░░░░░░░█▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔┊░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   y 237-255
  ridden (pale) │ lens: next 3 km  │ rest of route (grey, compressed)
```

| Item | Position | Look |
|---|---|---|
| Scrim | x 0..239, y 237..255 | each pixel 50 % toward white (cheap RGB565 blend) |
| Lens background | x lx0..lx1, y 237..255 | a further 50 % toward white, so the lens reads as a window |
| Lens top edge | x lx0..lx1, y 237 | 1 px dark line (the magnifier frame), inside the bar: clear of the scale bracket |
| Lens end | x lx1 | 1 px dotted vertical tick |
| Rider mark | x lx0 | 1 px blue line (0x1f6fe0) over the bar height, plus a 7 x 4 px blue triangle at y 238..241 |
| Km ticks | lx0 + 32 and lx0 + 64 (1 km = 32 px) | 1 x 2 px dark tick at y 238..239 |
| Route end | x of the route end, when inside the bar | 1 px dark vertical line |
| Remaining distance | right edge x 232, baseline y 231 | font 0x3c2a54d8 (line 20), 100 % opacity, 1 px white halo |
| Climb ahead | own line above the distance: right edge x 232, top y 197 | font 0x3c29188c (line 18), same style; owner 2026-11-23 |

The text top is the same as the stock scale label (y 214). The text right edge (x 232) is the stock number's right
edge and the mirror of the compass margin (x 8). The rider box (x 100..140, from the preview model and the device
photo of 2026-11-21, MEDIUM confidence) stays clear: both text lines are right-aligned at x 232 and are at most about 50 px wide. Glyph widths: firmware/elev/elev_font.h (generated from the base).

## 6. Behaviour

### 6.1 Distance to x (one chart, three linear parts)
- Route length L, progress P, lens length 3,000 m, lens width 96 px.
- L > 3,000 m: the lens [P, P + 3,000) gets 96 px (31.25 m per px). The ridden part [0, P) and the rest
  [P + 3,000, L) share the other 144 px at one density: (L - 3,000) / 144 m per px (290 m per px on 45 km).
  So lx0 = 144 * P / (L - 3,000), clamped to 144: the lens moves from x 0 to x 144 as the ride goes on.
- In the last 3 km the lens is shorter than 3,000 m; it ends at the route end tick. The pixels after it stay empty.
- L <= 3,000 m: the whole chart is linear (L / 240 m per px) and the whole route is the lens.
- Each 1 px column covers its distance range and draws one vertical span from the min to the max elevation of the
  4.464 m section columns inside it. A short peak or dip is never averaged away.
- A column without a value (section value 255) draws no pixel.

### 6.2 Vertical scale
- Bar height: 18 px of profile (y 238..255).
- Context (ridden part and rest of route): one scale for the whole route, min..max, range at least 40 m. It is
  computed once per route.
- Lens: its own scale, min..max of the lens columns, range at least 20 m (about 1 m per px on flat ground).
- No state (amendment A1): the lens scale is quantised so it does not move each frame. Bottom = lens min floored
  to 5 m; range = max(20 m, hi - bottom) rounded up to 10 m.
- The grade colour does not depend on the scale, so a magnified small hill does not show as steep.

### 6.3 Colour
- Grade = rise over a 100 m window of the section profile (mid of min/max). A lens column takes the highest grade of
  the windows inside it. Below 3 %: dark grey. 3..6 %: orange. Above 6 %: red. Descent: dark grey.
- Rest of route: mid grey, no grade colour. Ridden part: pale grey.
- Each column: the min..max span in full colour, and a 26 % tint of the same colour from the span down to y 255.

### 6.4 Text
- Remaining distance: below 1,000 m "850 m"; below 100 km one decimal "12.4 km" (round to nearest, not the stock
  setter defect "12.103 km"); 100 km or more "112 km".
- Climb ahead: sum of the rises of the 100 m profile over the next 3 km, rounded to the metre. Below 5 m: no text.

### 6.5 Per-frame work (amendment A1)
- No cache: each frame reads the section header with the coarse table (1,168 B) and the fine blocks that hold
  [P, P + 3,100 m] (at most 5 x 450 B), into one GL_BUF buffer, and draws each column as it computes it.
- Context columns use the coarse table: 576 cells over the route, cell c = [c L / 576, (c + 1) L / 576).
- Lens columns, grade and climb use the fine blocks.

### 6.6 Section version 2 (amendment A1)
- Bytes 0..11 as version 1, with version byte 2. Bytes 12..15: i16 coarse base m, u8 coarse step dm (5, 10, 20,
  50, 100 or 200, the smallest that fits), u8 0. Bytes 16..1,167: 576 x {u8 min, u8 max} steps above the coarse base,
  255 = no value. Blocks from byte 1,168, 450 B each, as version 1.

## 7. Contract (AGENTS.md)

- **Normal:** on the route, own map blocks (F_OWN), selector 0 (0x3fc9fcc4), trusted progress, a valid elevation
  section: scrim, one chart with the 3 km magnifier lens at the rider, distance text, climb text.
- **Admission (as cc29):** 0 < U <= T + 50 m (U clamped to T), |T - L| <= max(50 m, L / 100); `isfinite()` on the
  float total before use.
- **Unavailable state, no elevation:** route with trusted progress but no section, no value, or a read failure:
  scrim, a plain 2 px progress line with the rider mark (the stock meaning: ridden part / total), distance text.
- **Unavailable state, no trust:** the stock overlay draws as now (section 8). The new code draws nothing.
- **Restoration:** an image without the feature has no patch; the stock overlay draws. Regenerating the route file
  without the elevation section gives the "no elevation" state.

## 8. Stock switch

The stock overlay is the call `call8 0x4205bf0c` at 0x4204ca2e with (left = *0x3fc9fc2c, total, 10, show_text);
show_text = 1 when the caller's a3 = 0. The return value is not used.

- **Preferred (builder's call: the owner did not decide the mechanism):** redirect this call to a new function with the same
  arguments. It draws the new bar when show_text = 1 and the admission (section 7) passes; else it calls the
  stock 0x4205bf0c with the same arguments. Gains: the same values as the stock, the same draw order, and the stock
  UI as the fallback in every other state. The call8 range (+-512 KB) does not reach `cc_seg` (0x421ddc1c): the builder
  must find a safe trampoline (for example a free literal and `l32r` + `callx8` inside the patched range).
- **Fallback mechanism:** at 0x4204ca26 `bnez.n a3, 0x4204ca2a` -> `beqz.n a3, 0x4204ca42`, at 0x4204ca28
  `movi.n a13, 1` -> `nop.n`; the new bar is drawn from `wb_rt`. Then the "no trust" state must draw the distance
  text itself, because the stock text is gone in the a3 = 0 mode.
- Check every encoding with objdump before use. Remove the 0x420949e3 patch.
- Gap: the meaning of the caller's a3 (not resolved). In the a3 != 0 mode, the stock overlay stays unchanged.

## 9. Code to remove

- `elev_chart`, `el_val` and `EL_C_*`, `EL_RANGE_MIN_DM` in `firmware/elev/elev.{c,h}` (keep `el_head_parse` and,
  if still used, `el_window`).
- `wbd_chart` per-frame fopen / 3 reads / PSRAM malloc in `firmware/wayback/wb_device.c`.
- The third patch in `tools/cc27_build.py:64` and its test.
- Unused `gpxHasElevation` in `js/cc27_file.js:11` if nothing imports it.
- The `res.url` live check in `js/wayback.js:85` is a separate finding; not part of this work.

## 10. Tests

- Host (`tools/elev_host.c`, `tools/test_elev.mjs`): distance-to-x mapping (lx0 at start, middle, last 3 km,
  L <= 3 km; columns monotonic), column min/max, empty columns, route end, both scales with their minimum ranges,
  hysteresis, grade colour, climb sum, distance format (999 m,
  1.0 km, 12.4 km, 99.9 km, 112 km, the 12,980 m case), with exact pixel checks (no loose tolerance).
- Preview (`js/preview.js`): render the bar on a real route for the owner to see before a device test.
- Build: patch old-byte checks and the redirect encoding.

## 11. Device test (needs owner approval)

- Hypothesis: the redirect draws the chart, the lens and the text with no stock overlay, and the frame time does not increase
  by more than the rebuild cost every 25 m.
- Observation: photo of the map page on one of the 4 north test routes; frame time from the existing timing.
- Duration: one short ride or a stationary check on the 400 m route.
- Restoration: the current device image (cc28g, see the receipts) on the other OTA slot.

## 12. Left to the builder

- The trampoline for the redirect (section 8).
- The draw primitives (scrim blend, halo text through `fw_canvas_text` with the font at descriptor +0).
- Whether the context columns (ridden part and rest of route) are rebuilt from a full read of the section or from a streamed read, by measurement.
