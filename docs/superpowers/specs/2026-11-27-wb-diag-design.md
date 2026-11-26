# WB_DIAG: test rows of closed experiments in a test image only (27 Nov)

Owner goal: less area-2 code without a loss of riding function. Relation-map study (26-27 Nov): the test
text of closed experiments is one group spread over 4 files and the largest single lever.

## Approaches

- Delete the rows: smallest code, but a later experiment must write them again. Rejected.
- Runtime switch (F_TEXT levels): the code stays in the image, no saving. Rejected.
- Build flag `WB_DIAG` (chosen): the project already gates optional code with build flags (`WBD_KM_WHY`,
  `WBD_GREY`). Ride image without the flag, test image with `--diag`.

## Ride image (no WB_DIAG) keeps

- `m<ms>` map time and ` c<k>` stop pass (map.c): riding evidence of a cut detail map.
- The way-back row `<d>m[+]` / `wb<code>` (not F_TEXT).
- T1 ` u<U> z<level>` (wb_device.c): open until the ride on image 2d03d449 confirms dadbaf9. Move it under
  WB_DIAG when T1 closes.

## Test image only (WB_DIAG)

- ` p<d>` and `own_check` (own projection check; F_PROJ ships).
- W canvas-pass timing (25 Nov test).
- Far rows `foehd` / `FLANPW`, the far time split in `wb_far`, the far draw counters in `wb_far.c`
  (not `st->work` / `st->points`: those are caps, riding behaviour).
- ` w<ms> r<reads>` and the file time / read count of `wbd_raw`.

## Normal behaviour, fallback, restoration

Map, way-back and far drawing are unchanged; only text and counters go. Host tests build both variants:
`-DWB_DIAG` keeps every current text test; the ride variant checks that the rows are absent and that
pixels and the way-back row are the same. Restore: build with `--diag`.

## Result (27 Nov, measured, host link of the area-2 sources, no image built: no C4 base on this machine)

- Ride image: area 2 .text 17,436 B (was 18,260 B): -824 B; 968 B free of 18,404 B. Tail unchanged (3,224 B).
- `--diag`: 18,260 B, the same as before.
- Host tests: the old tests run on `-DWB_DIAG` builds; new ride tests check the rows and that line, distance,
  map pixels and far pixels are the same as the test image (test_wayback_device, test_renderer_host,
  test_far_unit). G4 stack: PASS (deepest wb_rt path 1,888 of 3,968 B).
- Gaps: no image built or flashed; no ride. Device time saving (fewer clock calls) not measured.
