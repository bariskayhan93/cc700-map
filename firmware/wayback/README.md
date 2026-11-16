# Way-back core (host only)

## Status

Host only. Nothing is on the device. No adapter to the map patch exists.
The core is 2,782 B of Xtensa code, for every file. The room is 4,376 B. Before forward mode was added, the core was 2,294 B.
The core has no heap, no float and no library call. Its only external call is the reader callback.

## Normal behaviour

The rider is off the route and at most 15 m from a stored street piece. The core gives a line along
the stored streets to the route. It gives the ride distance to the route in decimetres.
The line has up to 4,096 points. Point 0 is the nearest point on the piece. Point 1 is the end node.

## Admission

`wb_mount` accepts a file only when all of these hold:

- The magic is `CCWB` and the version is 1.
- The route identity (16 bytes) equals the route identity of the caller.
- The scale fields are not 0.
- The header and the section sizes add up to the file size.
- Every chunk-table value is in order, the first is 0, and the last is the exception count.
- The sentinel cell record matches the node count and the extra count.

Forward mode needs a trusted exit (`WB_EXIT_TRUSTED` in the flags) and an exit km that is in the file.

## Unavailable state

When `state` is `WB_NONE`, the device must show the stock off-route display. There is no way-back line.

| `reason` | Value | Cause | What the device shows |
|---|---:|---|---|
| `WB_OK` | 0 | A line is available (`state` = `WB_LINE`). | The line. |
| `WB_NO_FILE` | 1 | No file is mounted, or the mount failed. | Stock display. |
| `WB_GPS` | 2 | `WB_GPS_VALID` is not set. | Stock display. |
| `WB_ON_ROUTE` | 3 | `WB_OFF_ROUTE` is not set. | Stock display. |
| `WB_NO_STREET` | 4 | The rider is outside the grid, or more than 15 m from every stored piece. | Stock display. |
| `WB_READ` | 5 | A read from the file failed. | Stock display. The line is dropped. |

## Fallback

- Tree A values are used when the exit is not trusted, when the file has no exception lists, or when the exit km is not in the file. `forward` is 0 in these cases.
- In forward mode, the distance walk is limited to 64 nodes. When neither an exception record nor a route node is reached, `distance_dm` is `WB_DIST_UNKNOWN`.

## Restoration

`wb_unmount` clears the engine. Removing the file restores the stock behaviour.
The core writes nothing. It changes no stock state.

## Drawing contract (not built)

The adapter calls `wb_tick` one time for each position. When `changed` is 1, it reads at most 64 points
with `wb_read_point` into its own buffer. It draws nothing if a read fails. It converts each point
from E7 to float degrees and gives the list to the firmware projection callback (`0x4204c1bc`),
which calls `cc_line`. This step is behind the owner gate: the cause of the cc24 map-view restart is not known.

## Files

- `wayback.h`, `wayback.c`: the core.
- `tools/wayback_host.c`: host command. `tools/wayback_core_host.mjs`: builds it and runs it.
- `tools/wayback_tree.mjs`: model. `tools/wayback_format.mjs`: file format.
- `tools/wayback_build.mjs`: private inputs to a file and a size report. `tools/wayback_replay.mjs`: replay on the recorded ride.
- `tools/wayback_size.py`: code size on the Xtensa target.

## File format

This section is the format contract. `tools/wayback_format.mjs` implements it.

All values are little-endian. `u24` is three bytes, low byte first. `NONE` is `0xFFFFFF`.

**Units.** A position is `(X, Y)` in units of 1/16 m from the origin. X is east, Y is north.

- `lat_u_q16 = 11673` (units for each 1e-7 degree of latitude, times 65,536).
- `lon_u_q16 = round(11673 * cos(lat0))`, with `lat0` in radians.
- `lat_e7_q16 = round(65536 * 65536 / lat_u_q16)`, `lon_e7_q16 = round(65536 * 65536 / lon_u_q16)`.
- Origin: `lat0_e7 = (smallest node lat_e7) - 30000`, `lon0_e7 = (smallest node lon_e7) - 50000`.
- To units: `Y = floor((lat_e7 - lat0_e7) * lat_u_q16 / 65536)`, `X` the same with the `lon` values. Generator and core must use this integer formula.
- To E7: `lat_e7 = lat0_e7 + floor(Y * lat_e7_q16 / 65536)`, `lon_e7` the same with X.
- Cell: 2,048 units (128 m). `cell key = ((Y >> 11) << 16) | (X >> 11)`.

**Header, 64 bytes**

| Offset | Type | Field |
|---:|---|---|
| 0 | 4 bytes | magic `CCWB` |
| 4 | u16 | version = 1 |
| 6 | u16 | flags; bit 0 = the file has exception lists |
| 8 | 16 bytes | route identity: first 16 bytes of the SHA-256 of the route file |
| 24 | i32 | `lat0_e7` |
| 28 | i32 | `lon0_e7` |
| 32 | u32 | `lat_u_q16` |
| 36 | u32 | `lon_u_q16` |
| 40 | u32 | `lat_e7_q16` |
| 44 | u32 | `lon_e7_q16` |
| 48 | u32 | `node_count` |
| 52 | u32 | `cell_count` |
| 56 | u32 | `extra_count` |
| 60 | u32 | `chunk_count` (0 if there are no exception lists) |

**Sections, in this order, with no padding**

1. **Cells:** `cell_count + 1` records of 12 bytes: `key u32`, `first_node u32`, `first_extra u32`. Sorted by key. The last record is a sentinel: key `0xFFFFFFFF`, `first_node = node_count`, `first_extra = extra_count`.
2. **Nodes:** `node_count` records of 12 bytes: `X u24`, `Y u24`, `next u24` (node index or `NONE`), `dist u24` (ride distance to the route in 0.1 m). Sorted by cell key. A node with `next = NONE` is on the route.
3. **Extra pieces:** `extra_count` records of 8 bytes: `a u24`, `b u24`, `lenflags u16` (bits 0 to 13: length in 0.1 m; bit 14: the rider can go to `a`; bit 15: the rider can go to `b`). A record is in the cell of node `a`. Sorted by that cell key.
4. **Chunk table:** only if `chunk_count > 0`: `chunk_count + 1` values `u32`, the first exception index of each chunk. Chunk `c` is route km `c`.
5. **Exceptions:** records of 8 bytes: `node u24`, `next u24`, `dist u16` (ride distance in metres). Sorted by `node` in each chunk.

The file size must be exactly the header plus the five sections.
