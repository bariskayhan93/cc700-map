# Map draw (v21 `cc_iter` and `cc_line`)

`map.c` and `fw.h` are the v21 map draw sources. Built with the v21 flags together with the v21 `blk.c`, `arrow.c`,
`tramp.S` and `patch.ld`, they give the v21 `.text` byte for byte (6,480 B), and the C4 base image (`ac48ba3d…`)
holds that `.text` unchanged at 0x421dc5d0. Checked on 18 Nov 2026.

Hooks in the base: `tramp_iter` (0x42049670, literal 0x42049678 = `cc_iter` 0x421dcb2c) and `tramp_line`
(0x4205bd90, literal 0x4205bd98 = `cc_line` 0x421dc988).

## Changes on cc26 (after the crash of 18 Nov 2026)

The crash core showed the stock fill loop under `cc_iter` → `cc_line` → `line`, drawing a green outline (op 24) with
points far off the 240×256 canvas, about 1 s after the first GPS fix. The cause of the long frame is not proven.

- **A (speed, same pixels):** a line or a dash piece whose box is outside the canvas plus `CLIP_M` (16 px, more than
  half of the widest line and its cap) makes no stock draw call. An off-screen dash segment keeps the dash phase.
  Host: 64 long paths and streets, mostly off the canvas: 25,856 stock draw calls on v21, 17 now; the calls that can
  paint and the painted pixels are the same (`tools/test_renderer_host.py`).
- **B (stability):** `cc_iter` stops drawing the rest of a frame after `MAP_FRAME_US` (400 ms). The next frame draws
  again from the start. The normal frame time on the unit is not measured; 400 ms is above any frame seen on the
  screen and far below the stock watchdog.
- The device build (`tools/cc26_build.py`, `-DCC26_AREA2`) puts `cc_iter` and `cc_line` in the second code area and
  sets the two literals. The v21 tables stay in the base (`0x3c1ddf20`, data-bus alias of `0x421ddf20`); the build
  checks that their bytes equal the tables of this source. Stack frames are the same as v21.
