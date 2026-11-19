# cc27 one release: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One image (cc27), one page version and one device session that give a stable map, grey streets under the
whole screen out to a reach of 1, 2 or 3 km, better names with landmarks, an elevation strip and a test text.

**Architecture:** New code goes into the second code area through the 3 existing literals (`wb_rt`, `cc_iter`,
`cc_line`); no new hook. Pure modules (`raster`, `view`, `elev`, grey reader) have no stock address and run the same
C on the host. Only `firmware/common/fw.h` has stock addresses; only `map.c` and `wb_device.c` include it. The page
proves the grey budget before a file is sent and writes all switches into the file.

**Tech stack:** C (gnu11, Xtensa `xtensa-esp32s3-elf-gcc -Os`, host `cc` with ASan and UBSan), plain ES modules
(page), `node --test`, Python `unittest` (builders, run with `python3 -I`).

**Spec:** `docs/current/one-release-design-2026-11-19.md` (owner approval 19 Nov 2026). The executor reads both.

## Global constraints

- Writing (docs, commit messages): ASD-STE100. Answer first. Name the file, the field and the value.
- The 9 stock hooks are frozen. The image changes only the version text and the 3 literals `0x420496b8`,
  `0x42049678`, `0x4205bd98`. Base: the C4 image `ac48ba3d…` only. `mapdec` and its literal do not change.
- Second code area: 20,172 B. Code limit for cc27: 18,404 B (1,768 B reserve kept).
- No `.data`, `.bss` or `.rodata` in the second code area (`wb_area2.ld` ASSERT). So: no `const` tables, no string
  literals, no `switch` that makes a jump table. Text is built one character at a time.
- Free stack guard `WBD_STACK` 3,968 B stays. No function in the second code area has a frame above 512 B (`.su`).
- Block limits stay: 65,536 B serialized, 57,344 B decoded, 1,400 calls, 7,000 points, 2,304 fill vertices, 384 B
  names, 245,760 B transition. Page guard 4,000,000 B. Way-back cap 1,536 KB.
- Only `firmware/common/fw.h` has stock addresses (pattern `0x(3c|3f|40|42)[0-9a-f]{6}`), for the cc27 tree:
  `firmware/common`, `firmware/raster`, `firmware/view`, `firmware/elev`, `firmware/mapdraw`, `firmware/wayback`.
- A missing switch means cc26 behaviour. A file without the flags entry draws as cc26 (LVGL, no text, no file work
  on the route), except the new frame stops.
- No coordinates or ride data in git. Private inputs stay in `.local/`.
- Commit only when the owner asks, and only before 08:00 or after 19:00 (UTC+1). Never rewrite a pushed commit. Push
  only with `git push origin main:main`. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Device: each flash write, storage write and coredump read needs the owner's yes (`.local/cc26-pack/CARD.md`
  texts). After each esptool step, RTS boot (`run_test.boot()`). Normal boot is not map acceptance.
- Python: `python3 -I`. Each new test file is found by `tools/validate_local.py` (it globs `tools/*.mjs`,
  `tools/*.py`); a suite with 0 tests fails.

## Deviations from the design (owner, please check)

1. **Block flags without a decoder change.** The flags are a class-15 entry with 0 points, added as the **last**
   entry of each block: `style = 15`, `lat = 0x7F434346` (above 2^30, so never a real latitude), `lon = flags`.
   Scheme D version 1 already accepts it (`firmware/mapdec/mapdec.c:129`), `cc_iter` skips class 15
   (`map.c:205-211`), and v21 `arrow.c` skips class 15 with fewer than 2 points. So `mapdec` and the C4 base stay.
   Design 8.1 and 8.2 said "payload version 2, flags into entry 0".
2. **Flag polarity.** `F_OWN` (bit 0) set = own drawer. Design said `F_LVGL` set = LVGL. Reason: an old file with no
   flags entry then draws as cc26.
3. **Where the switches are.** Block flags: `F_OWN` (bit 0), `F_TEXT` (bit 1), `F_ROUTE` (bit 2: the adapter works
   on the route). `wb_rt` reads them under the block lock, the same lock and task as `cc_iter`. The trailer v2 has
   only the section table, no flags word. Reason: on the route the adapter must not open the file when the page did
   not ask for it, and only the block is in RAM before the file is open.
4. **Own drawer scope.** Map entries, grey streets and the way-back line use the own drawer. The stock route line,
   the turn arrows (ops 16 and 17 from v21 `arrow.c`) and the route dots (op 32) keep LVGL: their callers have no
   switch channel.
5. **View.** 4 anchors, not 3. The fourth anchor checks on the unit that the projection is affine (more than 2 px
   off: no grey in that frame). Reference distance 16,384 units (1,024 m), so `vw_map` uses a shift, no division.
   `view` is pure math; the anchor calls are in `wb_device.c`. Builder check 3 is thus a run-time check.
6. **Grey layer v2.** The directory stride (16, 32 or 64 cells for each key) is a header field; the directory has at
   most 256 keys. One heap buffer of 4,096 B for each frame (design: 2,048 B). Grey (off the route) and elevation
   (on the route) share it; they never run in the same frame.
7. **Way-back version 3.** Version 2 layout with 2 m distance steps (0 to 8,190 m). The unit accepts only version 3.
8. **Elevation progress.** `p = T − U`, with `U = *(uint32_t *)0x3c389344` (remaining distance, metres) and
   `T = *(float *)0x3c389320` (route total) from `docs/research/progress-arrival-extraction.md:82`, `:159`. Trusted
   only when: on the route, selector `*(uint32_t *)0x3fc9fcc4 == 0`, `0 < U ≤ T`, and `|T − L| ≤ max(50 m, L/100)`
   with `L` from the elevation section. The on-route test text shows `U` and `T`, so the owner compares them with the
   stock display in the first session.
9. **Test text in ASCII** (the stock font can lack `·`): `cc_iter` writes `m<ms>` at (6, 24). The adapter writes
   `<dist>m[+] w<ms> r<reads>` off the route and `e<code> u<U> t<T> w<ms>` on the route, at (6, 6).
10. **Frame stops.** An outline stays with its fill entry. Stop checks: before the fill pass, before each level 0
    to 4, before the signal pass, before the name pass.
