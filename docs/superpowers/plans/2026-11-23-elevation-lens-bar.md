# Elevation lens bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stock remaining-distance overlay of the map page with one whole-route elevation chart that has a moving 3 km magnifier lens at the rider, plus readable distance and climb text.

**Architecture:** The generator adds a coarse whole-route table to the elevation section (version 2). A stateless C module (`firmware/elev`) computes and draws the chart for each frame from one bounded read. A new 28-byte trampoline at 0x4205bdd0 sends the stock call at 0x4204ca2e to `wb_km`. `wb_km` draws the new chart, or calls the stock overlay 0x4205bf0c when admission fails.

**Tech Stack:** JS (ES modules, `node --test`), C gnu11 (host: `cc -DHOST` with ASan; device: xtensa-esp32s3 gcc `-Os -mlongcalls -mtext-section-literals`), Xtensa assembly, Python 3 builder (`unittest`).

**Spec:** `docs/superpowers/specs/2026-11-23-elevation-bar-design.md` (with amendment A1). Mock-up: https://claude.ai/artifact/NxLuze3j4WowWt51sCUWED

## Global Constraints

- Second code area: no writable globals, no static memory, no `.rodata` (`firmware/wayback/wb_area2.ld` ASSERT). No string literals and no `const` tables in device code. Build strings on the stack (as `uint32_t mode = 0x00006272u; /* "rb" */`).
- Integer code only in `firmware/elev` (no float). Every function frame ≤ 512 B (`FRAME_LIMIT`). Code ≤ 18,404 B (`CODE_LIMIT`).
- One GL_BUF (4,096 B) heap buffer for each frame (`fw_malloc(GL_BUF, CAPS_PSRAM)`), freed in the same frame.
- Canvas 240 × 256 RGB565. Bar rows y 237..255. Profile rows y 238..255 (18 px). The lens is 96 px for 3,000 m. Context density = (L − 3,000) / 144 m per px.
- Colours (`RS_RGB`): flat 0x3d4148, 3..6 % 0xe07b00, > 6 % 0xd0182b, rest of route 0x9a9fa6, ridden 0xcdd0d4, marks 0x202327, rider 0x1f6fe0, text 0x111316, halo 0xffffff.
- Fonts: number 0x3c2a54d8 (line 20, base 4), unit/climb 0x3c29188c (line 18, base 4). Label descriptor 0x3c38a570: font +0, colour +12, opacity +26, alignment +28 (3 = right). Save and restore all four.
- Commits only before 08:00 or after 19:00 local time. No device action and no flashing in this plan.
- Write all comments and docs in ASD-STE100.

## Review Focus

1. A route section of version 1 (old route files on the unit): the bar must show the "no elevation" state, never a crash or garbage. Test in Task 4.
2. Progress at exactly 0 m, in the last 3 km, and at the route end (P = L): lx0 and lx1 stay in 0..239, with no division by zero. Test in Task 2.
3. A data gap that covers the full lens (all values 255): no profile pixels, the lens scale gives no NaN or overflow, and the text still draws. Test in Task 2.
4. Remaining distance above 100 km and below 10 m: the text format does not overflow its stack buffer. Test in Task 2.
5. `show_text = 0` (the stock second mode) and `fw_stack() < WBD_STACK`: these must call the stock overlay with the same 4 arguments, unchanged. Test in Task 4.

---

### Task 1: Section version 2 with the coarse table (generator)

**Files:**
- Modify: `js/elevation_section.js` (layout comment lines 1-4, `EL`, `elevationFromPoints`)
- Modify: `js/cc27_file.js:10-11` (remove the unused `gpxHasElevation`, after a `grep -rn gpxHasElevation js tools index.html` shows no user)
- Test: `tools/test_elev.mjs`

**Interfaces:**
- Produces: `EL = {COLS: 224, BLOCK: 450, HEAD: 12, COARSE: 576, HEAD2: 1168, BLOCK_M: 1000, GAP_M: 250, NONE: 255}`. Section bytes as spec 6.6: version byte 2, bytes 12..15 coarse head (i16 base m, u8 step dm ∈ {5,10,20,50}, u8 0), 16..1167 coarse cells, blocks from 1168.

