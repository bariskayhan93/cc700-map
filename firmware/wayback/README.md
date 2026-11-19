# Way-back core (host only)

## Status

A first test image (`cc23wb1`) was on the device on 16 November 2026. It drew no line: each off-route frame reached the 300 ms limit (`wb5`), because the cell search made about 500 small file reads at the median.
The core now reads node records in blocks of 16 and filters by distance before it loads a second node. On the host this gives about 100 to 130 reads at the median with identical output. The time of one read on the device is not measured. This image (`cc23wb1` text, SHA-256 `25877b1b…`, on the cc23 with the trampoline fix) is on the test unit since 17 November 2026, 00:30 local time. No ride result exists yet.
The core with the adapter is 4,284 B of Xtensa code. The usable room is 4,376 B. 1,860 B stay free in the code page (reserve: 1,768 B).
The core has no heap, no float and no library call. Its only external call is the reader callback.
Forward mode is removed from the core (cc26, R-D2). The installed test image (cc23wb2fix) was built from the core of commit `6091401` with `-DWB_NO_FWD`; its builder is retired (sources at `d9aa2f8^`). The device has no trusted exit km, so it uses tree A values only. The version 2 core has no forward code.

## How the line is made

```
   stored street points: each stores its next point and its distance to the route

        o--->o--->o--->o                      R = route
                       |                      o = stored street point
                       v                      > = direction of "next" (not a one-way sign)
   P ~ ~ x--->o--->o-->R=====R=====R          P = rider, x = nearest point on a stored piece
     (15 m or less)                           line: x, o, o, R
```

1. The host (`tools/wayback_build.mjs`) calculates the shortest permitted street way to the route for each street point within the reach. Each stored point keeps only its next point and its distance.
2. The device finds the stored street piece nearest to the rider. The piece must be within 15 m. The search reads the 3 x 3 cells of 128 m around the rider.
3. The line starts at the nearest point on that piece. Then it goes from point to next point until the route. The test image draws the first 32 points and makes the line again on each map frame.

- The heading and the speed of the rider have no effect. The line goes by street to the nearest route point, which can be behind the rider. There is no forward mode in version 2 (`forward` is always 0).
- No stored street within 15 m (yard, field, building, bad GPS), or a street with no permitted way to the route: no line. The stock off-route arrow stays.
- `node tools/wayback_draw.mjs <route.bin> <file.ccwb> <out.html>` makes an interactive page of an 800 m x 600 m part of a route. The pointer is the rider, and the line for each 4 m square comes from the real core. A page of a private route holds real street geometry, so keep it in `.local/`. `docs/way-back-demo.html` is this page for a part of the public Düsseldorf Tour D3, and `tools/wayback_draw_svg.mjs` makes the static picture `docs/comparison/way-back-demo.svg` from it.

## Page option (test)

The page has the option "Rückweg-Linie (Test)" in the patch settings. The default is off, and the route file is then unchanged.
With the option on, the page loads the streets in the box of the route plus 2.2 km from Overpass (node ids, way tags, turn restrictions), builds the tree and appends the data after the checked route file.

- The page writes no way-back data when the street data is not complete, when the box exceeds 600 km², or when the data exceeds 1,536 KB at both reaches (2 km, then 1.5 km), or when the file with the data exceeds the 4,000,000 B limit of the page. The plain route file stays, and the summary line gives the cause.
- One short route was compared: the page data from Overpass and the host data from the PBF snapshot are byte-identical (210,916 B, 15,982 stored nodes). This is one route on one day.
- Not measured: a long route. A 70 km loop can exceed the 600 km² box. The load time and memory on a phone are not measured.
- Only the way-back test firmware reads the data. The effect of the longer file on other firmware is not tested, except that the test unit opened and followed such a route.

## Normal behaviour

The rider is off the route and at most 15 m from a stored street piece. The core gives a line along
the stored streets to the route. It gives the ride distance to the route in decimetres.
The line has up to 4,096 points. Point 0 is the nearest point on the piece. Point 1 is the end node.

## Admission

`wb_mount` accepts a file only when all of these hold:

- The magic is `CCWB` and the version is 2. Version 1 files are refused (`WB_NO_FILE`).
- The route identity (16 bytes) equals the route identity of the caller.
- The scale fields are not 0.
- The header and the section sizes add up to the file size.
- The flags bit 0 is 0 and the chunk count is 0: version 2 has no exception lists.
- The sentinel cell record matches the node count and the extra count.

The trusted exit flag (`WB_EXIT_TRUSTED`) has no effect in version 2.

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

- Tree values only. `forward` is 0. The distance is the end node's distance plus the way along the piece, so `WB_DIST_UNKNOWN` does not occur.

## Restoration

`wb_unmount` clears the engine. Removing the file restores the stock behaviour.
The core writes nothing. It changes no stock state.

## Device adapter (test image, on the test unit)