11. **Builder checks 1 and 2 are done (19 Nov, host only).**
    - (1) The map frame `0x4204da24` calls the map iterator `0x4204c9b8` (which calls `0x421dd4dc` → `cc_iter`) at
      `0x4204da3e`, and the route trampoline `0x420496b0` (`wb_rt`) at `0x4204da5a`. So the adapter draws on top
      of the map.
    - (2) `lv_color_hex` (`0x421d0034`) returns `R5<<11 | G6<<5 | B5`: plain RGB565, no byte swap.
12. **Release name cc27**, new builder `tools/cc27_build.py`. `tools/cc26_build.py` stays as the cc26 record.

## Review focus

1. A cc26 page file (no flags entry, trailer `CCWT`) on cc27: the map draws as cc26, off the route `wb7`, on the
   route no file call. Tests: Task 3 `test_block_without_flags_entry_draws_as_cc26`, Task 6 `a cc26 file …`,
   Task 9 `on the route without F_ROUTE …`.
2. The rider zooms the map (not 2.5 m/px): the grey work exceeds the page proof. The cap stops at a line boundary and
   the same zoom gives the same picture. Test: Task 7 `zoom 1.25 m/px …`.
3. An anchor outside ±4,000 px or a NaN heading: no grey in that frame, the way-back line and text stay. Test: Task 8
   `an anchor that fails …`.
4. Stale progress after a rejoin (`U > T`, selector not 0, or `T` far from `L`): no strip. Test: Task 10 `progress
   gates …`.
5. A southern route (`lat` near −2^30): the delta from the last real entry to the flags entry wraps in int32. Test:
   Task 12 `flags entry after a southern entry …`.

---

### Task 1: One address file and shared types

**Files:**
- Create: `firmware/common/types.h`, `firmware/common/fw.h`, `firmware/common/text.h`, `tools/test_fw_addresses.py`
- Delete: `firmware/mapdraw/fw.h` (content moves)
- Modify: `firmware/mapdraw/map.c:8`, `:21-23`, `:124-132`, `:192-195`; `firmware/wayback/wb_device.c:21-99`, `:137-143`
- Modify: `tools/cc26_build.py:30-31`, `:122-125` (copy `firmware/common/*.h` into the build directory);
  `tools/renderer_host.c`, `tools/test_renderer_host.py`, `tools/test_wayback_device.mjs` (add `-I firmware/common`)

**Interfaces:**
- Produces `firmware/common/types.h` (no address): `pt_t`, `line_dsc_t`, `ent_t`, `proj_cb_t` (moved);
  `#define BLK_FLAGS_MAGIC 0x7F434346`; `F_OWN 1u`, `F_TEXT 2u`, `F_ROUTE 4u`;
  `static inline uint32_t blk_flags(const ent_t *E, uint32_t cnt)`: the `lon` of entry `cnt − 1` when it has
  style 15, 0 points and `lat == BLK_FLAGS_MAGIC`, else 0.
- Produces `firmware/common/text.h`: `static inline char *tx_num(char *s, uint32_t v)` (moved `wbd_num`, 5 digits).
- Produces `firmware/common/fw.h` (includes `types.h`): all addresses of the old `fw.h`, of `wb_device.c:66-99` and
  of `map.c:127-130`; the v21 tables `FW_V21_OPS 0x3c1ddf40`, `FW_V21_FILLS 0x3c1ddf36`, `FW_V21_LEVEL 0x3c1ddf20`;
  the channel `OP_PATCH 0x8000u`, `OP_BRIDGE 0x0100u`, `OP_TUNNEL 0x0200u`, `OP_ANCHOR 23u`. The HOST part declares
  the `host_*` names of both host drivers.

- [ ] **Step 1: Record the cc26 code hash.** Add `'code_sha256': hashlib.sha256(code).hexdigest()` to the receipt
  in `tools/cc26_build.py:184`. Run `python3 -I tools/cc26_build.py --output /tmp/cc26-ref` and note the value.
- [ ] **Step 2: Write the failing tests**

```python
# tools/test_fw_addresses.py
TREE = ['firmware/common', 'firmware/raster', 'firmware/view', 'firmware/elev', 'firmware/mapdraw', 'firmware/wayback']
ADDR = re.compile(r'0x(3c|3f|40|42)[0-9a-f]{6}', re.I)
def test_only_fw_h_has_stock_addresses(self):   # .c .h .S files; .ld files are exempt
    hits = [f'{p}:{n}' for p in files(TREE) if p.name != 'fw.h' for n, l in lines(p) if ADDR.search(l)]
    self.assertEqual(hits, [])
def test_pure_modules_do_not_include_fw_h(self):
    for p in files(['firmware/raster', 'firmware/view', 'firmware/elev']) + [WB / 'wb_grey.c', WB / 'wb_grey_draw.c', WB / 'wayback.c']:
        if p.exists(): self.assertNotIn('"fw.h"', p.read_text(), p)
```

```python
# tools/test_cc26_build.py, new test
def test_the_address_move_keeps_the_code(self):
    self.assertEqual(self.receipt['code_sha256'], '<value from Step 1>')
```

- [ ] **Step 3: Run:** `python3 -I tools/test_fw_addresses.py` → FAIL (addresses in `wb_device.c`, `map.c`).
- [ ] **Step 4: Move the definitions** as listed in Interfaces. `map.c` uses `FW_V21_OPS`, `OP_PATCH`, `OP_BRIDGE`,
  `OP_TUNNEL` in place of the literals; `wb_device.c` uses `tx_num` and `OP_PATCH`. No other change.
- [ ] **Step 5: Run:** `python3 -I tools/test_fw_addresses.py`, `python3 -I tools/test_cc26_build.py`,
  `python3 -I tools/test_renderer_host.py`, `node --test tools/test_wayback_device.mjs` → all PASS; the code hash is
  equal (the move changes no instruction).
- [ ] **Step 6: Commit:** `Move all stock addresses into firmware/common/fw.h`.

### Task 2: Raster module

**Files:**
- Create: `firmware/raster/raster.h`, `firmware/raster/raster.c`, `tools/raster_host.c`, `tools/test_raster.mjs`