- [ ] **Step 1: Write the failing tests** in `tools/test_elev.mjs`:
  - `test('version 2: 70 km gives 1168 + 70 * 450 B')`: `b.length === 1168 + 70*450`, `head(b).version === 2`.
  - `test('coarse cell c holds min/max of [c L/576, (c+1) L/576)')`: on a 57.6 km linear climb 0 → 576 m, cell 100 has min ≈ 100 m and max ≈ 101 m within one coarse step.
  - `test('coarse step is the smallest that fits 254 steps')`: a route with a 2,000 m range gives `null` (no step fits). A route with a 600 m range gives step 50.
  - `test('a coarse cell with no point gives 255/255')`.
  - Replace the version 1 size assertions (`12 + 70 * 450`, version 1) with the version 2 values.
- [ ] **Step 2:** Run `node --test tools/test_elev.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement. Compute the coarse cells from the same per-point profile that `elevationFromPoints` uses, with the same gap rule (GAP_M). The coarse base = floor(min m). Step = the first of [5, 10, 20, 50] dm where ceil((max − base) · 10 / step) ≤ 254. Min is floored and max is ceiled, as for blocks.
- [ ] **Step 4:** Run `node --test tools/test_elev.mjs tools/test_app_offline.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `git add js/elevation_section.js js/cc27_file.js tools/test_elev.mjs && git commit -m "Add the coarse route table to the elevation section (version 2)"`

### Task 2: Stateless chart core (geometry, spans, scales, grade, climb, text format)

**Files:**
- Rewrite: `firmware/elev/elev.h`, `firmware/elev/elev.c` (remove `elev_chart`, `el_val`, `el_window`, `EL_C_*`, `EL_RANGE_MIN_DM`)
- Rewrite: `tools/elev_host.c` (new commands below)
- Test: `tools/test_elev.mjs` (replace the old `window`/`draw` host tests)

**Interfaces:**
- Consumes: Task 1 section bytes.
- Produces (all integer, metres or decimetres):
```c
#define EL_HEAD2 1168u
#define EL_COARSE 576u
#define EL_LENS_M 3000u
#define EL_LENS_PX 96
typedef struct { uint32_t len_cm, blocks, step_dm, cstep_dm; int32_t cbase_m; } el_head;
typedef struct { const el_head *h; const uint8_t *coarse; const uint8_t *blk; uint32_t k0, nblk, len_m, prog_m; } el_view;
enum { EL_NONE, EL_PAST, EL_CTX, EL_LENS };
int el_head_parse(el_head *h, const uint8_t *b);                 /* 16 B; 1 = "CCEL" v2, valid steps, blocks > 0 */
int el_lens_x0(uint32_t len_m, uint32_t prog_m);                  /* L > 3000: min(144, 144 P / (L - 3000)); L <= 3000: 240 P / L */
int el_lens_x1(uint32_t len_m, uint32_t prog_m);                  /* exclusive: lx0 + 96 min(3000, L - P) / 3000, at most 240; L <= 3000: 240 */
int el_col_range(uint32_t len_m, uint32_t prog_m, int x, uint32_t *d0, uint32_t *d1); /* zone EL_*; [d0,d1) m */
int el_span(const el_view *v, uint32_t d0, uint32_t d1, int32_t *lo_dm, int32_t *hi_dm); /* 0 = no value */
int32_t el_grade(const el_view *v, uint32_t d);                   /* dm rise over [d, d+100); 0 without values */
uint32_t el_climb(const el_view *v);                              /* m, sum of rises of 30 x 100 m windows from P */
void el_lens_scale(const el_view *v, int32_t *lo_dm, int32_t *rng_dm);  /* spec 6.2 quantised; rng 0 = no values */
void el_route_scale(const el_view *v, int32_t *lo_dm, int32_t *rng_dm); /* coarse min..max, range >= 400 dm */
int el_fmt_dist(char num[8], char unit[3], uint32_t rem_m);       /* "850","m" / "12.4","km" / "112","km"; returns strlen(num) */
int el_fmt_climb(char out[8], uint32_t climb_m);                  /* "+46 m"; 0 (empty) below 5 m */
uint32_t el_blocks_for(const el_head *h, uint32_t prog_m, uint32_t *k0); /* blocks holding [P, P+3100]: count, at most 5 */
```
- `tools/elev_host.c`: `elev_host geom LEN_M PROG_M` → `{"lx0","lx1","ranges":[[zone,d0,d1] x 240]}`. `elev_host core FILE PROG_M` → `{"ok","lens":[lo,rng],"route":[lo,rng],"climb","grade":[...30],"spans":[[ok,lo,hi] x 240]}`. `elev_host fmt REM_M CLIMB_M` → `{"num","unit","climb"}`.

