# Map draw (v21 `cc_iter` and `cc_line`)

`map.c` and `fw.h` are the v21 map draw sources. Built with the v21 flags together with the v21 `blk.c`, `arrow.c`,
`tramp.S` and `patch.ld`, they give the v21 `.text` byte for byte (6,480 B), and the C4 base image (`ac48ba3d…`)
holds that `.text` unchanged at 0x421dc5d0. Checked on 18 Nov 2026.

Hooks in the base: `tramp_iter` (0x42049670, literal 0x42049678 = `cc_iter` 0x421dcb2c) and `tramp_line`
(0x4205bd90, literal 0x4205bd98 = `cc_line` 0x421dc988).
