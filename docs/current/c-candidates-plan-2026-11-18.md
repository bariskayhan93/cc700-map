# Device Candidates cc25 and cc26: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Start only after `docs/current/map-economy-plan-2026-11-18.md` is complete (its Task A3 files and Task B2 result are inputs here).

**Goal:** Two firmware candidates that stay on the unit and get fixes on the same base:
- **cc25:** draws map entries whose points are stored as differences (step 3, small form).
- **cc26 (on cc25):** way-back file version 2 with 8-byte nodes, a street window around the rider, at most 400 street pieces per frame (step 2).

**Architecture:** Each candidate adds code to the installed cc23 + trampoline fix image (SHA-256 `d225e179…`) and changes one literal word to reach it. The route file switches each feature on: a route without delta entries or without way-back data runs today's code. The page writes the new data only when the owner selects the new firmware choice. Every C file runs on the host first, under ASan/UBSan, with the real route files.

**Tech Stack:** Freestanding C11 (no heap except the firmware's `heap_caps_malloc`, no float in the way-back core, no library call). `~/xtensa-esp-elf/bin/xtensa-esp32s3-elf-gcc` 13.2.0 with `-Os -mlongcalls -mtext-section-literals -ffreestanding -fno-builtin -nostdlib -ffunction-sections`. Python 3 `-I` builders. Node.js `node:test`.

**Spec:** `.local/study/out/fw-study.md` (firmware facts, private), `.local/study/out/c-study.md` (B1, B2), `firmware/wayback/README.md` (way-back contract), `docs/current/budget-plan-2026-11-16.md`, `AGENTS.md`.

## How this plan keeps the unit stable (for the owner)

1. **Same code on the host first.** The drawing code and the way-back core are compiled for the Mac with address and undefined-behaviour checks. The tests feed real route files, broken files and random input. A candidate goes to the unit only when all host tests pass.
2. **Each builder changes only named bytes.** A builder accepts only the exact base image (by SHA-256), and it refuses the build if any byte outside the named ranges changes. This is how cc22 and cc23 were built.
3. **The route file is the switch.** Old routes run old code paths. If a new feature fails on the unit, you make the route again without the option. No reflash is needed for that.
4. **Limits in the code.** Time, file reads, stack and memory have fixed limits. At a limit the code stops and the unit shows the stock display.
5. **One device test for each candidate**, with the hypothesis, what to look at, the duration and the restore step written before the flash. You approve each flash.
6. **Fix forward.** A fault is analysed from the core file and fixed on the same base as cc25.1, cc25.2, and so on.

## Decisions

- **E1 delta entry:** style bit 12 (`0x1000`) marks an entry whose field-6 points are zigzag differences: point 0 from the centre (fields 3 and 4), point k from point k−1, in semicircle integers. Only classes 1 to 11 can have bit 12. Labels (12), signals (13), stops (14) and arrows/rough route (15) never have it.
- **E2 drawing:** the new iterator adds the differences in `int32` with wraparound (`uint32_t` sum), then converts to float as today. An entry without bit 12 is drawn exactly as v21.
- **E3 page choice:** a third value `patch25` of the `fw` select ("Patch cc25+"). Only `patch25` writes bit-12 entries and CCWB version 2. `patch` and the original choice write today's files.
- **E4 cc25 code place:** the free IROM tail at `0x421de800` (4,376 B usable, 1,768 B reserve stays). Reached by the iterator literal at `0x42049678` (today `0x421dcb2c`, the v21 `cc_iter`). Version text `CC700_V1.414-cc25`.
- **E5 CCWB version 2 node (8 B, one little-endian `u64`):** bits 0–18 `X/2`, bits 19–37 `Y/2` (units of 1/16 m, stored halved, so 1/8 m and at most 65.5 km on each axis), bits 38–50 `next − index` as a signed 13-bit value (0 = on the route), bits 51–63 ride distance in whole metres (0 to 8,191). The header, the cells (12 B) and the extra pieces (8 B) are as in version 1. Version 2 has no exception lists. Measured on the 70 km 3 km file: 0 `next` values out of range at 13 bits, largest distance 6,000 m.
- **E6 generator refusal:** if a node does not fit E5, the generator writes no version 2 file, and the page goes on with its existing reach fallback (2 km, then 1.5 km, then none). It never writes a partial file.
- **E7 cc26 code place:** the second code area `0x4237b134..0x42380000` (20,172 B; constants through `0x3c37b134`). The image builder moves DRAM segment 1 (`0x3fc98200`, 20,188 B) to the end of the file, extends DROM segment 0 by the code, and fills the 24 B before the IROM header with one padding segment (load address 0). The way-back adapter hook stays the `tramp_rt` literal at `0x420496b8`. Version text `CC700_V1.414-cc26`.
- **E8 street window:** 128 m cells, 5 cells wide, 5 ahead and 1 behind, turned by the map heading quadrant `round(h / 90) mod 4`. `h` is the `float` in degrees at `0x3c388d08` (written by `0x4204a504`, read by the projection at `0x4204c288`). The window refreshes when the rider's cell or the quadrant changes.
- **E9 window cache:** RTC slow memory `0x50000000`, 8,192 B: a 32 B header (magic `CCWC`, first 8 bytes of the route identity, window key, piece count, origin) and at most 1,020 pieces of 8 B (four `int16`: start X, start Y, end X, end Y, in 1/16 m from the cache origin). At a refresh the cache keeps the 1,020 pieces nearest to the rider. Measured window sizes (5 x 6, 3,000 rider points): p90 679, p99 1,080, max 1,259 pieces. A header that does not match is a refresh, never a read of old data.
- **E10 drawing of the window:** only while the off-route byte is set. Draw at most 400 pieces each frame, the nearest first (selection by a 32-bucket distance histogram, no sort). One pass, 3 px, colour `0x7a7e83`, drawn before the way-back line. Draw only pieces with both node distances 250 m or more by ride (nearer streets are in the map). The drawing stops at 60 ms after the frame start.
- **E11 limits:** stack check 3,360 B (as today), 300 ms total for the way-back work in one frame, at most 160 file reads for one window refresh. At a limit: no window this frame, the line still draws if it is ready.

## Global Constraints

- No command that opens a USB or serial device. No `esptool`, no `flash.sh`, no `run_test.py install*`. Builders write only to `.local/`.
- Edit only the files that a task names. `../cc700-patch/src/map.c` is the only file in `../cc700-patch` that this plan changes. Commit it in that repository, and do not move the `patch-v21` tag.
- Stage only the named files. Never `git add -A`, `git add .` or `git commit -a`. Never push.
- The repository is public: no coordinates, ride data or `.local/` content in committed files. Host tests use synthetic data near latitude 51, longitude 7. Real route files are read from `.local/` only by scripts that print counts.
- Docs and commit messages in ASD-STE100. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not change a number in "Decisions". If a step fails and the fix is not in this plan, stop and report. Do not weaken a test.
- Every size and count in a doc comes from a command you ran.

## Review Focus

1. **Wraparound in the point sum:** a difference that crosses ±180° longitude or the int32 limit must give the same point as the absolute value. Test in Task C1.
2. **An entry with bit 12 and 0 points, or 1 point:** no read past `pts`, no draw. Test in Task C1.
3. **A version 2 file with a `next` that points outside the node table** (delta past either end): `wb_mount` must refuse it, not walk into the next section. Test in Task D2.
4. **RTC slow memory after a reset** holds old bytes: the cache must refresh and must never draw a piece from another route. Test in Task D3 (host fills the cache with another route's header first).
5. **Heading not a number or outside 0 to 360** (sensor start-up): the quadrant must clamp to 0. Test in Task D3.

## File Structure

| File | Responsibility |
|---|---|
| `../cc700-patch/src/map.c` | `draw_entry` adds the differences when bit 12 is set (C1). |
| `tools/renderer_host.c`, `tools/test_renderer_host.py` | Host case `styles_delta` (C1). |
| `firmware/mapdelta/mapdelta.ld`, `tools/mapdelta_build.py`, `tools/test_mapdelta_build.py` | cc25 image: the new iterator in the tail and the literal change (C2). |
| `js/mapsec.js`, `js/preview.js`, `index.html`, `js/app.js`, `js/route.js` | Delta entries and the `patch25` choice (C3). |
| `js/wayback_format.js`, `tools/test_wayback_format.mjs` | CCWB version 2 encode and decode (D1). |
| `firmware/wayback/wayback.c`, `wayback.h`, `tools/test_wayback_core.mjs` | Version 2 reader (D2). |
| `firmware/wayback/wb_window.c`, `wb_window.h`, `tools/wb_window_host.c`, `tools/test_wb_window.mjs` | Window cache, selection and drawing list (D3). |
| `firmware/wayback/wb_device.c`, `wb_area2.ld`, `tools/area2_image.py`, `tools/test_area2_image.py`, `tools/cc26_build.py`, `tools/test_cc26_build.py` | cc26 adapter and image (D4, D5). |
| `docs/releases/cc25-2026-11-18.md`, `docs/releases/cc26-2026-11-18.md` | Release record and device test steps (C4, D6). |

---

## Part C: cc25 (delta map points)

> **Gate result, 18 Nov (Task B2):** the protobuf-kept delta makes the 70 km map 2,681,396 B (ratio 0.701). With 2 km way-back data the unit estimate is 4,372,849 B, above the 4,000,000 B guard. Scheme D (ratio 0.338) gives 2,720,906 B. Part C as written fits 70 km only without way-back data. **Do not start Part C until the owner chooses:** (a) Part C as written, or (b) a scheme D decoder at the `pb_decode` call 0x4204957a, which needs the decode callback 0x420492f4 mined first (this is not a Haiku task).

### Task C1: Delta drawing in `map.c`

**Files:**
- Modify: `../cc700-patch/src/map.c:198-204` (`draw_entry`)
- Modify: `tools/renderer_host.c` (new case), `tools/test_renderer_host.py`

**Interfaces:**
- Produces: `draw_entry(cb, e, sel, buf)` keeps its signature. With `e->style & 0x1000` it reads `e->pts` as differences.

- [ ] **Step 1: Add the host cases.** In `tools/renderer_host.c`: case `styles_delta` = case `styles`, but after the entries are made, each entry with class 1 to 11 gets bit 12, and its points are replaced by differences (point 0 minus the centre, point k minus point k−1, computed in `uint32_t`). Case `delta_wrap` = one class-6 entry with centre lon `2147483000` and points that cross the int32 limit. Case `delta_short` = class-6 entries with bit 12 and `cnt` 0 and 1.
- [ ] **Step 2: Add the tests** in `tools/test_renderer_host.py`:

```python
    def test_delta_entries_draw_the_same_as_absolute_entries(self):
        a, b = self.run_case('styles'), self.run_case('styles_delta')
        for k in ('trace', 'callbacks', 'draws', 'projected_points', 'painted'):
            self.assertEqual(a[k], b[k], k)
    def test_delta_sum_wraps_like_the_absolute_value(self):
        self.run_case('delta_wrap')
    def test_delta_entries_with_zero_or_one_point_are_safe(self):
        self.run_case('delta_short')
```

`delta_wrap` checks inside `renderer_host.c` that each projected float equals the float of the absolute value (`require`).

- [ ] **Step 3: Run and see the delta test fail.** Run: `CC700_PATCH_SRC=../cc700-patch/src/blk.c python3 -I -m unittest tools.test_renderer_host -v`. Expected: `test_delta_entries_draw_the_same_as_absolute_entries` FAILS (`trace` differs). The other tests PASS.
- [ ] **Step 4: Change `draw_entry`.** Keep a `uint32_t` running value for lat and lon, starting at the centre. For each point: if bit 12, add the stored value; else take it. Convert the running value (as `int32_t`) with the same `k` as today.
- [ ] **Step 5: Run all renderer tests.** Same command. Expected: all PASS.
- [ ] **Step 6: Check that v21 still rebuilds from its tag.** Run: `cd ../cc700-patch && python3 -I tools/build_patch.py patch-v21`. Expected: exit 0 (the tag is unchanged).
- [ ] **Step 7: Commit both repositories.** In `../cc700-patch`: `git add src/map.c`, message "Add the running sum for map entries with style bit 12". In this repository: `git add tools/renderer_host.c tools/test_renderer_host.py`, message "Test delta map entries against absolute entries on the host".

### Task C2: cc25 image builder

**Files:**
- Create: `firmware/mapdelta/mapdelta.ld`, `tools/mapdelta_build.py`, `tools/test_mapdelta_build.py`

**Interfaces:**
- Consumes: `../cc700-patch/src/map.c` (Task C1), `cc700-backup/tools/espimg.py` (as `tools/wayback_device_build.py` loads it).
- Produces: `build_candidate(base: bytes, sections: dict, fragment_read) -> bytes` and the CLI `python3 -I tools/mapdelta_build.py --base .local/mining/ota_1_cc23trampfix.bin --output .local/cc25`. Output: `ota_1_cc25.bin` and `manifest.json` (base SHA, map.c SHA, section addresses and sizes, output SHA).

Copy the structure of `tools/wayback_device_build.py`. The differences:

| Item | Value |
|---|---|
| Accepted base | only `d225e17970940be7b153c524aebcfc60f4ca7ae8cd74696ef2282396e461ce04` |
| Code | `map.c` compiled with entry `cc_iter`, `--gc-sections`, linked at `0x421de800` |
| Scopes | `.text` at `0x421de800`, at most 4,376 B with `.rodata`; `.rodata` through the `0x3c` alias, as in `../cc700-patch/src/patch.ld`; one literal word at `0x42049678` |
| Literal check | the base word at `0x42049678` is `0x421dcb2c` |
| Version | `CC700_V1.414-cc25` |
| Writable data | `SIZEOF(.data) + SIZEOF(.bss) == 0` (linker assert) |

- [ ] **Step 1: Write the failing tests** in `tools/test_mapdelta_build.py`: (a) a wrong base SHA raises `ValueError`; (b) the output differs from the base only in `0x421de800..end of .rodata`, `0x42049678..+4`, the version text, the checksum and the digest; (c) the new literal is the ELF address of `cc_iter`; (d) code plus constants are at most 4,376 B; (e) `xtensa-esp32s3-elf-nm -u` of the ELF is empty.
- [ ] **Step 2: Run and see them fail.** Run: `python3 -I -m unittest tools.test_mapdelta_build -v`. Expected: FAIL, the module is missing.
- [ ] **Step 3: Write `mapdelta.ld` and `mapdelta_build.py`.**
- [ ] **Step 4: Run the tests.** Expected: all PASS. Write the code size in the commit message.
- [ ] **Step 5: Build the candidate.** Run the CLI above. Expected: exit 0, `manifest.json` with `device_written: false`.
- [ ] **Step 6: Commit** `firmware/mapdelta/mapdelta.ld tools/mapdelta_build.py tools/test_mapdelta_build.py`, message "Build cc25: the map iterator with delta entries in the IROM tail".

### Task C3: Page writes delta entries for `patch25`

**Files:**
- Modify: `index.html` (the `fw` select), `js/app.js:29-43` and `js/app.js:81-100`, `js/route.js` (pass `map.delta`), `js/mapsec.js` (`sentry`), `js/preview.js` (`readFile` sums bit-12 points)
- Test: `tools/test_map_contract.mjs`, `tools/test_preview.mjs`, `tools/test_app_offline.mjs`

**Interfaces:**
- Produces: `buildRoute(..., {map: {styled: true, delta: true}})` writes bit-12 entries for classes 1 to 11. `readFile` returns absolute points for both kinds.

- [ ] **Step 1: Write the failing tests.** In `tools/test_map_contract.mjs`: `delta entries decode to the same points as absolute entries` (build the same route with `delta: false` and `delta: true`; `readFile` blocks are deep-equal after the style bit 12 is cleared; the delta file is smaller). `labels, signals and arrows never get bit 12`. In `tools/test_app_offline.mjs`: the `fw` select has the value `patch25`, and `patch25` sets `styled` and `delta`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** `sentry(style, pts, delta)`: with `delta` and class 1 to 11, set `0x1000` and write `fs(1, sc(q[0]) - sc(prev[0]))`, `fs(2, ...)`, computed with `| 0` wraparound to int32. `styled = fw.startsWith('patch')`, `delta = fw === 'patch25'`. The `patch25` option text: "Patch cc25+ (kleinere Karte)". `localStorage` keeps `patch25` like `patch`.
- [ ] **Step 4: Run** `node --test` on the tests of Task A2 Step 8 of the earlier plan plus `tools/test_app_offline.mjs`. Expected: all PASS.
- [ ] **Step 5: Measure.** Build `t70.gpx` with `delta` on (add a `DELTA=1` env switch to `.local/study/m90/build.mjs` that sets `map.delta`). Write the map bytes beside the Task B2 `pbDelta` number. They must agree within 1%. If not, stop and report.
- [ ] **Step 6: Commit** the named files, message "Write delta map entries for the cc25 firmware choice".

### Task C4: cc25 release record and device test steps

**Files:** Create `docs/releases/cc25-2026-11-18.md`.

- [ ] **Step 1:** Write it with: what changed, image SHA-256 and size (from `manifest.json`), host test commands and results, and this device test:
  - **Hypothesis:** cc25 draws a delta route exactly as cc23 draws the same route without delta, and an old route as before.
  - **Observation:** the owner opens route 1 (made with `patch`) and route 2 (the same GPX, made with `patch25`), each for 2 minutes, stationary, then rides 10 minutes on route 2. Photos of the same place on both. No restart. `/ABNORMAL/` is empty after the test.
  - **Duration:** 30 minutes.
  - **Restore:** install `.local/mining/ota_1_cc23trampfix.bin` (`d225e179…`); delete route 2.
- [ ] **Step 2: Commit** the doc. Do not flash. The owner approves the flash in chat.

---

## Part D: cc26 (way-back version 2 and the street window), on cc25

### Task D1: CCWB version 2 in the generator

**Files:** Modify `js/wayback_format.js`, `tools/wayback_format.mjs` (re-export), `tools/wayback_build.mjs` (`--format 2`), `js/wayback.js` (format 2 for `patch25`). Test: `tools/test_wayback_format.mjs`, `tools/test_wayback_page.mjs`.

**Interfaces:**
- Produces: `encodeWaybackV2(model, routeId) -> Uint8Array` (throws `Error('node does not fit version 2: <field>')` per E6), and `decodeWayback(bytes)` reads versions 1 and 2. Version 2 nodes decode to `{X, Y, next, distDm}` with `X`, `Y` even and `distDm` a multiple of 10.

- [ ] **Step 1: Failing tests:** round trip of `gridFixture()` (positions within 1 unit, distances within 5 dm, `next` exact); a node 70 km east throws `/X/`; a distance of 9,000 m throws `/dist/`; a `next` 5,000 indexes away throws `/next/`; the file size is `64 + 12 * (cells + 1) + 8 * nodes + 8 * extras`.
- [ ] **Step 2 to 4:** run (fail), implement, run (pass).
- [ ] **Step 5: Measure.** Add `--format 2` to `.local/study/m90/wb70.mjs` (it made `t70-v0.ccwb` and `t70-v0k3.ccwb` from `.local/study/var/`), and rebuild both reaches. Expected sizes: 916,812 B and 1,401,584 B (from the B1 counts). Write the sizes in the commit message.
- [ ] **Step 6: Commit.**

### Task D2: Version 2 reader in the C core

**Files:** Modify `firmware/wayback/wayback.c`, `wayback.h`, `firmware/wayback/README.md` (format section). Test: `tools/test_wayback_core.mjs`, `tools/test_wayback_replay.mjs`.

**Interfaces:**
- `wb_mount` accepts version 2 only. Version 1 returns 0 (the cc26 unit ignores old way-back data; the stock display stays).
- `#define WB_NODE_BYTES 8u`. `node_parse` reads one `u64` per E5. `X = 2 * field`.

- [ ] **Step 1: Failing tests:** all existing core tests run on a version 2 file of the same fixture; the line points are within 2 units and `distance_dm` within 6 of the version 1 result; a file whose `next` delta points before node 0 or past the last node is refused by `wb_mount` (Review Focus 3); a version 1 file is refused.
- [ ] **Step 2 to 4:** run (fail), implement, run (pass). Do not check all nodes in `wb_mount` (that reads the whole file). Check the `next` range in `load_node`, and return `WB_READ` when it is out of range. For Review Focus 3, `wb_mount` refuses the file when the first or the last node record has an out-of-range `next`, and the walk refuses any other one.
- [ ] **Step 5: Replay equivalence on the private 70 km file.** Run `node tools/wayback_replay.mjs` for version 1 and version 2 on the 1,500 rider points of `detour.mjs` part 4. Expected: the same state for each point, the same point count, the distance within 1 m. Write the counts in `.local/study/out/c-study.md`.
- [ ] **Step 6: Size.** Run `python3 -I tools/wayback_size.py`. Write the bytes.
- [ ] **Step 7: Commit.**

### Task D3: Street window

**Files:** Create `firmware/wayback/wb_window.h`, `wb_window.c`, `tools/wb_window_host.c`, `tools/test_wb_window.mjs`.

**Interfaces:**

```c
typedef struct { int16_t ax, ay, bx, by; } wbw_piece;            /* 1/16 m from the cache origin */
typedef struct { uint32_t magic, route8[2], key, count, origin_x, origin_y, reserved; wbw_piece p[1020]; } wbw_cache;  /* 8,192 B */
int  wbw_refresh(wb_engine *, wbw_cache *, int32_t lat_e7, int32_t lon_e7, float heading_deg, uint32_t max_reads); /* 1 = ok */
uint32_t wbw_select(const wbw_cache *, int32_t lat_e7, int32_t lon_e7, uint16_t *out, uint32_t max); /* nearest first, max 400 */
int  wbw_piece_e7(const wb_engine *, const wbw_cache *, uint32_t index, int32_t a[2], int32_t b[2]);
```

- `_Static_assert(sizeof(wbw_cache) == 8192, ...)`.
- `wbw_refresh` reads the cells of E8, keeps tree pieces (node → next) and extra pieces whose both ends have a ride distance of 250 m or more, keeps the 1,020 nearest (32-bucket histogram), and writes the header last.
- The quadrant: `h` not finite, or outside 0 to 360, gives quadrant 0 (Review Focus 5).

- [ ] **Step 1: Failing tests** (host command, JSON output, like `tools/wayback_host.c`): (a) a cache with another route's header refreshes (Review Focus 4); (b) a rider on a synthetic grid gets every piece of the 5 x 6 window; (c) `wbw_select` returns at most 400 indexes, sorted into nearer-first buckets; (d) with `max_reads` 5 the refresh returns 0 and the header stays invalid; (e) NaN and 720 degrees give quadrant 0; (f) the private 70 km file: refresh reads p50, p90 and max on the 3,000 rider points, and the share of refreshes that hit 1,020 pieces.
- [ ] **Step 2 to 4:** run (fail), implement, run (pass) under ASan/UBSan.
- [ ] **Step 5: Gate on the private file:** refresh reads p90 at most 160 (E11). If not, stop and report.
- [ ] **Step 6: Commit.**

### Task D4: Second code area in the image

**Files:** Create `tools/area2_image.py`, `tools/test_area2_image.py`.

**Interfaces:** `add_area2(base: bytes, code: bytes) -> bytes`. Refuses a base that is not cc25 (`manifest.json` SHA of Task C2) or code longer than 20,172 B.

- [ ] **Step 1: Failing tests:** with 0 B code, the output parses with `espimg.read` into 6 segments: DROM (same start, data equal to the base for its first 1,683,732 B), padding (load address 0, 16 B), IROM (same address, same data, file offset ≡ 0x20 mod 65,536), DRAM `0x3fc9d0dc`, IRAM, DRAM `0x3fc98200` (data equal to the base). With 20,172 B code, the DROM segment ends at `0x3c380000` and holds the code at `0x3c37b134`. 20,173 B raises `ValueError`. Checksum and digest are valid (`espimg.build` round trip).
- [ ] **Step 2 to 4:** run (fail), implement, run (pass).
- [ ] **Step 5: Commit.**

### Task D5: cc26 adapter and image

**Files:** Modify `firmware/wayback/wb_device.c`. Create `firmware/wayback/wb_area2.ld`, `tools/cc26_build.py`, `tools/test_cc26_build.py`. Modify `tools/wayback_device_host.c`, `tools/test_wayback_device.mjs`.

- The adapter does what `firmware/wayback/README.md` "Device adapter" says, with these changes: no `wb3` text on the route; no screen text except the distance next to the line; the cache at `0x50000000`; heading from `0x3c388d08`; window drawn per E10 before the line; limits per E11.
- `wb_area2.ld`: text at `0x4237b134`, constants through `0x3c37b134`, at most 20,172 B, no writable data.
- `cc26_build.py`: base = cc25 output; replaces the literal at `0x420496b8` with the adapter entry; calls `add_area2`; version text `CC700_V1.414-cc26`.

- [ ] **Step 1: Failing tests:** the adapter host tests of `tools/test_wayback_device.mjs` pass against the new adapter (stack gate, lock busy, no file, read failure, 300 ms limit); new: the window draws at most 400 pieces, draws nothing on the route, stops at 60 ms (host clock fixture); `test_cc26_build.py`: only the named ranges change, `nm -u` is empty, the size is printed.
- [ ] **Step 2 to 4:** run (fail), implement, run (pass).
- [ ] **Step 5: Build** to `.local/cc26/`. `device_written: false`.
- [ ] **Step 6: Commit.**

### Task D6: cc26 release record and device test steps

**Files:** Create `docs/releases/cc26-2026-11-18.md`.

- [ ] **Step 1:** Write it as Task C4, with this device test:
  - **Hypothesis:** cc26 boots, runs code from the second area, and draws the window and the line off route inside 300 ms.
  - **Observation:** boot; open an old route (no way-back data) for 2 minutes; open a `patch25` route with way-back data; ride 15 minutes with two planned detours. Photos with the distance text. No restart; `/ABNORMAL/` empty.
  - **Duration:** 45 minutes.
  - **Restore:** install cc25 (`ota_1_cc25.bin`) over USB with the existing install step. If cc26 does not boot, the USB install still works: the bootloader and the USB download mode are not changed by cc26.
- [ ] **Step 2: Commit.** Do not flash.

---

## Not in this plan

- Scheme D (map points without protobuf framing). It needs a new decoder in place of `pb_decode` at `0x420494d0`. Only if Task C3 Step 5 shows that 70 km does not fit.
- The stock log writer for refusal codes (the cc24 diagnostic used `0x421434dc`). Its contract is not mined. Until then the adapter shows its codes nowhere in a release image.