- [ ] **Step 1: Write the failing tests** (`tools/test_elev.mjs`, exact values):
  - geom: `(45000, 0)` → lx0 0, lx1 96. `(45000, 21000)` → lx0 72, lx1 168. `(45000, 42000)` → lx0 144, lx1 240. `(45000, 44000)` → lx0 144, lx1 176, columns x ≥ 176 are EL_NONE. `(45000, 45000)` → lx0 144, lx1 144. `(2400, 600)` → lx0 60, lx1 240, x < 60 EL_PAST, x ≥ 60 EL_LENS. Zones: x < lx0 EL_PAST, lx0 ≤ x < lx1 EL_LENS, x ≥ lx1 EL_CTX (EL_NONE past the route end). Columns are monotonic and cover [0, L) without gaps.
  - spans: the min/max of a lens column equals the min/max of the fine section columns inside [d0, d1). The context column uses the coarse cells that overlap [d0, d1).
  - lens scale: a 3 km flat at 42.0..43.1 m → lo 400 dm, rng 200 dm. A 3 km climb 100 → 137 m → lo 1000 dm, rng 400 dm.
  - grade: a 7 % ramp gives 70 dm. Climb over the ramp of 38 m in 500 m inside the lens → 38 (±1).
  - all-gap lens: spans all 0, lens rng 0, climb 0, no ASan report.
  - fmt: 0 → "0","m". 9 → "10","m". 999 → "1.0","km". 12980 → "13.0","km". 12940 → "12.9","km". 99949 → "99.9","km". 99950 → "100","km". 250000 → "250","km". Climb 4 → "", 46 → "+46 m".
- [ ] **Step 2:** Run `node --test tools/test_elev.mjs`. Expected: FAIL (the host does not build or the commands do not exist).
- [ ] **Step 3:** Implement `firmware/elev/elev.c` and `tools/elev_host.c`. Use integer metres. For context columns: d0 = x·(L−3000)/144 (x < lx0), d0 = P + 3000 + (x−lx1)·(L−3000)/144 (x ≥ lx1). For lens columns: d0 = P + (x−lx0)·3000/96. Fine column index = d·224/1000. Block k is at section offset `EL_HEAD2 + 450·k`, relative to `v->k0`. No `static`, no `const` tables.
- [ ] **Step 4:** Run `node --test tools/test_elev.mjs`. Expected: PASS, no ASan or UBSan output.
- [ ] **Step 5: Commit** `git commit -m "Rewrite the elevation core for the lens chart, stateless"` (elev.h, elev.c, elev_host.c, test_elev.mjs).

### Task 3: Chart drawing (scrim, lens, columns, marks)

**Files:**
- Modify: `firmware/elev/elev.h`, `firmware/elev/elev.c`
- Modify: `tools/elev_host.c` (command `draw FILE PROG_M OUT.ppm`: map-like test background, then the chart; writes a P6 PPM)
- Test: `tools/test_elev.mjs`

**Interfaces:**
- Consumes: Task 2 `el_view`, `el_col_range`, `el_span`, `el_grade`, scales.
- Produces:
```c
uint16_t el_mix(uint16_t dst, uint16_t src, uint32_t a256);       /* RGB565 blend, a256 = 0..256 */
void el_draw(const rs_canvas *cv, const el_view *v);              /* the full normal-state bar, spec 5 and 6.1-6.3 */
void el_plain(const rs_canvas *cv, uint32_t len_m, uint32_t prog_m); /* no-elevation state: scrim, 2 px line y 246..247, rider mark */
```
- Draw order in `el_draw`: scrim (50 % to white, x 0..239, y 237..255). Lens background (another 50 %, lx0..lx1). Columns: tint from the span bottom to y 255 at a256 67 (26 %; ridden 141), then the span in full colour. Lens top edge y 237. Dotted lens end x lx1 when lx1 < 240 (every second row). Km ticks at lx0+32 and lx0+64, y 238..239. Route-end line, when inside the bar. Rider line x lx0 y 237..255, and a triangle at y 238..241 with row widths 7, 5, 3, 1 centred on lx0.
- Profile y = 255 − (e − lo)·17 / rng. A lens column uses the lens scale; other columns use the route scale. Colour by `el_grade` max over the column in 25 m steps: ≥ 60 dm steep, ≥ 30 dm mid, else flat. Context and ridden columns have no grade colour.

