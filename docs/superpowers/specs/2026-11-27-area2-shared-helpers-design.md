# Area 2: shared helpers (27 Nov, commit 2 of the code-room plan)

Owner goal: less area-2 code without a loss of riding function (plan of 26-27 Nov: 1 WB_DIAG, 2 shared helpers,
3 raster merges, 4 far-map format, optional). Source: the relation maps of 26-27 Nov (data flow and call graph).

## Approaches

- Keep the copies: no risk, no saving. Rejected.
- One helper per repeated job, in the module that the host tests already build (chosen).
- Shared header with weak bodies (as `tx_num`): needs `fw.h` in every includer and links host stubs into the renderer
  host build. Rejected.

## What changed (same pixels, same rows, same limits)

- Text: `tx_halo` (1 px white halo, then the colour) and `tx_row` (test and state rows at (6, y)) in `wb_device.c`.
  Street names (`map.c` `text`), the map time row (`map_row`), the way-back row and the km text use them. Same draw
  order and offsets as before. `tx_row` skips a missing canvas (the map row did not check).
- Clock: `tx_clock`, one call for `fw_clock` (map stop B, file time limit, page-cache keep time, far stop).
- Canvas: `tx_cv`, the one reader of the stock canvas address and size (map raster, far map, km chart, grey).
- File frame: `wbd_start` (all context fields 0, time limit from now) and `wbd_done` (free the buffer, close the
  file) in `wb_far`, `wbd_frame` and `wb_km`. `wb_km` still starts its time limit after the open.
- `deg()`: the one map-unit to degree conversion (same float constant).
- `cc_iter`: the 8 passes in one loop with one stop check (the same stop points and `c<k>` values).
- `cc_line`: one colour per op. `fm_open`: the 10 header words in one loop. `fm_units`: a macro on `wb_units`.
- `wbd_file` is `wbd_at`. The page-cache hit count is test-image only (`WB_DIAG`; `test_wb_cache` builds with it).

Not taken: `far_mu` in float (changes the anchor units), position as E7 in `wbd_pos` (4 B), `el_digits` on `tx_num`
(the chart is in the tail, 212 B free).

## Result (measured, host link of the area-2 sources, no image built: no C4 base on this machine)

- Ride image: area 2 .text 17,040 B (was 17,436 B): -396 B; 1,364 B free of 18,404 B. Tail unchanged (3,224 B).
- `--diag`: 17,868 B (was 18,260 B).
- Largest frame 496 B (`wb_scan`, unchanged). G4: deepest wb_rt path 1,888 of 3,968 B.
- Host tests: the same results as commit 1 (node 559 pass; python 247 tests; the same 4 failures from missing private
  inputs).
- Gaps: no image built or flashed, no ride. The text pixels are checked by the host call records, not on the unit.