`wb_device.c` replaces one word: the literal of `tramp_rt` at `0x420496b8` (was `cc_rt`, `0x421dd920`). `wb_rt` calls `cc_rt` first.
The map frame (`0x4204da24`) makes one hooked route call for each frame, so the adapter runs one time for each frame.
It has no stored state. The switches come from the flags entry of the current map block (`firmware/common/types.h`):
`F_OWN` (bit 0) draws the way-back line with the raster module, `F_TEXT` (bit 1) adds the test text, `F_ROUTE` (bit 2)
lets the adapter open the route file on the route. A block without the flags entry has flags 0: cc26 behaviour.

1. Checks the free stack of the task (3,968 B or more), as `loop_start.c` does. Low stack: off the route `wb8`, on the route nothing.
2. Reads the switches under the block lock (`0x420494a4`, `0x420494b8`), the lock of `cc_iter`. On the route without `F_ROUTE`: stops (cc26).
3. Off the route: takes the position through `cc_pos` with a zero-wait navigation lock, as `cc_rt` does.
4. Finds the path of the first open route file in the open-file table of the firmware (zero-wait lock).
5. Opens that file a second time for reading. It never moves the position of the firmware's own handle.
6. Reads the section table (last 64 B, one read). Takes one heap buffer of 4,096 B (`heap_caps_malloc`, PSRAM) when the
   frame has a section for it: off the route the grey layer (type 2), on the route the elevation (type 3, Task 10).
7. Off the route: mounts the way-back data (type 1), runs one tick, reads at most 32 line points, then the grey: 4 anchors
   (op 23 through the projection), the view, and every line of the screen cells with the raster under the page caps.
   A read later than 300 ms after the frame start fails (raw timer `0x403779f4`). A line of more than 32 points is cut:
   the first 32 points from the rider are drawn, and the text has `+` after the distance.
8. Gives the heap buffer back and closes the file. Off the route draws the line two times through the projection callback
   (`0x4204c1bc`): operation 17 (white, 7 px), then 14 (dark purple, 4 px); with `F_OWN` both carry `OP_OWN`.
9. Writes a text at the top left of the map.

| Text | Cause |
|---|---|
| `123m` | Off the route, a line is drawn. 123 m is the ride distance to the route. |
| `123m w45 r30 g87` | The same with `F_TEXT`: 45 ms of work, 30 file reads, 87 grey lines. |
| `123m w45 r30 g60+` | Not every grey line of the screen cells is drawn: a page cap or a read error. |
| `123m w45 r12 wb11` | No heap buffer: no grey. The line is drawn. |
| `820m+ w150 r20 g0` | The line has more than 32 points: only its first 32 points (from the rider) are drawn. |
| `wb2` | No position, no route list, or the navigation lock is busy. |
| `wb4` | No stored street within 15 m. |
| `wb5` | A file read failed, or the 300 ms limit was reached. |
| `wb6` | The open-file table lock is busy. |
| `wb7` | No open route file, no way-back section, or the data is refused by `wb_mount` (also a cc26 file). |
| `wb8` | Less than 3,968 B of stack are free. No lock and no file call is made. |
| `wb9` | The second open of the route file failed. |
| `e1 w12` | On the route with `F_ROUTE` and `F_TEXT`: no elevation section (Task 10 adds the other codes). |

With `F_TEXT` each `wb<code>` off the route also has the tail ` w<ms> r<reads> g<lines>`.

**Sections in the route file.** `js/wayback_embed.js` (page) and `tools/wayback_embed.mjs` (host) append the sections
and the table; the route bytes do not change. The identity check of `wb_mount` gets the identity from the data itself.
The binding is that the data is inside its route file.

**Firmware functions used** (stock V1.414). `fopen` `0x421b85b0`, `fseek` `0x421b8848` and `fread` `0x421b8818` are each confirmed at two or more call sites.
`fclose` `0x421b7de0` has one call site; its body agrees with `_fclose_r` of the toolchain `libc.a`. Also:
open-file table `0x3c380124` (132 B records: handle, name) with count `0x3fc9f5fc` and lock `0x3fc9f600`,
route file handles `0x3c388418` (6 types). The other addresses are those of the v21 patch (`fw.h`, `blk.c`, `arrow.c`, `map.c`).

**Build.** `python3 -I tools/cc26_build.py --output <dir>` builds the cc26 image (see `docs/releases/cc26-2026-11-18.md`).
It never writes to the device. `tools/wayback_device_build.py` keeps only the shared callee checks and the build mark.

**Gaps of the adapter.**

