# Ride map loss: 2026-11-13 evening, root cause and v17

**2026-11-14 review supersedes the acceptance claims below:**
[v17 review and continuation](../releases/v17-review-2026-11-14.md) reproduces two remaining
loader failures and corrects replay callback/FIT input bugs. The historical
294/576 and 0/576 results are coverage proxies per sample, not measured blank
seconds. Current v17 is not yet recommended for flashing. The original account
below is retained with its evidence date.

Status entry point: [mining closure](mining-closure.md). This report resolves
its open item 6 (off-route draw gate) and the first real moving validation of
the v16 position-based map loader, with a fix.

A 4.6 km test route was ridden with saved v16. The map showed correct styled
data at the start, then went blank at the first block boundary (~1.5 km) and
never returned; the route line stayed visible. The owner approved one
interrupting storage read after the ride. The device log, the ridden route
file and the ride FIT were extracted, and the device was reset back into the
app. No firmware or storage write was performed.

## Evidence summary

Private artifacts (log, route file, FIT, storage image) are under
`.local/ride-incident-20261113/`, excluded from git.

| Observation | Source | Consequence |
|---|---|---|
| Route file: 30 sections, 560 unique points, 4 map blocks at 0/1494/2904/4404 m; block 1 has 836 entries, nearest 7 m from the route at 1500 m | decoded route file | The generator output was correct; the failure was on the device. |
| `AllPointNum:560` all ride; `RoadNumTable[0]:30` | device log | The list at `0x3c388cf8` holds **all route points**, not section endpoints. The 2026-11-12 "section count + 1" reading of `AllPointNum` was a special case and is superseded. |
| Road index advanced 0→13 across the boundary normally, then jumped 13→5→29/27 near the route's self-crossing | device log | The firmware matcher works across block boundaries; it wobbles where the route passes the same corridor twice (two passes 107 m apart along-route, bearings ~25° vs ~258°). |
| `YawFlag` (= byte `0x3c3894f0+145`, the draw-gate byte, confirmed at `0x42054812`) set intermittently from one minute after the boundary; the logged value alternated 0/1 for the rest of the ride | device log + binary | The stock draw gate blanked the map during every flag=1 phase. |
| 576 GPS fixes at 1 Hz for the whole ride | ride FIT (zlib-chunked on-device container, unwrapped offline) | Full ride replay is possible offline. |

## Root cause

The v16 loader `cc_blk` passed the result of `cc_nearest_sec` — an index over
**point segments** (0..559) — directly as the **section/block index**
(0..29) into the map index `off[]`. Every value ≥ 30 clamped to the last
block, so from a few hundred metres on, the device permanently drew the
finish-area block. The finish of this route lies ~150–250 m from the start,
so that block still looked plausible near the start, then thinned out with
the styled ranges (main roads to 1000 m from the last route stretch) and ran
completely empty at ~1.15 km crow distance — exactly where the owner reported
the map "finished". The route line is drawn by a separate path and stayed.

The off-route draw gate (mining open item 6) was a second, intermittent
contributor: replay attributes 220 of 576 ride seconds to flag=1 phases, on
top of the 294 blank seconds measured for v16 overall.

## Replay harness (new local simulation)

`tools/cc700_replay.py` replays a recorded ride through the **real patch C
code** (`cc_nearest_sec` compiled for the host from the preserved source)
using the route file, the ride FIT, and the device log's per-second road
index and `YawFlag`. It reproduces the device behaviour of this ride from
geometry alone, including the matcher's backward jump at the self-crossing,
and counts blank-map seconds and block switches for a chosen build. The ride
FIT reader `tools/fit_track.py` also unwraps the device's on-device
`.ZIP`+zlib-chunk container. `tools/route_block_audit.py` audits any route
file's block index and coverage; `tools/analyze_gpx_geometry.py` flags
self-approaching corridors that stress nearest-section selection.

Results for this ride:

| Build | Blank seconds of 576 | Block switches |
|---|---|---|
| v16 as shipped | 294 | – |
| v17 index fix, gate still stock | 220 | 3 |
| v17 complete | **0** | 3 |

## Patch v17

Two changes in `../cc700-backup/patch/src/` (v16 copies kept as `*.v16`):

1. **`blk.c`: point→section mapping.** The firmware stores each route point's
   road/section as a uint16 at payload +40 (its own mapping; `0x4204a5fc`
   copies it as `OutputPos`). Verified against the ride log: section-of-point
   equals the logged road for 473/522 logged seconds; every mismatch is a
   shared boundary point (assigned to the following section) or matcher lag.
   `cc_blk` now maps the nearest point to its section and follows the
   position only when the firmware index differs by more than one section
   (stuck or behind), preventing block flicker at boundaries.
2. **Draw-gate bypass.** `TRAMP0 gate, cc_gate` replaces the stock map gate
   wrapper at `0x4204c9b8` (26-byte body, 20-byte trampoline): the map pass
   runs whenever a block is loaded, regardless of the off-route flag. The
   off-route notice, replanning and prompt paths are untouched.

Build and checks (all repeated here):

- ELF 16,320 B (`.text` 5600 + `.rodata` 296; 9000 B remain in the page).
- Image `CC700_V1.414-cc17` builds with `mkpatch.py`; `espimg.py` rebuild is
  byte-identical; SHA-256 `537364660e222139d29c70078850dfceb56f51c26acad728708b2ab121af24d9`.
- Per-segment diff vs saved v16: exactly the version byte, the gate
  trampoline, and additions/relocations inside the patch tail; both DRAM
  segments unchanged.
- `cc_nearest_sec` policy probes 9/9; app preview tests 5/5; host map build OK.
- Ride replay: 0/576 blank seconds, 3 block switches, no flicker.

## Remaining boundaries

- The point→section read (+40) and the block-index contract belong to
  firmware V1.414; a different firmware needs re-verification.
- The `road` argument is assumed to be in the same section domain as the
  active navigation file (true for this firmware's normal navigation path;
  reroute-file types were not re-traced).
- At a route self-crossing the map can still briefly follow the other pass
  (observed once, seconds-scale, locally correct data); heading/progress
  arbitration there is firmware behaviour, unchanged by v17.
- Device validation of v17 has not happened: it needs an owner-approved
  `ota_1` write and a re-ride or replay. The device currently still runs v16.

## Pre-flash blast-radius checks

- The replaced gate wrapper `0x4204c9b8` has exactly **one** caller:
  `0x4204da24` (map frame order), itself called only by the ~1 Hz map draw
  timer `0x420515c8`. Prompts, replanning, recording, heading and arrival
  never pass through it. The predicate `0x42050618` (four callers) is
  untouched.
- Ordering inside the position event handler guarantees freshness of the
  point's `+40` road field: `mg_road_yaw_calculate` (full 0..560 point scan,
  per the ride log) runs at `0x420547dd` before the loader call at
  `0x420548d4`. The patch's reads happen only while the route point list
  exists; the teardown path (`0x4204c500`) frees it and nulls the global on
  restart, and `cc_blk` guards on list presence first.
- Drawing during off-route phases (previously skipped) adds draw work while
  replanning may run concurrently; frame duration there remains an open
  measurement, watched in the next ride rather than blocked on.
- Rollback: stock `ota_0` is untouched, and saved v16 ELF/image are preserved
  byte-exact, so v16 can be re-flashed verbatim if v17 misbehaves.