**Interfaces:**
- Consumes: `pt_t` (`types.h`).
- Produces (`raster.h`):
  - `typedef struct { uint16_t *buf; int16_t w, h; } rs_canvas;` (row-major RGB565, as `FW_CANVAS_BUF`).
  - `#define RS_RGB(rgb) ((uint16_t)((((rgb) >> 8) & 0xf800u) | (((rgb) >> 5) & 0x07e0u) | (((rgb) >> 3) & 0x001fu)))`
    (equal to `lv_color_hex`, deviation 11).
  - `void rs_fill(const rs_canvas *c, const pt_t *p, uint32_t n, uint16_t col);` — the even-odd fill of
    `map.c:89-119`, moved; `int16_t xs[128]` stays.
  - `void rs_line(const rs_canvas *c, const pt_t *p, uint32_t n, int w, uint16_t col, uint8_t opa, int round);`
    w ≤ 1: integer Bresenham for each segment, both ends drawn. w ≥ 2: each segment as the quad of the segment
    widened by w/2 on each side (normal from integer `isqrt`, 1/16 px), filled with the span code of `rs_fill`.
    `round` and w ≥ 3: `rs_disk` of diameter w at each point. opa < 255: blend, no disks.
  - `void rs_disk(const rs_canvas *c, int x, int y, int d, uint16_t col, uint8_t opa);`
  - `void rs_rect(const rs_canvas *c, int x0, int y0, int x1, int y1, uint16_t col);` — `[x0, x1) × [y0, y1)`.
  - `uint32_t rs_work(const pt_t *p, uint32_t n, int w);` — the pixel-work rule:
    `Σ_segments (max(|dx|, |dy|) + 1) · max(w, 1)` plus `n · w²` when w ≥ 3. Not clipped.
  - Blend: `out = (src · opa + dst · (255 − opa)) / 255` for each of R5, G6, B5.
  - Clip at the canvas. No write outside `buf[0 .. w·h)`.

- [ ] **Step 1: Write the failing tests** (`tools/test_raster.mjs`; the driver gets a case name and numbers, and
  prints the canvas hash, the changed pixel count and the bounding box as JSON).

```js
test('a horizontal line of width 7 from (10,50) to (110,50) sets 101 x 7 pixels plus the two end disks', ...);
  // assert.equal(r.changed, rasterRef.hline(101, 7))   (reference in the test: square body + 2 half disks)
test('a width-1 line from (0,0) to (9,3) sets exactly 10 pixels, the same set in both directions', ...);
test('a line fully outside the canvas changes no pixel; a line from (-500,-500) to (500,500) stays in bounds', ...);
test('rs_fill gives the same pixels as the v21 fill on the renderer fixtures', ...);   // the driver has a copy of map.c:89-119 as old_fill
test('white at opa 115 over black gives RGB565 0x6b8d (R 13, G 28, B 13)', ...);
test('rs_work of a 3-point line of width 4 is (|d1|+1)*4 + (|d2|+1)*4 + 3*16', ...);
test('the same line drawn two times gives the same hash (no state)', ...);
```

- [ ] **Step 2: Run:** `node --test tools/test_raster.mjs` → FAIL (`raster.c` absent).
- [ ] **Step 3: Implement** `firmware/raster/raster.c` with the signatures above. No `fw.h`, no float, no static
  data.
- [ ] **Step 4: Run:** `node --test tools/test_raster.mjs` and `python3 -I tools/test_fw_addresses.py` → PASS.
- [ ] **Step 5: Commit:** `Add the raster module: fill, line, disk and pixel work with no stock call`.

### Task 3: Map draw on the raster, with level stops, flags and map time

**Files:**
- Modify: `firmware/mapdraw/map.c` (`fill` → `rs_fill`; `line()` at `:63-67`; `cc_iter` at `:219-284`)
- Modify: `tools/renderer_host.c` (link `firmware/raster/raster.c`; a case option for the flags entry and a slow
  clock), `tools/test_renderer_host.py`
- Modify: `firmware/mapdraw/README.md`

**Interfaces:**
- Consumes: `rs_*` (Task 2), `blk_flags`, `F_OWN`, `F_TEXT`, `tx_num` (Task 1).
- Produces: `#define OP_OWN 0x4000u` in `fw.h`: `cc_iter` sets it in `sel` of each map entry when the block has
  `F_OWN`; `cc_line` then draws with `rs_*` on `rs_canvas {FW_CANVAS_BUF, FW_CANVAS_W, FW_CANVAS_H}`. Without the bit,
  `line()` calls `fw_draw_line` as today. Fills always use `rs_fill` (as today, same code).
- Produces: `MAP_FRAME_US` 400,000 µs stays; `LATE()` only at the 4 boundaries of deviation 10, plus the star-line
  loop of style-0 entries (`map.c:233`, unchanged).
- Produces: with `F_TEXT`, at the end of `cc_iter`: text `m<ms>` (time of `cc_iter`, ms) at (6, 24), white at
  (7, 25) then black, with `fw_canvas_text` as `map.c:131`.

- [ ] **Step 1: Write the failing tests** (`tools/test_renderer_host.py`)

```python
def test_block_without_flags_entry_draws_as_cc26(self):        # existing fixture: same draw trace as today
def test_flags_entry_is_not_drawn_and_not_counted_as_a_label(self):
def test_own_lines_draw_pixels_and_make_no_lvgl_call(self):     # F_OWN: host_draw_line calls == 0, canvas hash != blank
def test_level_stop_keeps_each_road_whole(self):
    # clock step makes 400 ms pass inside level 1. For each entry i: core drawn <=> edge drawn; no pass of level 2.
def test_fill_pass_and_name_pass_stop_only_at_their_start(self):
def test_map_time_text_only_with_F_TEXT(self):                 # host_text sees "m" + digits at (6,24) only with F_TEXT
```

- [ ] **Step 2: Run:** `python3 -I tools/test_renderer_host.py` → the new tests FAIL.
- [ ] **Step 3: Implement** in `map.c`: `uint32_t flags = blk_flags(E, cnt)` after the lock; `OP_OWN` into `sel`
  in `draw_entry` callers; `line()` branches on `OP_OWN`; `dash()` and `K_DOT` go through `line()`; delete `LATE()`
  at `:243`, `:257`, `:264`, `:268` and add one check before the fill pass, before each `lv` loop, before the signal
  loop and before the name loop.