- [ ] **Step 1: Write the failing tests** (read the PPM in node):
  - Rows y < 237 are not changed (byte compare with the background).
  - At (45000, 21000): the pixel (72, 250) is rider blue. (73..167, 237) is the 0x202327 edge. Column 168 has the dotted mark on alternate rows.
  - A 7 % ramp inside the lens gives at least one 0xd0182b pixel in x 72..168.
  - A column with no value has only scrim pixels (y 238..255 equal the scrimmed background).
  - `el_mix(0x0000, 0xffff, 128)` is 0x7bef ± 1 per channel. `el_mix(a, b, 0) == a`.
  - `el_plain` at (45000, 22500): (120, 246) is 0x202327, (200, 246) is the light line.
- [ ] **Step 2:** Run `node --test tools/test_elev.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement `el_mix`, `el_draw` and `el_plain` with direct pixel writes into `cv->buf` (no `rs_*` call is necessary). Each column is computed and drawn in one pass (no column array).
- [ ] **Step 4:** Run `node --test tools/test_elev.mjs`. Expected: PASS. Open `OUT.ppm` for the 42 km example at P = 7,300 and compare it by eye with option B of the mock-up.
- [ ] **Step 5: Commit** `git commit -m "Draw the elevation lens chart"`.

### Task 4: Glyph widths and the device adapter `wb_km`

**Files:**
- Create: `tools/font_widths.py` (reads the C4 base; prints the generated header)
- Create: `firmware/elev/elev_font.h` (generated; `static inline int el_glyph_w(int big, int c)` as an `if` chain, no table)
- Modify: `firmware/common/fw.h` (device and host: `FW_LABEL_FONT` +0 `void *`, `FW_LABEL_ALIGN` +28 `uint8_t`, `FW_FONT_NUM` 0x3c2a54d8, `FW_FONT_UNIT` 0x3c29188c, `fw_km_overlay` = 0x4205bf0c `void (*)(int32_t, int32_t, int32_t, int32_t)`; host: a `host_km_calls` counter and the last arguments)
- Modify: `firmware/wayback/wb_device.c:189-222` (remove `wbd_chart`; add `wb_km`; `wb_rt` no longer draws the chart)
- Modify: `tools/wayback_device_host.c` (a `km` mode that calls `wb_km` with the 4 arguments and prints the counter and the text calls)
- Test: `tools/test_font_widths.py`, `tools/test_wayback_device.mjs` (replace the cc29 corner-chart tests at lines 323+)

**Interfaces:**
- Consumes: Tasks 2-3 (`el_head_parse`, `el_blocks_for`, `el_draw`, `el_plain`, `el_climb`, `el_fmt_*`).
- Produces: `void wb_km(int32_t left, int32_t total, int32_t bar_w, int32_t show_text);` (the trampoline target, Task 5).

- [ ] **Step 1: Write the failing tests.**
  - `tools/test_font_widths.py`: the generated header equals `firmware/elev/elev_font.h` byte for byte (drift guard). For both fonts, each of `0-9 . + space k m` has a width of 1..20 px.
  - `tools/test_wayback_device.mjs`, mode `km`:
    - show_text 0 → `host_km_calls == 1` with the same 4 arguments and no canvas change.
    - Untrusted: selector ≠ 0, T NaN, U > T + 50, |T − L| > max(50, L/100), no F_OWN → stock called once each.
    - Normal (version 2 file, trusted) → stock not called, bar pixels present, text calls: number font, then unit font, 5 draws each (4 halo + 1).
    - Version 1 file → stock not called, `el_plain` pixels, a distance text, no climb text.
    - After `wb_km` the label descriptor font, colour, opacity and alignment equal their values before the call.
    - Climb text is not drawn when its left edge would be < 148 (a long number "250" km with "+999 m").
- [ ] **Step 2:** Run `python3 -I -m unittest discover -s tools -p test_font_widths.py` and `node --test tools/test_wayback_device.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement `tools/font_widths.py`. Read lv_font_t at the font address. Find `dsc` (the lv_font_fmt_txt_dsc_t pointer) at the offset the second-pass mining used. Read `glyph_dsc` (8 B per glyph: `bitmap_index:20 | adv_w:12`, box_w, box_h, ofs_x, ofs_y) and the single format-0-tiny cmap (range_start 32, glyph_id_start). For char c, the glyph id is glyph_id_start + c − 32, and the width is (adv_w + 8) >> 4.
- [ ] **Step 4:** Implement `wb_km` in this order:
  1. If show_text is 0, or `fw_stack() < WBD_STACK`, or admission (spec section 7, the same checks as the old `wbd_chart`) fails, call `fw_km_overlay(left, total, bar_w, show_text)` and return.
  2. Open the route file and read the 16-byte header plus the coarse table (1,168 B), then `el_blocks_for` blocks, into one GL_BUF buffer.
  3. On success, call `el_draw`. On any read or parse failure, call `el_plain`.
  4. Draw the text. The unit is right-aligned at x 232 (align 3, x 0, max_w 232, top 217). The number has max_w 232 − w(unit) − 3, top 215. The climb has max_w = number left − 7, top 217, and is drawn only if its left edge is ≥ 148.
  5. Restore the descriptor. Free the buffer and close the file.
