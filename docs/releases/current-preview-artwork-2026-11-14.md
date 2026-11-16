# Current preview artwork — 14 November 2026

The README's six new PNG comparisons and animated WebP use the current
`index.html` display markup and CSS. Each panel contains the same 240 × 320
inner display. Browser screenshots preserve the two-row card and all overlays
at native size rather than independently resizing the map and UI.

The middle and right map canvases are rendered by `js/preview.js` after
`js/route.js` generates synthetic route files and `readFile` reads them back.
Guidance uses `previewGuidance` and serialized outgoing captions. Name bitmaps
use the actual `js/names.js` encoder with a desktop Canvas adapter. The right
panel uses v21: the v20 palette with an opaque red route.

The left panel is explicitly an **OnelapFit-style reconstruction**, not an
OnelapFit export. Its small pale-grey spokes are illustrative: the synthetic
stock entries are shortened to 22 m and drawn with thinner strokes. No
proprietary OnelapFit map data, renderer, icons or fonts are used. This depiction
does not establish the application's native junction selection or arm lengths.

The synthetic roads, water and park are mathematical fixtures in the generator
script. They use no real ride track, private coordinates, or external map query.
The animation moves all panels through 13 shared positions, 15 m apart, with
1.5 seconds per frame. This is position replay rather than GPS/time simulation.
Fonts, line rasterization, route-chevron spacing and lower-panel layout remain
approximations. Native circle/chevron visuals were reconstructed from the
supplied references; chevrons use an illustrative 28-pixel interval and a
64-chevron upper bound. These are browser UI overlays, not firmware changes.

The original user-supplied OnelapFit reference is copied unchanged as
`comparison/onelapfit-user-reference.png`. It shows a different route and remains
separate from the synthetic comparisons. Its SHA-256 is
`3b6b345a64d8470a9b6da5f45aea4680badfb430bb42cb4dc420581dbab89562`.
The private ride photographs are not copied into the published artwork.

## Reproduction

Requires Node.js 22+, a Chromium-compatible headless browser,
`@napi-rs/canvas`, and the `img2webp` command from libwebp.
The tool uses existing local dependencies and makes no device or network calls.

```sh
CC700_BROWSER=/path/to/chrome-headless-shell node tools/test_preview_layout.mjs
CC700_BROWSER=/path/to/chrome-headless-shell \
CC700_CANVAS=/path/to/node_modules/@napi-rs/canvas \
node tools/render_readme_preview.mjs
```

Without `CC700_CANVAS`, the renderer uses
`.local/render-check/node_modules/@napi-rs/canvas`.
All six static frames and representative animation frames were visually checked.
`webpmux -info` confirms a 840 × 426, 13-frame lossless animated WebP.
The older Tour D3 assets are preserved only in the
[historical appendix](comparison/historical-tour-d3.md).
