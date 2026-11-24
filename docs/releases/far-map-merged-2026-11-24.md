# Merged map: detail near the route, far map beyond — 24 Nov

Status: built, tested and installed to ota_1 with flash readback verification (image 7826c660, commit dde0b37,
18,188 B of 18,404 B code). Restore: `restore-noseek-image` in `.local/wayback/device/run_cc27.py`.

## What changed

- Detail map to 300 m around the route; the far map owns the areas and the ways outside it (WP 6 handover B).
- Far streets in style D (owner choice): grey edge 4 px, white core 2 px. Pictures of the five candidates on seven
  edge-case frames: artifact "Far Street Variants"; numbers in `docs/research/map-layers-2026-11-24.md` 12.2.
- Band fill in `rs_fill` (WP 2) and the fused area outline (WP 3).
- Page cache of 48 pages of 1 KB, kept between frames through the GUI task thread-local list (key CCMC; WP 4, WP 5).
  A warm frame makes no file read and no stdio seek; the file size comes from the cache.
- Span writes for opaque lines and disks, 32-bit stores in the fill: the same pixels (identity tests against a frozen
  copy of the old line code).
- The grey fallback layer is retired (owner decision, code room).

## Measured on the unit (N3 / N4 home, stationary)

| Value | Before (split image) | Now |
|---|---|---|
| Far map total `f` | 67–93 ms | 24 / 25 ms |
| Setup (open, end seek, trailer) | 40+ ms | 4–5 ms |
| File reads in a warm frame | 13 | 0 |
| Line time `L` | 13 ms | 4 ms |
| Way-back `w` | 141–170 ms | 5 ms |

The far map completes every frame (150 ms stop): no flicker. The fill (10–12 ms) is now the largest part; overdraw
is only 7.5 %, so the area union of WP 6 step 2 was not done.

## Open

- On-route `m` measurement on a ride.
- 70 km routes at 3 km far radius can pass the 4.0 MB guard (3.5–4.1 MB): next, a smaller far radius for large
  files only. WP 7 C (streets from the way-back data) stays a separate project.
- H142 keeps the old file format.
- Branch `research/map-layers-2026-11-24` is not pushed.
