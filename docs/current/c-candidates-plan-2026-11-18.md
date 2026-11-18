# Device Candidates cc25 and cc26: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two firmware candidates that stay on the unit and get fixes on the same base:
- **cc25:** a compact map block format (scheme D). The 70 km map becomes 0.34 of today's size.
- **cc26 (on cc25):** way-back file version 2 with 8-byte nodes, a street window around the rider, at most 400 street pieces per frame.

**Architecture (owner rule: minimal hooks, small modules, no bloat):** each candidate is **one hook word plus one small C module**. cc25 replaces the literal of the stock map-entries decode callback (one word). The module decodes a scheme D block into exactly the structures the stock decoder makes, so the drawing code, the free code and the budgets do not change. Old blocks go on to the stock callback. The route file is the switch: a route without the new data runs today's code.

**Tech Stack:** Freestanding C11 (no float, no library call; memory only through the firmware's `heap_caps_malloc`). `~/xtensa-esp-elf/bin/xtensa-esp32s3-elf-gcc` 13.2.0, `-Os -mlongcalls -mtext-section-literals -ffreestanding -fno-builtin -nostdlib -ffunction-sections`. Python 3 `-I` builders. Node.js `node:test`.

**Spec:** `.local/study/out/fw-study.md` sections 2 and 8 (stock decode path, private), `.local/study/out/c-study.md` (B1, B2), `firmware/wayback/README.md`, `docs/current/budget-plan-2026-11-16.md`, `AGENTS.md`.

## How this plan keeps the unit stable (for the owner)

1. **The same C runs on the Mac first**, with address and undefined-behaviour checks, on every block of real route files, on broken files and on random bytes.
2. **Exact comparison:** for each real block, the module's output must equal the stock decoder's structures (style, centre, count, every point), byte for byte.
3. **Each builder changes only named bytes** of one exact base image, as for cc22 and cc23.
4. **The route file is the switch.** Old routes use the stock path. If the new path fails, make the route again with the old firmware choice. No reflash.
5. **A fault in the data never crashes the unit:** the module checks every length, and on any error it leaves an empty, consistent block (nothing drawn there).
6. **One device test for each candidate** with hypothesis, observation, duration and restore, approved by you. Then fixes go on the same base (cc25.1, cc25.2 …).

## Stock facts this plan uses (mined 18 Nov, `fw-study.md` section 8)

- Block load `0x420494d0` (kind 1 path `0x4204959c`): reads the block, frees the old entries (each `pts`, then the array at `0x3fc9fbe8`, which it sets to 0), clears the message struct `0x3c3887bc` (12 B: count, callback, argument), sets the entries callback from the literal `0x4203e3ec` (value `0x42049368`, used once), calls `pb_decode` (`0x4203a8e0`) with descriptor `0x3c1ee408`, then writes header `0x3c3887d4` +20 = count (only if count ≠ 0) and +28 = loaded.
- Entries callback `0x42049368(stream, field, void **arg)`, `*arg` = header: allocates the array once (`28 × count`, caps `0x404`, zeroed) at `0x3fc9fbe8` and header +24; decodes one entry into `0x3c3887a0`; copies 20 B to `array + 24 × n`. The point callback allocates `pts` = `8 × cnt` and copies 8 B per point. It returns true.
- Entry record (24 B stride): `n, style, lat, lon, cnt, pts` (`ent_t` in `../cc700-patch/src/fw.h`).
- Stream: `{callback, state, bytes_left, errmsg}`; a buffer stream has callback `0x421cfe20` and `state` = current byte pointer.
- Descriptors: block = fields 1 (uvarint) and 2 (callback); entry = fields 1 to 6; point = fields 1 and 2. An unknown field is skipped.
- Stock faults that the new path avoids: no check of `n` against the count; a block with count 0 leaves header +20/+24 at the freed old entries. No real build has an empty block today (0 of 75, 4 and 104 blocks).

## Decisions

- **E1 scheme D block (version 1).** The outer message stays protobuf, so stock code reads it without fault:
  `field 1 = N` (N ≥ 1), then **one** `field 2` record whose bytes are `08 00 10 00 28 00 7A` + `uvarint(len)` + payload.
  The stock entry decoder reads this as entry 0 (n 0, style 0, cnt 0) and skips field 15 (`7A`). So **old firmware draws an empty block and does not crash**.
- **E2 payload:** `01` (version) `uvarint N`, then N entries: `uvarint style`, `uvarint cnt`, `zz(centre lat − previous centre lat)`, `zz(centre lon − previous centre lon)` (previous = 0 for entry 0), then `cnt` pairs: for class 12 (labels) the two raw words as `zz`; for every other class `zz(point − previous point)`, previous = the centre for point 0. All in int32 with wraparound. `zz` = zigzag 32-bit, varints at most 5 bytes.
- **E3 empty block:** N = 1 with one entry `style 0, cnt 0, centre 0,0`. The new format never writes count 0.
- **E4 module `mapdec` (cc25):** `int cc_entries(pb_istream_t *s, const void *field, void **arg)` at `0x421de800` (IROM tail, at most 1,024 B of the 4,376 B usable; the 1,768 B reserve stays). Hook: the literal `0x4203e3ec` → `cc_entries`. Version text `CC700_V1.414-cc25`. Rules:
  1. If `s->callback != 0x421cfe20`, or the bytes do not start with the E1 prefix, tail-call the stock `0x42049368`.
  2. Else decode the payload directly from `s->state`, check `version == 1` and `N == *(uint32_t *)0x3c3887bc`.
  3. Allocate the array exactly as stock (`28 × N`, caps `0x404`, zeroed), store it at `0x3fc9fbe8` and header +24. For each entry, allocate `pts` = `8 × cnt` (none when cnt = 0) and fill `n = i, style, lat, lon, cnt, pts`.
  4. Limits: `cnt ≤ 4096`, and before each allocation `bytes_left ≥ 2 × cnt`. Every varint read checks the end.
  5. On a data error: stop, keep the entries made so far (the rest stay zero), consume the rest, return false.
  6. On an allocation failure: set header +20 = 0, header +24 = 0, `0x3fc9fbe8` = 0 and the message count = 0, then return false. The stock iterator and free loop then see an empty block.
  7. On success: `s->state += bytes_left; s->bytes_left = 0;` return true.
- **E5 page choice:** a third value `patch25` of the `fw` select ("Patch cc25+"). Only `patch25` writes scheme D blocks (and, in cc26, way-back version 2). The other two choices write today's files.
- **E6 one codec module on the page:** `js/map_codec.js` has `encodeBlockD(entries)` and `decodeBlockD(bytes)`. The generator, `preview.js` `readFile` and `map_budget.js` `auditMapSection` use it. The budgets stay as today (the serialized-byte check uses today's protobuf size, which is larger, so it is conservative).
- **E7 CCWB version 2 node (cc26), 8 B, one little-endian `u64`:** bits 0–18 `X/2`, bits 19–37 `Y/2` (1/16 m units, stored halved: 1/8 m, at most 65.5 km on each axis), bits 38–50 `next − index` as signed 13 bits (0 = on the route), bits 51–63 ride distance in whole metres (0 to 8,191). Header, cells (12 B) and extras (8 B) as version 1; no exception lists. Measured on the 70 km 3 km file: 0 `next` out of range, largest distance 6,000 m. A node that does not fit: no version 2 file (the page goes on with its reach fallback).
- **E8 cc26 code place:** the second code area `0x4237b134..0x42380000` (20,172 B, constants through `0x3c37b134`). The image builder moves DRAM segment 1 to the file end, extends DROM segment 0 by the code, and adds one 16 B padding segment (load address 0). Hook: the existing way-back literal `0x420496b8`. Version text `CC700_V1.414-cc26`.
- **E9 street window and line cache (cc26):** 128 m cells, 5 wide, 5 ahead, 1 behind, turned by the quadrant of the map heading (`float` degrees at `0x3c388d08`; NaN or outside 0 to 360 gives 0). Cache: RTC slow memory `0x50000000`, 8,192 B = 32 B header (magic, route identity 8 B, window key, count, origin) + a line store (piece id, point count, 32 points as `int32` E7 pairs: 264 B) + at most 640 pieces of 12 B (four `int16` positions in 1/16 m from the origin, `u32` piece id = node index of a tree piece, or extra index with bit 31). A header that does not match means a refresh.
  Each off-route frame: (1) find the nearest cached piece within 15 m (no file read); (2) if its id equals the line store id, reuse the stored points 1 to n and compute only point 0; (3) else run the core from that piece (`wb_tick_piece`, no cell search) and store the new line; (4) if no cached piece is within 15 m, refresh the window, then go on as (1). The file is opened only in (3) and (4).
  Drawing, only off route: at most 400 nearest pieces with both node distances 250 m or more, one pass 3 px `0x7a7e83`, before the line; stop at 60 ms. Limits: stack 3,360 B, 300 ms way-back work per frame, 160 reads per refresh.
  Evidence (17 Nov ride, 509 fixes, 440 with a line): the line used the same nodes as at the fix before in 278 frames (63%). Today each of these frames reads 179 times (median).

## Global Constraints

- No command that opens a USB or serial device (`esptool`, `flash.sh`, `run_test.py install*`). Builders write only to `.local/`.
- Do not edit `../cc700-patch`. Edit only the files that a task names.
- Stage only the named files. Never `git add -A`, `git add .` or `git commit -a`. Commit to `main`. Never push.
- Public repository: no coordinates, ride data or `.local/` content in committed files. Host tests use synthetic data near latitude 51, longitude 7. Real route files are read from `.local/` by scripts that print counts only.
- Docs and commit messages in ASD-STE100. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not change a number in "Decisions". If a step fails and the fix is not in this plan, stop and report. Do not weaken a test.
- Every size and count in a doc comes from a command you ran.

## Review Focus

1. **Truncated payload in the middle of a varint, a point list or an entry header:** no read past the end; the block stays consistent. Test in Task C2 (every truncation length of a real block).
2. **N in the payload differs from field 1:** refused. Test in Task C2.
3. **Wraparound:** differences across the int32 limit give the exact absolute value. Test in Tasks C1 and C2.
4. **An old-format block after a scheme D block and the other way round:** the free and the next decode work (no stale array, no double free). Test in Task C2 with a host model of the load sequence.
5. **Label words** (class 12) round-trip exactly, also words that are negative as int32. Test in Tasks C1 and C2.

## File Structure

| File | Responsibility |
|---|---|
| `js/map_codec.js`, `tools/test_map_codec.mjs` | `encodeBlockD`, `decodeBlockD` (C1). |
| `js/mapsec.js`, `js/preview.js`, `js/map_budget.js`, `js/route.js`, `js/app.js`, `index.html`, `sw.js` | Use the codec for `patch25` (C1, C3). |
| `firmware/mapdec/mapdec.h`, `mapdec.c`, `mapdec.ld`, `README.md` | The cc25 module and its contract (C2). |
| `tools/mapdec_host.c`, `tools/test_mapdec.mjs` | Host build, exact compare, truncation and random tests (C2). |
| `tools/cc25_build.py`, `tools/test_cc25_build.py` | cc25 image (C4). |
| `docs/releases/cc25-2026-11-18.md` | Release record and device test steps (C5). |
| Part D files | As listed in each Part D task. |

---

## Part C: cc25 (scheme D map blocks)

### Task C1: Page codec

**Files:** Create `js/map_codec.js`, `tools/test_map_codec.mjs`. Modify `tools/validate_local.py` (add the test to the node list), `sw.js` (add `js/map_codec.js` to `FILES`).

**Interfaces:**
- `encodeBlockD(entries) -> number[]`: `entries` = array of `{style, lat, lon, pts}` (`lat`, `lon` int32 semicircles; `pts` = array of `[a, b]` int32 pairs; for class 12 the pairs are the label words). Returns the whole outer message bytes of E1 (field 1, field 2 with prefix and payload). An empty array gives the E3 block.
- `decodeBlockD(bytes) -> entries | null`: `null` when the bytes are not an E1 block. Throws `Error('scheme D: <reason>')` on a bad payload.
- `isBlockD(bytes) -> boolean`.

- [ ] **Step 1: Failing tests:** round trip of random entries (seed fixed: 200 entries, styles of every class 1 to 15, counts 0 to 60, coordinates across the int32 limit, label words negative); `decodeBlockD` of a protobuf block returns `null`; every truncation of an encoded block throws; a payload N that differs from field 1 throws; the empty array round-trips to one `style 0` entry; the first 9 bytes after the field-2 key and length are `08 00 10 00 28 00 7A` + length.
- [ ] **Step 2: Run:** `node --test tools/test_map_codec.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** E1, E2, E3 with `uv`, `zz` from `js/pb.js`. Use `| 0` for the int32 wraparound.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Size check on the real 70 km build:** convert every block of `.local/study/out/t70S1.bin` with the codec (a 20-line script in `.local/study/`). Expected: total within 2% of 1,293,208 B (B2 `D_exact`). Write the number in the commit message.
- [ ] **Step 6: Commit.**

### Task C2: The `mapdec` module on the host

**Files:** Create `firmware/mapdec/mapdec.h`, `mapdec.c`, `firmware/mapdec/README.md`, `tools/mapdec_host.c`, `tools/test_mapdec.mjs`.

**Interfaces:**

```c
/* mapdec.h */
typedef struct { uint32_t n, style; int32_t lat, lon; uint32_t cnt; int32_t *pts; } md_ent;   /* = ent_t, 24 B */
typedef struct pb_istream_s { int (*callback)(struct pb_istream_s *, uint8_t *, uint32_t); const uint8_t *state; uint32_t bytes_left; const char *errmsg; } pb_istream_t;
int cc_entries(pb_istream_t *s, const void *field, void **arg);   /* E4 */
```

Device addresses come from macros in `mapdec.c` (`MD_BUF_READ 0x421cfe20`, `MD_STOCK_CB 0x42049368`, `MD_MSG 0x3c3887bc`, `MD_ARRAY 0x3fc9fbe8`, `MD_MALLOC 0x403763e0`, caps `0x404`). With `-DHOST` they map to host variables and stubs, as `tools/wayback_device_host.c` does.

`tools/mapdec_host.c` models the stock load sequence: free the old entries as `0x4204944c` does, clear the message, call `cc_entries` (or a host model of the stock callback for protobuf blocks), then set header +20 and +28 as `0x42049655..0x42049660` does. It prints JSON: entries (style, lat, lon, cnt, points), live allocations, errors.

- [ ] **Step 1: Failing tests** in `tools/test_mapdec.mjs` (build with `cc -std=c11 -O1 -g -DHOST -fsanitize=address,undefined -fno-sanitize-recover=all`):
  - **Exact compare:** for every block of `.local/study/out/cityS1.bin` and `.local/study/out/t70S1.bin` (skip with a message when the files are absent), encode with `encodeBlockD` (from the JS parse of the protobuf block) and decode with the host module. The entries equal the JS parse of the protobuf block field by field. Print the block count compared.
  - **Synthetic exact compare** (always runs): the random entries of Task C1.
  - **Truncation:** every length from 0 to the full size of three real blocks (or synthetic ones): no sanitizer error, and the header is consistent (array null and count 0, or array with N zeroed-or-filled entries).
  - **Random bytes after the prefix:** 10,000 cases, fixed seed: no sanitizer error.
  - **Allocation failure** at the array and at the k-th `pts`: E4 rule 6 holds; no leak.
  - **Sequence:** protobuf block → D block → protobuf block → D block: no leak, no double free (host allocator counts).
  - **Fallback:** a protobuf block reaches the stock-model callback; a stream with another `callback` reaches it too.
- [ ] **Step 2: Run:** `node --test tools/test_mapdec.mjs`. Expected: FAIL (sources missing).
- [ ] **Step 3: Implement** `mapdec.c` to E4. No writable globals. No float.
- [ ] **Step 4: Run** again. Expected: PASS, with the compared block count printed.
- [ ] **Step 5: Size:** compile for Xtensa with entry `cc_entries` and `--gc-sections`. Expected: at most 1,024 B, `nm -u` empty. Write the size in `firmware/mapdec/README.md`.
- [ ] **Step 6: README:** normal behaviour, admission (E1 prefix, version, N), unavailable state (stock path), fallback (rule 5 and 6), restoration (an old-format route).
- [ ] **Step 7: Commit.**

### Task C3: The page writes scheme D for `patch25`

**Files:** Modify `index.html` (`fw` select), `js/app.js:29-43` and `:81-100`, `js/route.js` (pass `map.codec`), `js/mapsec.js:285` and `:469` (block assembly), `js/preview.js` (`readFile`), `js/map_budget.js` (`auditMapSection`). Test: `tools/test_map_contract.mjs`, `tools/test_preview.mjs`, `tools/test_app_offline.mjs`, `tools/test_map_budget.mjs`.

- [ ] **Step 1: Failing tests:** the same route built with `codec: 'd'` and without gives deep-equal `readFile` blocks and the same `auditMapSection` costs except the serialized bytes; the D file is smaller; `patch25` exists, saves to `localStorage`, and sets `styled` and `codec: 'd'`; an empty block in D mode is the E3 block.
- [ ] **Step 2: Run** and see the failures.
- [ ] **Step 3: Implement.** In the block assembly: with `opt.codec === 'd'`, parse each entry body (`parse` from `js/pb.js`) to `{style, lat, lon, pts}` and call `encodeBlockD`. Else today's code. `readFile` and `auditMapSection`: `isBlockD` first, then today's parser.
- [ ] **Step 4: Run** the map test list of the earlier plan (Task A2 Step 8) plus the new tests. Expected: all PASS.
- [ ] **Step 5: Measure:** build `t70.gpx` with `codec: 'd'` (env `CODEC=d` in `.local/study/m90/build.mjs`). Write the file size. Expected: map within 2% of Task C1 Step 5.
- [ ] **Step 6: Commit.**

### Task C4: cc25 image

**Files:** Create `firmware/mapdec/mapdec.ld`, `tools/cc25_build.py`, `tools/test_cc25_build.py`.

Copy the structure of `tools/wayback_device_build.py`:

| Item | Value |
|---|---|
| Base | only `d225e17970940be7b153c524aebcfc60f4ca7ae8cd74696ef2282396e461ce04` (cc23 + trampoline fix) |
| Code | `mapdec.c`, entry `cc_entries`, at `0x421de800`, text + constants ≤ 1,024 B, constants through the `0x3c` alias as in `../cc700-patch/src/patch.ld` |
| Hook | the word at `0x4203e3ec`: base value `0x42049368`, new value = address of `cc_entries` |
| Called entries | `0x42049368` and `0x403763e0` must begin with an `entry` instruction |
| Version | `CC700_V1.414-cc25` |
| Output | `.local/cc25/ota_1_cc25.bin`, `manifest.json` with `device_written: false` |

- [ ] **Step 1: Failing tests:** wrong base refused; only `0x421de800..end`, `0x4203e3ec..+4`, the version text, the checksum and the digest change; the hook word is the ELF address of `cc_entries`; `nm -u` empty; size ≤ 1,024 B.
- [ ] **Step 2 to 4:** run (fail), implement, run (pass).
- [ ] **Step 5: Build** the candidate.
- [ ] **Step 6: Commit** the three files.

### Task C5: cc25 release record and device test

**Files:** Create `docs/releases/cc25-2026-11-18.md`.

- [ ] **Step 1:** Write: what changed, image SHA-256 and size, host test results, and the device test:
  - **Hypothesis:** cc25 draws a scheme D route as cc23 draws the same route in today's format, and old routes as before.
  - **Observation:** route 1 = a GPX made with `patch`; route 2 = the same GPX made with `patch25`. Open each for 2 minutes, stationary, same place, photos. Ride 10 minutes on route 2 through two block changes. No restart; `/ABNORMAL/` empty.
  - **Old-firmware check (before the flash, on the installed image):** open route 2 for 1 minute. Expected: the map area is empty, no restart. This proves E1 on the stock decoder.
  - **Duration:** 35 minutes.
  - **Restore:** install `.local/mining/ota_1_cc23trampfix.bin` (`d225e179…`); delete route 2.
- [ ] **Step 2: Commit.** Do not flash. The owner approves each device step in chat.

---

## Part D: cc26 (way-back version 2 and street window), on cc25

Each task follows the same pattern: failing host tests first (ASan/UBSan), then the code, then a size check and a commit.

### Task D1: CCWB version 2 in the generator
Files: `js/wayback_format.js`, `tools/wayback_build.mjs` (`--format 2`), `js/wayback.js` (version 2 for `patch25`), tests `tools/test_wayback_format.mjs`, `tools/test_wayback_page.mjs`. `encodeWaybackV2(model, routeId)` per E7; it throws `Error('node does not fit version 2: <field>')`. Tests: round trip (positions within 1 unit, distance within 5 dm), refusals for X, distance and `next`, file size `64 + 12 × (cells + 1) + 8 × nodes + 8 × extras`. Measure: 2 km and 3 km sizes from `.local/study/m90/wb70.mjs` with `--format 2`; expected 916,812 B and 1,401,584 B.

### Task D2: Version 2 reader in the C core
Files: `firmware/wayback/wayback.c`, `wayback.h`, `README.md`, tests `tools/test_wayback_core.mjs`, `tools/test_wayback_replay.mjs`. `wb_mount` accepts version 2 only. `node_parse` reads one `u64`. `load_node` refuses a `next` out of range (`WB_READ`). Tests: the existing core tests on version 2 files (points within 2 units, distance within 6 dm of version 1); out-of-range `next` refused; version 1 refused. Replay on the 1,500 rider points: same state and point count, distance within 1 m.

### Task D3: Street window module
Files: `firmware/wayback/wb_window.h`, `wb_window.c`, `tools/wb_window_host.c`, `tools/test_wb_window.mjs`.

```c
typedef struct { int16_t ax, ay, bx, by; uint32_t id; } wbw_piece;                     /* 12 B */
typedef struct { uint32_t id, n; int32_t pt[32][2]; } wbw_line;                        /* 264 B */
typedef struct { uint32_t magic, route8[2], key, count, origin_x, origin_y, reserved;
                 wbw_line line; wbw_piece p[640]; } wbw_cache;                          /* <= 8,192 B */
int wbw_refresh(wb_engine *, wbw_cache *, int32_t lat_e7, int32_t lon_e7, float heading_deg, uint32_t max_reads);
int wbw_nearest(const wbw_cache *, int32_t lat_e7, int32_t lon_e7, uint32_t *index);   /* 1 = a piece within 15 m */
uint32_t wbw_select(const wbw_cache *, int32_t lat_e7, int32_t lon_e7, uint16_t *out, uint32_t max);
```

`wb_tick_piece(wb_engine *, const wb_input *, uint32_t piece_id, wb_output *)` is added to `wayback.c`: the same result as `wb_tick` for that piece, without the cell search.

Tests: another route's header refreshes; every piece of the 5 × 6 window on a synthetic grid; at most 400 selected, nearer buckets first; `max_reads` 5 fails with the header invalid; NaN and 720 degrees give quadrant 0; `wb_tick_piece` gives the same line as `wb_tick` on every rider point of the fixture; on the private 70 km file, refresh reads p90 ≤ 160; on the 17 Nov ride (`.local/study/out/linechange.mjs` inputs), the frames that reuse the line store are at least 60%, and the mean reads per frame are written to `c-study.md`.

### Task D4: Second code area in the image
Files: `tools/area2_image.py`, `tools/test_area2_image.py`. `add_area2(base, code) -> bytes` per E8. Tests: 6 segments; DROM, IROM, IRAM and both DRAM segments keep their addresses and data; IROM file offset ≡ 0x20 mod 65,536; code at `0x3c37b134`; 20,173 B refused; checksum and digest valid.

### Task D5: cc26 adapter and image
Files: `firmware/wayback/wb_device.c`, `wb_area2.ld`, `tools/cc26_build.py`, `tools/test_cc26_build.py`, `tools/wayback_device_host.c`, `tools/test_wayback_device.mjs`. The adapter of `firmware/wayback/README.md` with: no text on the route, only the distance next to the line, the cache of E9, the window before the line, the limits of E9. Base = cc25 output. Hook = the literal `0x420496b8`.

### Task D6: cc26 release record and device test
As Task C5. Hypothesis: cc26 boots, runs code from the second area, and draws the window and the line off route within 300 ms. Observation: an old route 2 minutes; a `patch25` route with way-back data, 15 minutes with two planned detours; photos; no restart. Duration 45 minutes. Restore: install cc25 over USB.

## Not in this plan

- The stock log writer for refusal codes (the cc24 diagnostic used `0x421434dc`; its contract is not mined).
- Pool layout, the 0.25 m grid and zoom-out (tier 2).
- **One allocation per block (cc25.1 option, only with device evidence):** the module puts the entry array and all points in one allocation and marks it in the 4 spare bytes per entry; a trampoline over the free routine `0x4204944c` (0x27 B body) skips the per-entry frees for a marked block. Allocations per block 411 median / 730 max → 1. Start it only if the cc25 test shows slow block loads or heap fragmentation.
- Rejected: a compact decoded form (int16 points) with a new iterator (needs hooks in the iterator, `arrow.c` and the label code; decoded RAM is not the binding limit), and raw scheme D without the protobuf wrapper (saves 12 B per block, loses the old-firmware safety).
