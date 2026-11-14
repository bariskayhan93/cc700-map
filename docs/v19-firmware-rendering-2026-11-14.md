# v19 firmware rendering candidate

The v19 candidate retains v18 navigation and loader sources, and changes map selection, polygon filling and label placement. It was installed to ota_1 and flash verification passed on 2026-11-14. An RTS reset automatically booted the app from ota_1; the eight-second boot observation contained one reset and no captured panic. Stock ota_0, OTA selection and route/ride storage were not written. This establishes installation/boot, not target map frame-time or physical navigation acceptance.

## Selection and memory

`cc_iter` builds 41 first/end index ranges in its existing initial traversal: four fill classes; seven road classes times five valid levels; one combined traffic-signal/tram-stop bucket; one label bucket. Each original pass scans its range and retains the original predicate. Entry order within every pass remains unchanged, including interleaved signal/stop entries. Old unsorted files need no format marker or sorting: their bounds can be wider, while predicates preserve dispatch. Styled class 0/15 and invalid road levels retain their previous behavior. Bounds rebuild under the block lock each frame, so route replacement cannot leave a stale cache.

Index construction is O(N), with 328 bytes of stack storage and no added heap allocation. Worst-case unsorted selection remains bounded by the original 61N pass examinations plus the initial N traversal. Contiguous semantic buckets reduce examinations to at most 3N including the initial traversal (road classes with casing/core are examined twice). The actual 4,000-minor-road C fixture measured **12,000 entry examinations versus 248,000** in the frozen v18 iterator, with the same 8,000 projection calls and dispatch trace. This measures selection work, not frame time or FPS.

Existing geometry scratch allocation remains `(largest styled entry point count + 1) * 8` bytes. The 60-point fixture uses 488 bytes; the four-point fixture uses 40 bytes. Scratch OOM still draws original style-zero star entries, skips styled entries, and releases the lock. Bounds and collision handling need no allocation or OOM fallback.

## Fill and labels

The tested semantic color separation is promoted into v19: water fill is `#82cbd5`, water lines/outlines are `#378b98`, and ordinary paths use neutral `#66615a` at 2 pixels. Rough paths remain brown at 2 pixels; cycleways remain blue. Street casing widths, green/grey fills, existing area outline policy and route opacity remain unchanged. Source-level assertions cover both promoted and preserved operation colors/widths.

Scanline fill normalizes edge direction, computes the ceiling of pixel-center intersections, sorts crossings and cancels coincident pairs. A slanted doubled bridge into a rectangular hole now paints the exact expected 2,100 pixels; v18 paints 2,088. Reversing the polygon preserves the expected mask. The existing 128-crossing limit and sane projected-coordinate range remain; arbitrary malformed or extremely complex rings are not newly guaranteed.

Labels share the actual C placement logic between HOST and target. UTF-8 leading-byte count estimates width as `nc*7+4`; text origin is `(anchor.x-floor(width/2), anchor.y-8)`. Existing one-pixel edge eligibility and bottom-left HUD exclusion remain. Stored collision rectangles are `[x-3,y-3,x+w+3,y+19)`; strict overlap rejects a candidate and touching is allowed. The first 12 eligible noncolliding labels win in entry order; state resets each frame. New files can encode deterministic priority order without changing the legacy format. Glyph drawing remains the stock font with the existing four white halo draws and black text.

The linker forbids writable globals, so the 12 rectangles and count live in `cc_iter`'s frame. For K_TEXT only, `cc_line` reports the projected anchor in the line descriptor's color/width fields and uses `dash_gap=1` as a validity marker. The iterator invokes text placement after the callback returns, clears the marker, and restores color/width. Extracted stock instructions at `0x4204c21d..0x4204c228` show that after calling `cc_line`, the callback only frees the projected point buffer and returns. It does not modify the descriptor. The extraction is preserved in `.local/patch-v19/mining/projection-callback.txt`. This seam is specific to the pinned firmware.

## Local checks and limits

`python3 tools/test_renderer_host.py`: 11 tests pass with AddressSanitizer and UndefinedBehaviorSanitizer. The frozen v18 iterator is linked against the same drawing implementation to isolate selection equivalence. Traces include projection inputs/selectors and line descriptors/points; fixtures cover mixed unsorted styles, all classes, levels/flags, class 0/15, symbols, labels, repeated frames, OOM, failed projection prefixes, empty/unloaded blocks and dense 4,000 entries. Fill checks inspect every pixel in the hole fixture. Label checks cover collisions, the cap across repeated frames, edges, HUD, touching boxes and unterminated payloads.

`renderer-host fill_json` accepts `N W H` followed by integer `x y` vertices and returns a row-major pixel mask. `labels_json` accepts `N` followed by `x y HEX_UTF8` entries and returns accepted entry IDs and rectangles. These hooks execute actual C fill and placement, supporting independent cross-language comparisons with preview rules.

HOST projection, line rasterization and glyph drawing are fixtures. These checks do not prove stock projection OOM handling, LVGL glyph extents, target stack headroom, target frame timing/heap peaks, physical navigation acceptance or motion readability. The 7-pixel character width remains an estimate inherited from v18. No live position injection was used. Installation used serial only for the bounded backup/write/verification/RTS sequence described below.

## Versioned artifacts

`python3 tools/build_render_candidate.py` checks the pinned v18 SHA-256, copies sibling sources, links the Xtensa ELF, permits only named patch sections, patches the v18 image, changes its version to `CC700_V1.414-cc19`, rebuilds its checksum/hash and writes `.local/patch-v19/manifest.json`. Generic binaries are untouched. Original source is preserved as sibling `map-v18-before-v19.local.c` and `.local/patch-v19/map-v18-before.local.c`.

| Budget | v18 | v19 |
|---|---:|---:|
| `.text` | 6,000 B | 6,480 B |
| `.rodata` | 296 B | 296 B |
| Last mapped page free | 8,600 B | 8,120 B |
| `cc_iter` compiler static frame | 80 B | 512 B |
| `fill` compiler static frame | 320 B | 320 B |
| Added full-frame buffer | 0 | 0 |

Compiler frames are static function frames, not task-stack high-water measurements. The v19 image is `.local/patch-v19/ota_1_v19.bin`, **3,750,816 bytes**, SHA-256 `7d6204b13850dbf1dcadace3a74932156686b1847ba6a4527d7f90ba224f9be5`. `esptool image_info` reports a valid checksum and validation hash; independent `espimg.py` rebuilding is byte-identical. Installation receipt: `.local/patch-v19/installation-20261114T130226Z/receipt.json`. Fresh full ota_1 rollback backup SHA-256 `a7caf9767c42808c8405427d9436e563d579140d74950e6779dab3b557f40a94`. Saved v18 is retained byte-exact.
