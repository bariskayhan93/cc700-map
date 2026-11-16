# Close-turn captions, opaque route and reference UI — v21

The owner reported missing following-turn information and a mismatch between
the Pages/README instruction window and the supplied device references.
Two separate problems were confirmed; they must not be conflated with detour
matching or solved by pretending the device has an extra instruction row.

## Missing caption information

In the saved ride file, the name bitmaps do contain `then left/right` prefixes,
but record info field 6 contains only street names. The bitmap workaround did
not establish that the native caption would show the hint.

The extracted stock next-point path loads local record **k + 1** at
`0x42050ef7`, then retrieves the text buffer through `0x4204a0b8` at
`0x42050f0c` and puts it into the next-point output. The 64-byte buffer at
`0x3c388998` is populated by the record parser; its string handler at
`0x4204995c` rejects strings longer than **63 bytes**. The important channel is
therefore the native text field of the outgoing record, not only the bitmap
of the current maneuver.

Generation now puts the following-turn prefix on that outgoing record, with
its own street or explicit waypoint label. UTF-8 is capped at 63 bytes without
splitting a character. The preview consumes the same `.caption` representation.
Legacy `.text` remains section/list metadata; it is not a third native widget.

Ordinary field 6 retains its street-name meaning. Existing roundabout bitmap
exit-name substitution is preserved as a compatibility exception: those bitmaps
need not equal field 6. The complete native roundabout caption lifecycle remains
untraced. No maneuver geometry or turn-detection algorithm changed here.

Nine functional encoded-readback cases cover 22/27 m pairs, sequential turns,
neutral subdivisions, waypoint ownership, UTF-8 boundaries, bitmap abbreviation
and preservation of the roundabout exception. These tests first reproduced the
missing/wrong-channel captions and then passed with the new representation.
Native visual appearance and scrolling of each caption still need observation;
this is an encoded-contract fix, not a claim of a new native third line.

Existing transferred route files retain their old captions. Regenerate and
transfer a route with the updated app to obtain this correction. Firmware
installation alone cannot change those files; the saved ridden route and ride
were preserved during this update.

## Route opacity

v21 changes the red route segment's opacity from 180 to **255**. Red stays
`#d62828`; the v20 width, violet cycleways, light-blue waterways and shorelines
are retained. Removing transparency makes red less dependent on the background;
it can look stronger even though its RGB value is unchanged. The segment hook
restores the shared line descriptor after each call.

Actual `arrow.c` under ASan/UBSan verifies opaque red, unchanged non-route lines,
width handling and descriptor restoration. Compared with v20, all compiled patch
sections are identical except **one byte of .text**. Text remains 6480 bytes,
rodata 296 bytes and mapped-page room 8120 bytes. There is no new heap allocation,
map resolution change or navigation/rejoin logic change.

- Version: `CC700_V1.414-cc21`.
- Image: 3,750,816 bytes.
- SHA256: `7deb201d797bdd974bfc0460870288feed2632bb41c81b65338e3307f5d0a139`.
- Installed only to ota_1, flash verification passed, then one expected RTS boot
  with no captured crash in the eight-second observation.
- Fresh full v20 partition rollback is saved privately with the installation.
- Stock ota_0, OTA selection and route/ride storage were not programmed.
- [Sanitized installation receipt](mining/v21-install-observation.json).

## UI and examples

The supplied references show a two-row card: distance above a single caption,
with the turn arrow beside both. Far from a maneuver the caption is “Go straight”;
near one it shows the outgoing street/caption. The previous page's instruction,
street and separate following-turn row overstated the native UI.

The preview and new README examples use this two-row composition and the full
240 × 320 portrait display, preserving the 240 × 256 map buffer. Lower fields
match the supplied Speed/GPS Heading arrangement. The supplied OnelapFit
reference is separate from rendered examples; old Tour D3 artwork is historical.
Browser fonts/rasterization, route-chevron spacing and some native widget details
remain approximations, and the preview is still on-route playback, not live
firmware/GPS emulation. See [the artwork reference note](current-preview-artwork-2026-11-14.md).

[Ride analysis](ride-review-2026-11-14.md) and
[detour proposal](cycling-turn-practices-2026-11-14.md) remain separate work.
The known noisy/sparse GPX failures and rejoin issues are not fixed by this release.


## Final checks

Python suite: **121 passed**. Node suite including actual C/JS fill and label
parity: **102 passed**, zero non-TODO failures and the existing executed noisy-GPX
TODO. All seven offline probes pass. Chromium layout checks cover three widths
and short/long/following-turn captions with the two-row card. Six static examples
and selected animation frames were inspected. An independent integration review
found no critical issue.

A before/after generation comparison also verified identical route-point payloads,
non-caption record information, map index/block bytes and total route distance on
a synthetic close-turn fixture. Caption strings, their bitmap representations and
associated offsets are the intentional route-file changes. Source and validation
artifacts remain privately archived with v21.
