# Way-back line with the page cache, 25 Nov 2026 (image segfast 2de34f29)

Result: with the page cache (`WBD_KEEP`, 41af1f7) a warm off-route frame draws the way-back line in 12 ms with 0 file
reads. Before the cache: w144–157 r97–110 (23 Nov), w204–224 r162–171 (24 Nov photos).

| Field | Value | Meaning |
|---|---|---|
| `2696m+ w12 r0` | 12 ms, 0 reads | way-back line, N4, 2.2 km off route, unit still |
| `m6 p0` | 6 ms | detail map |
| `f24 o6 e0 h0 d17` | 24 ms | far map: open 6, draw 17 |
| `F10 L4 A42 N213` | | far fill 10 ms, lines 4 ms |

Off-route frame now about 42 ms (w12 + m6 + f24), against about 290 ms on 24 Nov.

Decision: the WP 7 speed target (80 ms) is met by the cache. No new violet file format for speed.

Gaps:
- Cold first frame off route is not measured. Model: 90–130 reads, 115–165 ms, under the 300 ms `WBD_TIME_US` stop.
- Riding is not measured. A moving rider loads new cells; the 48 pages are shared with the far map.
- One photo, one route, one heading.