- [ ] **Step 4: Run:** `python3 -I tools/test_renderer_host.py` → PASS (old tests unchanged).
- [ ] **Step 5: Commit:** `Draw map lines with the raster module and stop a frame only between levels`.

### Task 4: View module

**Files:**
- Create: `firmware/view/view.h`, `firmware/view/view.c`, `tools/view_host.c`, `tools/test_view.mjs`

**Interfaces:**
- Consumes: `pt_t`.
- Produces (`view.h`):
  - `#define VW_REF 16384` (way-back units, 1,024 m), `#define VW_SHIFT 14`.
  - `typedef struct { int32_t ux, uy, sx, sy, ex, ey, nx, ny; } vw_t;` — origin in units and on the screen; screen
    offset of `+VW_REF` east (`ex, ey`) and north (`nx, ny`).
  - `int vw_fit(vw_t *v, int32_t ux, int32_t uy, const pt_t s[4]);` — `s` = screen points of `(ux, uy)`,
    `(ux + REF, uy)`, `(ux, uy + REF)`, `(ux + REF, uy + REF)`. Returns 0 when `|s3 − (s1 + s2 − s0)| > 2` px on an
    axis, or when `|ex|, |ey|, |nx|, |ny| > 4000`.
  - `pt_t vw_map(const vw_t *v, int32_t ux, int32_t uy);` — `du, dv` clamped to ±131,072 units;
    `x = sx + ((du·ex + dv·nx + 8192) >> 14)`, same for y; the result clamped to ±4,000.

- [ ] **Step 1: Write the failing tests** (`tools/test_view.mjs`; the test makes a fake affine projection: scale
  2.5 m/px or 1.25 m/px, heading 0 to 337.5° in 22.5° steps, pixel rounding as `int16`)

```js
test('vw_map is within 1 px of the true projection for points up to 1 km from the origin, 16 headings', ...);
test('a fourth anchor 3 px off is refused; 2 px is accepted', ...);
test('an axis offset above 4000 px is refused', ...);
test('points 8 km away do not overflow (UBSan) and clamp to ±4000', ...);
```

- [ ] **Step 2: Run:** `node --test tools/test_view.mjs` → FAIL.
- [ ] **Step 3: Implement** `firmware/view/view.c`. Integer only.
- [ ] **Step 4: Run:** `node --test tools/test_view.mjs` → PASS.
- [ ] **Step 5: Commit:** `Add the view module: an affine screen map from four anchors`.

### Task 5: Way-back version 3 and the reach 1, 2 or 3 km

**Files:**
- Modify: `js/wayback_format.js:15`, `:154-206` (`encodeWaybackV2` → `encodeWaybackV3`), `decodeWayback`
- Modify: `js/wayback_tree.js:10-11`, `:194-197`, `:260` (reach table)
- Modify: `firmware/wayback/wayback.c:108` (`* 10u` → `* 20u`) and the version check in `wb_mount`
- Modify: callers of `encodeWaybackV2` in `js/`, `tools/*.mjs`; tests `tools/test_wayback_format.mjs`,
  `tools/test_wayback_tree.mjs`, `tools/test_wayback_core.mjs`, `tools/test_wayback_device.mjs`

**Interfaces:**
- Produces: `encodeWaybackV3(model, routeId, flagOf)`: version byte 3; node bits 51-62 = `Math.round(metres / 2)`;
  `MAX_DIST_M_V3 = 8190`; throws `'node does not fit version 3: dist'` above it.
- Produces: `decodeWayback(bytes)` reads version 2 (1 m) and 3 (2 m); `dist` in metres in both. The unit
  (`wb_mount`) accepts only version 3.
- Produces: `REACH = { line1k: {air: 1000, ride: 2000}, line2k: {air: 2000, ride: 4000}, line3k: {air: 3000, ride: 6000} }`
  in `wayback_tree.js`; `buildWaybackModel(graph, route, {reach})` accepts these and `ride1500` (study tools only).

- [ ] **Step 1: Write the failing tests**

```js
test('version 3 keeps 8,190 m and refuses 8,192 m', ...);
test('version 3 distances round to 2 m; the C core reads the same dm as the JS decoder', ...);   // via tools/wayback_core_host.mjs
test('line3k keeps a street 2,900 m from the route and line2k does not', ...);
test('the unit refuses a version 2 file with code 7', ...);                                      // tools/test_wayback_device.mjs
```

- [ ] **Step 2: Run:** `node --test tools/test_wayback_format.mjs tools/test_wayback_tree.mjs` → FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run:** `node --test tools/test_wayback_format.mjs tools/test_wayback_tree.mjs tools/test_wayback_core.mjs tools/test_wayback_device.mjs tools/test_wayback_replay.mjs` → PASS.
- [ ] **Step 5: Commit:** `Store the way-back distance in 2 m steps (version 3) and add the 1 and 3 km reach`.

### Task 6: Trailer version 2 (section table)

**Files:**
- Modify: `js/wayback_embed.js` (replace `readTrailer`, `embedWayback`), `js/wayback.js:93-111` (`checkWayback`,
  `addWayback`), `tools/wayback_embed.mjs`
- Modify: `firmware/wayback/wayback.c:165-191`, `:237-243` (remove the grey search and `wb_grey_section`),
  `firmware/wayback/wayback.h`
- Modify: `firmware/wayback/wb_device.c:154-166` (`wbd_run` reads the table)
- Test: `tools/test_wayback_page.mjs`, `tools/test_wayback_device.mjs`

**Interfaces:**
- Produces (layout, the last 64 B of the route file, little-endian): `u32 magic 0x53574343 ("CCWS")`,
  `u32 count (1..4)`, then 4 × `{u32 type, u32 offset, u32 size}` (unused: 0), `u32 0`. Types: `1` way-back,
  `2` grey layer, `3` elevation. Each section is inside `[route length, file length − 64)`; no overlap; a type
  occurs at most once; an unknown type is ignored.
- Produces (JS): `SECTION = {WAYBACK: 1, GREY: 2, ELEV: 3}`; `embedSections(route, [{type, bytes}])` → file
  (route padded to 4,096, sections, zero fill, trailer; total padded to 4,096); `readSections(file)` →
  `[{type, offset, size}]` or `null`.
