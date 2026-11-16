# Way-back core (host only)

## Status

Nothing is on the device. A test image exists on the host only: `cc23wb1` = installed cc23 plus the adapter `wb_device.c`.
The core with the adapter is 4,240 B of Xtensa code (core 2,784 B, adapter 1,456 B). The usable room is 4,376 B. 1,904 B stay free in the code page (reserve: 1,768 B).
The core has no heap, no float and no library call. Its only external call is the reader callback.
The test image uses tree A values only. The device has no trusted exit km, so forward mode is off.

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

## Device adapter (test image, not installed)

`wb_device.c` replaces one word: the literal of `tramp_rt` at `0x420496b8` (was `cc_rt`, `0x421dd920`). `wb_rt` calls `cc_rt` first.
The map frame (`0x4204da24`) makes one hooked route call for each frame, so the adapter runs one time for each frame.
On the route, the test image writes `wb3` and does nothing else. This text shows that the hook runs. A release image must not have it.
While the off-route byte (`0x3c3894f0 + 145`) is set, the adapter does the steps below. It has no stored state.

1. Checks the free stack of the task (3,072 B or more), as `loop_start.c` does.
2. Takes the position through `cc_pos` with a zero-wait navigation lock, as `cc_rt` does.
3. Finds the path of the first open route file in the open-file table of the firmware (zero-wait lock).
4. Opens that file a second time for reading. It never moves the position of the firmware's own handle.
5. Reads the trailer, mounts the data, runs one tick and reads at most 32 points. A read later than 300 ms after the frame start fails (raw timer `0x403779f4`).
6. Closes the file. Draws the line two times through the projection callback (`0x4204c1bc`): operation 17 (white, 7 px), then 14 (dark purple, 4 px).
7. Writes a text at the top left of the map: the ride distance to the route in metres, or a code, and then the time of this work in ms.

| Text | Cause |
|---|---|
| `123m 45` | A line is drawn. 123 m is the ride distance to the route. The work took 45 ms. |
| `wb3` | The rider is on the route (test image only). |
| `wb2 45` | No position, no route list, or the navigation lock is busy. |
| `wb4 45` | No stored street within 15 m. |
| `wb5 45` | A file read failed, or the 300 ms limit was reached. |
| `wb6 45` | The open-file table lock is busy. |
| `wb7 45` | No open route file, no way-back data at its end, or the data is refused by `wb_mount`. |
| `wb8 45` | Less than 3,072 B of stack are free. No file call is made. |
| `wb9 45` | The second open of the route file failed. |

**Way-back data in the route file.** `tools/wayback_embed.mjs` appends the way-back file to the route file.
The route bytes do not change. The last 12 bytes are the trailer: `CCWT`, `u32` offset, `u32` size.
The identity check of `wb_mount` gets the identity from the data itself. The binding is that the data is inside its route file.

**Firmware functions used** (stock V1.414). `fopen` `0x421b85b0`, `fseek` `0x421b8848` and `fread` `0x421b8818` are each confirmed at two or more call sites.
`fclose` `0x421b7de0` has one call site; its body agrees with `_fclose_r` of the toolchain `libc.a`. Also:
open-file table `0x3c380124` (132 B records: handle, name) with count `0x3fc9f5fc` and lock `0x3fc9f600`,
route file handles `0x3c388418` (6 types). The other addresses are those of the v21 patch (`fw.h`, `blk.c`, `arrow.c`, `map.c`).

**Build.** `python3 -I tools/wayback_device_build.py --output .local/wayback/device`. The builder accepts only the exact cc23 image
(SHA-256 `6146fb25…`), checks the hook bytes and the called entries, and allows changes only in the hook word, the new tail and the version text.
It never writes to the device.

**Gaps of the adapter.**

- Not run on the device. File read time, stack use of the firmware file calls and drawing time are not measured.
- The cause of the cc24 map-view restart is not known. The adapter draws on the same path.
- The firmware's own open function (`0x4200ab60`) refuses a file that is already open. The adapter opens the route file a second time with `fopen` directly. The file system may refuse this (`wb9`).
- The firmware reads the appended route file for the first time in the device test. The effect of the larger file is not known.
- A fresh mount for each frame has no memory of the last street piece. The line can change between two near pieces.
- With more than one open route file (after a reroute from the app), the adapter uses the first one.
- The text position (6, 6) can be under a stock widget. Not checked on the screen.
- The host tests were written after the adapter code.

## Files

- `wayback.h`, `wayback.c`: the core.
- `wb_device.c`, `wb_device.ld`, `wb_tramp.S`: the device adapter. `tools/wayback_device_build.py`: the test image. `tools/wayback_embed.mjs`: way-back data into a route file.
- `tools/wayback_device_host.c`, `tools/test_wayback_device.mjs`, `tools/test_wayback_device_build.py`: adapter tests on the host.
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