- [ ] **Step 5:** Run both tests and `node --test tools/test_elev.mjs`. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "Draw the lens chart from the stock overlay call, with stock fallback"`.

### Task 5: Trampoline, call patch and image build

**Files:**
- Create: `firmware/wayback/km_tramp.S` (section `.tramp_km`)
- Modify: `firmware/wayback/wb_area2.ld` (MEMORY `tramp_km(rx): ORIGIN = 0x4205bdd0, LENGTH = 0x20`; SECTION `.tramp_km : { KEEP(*(.tramp_km)) } > tramp_km`)
- Modify: `tools/cc27_build.py` (TREE and SOURCES gain `km_tramp.S`; CALLED gains 0x4205bf0c; remove the 0x420949e3 patch and its docstring; add the call patch and the tramp copy; receipt fields `km_tramp`, `km_call`)
- Modify: `tools/incoming_refs.py` (a `km` range (0x4205bdd0, 0x20) inside the dead span 0x4205bd90..0x4205bdf0)
- Test: `tools/test_cc27_build.py`, `tools/test_incoming_refs.py`

**Interfaces:**
- Consumes: `wb_km` (Task 4).
- Produces: image bytes. At 0x4204ca2e, `call8 0x4205bdd0` (was `e54d0f`). At 0x4205bdd0, 28 B: `entry a1,32; j L; .align 4; .word wb_km; L: l32r a8,<word>; mov.n a10,a2; mov.n a11,a3; mov.n a12,a4; mov.n a13,a5; callx8 a8; retw.n`.

- [ ] **Step 1: Write the failing tests** in `tools/test_cc27_build.py`:
  - The IROM diff set is the 3 literals, plus 0x4204ca2e..+3, plus 0x4205bdd0..+0x20. 0x420949e3 is no longer changed.
  - `objdump` of the image at 0x4204ca2e reads `call8 0x4205bdd0`. The tramp literal is in 0x4237b134..0x42380000 and equals the `wb_km` symbol.
  - The old bytes at 0x4204ca2e are `e54d0f`, else the build refuses. The guidance card range (0x4205bdb0, 0x20) and the km range do not overlap.
  - The receipt `code_bytes` ≤ 18,404 and `max_frame` ≤ 512.
- [ ] **Step 2:** Run `python3 -I -m unittest discover -s tools -p test_cc27_build.py`. Expected: FAIL.
- [ ] **Step 3:** Implement. Compute the call8 encoding with the builder (offset = (0x4205bdd0 − ((0x4204ca2e & ~3) + 4)) >> 2, op0 5, n 2). Assert it equals what objdump decodes. Copy the `.tramp_km` section bytes with objcopy, in the same way as `.lit_wb_rt`. If the `wb_rt` frame changes, set `HOOK_FRAME` to the reported value only after you read the `wb_rt` disassembly in `cc27.dis`, and say so in the commit message.
- [ ] **Step 4:** Run all tests: `python3 -I -m unittest discover -s tools -p 'test_*.py'` and `node --test tools/`. Expected: PASS. Build the image with the normal cc27 command and keep the receipt (`device_written: false`).
- [ ] **Step 5: Commit** `git commit -m "Route the stock km overlay call to the lens chart"`.

### Task 6: Record and hand over

**Files:**
- Modify: `docs/mining/map-page-ui-2026-11-23.md` (the trampoline address, the call patch, the removed cc29 patch)
- Modify: `docs/current/cc27-system-reference-2026-11-19.md` (elevation section v2, `wb_km` contract, new IROM changes)

- [ ] **Step 1:** Write the records. Write the device-test proposal (spec section 11) as a list for owner approval. Do not run it.
- [ ] **Step 2:** Run the full test set once more. Expected: PASS.
- [ ] **Step 3: Commit** `git commit -m "Record the lens chart image changes"`.

Open gap kept in the records: the meaning of the caller's a3, the rider centre on the unit, and whether another OneLap box layout changes the canvas.