- Produces (JS): `addWayback(routeBytes, {reach, layer, ...})` returns `{wayback, grey, reach, stats}` (bytes, not
  a file). `checkWayback(file)` uses `readSections` and drops all sections on an identity mismatch.
- Produces (C): `typedef struct { uint32_t at[4], size[4]; } wbd_secs;` indexed by type; `wbd_secs_read(void *fp,
  wbd_secs *s)` = one 64 B read; 0 = no valid table. `wb_mount` gets only the way-back section.
- Bridge until Task 8: `wb_grey_lines(e, info, cells, n, fn, ctx)` gets `info = {offset from the way-back section
  start, cell count, body bytes}` from the table and the 16 B `CCGL` header, not from the engine. The grey tests of
  `tools/test_wayback_device.mjs` keep passing.

- [ ] **Step 1: Write the failing tests**

```js
test('embedSections then readSections gives the same three sections; the route bytes are unchanged', ...);
test('a table with an overlap, a section past the trailer, or count 5 is refused', ...);
test('a cc26 file (CCWT trailer) gives wb7 and the file is closed', ...);         // tools/test_wayback_device.mjs
test('a file with only the way-back section draws the line as today', ...);
```

- [ ] **Step 2: Run:** `node --test tools/test_wayback_page.mjs tools/test_wayback_device.mjs` → FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run:** the same command → PASS.
- [ ] **Step 5: Commit:** `Find each way-back section by its type in a trailer table`.

### Task 7: Grey layer version 2 and the screen proof (page)

**Files:**
- Modify: `js/wayback_grey_layer.js` (header v2, directory); `firmware/wayback/wb_grey.c`, `wb_grey.h` (add
  `gl_cells`, see Task 8 Interfaces; `wb_grey_cells` calls it)
- Create: `js/screen_proof.js`, `tools/grey_cells_host.c`, `tools/test_screen_proof.mjs`
- Test: `tools/test_wayback_grey_layer.mjs`

**Interfaces:**
- Produces (layout v2): `"CCGL"`, `u8 12, u8 3, u8 2 (version), u8 log2 stride (4, 5 or 6)`, `u32 n cells`,
  `u32 body bytes`, `u32 pixel cap`, `u32 point cap`, `u32 m keys`, then `m × u32` key of cell `stride · j`, then
  the table `(n + 1) × {u32 key, u32 offset}` (sentinel as today), then the bodies. Header 28 B. The page picks the
  smallest stride with `m ≤ 256`; above 16,384 cells it writes no layer and reports `'grey layer over 16,384 cells'`.
- Produces: `greyLayer(parts, {pixCap = 60000, ptCap = 2048} = {})`, `readGreyLayer(bytes)` (v2 only).
- Produces (`js/screen_proof.js`):
  - `greyCells(x, y, courseDeg)` → keys; the same result as C `gl_cells` (Task 8), same screen box as
    `wb_grey.c:103-134`.
  - `lineWorkBound(pts, w = 4, unitsPerPx = 40)` = `Σ (ceil(len / unitsPerPx) + 2) · w + n · w²` (w ≥ 3). Upper
    bound of `rs_work` at 2.5 m/px for any heading.
  - `proveGreyLayer(cells, {pixCap, ptCap, step = 1024, headings = 16})` → `{screens, over: [{x, y, course}],
    worstWork, worstPoints}`. Positions: a 64 m grid over the layer cells.
  - `fitGreyLayer(parts, caps)` → `{bytes, removedKm, removedLines, proof}`. While a screen is over a cap: in the
    cells of that screen, remove the shortest line with an end point that no other line has; if none, the
    shortest line; ties by cell key, then line index. At most 10,000 removals, then throw.

- [ ] **Step 1: Write the failing tests**

```js
test('greyCells equals the C cell selection for 2,000 positions and 16 headings', ...);   // tools/grey_cells_host.c
test('rs_work of the drawn screen points is never above lineWorkBound at 2.5 m/px', ...); // raster_host + view_host
test('a layer over the pixel cap loses its shortest dead ends until every screen passes', ...);
test('the caps and the stride are in the header; readGreyLayer gives the same lines', ...);
test('zoom 1.25 m/px: the unit work can exceed the proof; the cap stops at a line boundary', ...); // documents the Review-focus case
```

- [ ] **Step 2: Run:** `node --test tools/test_screen_proof.mjs tools/test_wayback_grey_layer.mjs` → FAIL.
- [ ] **Step 3: Implement** the interfaces above. First move the body of `wb_grey_cells` into `gl_cells` (pure,
  units in, keys out); `tools/grey_cells_host.c` calls `gl_cells`.
- [ ] **Step 4: Run:** the same command → PASS.
- [ ] **Step 5: Commit:** `Prove the grey work on the page and write grey layer version 2 with its caps`.

### Task 8: Grey reader version 2 and grey draw (unit), with anchors in the adapter

**Files:**
- Modify: `firmware/wayback/wb_grey.c`, `firmware/wayback/wb_grey.h` (layer v2, units out)
- Create: `firmware/wayback/wb_grey_draw.c`, `firmware/wayback/wb_grey_draw.h`
- Modify: `firmware/wayback/wb_device.c:167-189` (remove `wbd_grey_visit`, `wbd_grey_draw`, `WBD_GREY_SEGS`,
  `WBD_GREY_US`, `WBD_GREY_END_US`; add `wbd_anchor`, `wbd_view`)
- Modify: `tools/wayback_device_host.c` (link `map.c`, `raster.c`, `view.c`, `wb_grey_draw.c`; fake projection
  with scale and heading; `host_proj` calls the real `cc_line`; count `host_proj` calls and heap calls)
- Test: `tools/test_wayback_device.mjs` (replace the grey tests at `:129-224`)

