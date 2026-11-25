# Way-back line behaviour and code room, 25 Nov 2026

Status: host only. No device contact, no ride. Sources: a workflow of four studies with one skeptic each, then
follow-up host runs. Marks: M = device measured (cited), H = host run, E = estimate.

## Answer

- The violet line has three faults on the host: it goes behind a rider who rides forward, it blinks at the 15 m
  edge, and its ride distance jumps between two near pieces. No stateful fix (hysteresis, bonus) passed on the host.
- A stateless near-tie rule (`WB_TIE`) fixes the largest jump cause and is now in the device build (c79f246).
- A forward join needs a trusted exit position and data made when the file is built. It does not fit the code room.
- The far map builder now caps the stacked area fill per cell (765a941).

## Host replay of the core (H)

The real core ran with a fresh mount per 1 Hz frame, as `wb_device.c:194-201` does. Data: the D3 demo (rebuilt from
`docs/way-back-demo.html`, close but not exact), and three lab route files (Monaco, rural, Freiburg). Scenarios:
a = a parallel street, riding forward or back; b = toward the route along the stored way; c = a still rider 12-18 m
from a street with GPS noise; d = between two parallel streets. Each also with 3 m noise. The `a` tracks are the same
in both seeds, so each counts two times in the raw totals; the shares below are per file.

| Fault | Result |
|---|---|
| Line behind a rider riding forward (`a_fwd`) | Monaco 44 %, rural 48 %, Freiburg 16 % of frames |
| Blink (line on/off) | only at the 15 m edge (scenario c); a rider on a street does not blink |
| More than 32 points | 28 % of frames in scenario b; whether the first 32 points already leave the screen is not known |
| Ride distance jump | up to 1,182 m between two frames on clean tracks (Monaco) |

Causes of the large jumps (traced on Monaco and rural):

1. A node shared by a tree piece and a one-way extra piece. The rider is about 0.3 m from both. Stock picks by
   rounding. The extra piece must go to its far end: 1,382 m instead of 640 m.
2. Two streets cross with no shared node (bridge, tunnel). A 2D position cannot tell them apart.
3. One rural case: an extra piece at a node gives a ride 300 m shorter than the node's own tree distance. Possible
   cause: a turn restriction in the tree. Not checked (gap).

Fixes on the host (scenario b = ride toward the route; c = still rider with noise):

| Policy | Blinks c | Piece jumps b | Distance jumps > 25 m, b / b 3 m noise | Max jump |
|---|---|---|---|---|
| stock | 8,343 | 731 | 70 / 1,729 | 1,182 m |
| hysteresis 15/20 m | 5,165 | 2,913 | 649 / 1,786 | 1,208 m |
| bonus 5 m for the last piece | 5,161 | 2,058 | 12 / 575 | 1,199 m |
| near tie 2 m, one pass (`WB_TIE`) | 8,343 | 760 | 37 / 1,062 | 778 m |

Hysteresis and the bonus need state between frames and make a moving rider jump more. A neighbour hysteresis variant
looked good, but its jump metric favours it by definition, and a still rider changes piece 55 % more. No test yet
checks that a correct move to another street still happens; this is needed before any stateful policy.

## Forward join (H, mining)

Extra ride if the line must join the route ahead of a rider riding forward (directed graph of the file):

| Data | Frames behind | Extra ride p50 / p90 | No join ahead found |
|---|---|---|---|
| demo | 35 | 89 / 89 m | 0 |
| Monaco | 211 | 168 / 360 m | 126 |
| rural | 448 | 98 / 271 m | 0 |
| Freiburg | 189 | 75 / 255 m | 0 |

- A heading on the device can change only the first piece. The tree in the file fixes the route end of each piece.
- Best stock input: the remaining distance `FW_ROUTE_LEFT` (`fw.h:159`), saved at the last on-route frame. `wb_km`
  already reads it on each map frame. Risks: the value can already be off during the 11 checks before the stock
  commits off route; at a shared start/finish the matcher chose point 720 of 721 (M, grey-route-state notes); a
  reroute loads a new point list. A read-only device test (text fields `u t o p`) would settle whether the value
  holds while off route.
- The v1 core with forward mode was 2,782 B (`way-back-tree-2026-11-16.md:3`). It does not fit.

## Code room (H, Xtensa GCC esp-13.2.0_20240530)

Hand link of area 2 without the base image (the cc25 base is not on this machine):

| Build | Area 2 | Free of 18,404 B |
|---|---|---|
| HEAD 92fe03d | 18,128 B | 276 B |
| + tick-only core | 17,940 B | 464 B |
| + tick-only + `WB_TIE` (c79f246) | 18,096 B | 308 B |

- G4 deepest path 1,888 B (was 1,952 B). Largest frame 496 B.
- The test text (`F_TEXT`) is larger than the code review says: about 770-960 B (E). `text` (452 B in the review) is
  the street-name drawer and is in use; the test-text code is `own_check`, `map_row`, the map time with the W pass in
  `cc_iter`, the far-map timing in `wb_far` and the `wbd_frame` tail.
- A last-piece memory could live in the `WBD_KEEP` page cache (PSRAM): about +50-65 B (E), no data in area 2.

## Far map

- Fill stack (765a941): the unit has no fill cap (`fillCap` is written, not read). The builder now keeps the area fill
  of each cell at 3 cell areas or less, so a screen fills at most 3 canvases (about 29 ms, E). Measured worst stack:
  rural 2.28, Freiburg 1.82, Monaco 1.00, so nothing is removed today. In 403 of 1,305 rural cells the stack is more
  than 1.5, because areas overlap; removing the overlap at build time would save fill time and bytes (not measured).
- Rails as a far class: +0.4 % rural, +5.3 % city (H), about 12-20 B of code (E). The CCFM version must change first:
  old firmware sees an unknown class as bad data, and cells are drawn nearest first, so the whole far map goes blank.
- Trams: skip (they run on drawn roads). Footways: skip (+27 % in the city, not rideable). Sea fill: measure in the
  builder first; a wrong polygon fills the land. Dashed far paths: open (the real detail dashes are pixel dashes,
  `map.c:37`, from unverified unit values).
- Far map speed: the two cheap ideas (lazy open, wider stores) were rejected on 24 Nov (`map-layers-2026-11-24.md`
  section 12). No new idea with evidence.

## Gaps

- No ride. All behaviour numbers are host numbers on synthetic tracks.
- The full cc27 image was not built (base image absent).
- Crossings with no shared node still give jumps; the builder knows `bridge`/`tunnel`/`layer`, the file does not.
- A correct-move test for stateful policies does not exist.
- The rural 300 m case (cause 3) is not classified.

Scripts and output: `.local/lab/wayback-replay/` (local only; the lab files hold real street geometry).
