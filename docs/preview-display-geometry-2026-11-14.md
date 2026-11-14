# Preview display geometry — 14 November 2026

The CC700 has a **240 × 320** display according to the
[manufacturer specification](https://geoid.com/products/geoid-cc700-bike-computer).
The firmware map buffer is separately **240 × 256**; see
[the firmware extraction](v19-firmware-rendering-2026-11-14.md). These dimensions describe
different regions of the screen.

Previously the page scaled only the map canvas with the available width. The
turn card, compass and metric typography used fixed CSS pixels, and the turn
distance font also depended on browser viewport width. The combined map and
metric panel therefore changed aspect ratio as its available width changed.

The preview now reserves a 240 × 320 coordinate space inside its decorative
bezel. Its map occupies the first 256 native pixels, followed by a 4-pixel
progress strip and a 60-pixel metric panel. The canvas backing buffer stays
240 × 256 and both axes use the same scale. Container query units apply that
scale to all overlay dimensions, offsets and typography. The 3:4 ratio applies
to the display inside the bezel; the bezel adds its own decorative border.

The 4/60 split of the remaining 64 pixels is a preview layout choice. The
manufacturer display resolution and extracted map buffer size do not establish
an exact native widget layout. The two-row turn card is 62 native pixels high with a 32-pixel-wide arrow.
Distance and one outgoing caption occupy its two rows. Long captions are clipped
with an ellipsis instead of creating a third row; native scrolling timing has
not been reproduced. Fonts, rasterization, route-chevron spacing, metric layout
and GPS behavior remain approximations. This correction establishes screen geometry;
it does not establish pixel-for-pixel firmware parity or change generated route
files, firmware, map colors or map geometry. Circular rider and route-chevron
overlays reconstruct the supplied UI references; their exact native draw calls
and chevron spacing have not been established.

## Verification

A real Chromium layout test loads the page's actual HTML and CSS, supplies short, long and `then …`
preview captions, and measures its geometry at 180, 252 and 360 CSS pixel bezel widths.
It verifies the full display ratio, undistorted map, unchanged canvas backing
buffer, adjacent map/progress/metric regions, and consistent card, arrow and
text scaling. It also verifies the fixed two-row card, the absence of unsupported
extra text rows, and long-caption clipping at every tested width.

```sh
CC700_BROWSER=/path/to/chrome-headless-shell node tools/test_preview_layout.mjs
```

The executable can also be a Chromium-compatible Chrome browser supporting
headless mode. Container query units require Chrome/Chromium 105 or newer.
The test has no npm dependency; a browser executable must be supplied explicitly.
The original layout failed its full-display assertion before the correction.
