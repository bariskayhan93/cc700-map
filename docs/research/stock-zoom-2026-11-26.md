# Stock map zoom: desk study (26 Nov)

Owner: "if detour, i shouldnt be zooming in". Goal: find the stock auto zoom rule, then block a zoom-in while off route.

## Found (OBSERVED, stock IROM `.local/mining/irom.bin`)

- The level is `S[0]`, with `ctx = *0x3c388cfc`, `S = *ctx`. The set-up at `0x4204c054` sets `ctx = alloc(4)`,
  `*ctx = 0x3c388be9` (a static block of 256 B, cleared). The getter `0x4204a4ec` returns `ctx`.
- The projection uses the level as a web-map zoom: `2^z * 256` (`firmware/common/fw.h:162-167`).
- Scale label: `0x42050688` returns 0 unless 1 <= z <= 22, else the u16 at `0x3c1f0214 + 4 z + 2`.
  The table gives: 13 = 500 m, 14 = 200 m, 15 = 100 m, 16 = 50 m, 17 = 20 m. The photo at 50 m was level 16.
- Only `0x42050688` reads the table (raw l32r scan over all of IROM).

## Not found

- The code that writes `S[0]`. No store at `S + 0` follows any of the 32 getter calls or the 15 loads of the
  `0x3c388cfc` slot (raw byte scan, not only the linear disassembly). The writer may get `S` through an argument or
  a struct copy. Gap: the auto zoom rule (turn distance, speed or route state) is not known.

## Next: T1 ride (image 414cb0ca, 21b0858)

The off-route F_TEXT row ends ` u<FW_ROUTE_LEFT> z<level>`, read only. The ride shows when z changes off route and
whether `u` holds the last on-route value. A fix (no zoom-in off route) needs that evidence first.