- Not run on the device. File read time, stack use of the firmware file calls and drawing time are not measured.
- The cause of the cc24 map-view restart is not known. The adapter draws on the same path.
- The firmware's own open function (`0x4200ab60`) refuses a file that is already open. The adapter opens the route file a second time with `fopen` directly. The file system may refuse this (`wb9`).
- The firmware reads the appended route file for the first time in the device test. The effect of the larger file is not known.
- A fresh mount for each frame has no memory of the last street piece. The line can change between two near pieces.
- With more than one open route file (after a reroute from the app), the adapter uses the first one.
- The text position (6, 6) can be under a stock widget. Not checked on the screen.
- The anchors assume that the stock projection is affine on the screen area (a fourth anchor checks it in each frame). Not checked on the device.
- The host tests were written after the adapter code.

## Files

- `wayback.h`, `wayback.c`: the core.
- `wb_device.c`, `wb_area2.ld`, `wb_tramp.S`: the device adapter. `tools/cc26_build.py`: the device image. `tools/wayback_embed.mjs`: way-back data into a route file.
- `tools/wayback_device_host.c`, `tools/test_wayback_device.mjs`, `tools/test_wayback_device_build.py`: adapter tests on the host.
- `tools/wayback_host.c`: host command. `tools/wayback_core_host.mjs`: builds it and runs it.
- `js/wayback_tree.js`: model. `js/wayback_format.js`: file format. `js/wayback_embed.js`: trailer. `js/routing_snapshot.js`, `js/recovery_transitions.js`, `js/recovery_graph.js`: street graph. `js/native_route.js`: route points. The files of the same name in `tools/` export this code again.
- `js/wayback.js`: the build path of the page and of `tools/wayback_build.mjs`. `tools/test_wayback_page.mjs`: its test.
- `tools/wayback_build.mjs`: private inputs to a file and a size report. `tools/wayback_replay.mjs`: replay on the recorded ride.
- `tools/wayback_size.py`: code size on the Xtensa target.
- `tools/wayback_draw.mjs`, `tools/wayback_draw.html`: interactive drawing of the stored streets and the line.

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
| 4 | u16 | version = 2 |
| 6 | u16 | flags; bit 0 = the file has exception lists (0 in version 2) |
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
| 60 | u32 | `chunk_count` (0 in version 2) |

**Sections, in this order, with no padding**

1. **Cells:** `cell_count + 1` records of 12 bytes: `key u32`, `first_node u32`, `first_extra u32`. Sorted by key. The last record is a sentinel: key `0xFFFFFFFF`, `first_node = node_count`, `first_extra = extra_count`.
2. **Nodes:** `node_count` records of 8 bytes (version 2, see below). Sorted by cell key. A node with no next is on the route.
3. **Extra pieces:** `extra_count` records of 8 bytes: `a u24`, `b u24`, `lenflags u16` (version 2: bits 0 to 12 length in 0.1 m, at most 8,191; bit 13 grey flag; bit 14: the rider can go to `a`; bit 15: the rider can go to `b`). A record is in the cell of node `a`. Sorted by that cell key.
4. **Chunk table and exceptions:** version 1 only. Version 2 files have none.

**Version 2 node (E7, D1b), one little-endian u64:**

| Bits | Field |
|---|---|
| 0 to 18 | `X / 2` (stored halved, 1/8 m; the core reads `2 * value`) |
| 19 to 37 | `Y / 2` |
| 38 to 50 | next minus node index, signed 13 bits (0 = no next) |
| 51 to 62 | ride distance to the route in whole metres (at most 4,095) |
| 63 | grey flag of the piece from this node to its next |

A version 2 file of a route with a 3 km way-back reach does not fit (the distance field is 12 bits). The page uses the 2 km or 1.5 km reach.

**Shared scan and the piece line (cc26, D2).**

- `wb_scan` visits the street pieces of a rectangle of cells (at most 7 across), rows up, then cells in x order, then the tree pieces and the extra pieces of each cell in index order. A piece is visited when its start node lies in the box `x0..x1`, `y0..y1` (`wb_out`, the same test as the old far test when the box is one point).
- `wb_tick` is `wb_scan` of the 3 x 3 cells around the rider with the box of the rider point, then the commit of the best piece. Its output is unchanged from version 1 within the precision below.
- `wb_tick_piece(id)` gives the line of one piece by its id. The id of `wb_output.piece` (E10): bits 0 to 22 node index of a tree piece or extra index, bit 23 extra piece. A piece farther than 15 m gives `WB_NO_STREET`.
- `wb_units`, `wb_point` and `wb_grid_get` convert between E7 and units with the frame of the file. `wb_line_info` gives the end distance, the length and the end side of the line.

**Precision of version 2 against version 1 (R-PREC).** The stored node positions are halved, so:

- A node point differs from version 1 by at most 2 units.
- The foot point (point 0) differs by at most one step of the piece plus 2 units, that is `ceil(piece length / 256) + 2` units on each axis. The step is 1/256 of the piece.
- A state can differ only when the rider is 14.5 m to 15.5 m from the nearest street. The replay test prints the count (1 of 1,500 on the synthetic grid).


The file size must be exactly the header plus the five sections.