**Interfaces:**
- Consumes: `rs_*`, `vw_*`, `wb_grid`, `wb_point`, `OP_ANCHOR`.
- Produces (`wb_grey.h`):
  - `#define GL_BUF 4096u` (directory 1,024 + records 576 + body 2,048 + rest).
  - `typedef struct { wb_reader rd; void *ctx; uint32_t at, size, n, body, pix_cap, pt_cap, stride, m; uint8_t *buf; } gl_layer;`
  - `int gl_open(gl_layer *l, wb_reader rd, void *ctx, uint32_t at, uint32_t size, uint8_t *buf);` — one read of
    header and directory; 0 = bad layer.
  - `uint32_t gl_cells(uint32_t x, uint32_t y, uint32_t course_deg, uint32_t cells[20]);` — made in Task 7; as
    `wb_grey_cells`, in units. This task deletes `wb_grey_cells` and `wb_grey_lines`.
  - `typedef int (*gl_fn)(void *ctx, const int32_t *xy, uint32_t n);` — points in units; 0 = stop.
  - `int gl_lines(gl_layer *l, const uint32_t *cells, uint32_t n, gl_fn fn, void *ctx);` — one table read for each
    row (records from the directory group), one body read for each cell; 1 = done or stopped, 0 = read error or bad
    body.
- Produces (`wb_grey_draw.h`): `int grey_draw(gl_layer *l, const rs_canvas *cv, const vw_t *v, uint32_t x,
  uint32_t y, uint32_t course, uint32_t *work);` — colour `RS_RGB(0x9a9ea3)`, width 4, round; before each line,
  stop (return 0) when `work + rs_work(line) > pix_cap` or `points + n > pt_cap`; returns 1 when all lines are drawn.
- Produces (`wb_device.c`): `static int wbd_anchor(const wb_grid *g, int32_t ux, int32_t uy, pt_t *s);` (op 23
  through `fw_proj`, restores `color` and `width`, ok when `dash_gap == 1`); `static int wbd_view(const wb_grid *g,
  uint32_t x, uint32_t y, vw_t *v);` (4 anchors, `vw_fit`).

- [ ] **Step 1: Write the failing tests** (`tools/test_wayback_device.mjs`)

```js
test('the same position and heading give the same canvas hash with a fast and a slow clock (below 300 ms)', ...);
test('every line of the selected cells is drawn: the drawn line count equals the JS reference', ...);
test('grey makes 4 projection calls (anchors) and no projection call for a grey line', ...);
test('reads for grey are at most 1 + rows + cells', ...);
test('the pixel cap stops at a line boundary: the drawn lines are a prefix of the full order', ...);
test('an anchor that fails (outside ±4000 px) or a NaN heading: no grey, the same line and text', ...);
test('a read error in a cell body: no more grey, the same line and distance', ...);
test('the heap buffer is freed on each path (malloc count == free count)', ...);
```

- [ ] **Step 2: Run:** `node --test tools/test_wayback_device.mjs` → FAIL.
- [ ] **Step 3: Implement** the interfaces above. The grey order: cells nearest first (as today), lines in body order.
- [ ] **Step 4: Run:** `node --test tools/test_wayback_device.mjs tools/test_screen_proof.mjs` → PASS.
- [ ] **Step 5: Commit:** `Draw all grey lines of the screen cells with the own drawer and a page-proven cap`.

### Task 9: Adapter frame entry, switches and text

**Files:**
- Modify: `firmware/wayback/wb_device.c:208-237` (`wbd_frame`, `wb_rt`)
- Modify: `tools/wayback_device_host.c` (block entries with a flags entry, block lock counts)
- Modify: `firmware/wayback/README.md:85-125` (steps and the text table)
- Test: `tools/test_wayback_device.mjs`

**Interfaces:**
- Consumes: `blk_flags`, `F_OWN`, `F_TEXT`, `F_ROUTE`, `wbd_secs_read` (Task 6), `grey_draw` (Task 8).
- Produces: `wb_rt(part)`: `fw_cc_rt(part)`; then `flags = wbd_flags()` (block lock, `blk_flags`, unlock); off the
  route → `wbd_frame(flags, 1)`; on the route and `F_ROUTE` → `wbd_frame(flags, 0)`; else nothing (as cc26).
- Produces: `wbd_frame` order: stack check → position (off route only) → path → open → table → heap buffer
  (`fw_malloc(GL_BUF, CAPS_PSRAM)`) → off route: mount, tick, view, grey, line → on route: elevation (Task 10) →
  free → close → text. The way-back line gets `OP_OWN` when `F_OWN`.
- Produces: text off the route: `<dist>m[+]`, with `F_TEXT` also ` w<ms> r<reads>`; error `wb<code>` (+ the same
  tail with `F_TEXT`). On the route (only with `F_TEXT`): `e<code> u<U> t<T> w<ms>`. New code `WBD_HEAP = 11`
  (no heap buffer: grey and elevation skipped, line still drawn).

- [ ] **Step 1: Write the failing tests**

```js
test('on the route without F_ROUTE: no block-flag text, no file call, no heap call (cc26)', ...);
test('on the route with F_ROUTE: one open, one table read, one close; the heap buffer is freed', ...);
test('off the route without F_TEXT the text is only the distance; with F_TEXT it has w and r', ...);
test('a failed heap allocation shows the line and code 11 in the text with F_TEXT', ...);
test('the stack check comes before the block lock and before any file call', ...);
test('without F_OWN the way-back line goes through LVGL (host_draw_line), with F_OWN through the raster', ...);
```

- [ ] **Step 2: Run:** `node --test tools/test_wayback_device.mjs` → FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run:** `node --test tools/test_wayback_device.mjs` → PASS.
- [ ] **Step 5: Commit:** `Read the block switches in the adapter and work on the route only with F_ROUTE`.

### Task 10: Elevation section and strip

**Files:**
- Create: `js/elevation_section.js`, `firmware/elev/elev.h`, `firmware/elev/elev.c`, `tools/elev_host.c`,
  `tools/test_elev.mjs`
- Modify: `firmware/common/fw.h` (`FW_ROUTE_LEFT 0x3c389344` u32, `FW_ROUTE_TOTAL 0x3c389320` float,
  `FW_NAV_SELECTOR 0x3fc9fcc4` u32), `firmware/wayback/wb_device.c` (on-route branch), `tools/wayback_device_host.c`

**Interfaces:**
- Produces (layout `CCEL`, little-endian): `"CCEL"`, `u32 route length cm` (field 5 of the last native record),
  `u16 K blocks`, `u8 step dm (5, 10 or 20)`, `u8 1 (version)`; then K blocks of 450 B: `i16 base m`, 224 ×
  `{u8 min, u8 max}` in steps above the base; 255 = no value. One block = 1,000 m = 224 columns of 4.464 m.
