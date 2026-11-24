# Code review parts 2 and 3, 25 Nov 2026 (image 8be5c061, source ec16ed9)

Part 1 (correctness) was done on 24 Nov. Sizes are from the cc27 build disassembly; the area-2 code is 17,888 of
18,404 B (516 B free); the tail area has 1,980 B free.

## Part 2: architecture

1. **The route file opens two times per map frame.** `wb_far` and `wbd_frame` each call `wbd_open`
   (`firmware/wayback/wb_device.c`). The test text shows the far open at `o4` (4 ms). Fix: open once per frame and
   give the handle to both. Saving: about 4 ms per frame, no new code room. This belongs to the draw-speed task.
2. **Two sine functions.** `fsin` (float, `firmware/mapdraw/proj.c:10`, 168 B) and `gl_sin` (integer,
   `firmware/wayback/wb_grey.c:20`, 96 B). Fix: none now. The far-cell path is integer on purpose; a merge saves
   less than 96 B and adds float code to the cell scan.
3. **Stock addresses are in `firmware/common/fw.h` only.** `guard_tramp.S` now includes `fw.h` (ec16ed9).
   `tools/test_fw_addresses.py` passes. No fix.
4. **Stack.** Deepest path is 1,952 of 3,968 B (gate G4, 24 Nov). The stock calls keep at least 2,016 B. No fix.
5. **Code room.** Area 2 has 516 B free; the tail area has 1,980 B free. A new feature larger than 516 B must go to
   the tail area (`wb_area2.ld`, region `tail`) or must remove code first.

## Part 3: code to remove

| Item | Where | Size | Decision |
|---|---|---|---|
| Test text and projection check (F_TEXT) | `map_time`, `own_check` in `firmware/mapdraw/map.c`; `text`, `tx_num` | at least 572 B (`text` 452, `own_check` 120) | Keep until the way-back ride tests end (owner, 23 Nov). Remove at release. |
| Grey streets (WBD_GREY) | `wb_device.c`, `wb_grey_draw.c` | 0 B in the image | Already out of the build. Delete the source after the next ride if no file without section 4 is in use. |
| Retired flags F_CYC (16), F_NODRAW (32) | `firmware/common/types.h:18-19` | 0 B | Keep the comments: old route files still set the bits. |
| `gl_cells`, `gl_bodies` | `wb_grey.c` | 1,072 B | Live: the far map uses the same cell index. Keep. |

Largest functions: `cc_iter` 1,632 B, `wb_scan` 980 B, `wb_km` 836 B, `wb_far` 780 B, `rs_fill` 668 B. No dead
branch was found in them.

## Gaps

- The two-opens saving is from the test text (`o4`), not from a timing of the shared handle.
- Tests in `tools/` that import missing modules (`map_budget`, `target_measurement`, and 10 more) fail on import.
  They did not run. They are not part of the image build tests.
