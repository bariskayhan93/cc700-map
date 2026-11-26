# Area-2 code room: levers not tried before (26 Nov)

Owner question: free about 20 % of area 2 (18,128 of 18,404 B used) without a loss of function.
Answer: not available. The measured levers give 380 B (2.1 %) without a loss.

Base: tree 19c1213 + ffdc39a, the device build (`-DCC26_AREA2`). The measure script rebuilds the
`tools/cc27_build.py` link; base output 18,128 B, the same as image 164deaa3.

## Compiler and link (measured, host build only, no flash)

| Flags (area-2 C files; tail elev.c, view.c unchanged) | .text B | Largest frame |
|---|---:|---|
| base (`-Os -mlongcalls -mtext-section-literals`) | 18,128 | 496 (wb_scan, wb_far) |
| `-flto` | 17,552 | 896 (cc_iter), 704 (wbd_core) |
| `-flto -fipa-pta`, no `-mtext-section-literals` | 17,484 | over 512 |
| `-flto -fipa-pta --param large-stack-frame=64 --param large-stack-frame-growth=10` | 17,748 | 496 |
| `-flto -fconserve-stack` | 17,668 | 800 (wb_far) |

- LTO inlines across files and grows frames over the 512 B frame rule. With frame-growth limits
  the gain is 380 B.
- With LTO the `.su` files come from the link (`x.elf.ltrans0.ltrans.su`), not from each object.
  The build frame check must read that file.
- `-mtext-section-literals` off: no change (0 B).
- Gap: an LTO image is not flashed. All area-2 code changes, so it needs a full ride test.

## One line drawer instead of two (rejected)

Area 2 has `rs_line` (runs, no AA: grey layer, far lines, ring, `own == 1`) and `rs_line_aa`
(smooth, owner style). Together about 2.3 KB. A merge saves about 1.1 KB.

Host time, 200 x 2,000 random points, 240 x 256 canvas (`-O2`, Mac):

| Width | rs_line | rs_line_aa | Ratio |
|---|---:|---:|---:|
| 2 px | 37.8 ms | 75.2 ms | 2.0 |
| 4 px (grey layer) | 33.6 ms | 167.2 ms | 5.0 |
| 6 px | 40.4 ms | 213.2 ms | 5.3 |

- Merge to `rs_line_aa`: grey and far layers get slower (device time is the scarcest resource).
- Merge to `rs_line`: the smooth look goes (owner style). Both are a loss.

## Other levers

- New MMU pages, ROM helpers, dead stock code: already mined on 16 Nov
  (`firmware-mining-2026-11-16.md`). No new result.
- Builder-side work: `wb_km` (836 B) is mostly glue (file read, admission, fallback). The lens
  chart math is in the tail (`elev.c`), not in area 2. No large gain.
- Test text (`text` 452, `tx_num` 92, `fw_text` 44 B and call sites): owner keeps F_TEXT.

## Decision for the owner

- Free room today: 276 B. With LTO and frame limits: about 656 B.
- Use LTO only in the next image that needs the room, with a `--no-lto` fallback in the build.