- Produces (JS): `elevationSection(routeBytes)` → bytes or `null` (no elevation field, or all values 0); it uses
  `readRouteElevations` (`js/native_route.js:34`). A gap over 250 m between two values gives 255 columns. The step
  is the smallest that fits the range of every block.
- Produces (`elev.h`): `EL_COLS 224u`, `EL_BLOCK 450u`, `EL_HEAD 12u`; strip `EL_X 4`, `EL_Y 68`, `EL_W 232`,
  `EL_H 32`, `EL_RANGE_MIN_DM 400`;
  - `typedef struct { uint32_t len_cm, blocks, step_dm; } el_head;`
  - `int el_head_parse(el_head *h, const uint8_t b[12]);` — 0 = bad magic or version.
  - `int el_window(const el_head *h, uint32_t progress_m, uint32_t *off, uint32_t *bytes, uint32_t *col0);` — the
    byte range of block `k0 = col / 224` and `k0 + 1` (if present); 0 when progress is past the end.
  - `void elev_draw(const rs_canvas *cv, const el_head *h, const uint8_t *blk, uint32_t nblk, uint32_t col0);` —
    white rectangle; for each of the 224 columns at `x = EL_X + 4 + i` a vertical span from the column maximum down
    to the strip bottom in `RS_RGB(0x9a9ea3)`, and the maximum pixel in `RS_RGB(0x202326)`; vertical range
    `max(40 m, window range)`; columns with 255 stay white.
- Produces (`wb_device.c`): progress `p = T − U` and the trust gates of deviation 8; codes `e0` drawn, `e1` no
  section, `e2` untrusted progress, `e3` past the end, `e4` read failed.

- [ ] **Step 1: Static check of `T`.** In the base disassembly, find the stores to `0x3c389320` and write the
  expression into `firmware/common/fw.h` as a comment. If `T` is not the route total in metres, the page writes no
  elevation section (G5 off) and the on-route text still shows `u` and `t`.
- [ ] **Step 2: Write the failing tests**

```js
test('a 70 km route with elevation gives 12 + 70 * 450 B', ...);
test('a gap over 250 m gives 255 columns; all-zero elevation gives no section', ...);
test('a ramp of 0 to 30 m over 1 km draws a rising edge with a 40 m vertical range', ...);  // pixel rows in elev_host
test('the window across two blocks reads 900 B from the right offset', ...);
test('progress gates: off route, selector 1, U 0, U > T, |T - L| > max(50, L/100) draw nothing and give e2', ...);
test('no elevation section gives e1 and no strip', ...);
```

- [ ] **Step 3: Run:** `node --test tools/test_elev.mjs tools/test_wayback_device.mjs` → FAIL.
- [ ] **Step 4: Implement** the interfaces above.
- [ ] **Step 5: Run:** the same command → PASS.
- [ ] **Step 6: Commit:** `Add the elevation section and the 1 km strip on the route`.

### Task 11: Street-name positions and landmark names (page)

**Files:**
- Modify: `js/map_labels.js:29-68` (`prepareLabelCandidates`, `labelsForBlock`), `js/osm.js` (query),
  `js/mapsec.js` (landmark entries)
- Test: `tools/test_map_labels.mjs`

**Interfaces:**
- Produces: the order of names in a block: streets that the route uses or crosses, then landmarks, then other
  streets by class, then length. At most 12 names and 384 B for each block (unchanged).
- Produces: a street name position on the street, 20 m or more from the route line and from a junction, at the
  middle of its longest straight run inside 300 m of the route.
- Produces: landmarks from OSM `amenity=drinking_water`, `amenity=place_of_worship` with `religion=christian`,
  `shop=supermarket`; text = `name`, else `Trinkwasser`, `Kirche`, `Supermarkt`; cut at 23 B on a character
  boundary; a class 12 entry at the landmark position.

- [ ] **Step 1: Write the failing tests**

```js
test('a route street name comes before a landmark, and a landmark before a side street', ...);
test('a name is 20 m or more from the route line and from each junction', ...);
test('a block with 14 candidates keeps 12 names and at most 384 B', ...);
test('a supermarket without a name gets "Supermarkt"; a 30-byte name is cut on a character boundary', ...);
```

- [ ] **Step 2: Run:** `node --test tools/test_map_labels.mjs` → FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run:** `node --test tools/test_map_labels.mjs tools/test_map_budget.mjs tools/test_preview.mjs` → PASS.
- [ ] **Step 5: Commit:** `Place street names away from the route and add three landmark types`.

### Task 12: Page switches, flags entry and the cc27 file

**Files:**
- Modify: `js/mapsec.js:417-425` (append the flags entry in `make`), `js/map_budget.js:22-40` (charge it),
  `js/map_codec.js` (int32 delta wrap), `js/preview.js` (ignore it)
- Modify: `index.html:81-84`, `:150` (fw option `patch27`, reach select, 3 checkboxes), `js/app.js:105-125`
- Test: `tools/test_map_codec.mjs`, `tools/test_map_budget.mjs`, `tools/test_app_offline.mjs`

**Interfaces:**
- Produces: `flagsEntry(flags)` in `js/mapsec.js` (style 15, 0 points, `lat = 0x7F434346`, `lon = flags`), appended
  after `canonicalEntries` when the option `blockFlags` is a number.
- Produces: `estimateBlock` charges a flags entry 28 B decoded and its serialized bytes, 0 calls, 0 points.
- Produces (page): `<option value="patch27" selected>Patch cc27 (eigene Linien, graue Straßen, Höhenprofil)</option>`;
  `<select id="waybackReach">` 1 km / 2 km / 3 km (`line1k`, `line2k`, `line3k`, default `line3k`); checkboxes
  `#ownLines` (F_OWN, on), `#testText` (F_TEXT, on), `#elevation` (section and F_ROUTE, on). The grey checkbox is
  the existing `#wayback`. For `patch27`: `F_ROUTE` = elevation section present or `F_TEXT`. The page steps the reach
  down (3 → 2 → 1 km) when the way-back data does not fit, and shows the reach it used. `patch25` (cc26) stays until
  cc27 passes on the unit.

- [ ] **Step 1: Write the failing tests**

