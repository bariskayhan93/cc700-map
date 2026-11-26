# Stock map zoom: desk study (26 Nov)

Owner: "if detour, i shouldnt be zooming in". Goal: find the stock auto zoom rule, then block a zoom-in while off route.

## Found (OBSERVED, stock IROM `.local/mining/irom.bin`)

- The level is `S[0]`, with `ctx = *0x3c388cfc`, `S = *ctx`. The set-up at `0x4204c054` sets `ctx = alloc(4)`,
  `*ctx = 0x3c388be9` (a static block of 256 B, cleared). The getter `0x4204a4ec` returns `ctx`.
- The projection uses the level as a web-map zoom: `2^z * 256` (`firmware/common/fw.h:162-167`).
- Scale label: `0x42050688` returns 0 unless 1 <= z <= 22, else the u16 at `0x3c1f0214 + 4 z + 2`.
  The table gives: 13 = 500 m, 14 = 200 m, 15 = 100 m, 16 = 50 m, 17 = 20 m. The photo at 50 m was level 16.
- Only `0x42050688` reads the table (raw l32r scan over all of IROM).

## Writer found (26 Nov, later, OBSERVED by call scan)

- `S[0]` has one writer: `0x420564f8` (clamp 0..20, then the tile origin `S[4]`, `S[5]`). Only `0x42056530` calls it,
  from 4 places: the route fit `0x4204cce9` (route header 0x44 + 1, then smaller until the route fits), `0x4204d0a6`
  (15), `0x4204d8e7` (keep), and `0x42051687` (the map task applies a view message: zoom = message [12], 0 = keep).
- The auto zoom rule is `0x42050190` (map task, from `0x420548dc`), with the guide `0x3c3894f0` and the view message
  `0x3c38939c` (84 B, sent to the queue `*0x3fc9fcec`):
  - it returns first when guide[145] = 1 (off route, the flag that `fw_off_route` reads);
  - state `0x3fc9fcac` = 0 and next-turn distance `0x3c389340` <= 100 m: message [12] = 16 (50 m), state 1;
  - state 1 and distance > 110 m or a new turn: [12] = [11] (the only writer of [11] sets 15 when it is 0), [15] = 1,
    state 0.
- Cause of 50 m off route: a zoom-in from before the off-route flag stays, because the zoom-out step also returns first.
  The route preview bytes on the unit are 11..14, so the route fit gives 15 or less: it is not the source of 16.

## Fix (dadbaf9, image 2d03d449)

`wb_rt` does the stock zoom-out step while off route (state 1 -> [12] = [11] or 15, [15] = 1, state 0). On route the
stock rule is unchanged. Cost: one load and one compare per off-route frame. Restore: `restore-t1` (414cb0ca).

## Superseded: first desk study

## Not found

- The code that writes `S[0]`. No store at `S + 0` follows any of the 32 getter calls or the 15 loads of the
  `0x3c388cfc` slot (raw byte scan, not only the linear disassembly). The writer may get `S` through an argument or
  a struct copy. Gap: the auto zoom rule (turn distance, speed or route state) is not known.

## Next: T1 ride (image 414cb0ca, 21b0858)

The off-route F_TEXT row ends ` u<FW_ROUTE_LEFT> z<level>`, read only. The ride shows when z changes off route and
whether `u` holds the last on-route value. A fix (no zoom-in off route) needs that evidence first.