```js
test('flags entry after a southern entry (lat -2^30) decodes to lat 0x7F434346 and the right lon', ...);
test('a block with the flags entry costs 28 B more decoded and the same calls', ...);
test('the preview of a block with the flags entry is the same as without it', ...);
test('patch27 with all switches gives a file with 3 sections and flags 7 in every block', ...);
test('patch27 with "Eigene Linien" off gives flags without bit 0', ...);
```

- [ ] **Step 2: Run:** `node --test tools/test_map_codec.mjs tools/test_map_budget.mjs tools/test_app_offline.mjs` → FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run:** the same command → PASS.
- [ ] **Step 5: Commit:** `Write the cc27 switches into each map block and offer the reach on the page`.

### Task 13: cc27 image builder

**Files:**
- Create: `tools/cc27_build.py`, `tools/test_cc27_build.py`
- Modify: `firmware/wayback/wb_area2.ld` (comment only: cc27)

**Interfaces:**
- Consumes: `cc26_build.read_any`, `check_called`, `check_map_tables`, `literal_outside` (import, no copy).
- Produces: `build(base, outdir, prefix) -> (image, receipt)`; sources = the cc27 tree of the global constraints;
  `VERSION_PREFIX = b'CC700_V1.414-cc27-'`; `CODE_LIMIT = 20172 - 1768`; refuse when the code is above it; refuse
  when any `.su` frame is above 512 B; `HOOK_FRAME` pinned to the value of the first clean build (record it in the
  receipt and in `docs/releases`); `check_called` also covers the new stock calls (`fw_malloc`, `fw_free`,
  `fw_blk_lock`, `fw_blk_unlock`).

- [ ] **Step 1: Write the failing tests** (as `tools/test_cc26_build.py`, plus)

```python
def test_code_keeps_the_1768_byte_reserve(self): self.assertLessEqual(self.receipt['code_bytes'], 18404)
def test_no_function_frame_above_512_bytes(self): ...
def test_only_the_planned_bytes_change(self): ...   # the 3 literals and the version text
def test_version_is_cc27_with_the_build_mark(self): ...
```

- [ ] **Step 2: Run:** `python3 -I tools/test_cc27_build.py` → FAIL.
- [ ] **Step 3: Implement** the interfaces above. Run `python3 -I tools/cc27_build.py --output .local/cc27`.
- [ ] **Step 4: Run:** `python3 -I tools/test_cc27_build.py tools/test_cc26_build.py tools/test_area2_image.py tools/test_incoming_refs.py` → PASS.
- [ ] **Step 5: Commit:** `Build the cc27 image with the code reserve and the frame checks`.

### Task 14: Budget gate on the 70 km route and the city ride

**Files:**
- Create: `tools/release_budget.mjs` (public code; private inputs by path), `tools/test_release_budget.mjs`
- Create: `docs/releases/cc27-<date>.md` (numbers only, no coordinates)

**Interfaces:**
- Produces: `node tools/release_budget.mjs --route <gpx> --ride <track.json> --reach line3k` prints JSON:
  file bytes for each reach, section bytes, block limit maxima, grey proof (`over`, `worstWork`, `worstPoints`,
  `removedKm`), own-drawer map work p50/p90/max, grey reads p50/p90, code bytes from the receipt.
- Gate (exit 1 when a gate fails): file ≤ 4,000,000 B; way-back section ≤ 1,536 KB; every block within the
  limits; grey proof `over` empty after `fitGreyLayer`. The map work numbers are reported, not gated.

- [ ] **Step 1: Write the failing test** (`tools/test_release_budget.mjs`, on the host fixture of
  `tools/wayback_fixture.mjs`): `test('the gate fails for a file over 4,000,000 B and passes for the fixture')`.
- [ ] **Step 2: Run:** `node --test tools/test_release_budget.mjs` → FAIL.
- [ ] **Step 3: Implement** the tool. Run it on the private 70 km route and the 17 Nov ride for 1, 2 and 3 km.
- [ ] **Step 4: Run:** `node --test tools/test_release_budget.mjs` → PASS. Write the numbers into
  `docs/releases/cc27-<date>.md`, with a table for each feature: normal behaviour, admission, unavailable state,
  restoration (AGENTS.md).
- [ ] **Step 5: Run the full runner:** `python3 -I tools/validate_local.py` → no suite fails.
- [ ] **Step 6: Commit:** `Record the cc27 budget for the 70 km route and the city ride`.

### Task 15: Device test pack and the one session

**Files:**
- Create: `.local/cc27-pack/` (private): `ota_1_cc27.bin`, `manifest.json`, route files R3 and t70 at 3 km with
  flags 7; switch files R3 with flags 6 (`F_OWN` off), R3 without the grey section, R3 without the elevation section
  (flags 3); `CARD.md` (approval texts as `.local/cc26-pack/CARD.md`); the cc26 restore files.
- Modify: `docs/releases/cc27-<date>.md` (the session record after the session)

- [ ] **Step 1: Check the pack on the host:** each route file passes `readSections`, `checkWayback` and the budget
  gate; the image receipt says `device_written: false`.
- [ ] **Step 2: Owner's yes, step by step:** flash `ota_1` (yes), RTS boot; storage: the new route files, and the
  removal of old test routes if free space needs it (yes).
- [ ] **Step 3: Session (about 60 min):** hypothesis, observation, duration and restore as design section 10.
  Stationary 10 min off the route at R3 and the 70 km test route, then 10 min on the route (compare `u` and `t`
  with the stock remaining distance), then a 45 min ride with a detour. Photos of the test text. Count restarts.
- [ ] **Step 4: Restore if needed:** a page switch file first (no reflash); else `restore-wb2` or the cc26 image
  from `.local/cc26-pack/`, only after the owner's yes. On a restart: keep the crash evidence; a coredump read needs
  the owner's yes.
- [ ] **Step 5: Record** the result in `docs/releases/cc27-<date>.md`. Commit only when the owner asks:
  `Record the cc27 device session`.

## Order and dependencies

Tasks 1 → 2 → 3 (map). Task 4 after 1. Tasks 5 → 6 → 7 → 8 → 9 → 10 (way-back side; Task 8 needs 2 and 4).
Tasks 11 and 12 after 6. Task 13 after 3, 9 and 10. Task 14 after 12 and 13. Task 15 last.
