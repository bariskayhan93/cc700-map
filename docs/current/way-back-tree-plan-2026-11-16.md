# Way-Back Street Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, on the host only, the way-back feature "street tree A plus exceptions": a generator that writes one way-back file for a route, a small C core that finds the line back to the route, a replay on the recorded ride, and a code-size measure.

**Architecture:** The generator runs a reversed shortest-way search from the route over the bicycle street graph. Each street node stores the next node toward the route and the ride distance (tree A). For each route km, a short exception list holds the nodes where the forward way is different. The C core finds the street piece within 15 m of the rider and follows the stored next values. The drawing code of the map patch gets the line as a list of points; that adapter is not built in this plan.

**Tech Stack:** Node.js ES modules with `node:test` (generator, tests, replay). Freestanding C11 (core). `cc` for the host build. `~/xtensa-esp-elf/bin/xtensa-esp32s3-elf-gcc` for the size measure. Python 3 for the size script.

**Spec:** No separate spec exists. The section "Decisions" below is the spec. Read also `AGENTS.md`.

## Decisions (made by the owner or measured on 16 Nov)

- **Policy:** strict. Use only ways where the map data permits a bicycle.
- **Order:** tree A first. Exception lists second.
- **Reach `line2k` (default):** store each street node that is at most 2,000 m from the route in a straight line and at most 4,000 m by ride.
- **Reach `ride1500` (fallback):** store each street node that is at most 1,500 m from the route by ride.
- **Fallback in the core:** if the exit km is not trusted, or the file has no exception lists, the core uses the tree A values.
- **Forward window:** for route km `c`, a forward line can end on the route from `c*1000 - 50 - R` to `c*1000 + 4000` metres. `R` is 4,000 for `line2k` and 1,500 for `ride1500`. A line can thus end behind the exit on the same pass of the route. Measurement: this causes no extra ride. The exception lists correct only the case where the nearest route part is a different pass.
- **Match limit:** the rider must be at most 15 m from a stored street piece. If not, the core shows no line.
- **Scope end:** a host-proven core and a written drawing contract. No device step. No app change.
- **Reference prototypes (private, on this machine, read only):** `.local/eq/tree-proto.mjs`, `.local/eq/tree-middle.mjs`, `.local/eq/tree-economy.mjs`. They show the search and the replay loop. `.local/eq/tree-records.mjs` counts the records of this plan's format on the recorded ride; its results are the expected values in Tasks 5 and 7.

## Global Constraints

- Host only. Do not run `esptool`, `flash.sh`, or any command that opens a USB or serial device.
- Do not edit files in `../cc700-patch`, `firmware/recovery/`, `js/`, or `docs/STATUS.md`.
- Seven files have uncommitted changes from other work. Do not stage them. Each commit step uses `git add` with the named files only. Never use `git add -A`, `git add .` or `git commit -a`.
- Never push.
- This repository is public. Do not write coordinates, ride data or `.local/` content into a committed file. Private outputs go to `.local/wayback/` (git ignores `.local/`).
- Test fixtures are synthetic, near latitude 51 and longitude 7.
- Write docs and commit messages in ASD-STE100 (short sentences, one idea in each sentence, active voice).
- The core has no heap, no float, no `sqrt`, no 64-bit division, and no library call other than the reader callback.
- Do not change a number in "Decisions". Do not add options that this plan does not name.
- If a step fails and the fix is not in this plan, stop and report. Do not weaken a test.
- All numbers in the results doc must come from a command that you ran. If a value is missing, write "not measured".

## Review Focus

1. **Rider outside the stored area or outside the grid** (negative offset from the origin): the core must return no line with reason `WB_NO_STREET`. It must not read outside the file. Test in Task 3.
2. **Truncated or wrong file** (short file, wrong magic, wrong route identity, section sizes larger than the file): `wb_mount` must return 0. Test in Task 3.
3. **A reader callback that fails in the middle of a line:** `wb_read_point` must return 0 and the core must drop the line state. Test in Task 3.
4. **One-way streets:** the line must not use a street against its direction. Tests in Task 1 and Task 3.
5. **Exit km at or after the route end, or a chunk number that is not in the file:** the core must use tree A. Test in Task 6.

## File Structure

| File | Responsibility |
|---|---|
| `tools/wayback_tree.mjs` | Build the model (nodes, extra pieces, exception lists) from a graph and a route. No file IO. |
| `tools/wayback_format.mjs` | Coordinate frame, `encodeWayback`, `decodeWayback`. No graph search. |
| `tools/wayback_fixture.mjs` | Synthetic graphs and routes for the tests. |
| `firmware/wayback/wayback.h`, `wayback.c` | The C core. |
| `firmware/wayback/README.md` | Contract of the core and the drawing contract. |
| `tools/wayback_host.c` | Host command: reads a file and positions, prints core results as JSON lines. |
| `tools/wayback_core_host.mjs` | Builds the host command with `cc` and runs it. Used by tests and replay. |
| `tools/wayback_build.mjs` | CLI: private inputs to a way-back file and a size report. |
| `tools/wayback_replay.mjs` | CLI: runs the core on the off-route frames of the recorded ride. |
| `tools/wayback_size.py` | Xtensa object size and undefined symbols. |
| `tools/test_wayback_tree.mjs`, `test_wayback_format.mjs`, `test_wayback_core.mjs` | Tests. |
| `docs/research/way-back-tree-2026-11-16.md` | Results and gaps. |

## File format CCWB version 1

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

---

### Task 1: Tree A model

**Files:**
- Create: `tools/wayback_fixture.mjs`, `tools/wayback_tree.mjs`
- Test: `tools/test_wayback_tree.mjs`
- Modify: `tools/validate_local.py` line 64 (add `"tools/test_wayback_tree.mjs"` to the node test list)

**Interfaces:**
- Consumes: `hav(a, b)` from `js/geo.js` (metres between two `[lat, lon]`).
- Produces:
  - `gridFixture()` in `tools/wayback_fixture.mjs`, returns `{graph, route, p}`. `p(x, y)` gives `[lat, lon]` for local metres: `[51 + y/111320, 7 + x/(111320*Math.cos(51*Math.PI/180))]`.
  - `buildWaybackModel(graph, route, {reach = 'line2k', exceptions = false} = {})` in `tools/wayback_tree.mjs`.
    - `graph`: `{nodes: [{id, point: [lat, lon]}], edges: [{from, to, meters}]}`. Edges are directed.
    - `route`: `[{point: [lat, lon], progress}]`, `progress` in cm (the output of `readNativeRoute`).
    - Returns `{nodes: [{point, next, dist, progress}], extras: [{a, b, meters, toA, toB}], chunks: [], stats}`. `next` is an index into `nodes` or `-1`. `dist` is metres. `progress` is an array of route distances in metres for a node on the route, and `[]` for other nodes. `a` and `b` are indexes into `nodes`.

**The grid fixture** (all edges in both directions, if not stated; `meters` = `hav` of the two points):

- Route points: `p(-300,0)` progress 0, `p(300,0)` progress 60000.
- Graph nodes on the route: `(-300,0)`, `(0,0)`, `(220,0)`, `(300,0)`, with edges between neighbours.
- Street x=0: nodes `(0,50)`, `(0,100)`, `(0,150)`, `(0,200)`, joined in a chain from `(0,0)`.
- Top street: `(0,200)` – `(100,200)` – `(220,200)`.
- Right street: `(220,200)` – `(220,100)` – `(220,0)`.
- One-way: node `(-100,100)` with one edge `(-100,100)` → `(0,100)` only.
- Long street: node `(0,1800)` with an edge to `(0,200)` (1,600 m).

**Model rules:**

1. **Split long edges first.** Replace each edge longer than 100 m with equal pieces of at most 100 m. The edge `u→v` and its reverse `v→u` must use the same new nodes.
2. **Route nodes.** Make route sample points each 5 m along the route. A graph node is on the route if a sample is at most 8 m away. Its `progress` is the list of the sample distances (metres) that are at most 8 m away.
3. **Search.** Run a reversed Dijkstra search from all route nodes at distance 0 over the directed edges. For an edge `u→v`, if `dist(v) + meters < dist(u)`, set `dist(u)` and `next(u) = v`.
4. **Stored set.** `ride1500`: nodes with `dist <= 1500`. `line2k`: nodes with `dist <= 4000` and straight-line distance to the route `<= 2000` (measure against route samples each 25 m). Then add each node on the `next` chain of a stored node.
5. **Extra pieces.** For each pair `{u, v}` of stored nodes with an edge in one or two directions, where `next(u) != v` and `next(v) != u`: one record `{a: u, b: v, meters, toA: edge v→u exists, toB: edge u→v exists}`.
6. `stats`: `{graphNodes, routeNodes, stored, extras, noWay}` (`noWay` = nodes with no way to the route).

- [ ] **Step 1: Write the fixture and the failing tests**

```js
// tools/test_wayback_tree.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hav} from '../js/geo.js';
import {gridFixture} from './wayback_fixture.mjs';
import {buildWaybackModel} from './wayback_tree.mjs';
const {graph, route, p} = gridFixture();
const at = (m, x, y) => { const i = m.nodes.findIndex(n => hav(n.point, p(x, y)) < 1); assert(i >= 0, `no node at ${x},${y}`); return i; };
const near = (a, b, tol = 1.5) => assert(Math.abs(a - b) <= tol, `${a} is not near ${b}`);

test('each node stores the next node and the ride distance to the route', () => {
  const m = buildWaybackModel(graph, route, {reach: 'line2k'});
  const n = m.nodes[at(m, 0, 100)];
  near(n.dist, 100); assert.equal(n.next, at(m, 0, 50));
  const t = m.nodes[at(m, 100, 200)];
  near(t.dist, 300); assert.equal(t.next, at(m, 0, 200));
  const r = m.nodes[at(m, 0, 0)];
  assert.equal(r.next, -1); assert.equal(r.dist, 0); assert(r.progress.some(g => Math.abs(g - 300) <= 8));
});
test('an edge longer than 100 m gets new nodes, and the piece with no tree edge is an extra piece', () => {
  const m = buildWaybackModel(graph, route, {reach: 'line2k'});
  const mid = at(m, 160, 200);
  near(m.nodes[mid].dist, 260); assert.equal(m.nodes[mid].next, at(m, 220, 200));
  const a = at(m, 100, 200);
  const x = m.extras.find(e => (e.a === a && e.b === mid) || (e.a === mid && e.b === a));
  assert(x); near(x.meters, 60); assert(x.toA && x.toB);
});
test('a one-way street is used only in its direction', () => {
  const m = buildWaybackModel(graph, route, {reach: 'line2k'});
  const n = m.nodes[at(m, -100, 100)];
  near(n.dist, 200); assert.equal(n.next, at(m, 0, 100));
  assert(m.nodes.every((q, i) => q.next !== at(m, -100, 100)));
});
test('reach ride1500 drops nodes that are more than 1,500 m of ride from the route', () => {
  const far = buildWaybackModel(graph, route, {reach: 'line2k'});
  near(far.nodes[at(far, 0, 1800)].dist, 1800, 3);
  const m = buildWaybackModel(graph, route, {reach: 'ride1500'});
  assert(m.nodes.every(n => n.dist <= 1500));
  assert(m.nodes.some(n => hav(n.point, p(0, 1500)) < 1));
});
test('the distance decreases along each next chain and the chain ends on the route', () => {
  const m = buildWaybackModel(graph, route, {reach: 'line2k'});
  m.nodes.forEach((n, i) => { let k = i, steps = 0; while (m.nodes[k].next >= 0) { const q = m.nodes[m.nodes[k].next]; assert(q.dist < m.nodes[k].dist); k = m.nodes[k].next; assert(++steps < 1000); } assert.equal(m.nodes[k].dist, 0); });
});
```

- [ ] **Step 2: Run the tests and make sure that they fail**

Run: `node --test tools/test_wayback_tree.mjs`
Expected: FAIL, `Cannot find module` for `wayback_tree.mjs`.

- [ ] **Step 3: Write `buildWaybackModel` to the model rules above**

Use a binary heap for the search. The search loop in `.local/eq/tree-proto.mjs` is the reference.

- [ ] **Step 4: Run the tests and make sure that they pass**

Run: `node --test tools/test_wayback_tree.mjs`
Expected: 5 tests pass.

- [ ] **Step 5: Add the test to `tools/validate_local.py` line 64 and commit**

```bash
git add tools/wayback_fixture.mjs tools/wayback_tree.mjs tools/test_wayback_tree.mjs tools/validate_local.py
git commit -m "Add the way-back street tree model"
```

---

### Task 2: File format

**Files:**
- Create: `tools/wayback_format.mjs`
- Test: `tools/test_wayback_format.mjs`
- Modify: `tools/validate_local.py` line 64 (add the test)

**Interfaces:**
- Consumes: the model of Task 1.
- Produces:
  - `makeFrame(points)` → `{lat0E7, lon0E7, latU, lonU, latE, lonE, toUnits([lat, lon]) → [X, Y], toE7(X, Y) → [latE7, lonE7]}`. `points` is a list of `[lat, lon]`.
  - `encodeWayback(model, routeId)` → `Uint8Array`. `routeId` is a `Uint8Array` of 16 bytes.
  - `decodeWayback(bytes)` → `{header, cells, nodes: [{X, Y, next, distDm}], extras: [{a, b, lenDm, toA, toB}], chunks: [[{node, next, distM}]]}`. `next` is `-1` for `NONE`. It throws an `Error` if the magic, the version or the file size is wrong.

**Encoder rules:** follow "File format CCWB version 1". Sort the nodes by cell key (keep the model order inside a cell) and change all indexes to the new order. Throw an `Error` if a node count is `>= 0xFFFFFF`, if a tree edge or an extra piece is longer than 1,700 units, or if a `dist` does not fit its field.

- [ ] **Step 1: Write the failing tests**

```js
// tools/test_wayback_format.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gridFixture} from './wayback_fixture.mjs';
import {buildWaybackModel} from './wayback_tree.mjs';
import {makeFrame, encodeWayback, decodeWayback} from './wayback_format.mjs';
const {graph, route, p} = gridFixture();
const model = buildWaybackModel(graph, route, {reach: 'line2k'});
const id = Uint8Array.from({length: 16}, (_, i) => i + 1);

test('the frame converts to units and back with an error below 0.2 m', () => {
  const f = makeFrame(model.nodes.map(n => n.point));
  for (const [x, y] of [[0, 0], [220, 200], [-300, 0], [0, 1800]]) {
    const q = p(x, y), [X, Y] = f.toUnits(q), [la, lo] = f.toE7(X, Y);
    assert(X >= 0 && Y >= 0 && Number.isInteger(X) && Number.isInteger(Y));
    assert(Math.abs(la - Math.round(q[0] * 1e7)) <= 18 && Math.abs(lo - Math.round(q[1] * 1e7)) <= 28);
  }
  const [x0] = f.toUnits(p(0, 0)), [x1] = f.toUnits(p(100, 0));
  assert(Math.abs((x1 - x0) / 16 - 100) < 0.2);
});
test('encode then decode keeps every node, next value, distance and extra piece', () => {
  const bytes = encodeWayback(model, id), d = decodeWayback(bytes);
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'CCWB');
  assert.deepEqual([...bytes.slice(8, 24)], [...id]);
  assert.equal(d.nodes.length, model.nodes.length); assert.equal(d.extras.length, model.extras.length);
  assert.equal(bytes.length, 64 + (d.header.cellCount + 1) * 12 + d.nodes.length * 12 + d.extras.length * 8);
  const f = makeFrame(model.nodes.map(n => n.point));
  const key = n => f.toUnits(n.point).join(',');
  const want = new Map(model.nodes.map(n => [key(n), {dist: Math.round(n.dist * 10), next: n.next < 0 ? null : key(model.nodes[n.next])}]));
  for (const n of d.nodes) { const w = want.get(n.X + ',' + n.Y); assert(w); assert.equal(n.distDm, w.dist); assert.equal(n.next < 0 ? null : d.nodes[n.next].X + ',' + d.nodes[n.next].Y, w.next); }
});
test('nodes are sorted by cell key and the cell table finds each node', () => {
  const d = decodeWayback(encodeWayback(model, id));
  const k = n => ((n.Y >> 11) << 16) | (n.X >> 11);
  d.nodes.forEach((n, i) => { if (i) assert(k(d.nodes[i - 1]) <= k(n)); const c = d.cells.find(c => c.key === k(n)); assert(c && i >= c.firstNode); });
  assert.equal(d.cells.at(-1).firstNode, d.nodes.length);
});
test('decode refuses a wrong magic and a wrong size', () => {
  const bytes = encodeWayback(model, id);
  assert.throws(() => decodeWayback(bytes.slice(0, bytes.length - 1)));
  const bad = bytes.slice(); bad[0] = 88; assert.throws(() => decodeWayback(bad));
});
```

- [ ] **Step 2: Run the tests and make sure that they fail**

Run: `node --test tools/test_wayback_format.mjs`
Expected: FAIL, `Cannot find module` for `wayback_format.mjs`.

- [ ] **Step 3: Write `makeFrame`, `encodeWayback` and `decodeWayback`**

- [ ] **Step 4: Run the tests and make sure that they pass**

Run: `node --test tools/test_wayback_format.mjs tools/test_wayback_tree.mjs`
Expected: all tests pass.

- [ ] **Step 5: Add the test to `tools/validate_local.py` line 64 and commit**

```bash
git add tools/wayback_format.mjs tools/test_wayback_format.mjs tools/validate_local.py
git commit -m "Add the way-back file format"
```

---

### Task 3: C core for tree A, with the host command

**Files:**
- Create: `firmware/wayback/wayback.h`, `firmware/wayback/wayback.c`, `tools/wayback_host.c`, `tools/wayback_core_host.mjs`
- Test: `tools/test_wayback_core.mjs`
- Modify: `tools/validate_local.py` line 64 (add the test)

**Interfaces:**
- Consumes: `encodeWayback`, `decodeWayback`, `gridFixture`.
- Produces `firmware/wayback/wayback.h`, exactly:

```c
#pragma once
#include <stdint.h>
#include <stddef.h>
typedef int (*wb_reader)(void *ctx, uint32_t offset, void *dst, uint32_t bytes); /* 1 = ok, 0 = failed */
typedef struct wb_engine wb_engine;
enum { WB_NONE = 0, WB_LINE = 1 };                                             /* state */
enum { WB_OK = 0, WB_NO_FILE = 1, WB_GPS = 2, WB_ON_ROUTE = 3, WB_NO_STREET = 4, WB_READ = 5 }; /* reason */
enum { WB_GPS_VALID = 1, WB_OFF_ROUTE = 2, WB_EXIT_TRUSTED = 4 };              /* input flags */
typedef struct { int32_t lat_e7, lon_e7; uint32_t exit_progress_cm, flags; } wb_input;
typedef struct { uint32_t state, reason, distance_dm, forward, changed; } wb_output;
size_t wb_size(void);                       /* bytes that the caller must supply for wb_engine, at most 128 */
int wb_mount(wb_engine *, wb_reader, void *ctx, uint32_t file_bytes, const uint8_t route_id[16]);
void wb_unmount(wb_engine *);
void wb_tick(wb_engine *, const wb_input *, wb_output *);
int wb_read_point(wb_engine *, uint32_t index, int32_t point_e7[2]);
```

- Produces `runCore(fileBytes, routeId, lines)` in `tools/wayback_core_host.mjs`. It builds `tools/wayback_host.c` and `firmware/wayback/wayback.c` one time with `cc -std=c11 -O1 -g -Wall -Wextra -Werror -fsanitize=address,undefined -fno-sanitize-recover=all` into a temporary directory. `lines` is a list of `{latE7, lonE7, exitCm = 0, flags, maxPoints = 64, failReadAfter = -1}`. It returns one object for each line: `{mounted, state, reason, distanceDm, forward, changed, reads, points: [[latE7, lonE7], ...]}`.
- `tools/wayback_host.c`: `main(argc, argv)` gets the file path and the route identity as 32 hex characters. It reads lines `lat_e7 lon_e7 exit_cm flags max_points fail_read_after` from stdin. For each line it calls `wb_tick`, then `wb_read_point` with index 0, 1, 2, … until it returns 0 or `max_points` is reached, and prints one JSON line. Its reader counts the reads. If `fail_read_after >= 0`, the reader returns 0 after that number of reads in the `wb_read_point` phase. If `wb_mount` returns 0, it prints `{"mounted":0}` for each line.

**Core rules:**

1. `wb_mount`: read the header. Return 0 if the magic or the version is wrong, if `route_id` is different, if a scale field is 0, or if the header plus the section sizes is not equal to `file_bytes`. Keep the header values and the section offsets in the engine.
2. `wb_tick`, in this order:
   - Not mounted → `WB_NONE`, `WB_NO_FILE`.
   - `WB_GPS_VALID` not set → `WB_NONE`, `WB_GPS`.
   - `WB_OFF_ROUTE` not set → `WB_NONE`, `WB_ON_ROUTE`.
   - Convert the position to units. If an offset from the origin is negative, or X or Y is `>= 0x1000000` → `WB_NONE`, `WB_NO_STREET`.
   - For each of the 9 cells around the rider cell: find the cell record with a binary search on `key`. For each node `u` in the cell with `next != NONE`: the piece is `u → next(u)`. For each extra record in the cell: the piece is `a – b`. Measure each piece with the function below. Keep the piece with the smallest `d2`. The first piece wins if two are equal.
   - No piece with `d2 <= 57600` (15 m) → `WB_NONE`, `WB_NO_STREET`.
   - A failed read → `WB_NONE`, `WB_READ`.
   - Choose the end. Tree piece: the end is `next(u)`; `distance_dm = dist(u) - (dist(u) - dist(next(u))) * t / 256`. Extra piece: `cost_a = len * t / 256 + dist(a)` if bit 14 is set; `cost_b = len * (256 - t) / 256 + dist(b)` if bit 15 is set; the end is the smaller cost, and `distance_dm` is that cost. If no bit is set, ignore the piece.
   - Output `WB_LINE`, `WB_OK`, `forward = 0`. `changed = 1` if the piece or the end is different from the last tick with a line, or if the last tick had no line.
3. `wb_read_point`: valid only after a tick with `WB_LINE`. Index 0 is the nearest point on the piece. Index 1 is the end node. Index `k >= 2` is the `next` of the node of index `k - 1`. The caller must call it in the order 0, 1, 2, …; any other index returns 0. It returns 0 when the node of the last index has `next = NONE`. A failed read returns 0 and sets the engine to "no line".

**The piece measure** (32-bit integers; `P` is the rider, `A` and `B` are the piece ends, all in units):

```c
/* returns 1 and sets *d2 (units squared) and *t (0..256 from A to B), or 0 to skip the piece */
static int wb_measure(int32_t ax, int32_t ay, int32_t bx, int32_t by, uint32_t *d2, uint32_t *t) {
  /* ax..by are already relative to P */
  if (ax < -4095 || ax > 4095 || ay < -4095 || ay > 4095) return 0;
  int32_t dx = bx - ax, dy = by - ay;
  if (dx < -1700 || dx > 1700 || dy < -1700 || dy > 1700) return 0;
  uint32_t l2 = (uint32_t)(dx * dx + dy * dy);
  if (!l2) return 0;
  int32_t dot = -(ax * dx + ay * dy);
  uint32_t q = dot <= 0 ? 0 : (uint32_t)dot >= l2 ? 256 : (uint32_t)dot * 256u / l2;
  int32_t cx = ax + dx * (int32_t)q / 256, cy = ay + dy * (int32_t)q / 256;
  *d2 = (uint32_t)(cx * cx + cy * cy); *t = q; return 1;
}
```

Unit conversion in the core: `(uint32_t)(((uint64_t)(uint32_t)delta * scale_q16) >> 16)`. Read multi-byte fields from a byte buffer, byte by byte. Do not cast the buffer to a struct.

- [ ] **Step 1: Write the failing tests**

```js
// tools/test_wayback_core.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hav} from '../js/geo.js';
import {gridFixture} from './wayback_fixture.mjs';
import {buildWaybackModel} from './wayback_tree.mjs';
import {encodeWayback} from './wayback_format.mjs';
import {runCore} from './wayback_core_host.mjs';
const {graph, route, p} = gridFixture();
const id = Uint8Array.from({length: 16}, (_, i) => i + 1);
const file = encodeWayback(buildWaybackModel(graph, route, {reach: 'line2k'}), id);
const e7 = (x, y) => { const q = p(x, y); return {latE7: Math.round(q[0] * 1e7), lonE7: Math.round(q[1] * 1e7)}; };
const ll = pt => [pt[0] / 1e7, pt[1] / 1e7];
const isAt = (pt, x, y, tol = 1.5) => assert(hav(ll(pt), p(x, y)) <= tol, `${ll(pt)} is not at ${x},${y}`);
const ON = 3; // WB_GPS_VALID | WB_OFF_ROUTE

test('a rider near a street gets the line along the stored next values to the route', () => {
  const [r] = runCore(file, id, [{...e7(5, 120), flags: ON}]);
  assert.equal(r.state, 1); assert.equal(r.reason, 0); assert.equal(r.forward, 0); assert.equal(r.changed, 1);
  assert.equal(r.points.length, 4);
  isAt(r.points[0], 0, 120); isAt(r.points[1], 0, 100); isAt(r.points[2], 0, 50); isAt(r.points[3], 0, 0);
  assert(Math.abs(r.distanceDm - 1200) <= 20);
});
test('a rider on an extra piece goes to the end with the shorter way', () => {
  const [r] = runCore(file, id, [{...e7(130, 203), flags: ON}]);
  assert.equal(r.state, 1);
  isAt(r.points[0], 130, 200); isAt(r.points[1], 160, 200); isAt(r.points.at(-1), 220, 0);
  assert(Math.abs(r.distanceDm - 2900) <= 30);
});
test('a rider on the one-way street goes in its direction', () => {
  const [r] = runCore(file, id, [{...e7(-50, 102), flags: ON}]);
  assert.equal(r.state, 1); isAt(r.points[1], 0, 100);
});
test('no street within 15 m gives no line', () => {
  const [a, b] = runCore(file, id, [{...e7(60, 100), flags: ON}, {...e7(-5000, -5000), flags: ON}]);
  assert.deepEqual([a.state, a.reason, a.points.length], [0, 4, 0]);
  assert.deepEqual([b.state, b.reason, b.points.length], [0, 4, 0]);
});
test('invalid GPS and an on-route rider give no line', () => {
  const [a, b] = runCore(file, id, [{...e7(5, 120), flags: 2}, {...e7(5, 120), flags: 1}]);
  assert.deepEqual([a.state, a.reason], [0, 2]); assert.deepEqual([b.state, b.reason], [0, 3]);
});
test('changed is 1 on a new piece and 0 on the same piece', () => {
  const r = runCore(file, id, [{...e7(5, 120), flags: ON}, {...e7(5, 118), flags: ON}, {...e7(5, 70), flags: ON}]);
  assert.deepEqual(r.map(x => x.changed), [1, 0, 1]);
});
test('max points limits the line', () => {
  const [r] = runCore(file, id, [{...e7(5, 120), flags: ON, maxPoints: 2}]);
  assert.equal(r.points.length, 2);
});
test('mount refuses a short file, a wrong magic and a wrong route identity', () => {
  assert.equal(runCore(file.slice(0, file.length - 4), id, [{...e7(5, 120), flags: ON}])[0].mounted, 0);
  const bad = file.slice(); bad[0] = 88; assert.equal(runCore(bad, id, [{...e7(5, 120), flags: ON}])[0].mounted, 0);
  assert.equal(runCore(file, Uint8Array.from(id, v => v ^ 1), [{...e7(5, 120), flags: ON}])[0].mounted, 0);
});
test('a failed read in the middle of the line stops the line', () => {
  const [r, next] = runCore(file, id, [{...e7(5, 120), flags: ON, failReadAfter: 1}, {...e7(5, 120), flags: ON}]);
  assert(r.points.length < 4); assert.equal(next.changed, 1); assert.equal(next.points.length, 4);
});
test('200 seeded positions: each line starts near the rider, ends on the route, and has the stated length', () => {
  let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
  const pos = Array.from({length: 200}, () => [Math.round(rnd() * 700 - 350), Math.round(rnd() * 500 - 100)]);
  const out = runCore(file, id, pos.map(([x, y]) => ({...e7(x, y), flags: ON, maxPoints: 4096})));
  let lines = 0;
  out.forEach((r, i) => { if (r.state !== 1) return; lines++;
    const pts = r.points.map(ll);
    assert(hav(pts[0], p(...pos[i])) <= 15.5);
    assert(Math.abs((pts.at(-1)[0] - 51) * 111320) <= 1.5, 'the line must end on the route (y = 0)');
    let len = 0; for (let k = 1; k < pts.length; k++) { const d = hav(pts[k - 1], pts[k]); assert(d <= 101); len += d; }
    assert(Math.abs(len - r.distanceDm / 10) <= 3);
  });
  assert(lines >= 10);
});
```

- [ ] **Step 2: Run the tests and make sure that they fail**

Run: `node --test tools/test_wayback_core.mjs`
Expected: FAIL, `Cannot find module` for `wayback_core_host.mjs`.

- [ ] **Step 3: Write `wayback.h` (exact text above), `wayback.c` to the core rules, `wayback_host.c` and `wayback_core_host.mjs`**

- [ ] **Step 4: Run the tests and make sure that they pass**

Run: `node --test tools/test_wayback_core.mjs tools/test_wayback_format.mjs tools/test_wayback_tree.mjs`
Expected: all tests pass, with no sanitizer message.

- [ ] **Step 5: Add the test to `tools/validate_local.py` line 64 and commit**

```bash
git add firmware/wayback/wayback.h firmware/wayback/wayback.c tools/wayback_host.c tools/wayback_core_host.mjs tools/test_wayback_core.mjs tools/validate_local.py
git commit -m "Add the way-back core for tree A with a host command"
```

---

### Task 4: Code-size measure

**Files:**
- Create: `tools/wayback_size.py`

**Interfaces:**
- Produces: `python3 -I tools/wayback_size.py` prints one JSON object: `{"text": n, "literal": n, "rodata": n, "total": n, "room": 4376, "fits": true|false, "undefined": [names]}`. `total = text + literal + rodata`. If the compiler is not at `~/xtensa-esp-elf/bin/xtensa-esp32s3-elf-gcc`, it prints `{"error": "toolchain not found"}` and exits with code 2.

- [ ] **Step 1: Write the script**

Compile with exactly these flags (the same flags as `tools/loop_start_build.py`):

```
xtensa-esp32s3-elf-gcc -Os -mlongcalls -mtext-section-literals -ffreestanding -fno-builtin -c firmware/wayback/wayback.c -o <temporary>/wayback.o
xtensa-esp32s3-elf-size -A <temporary>/wayback.o
xtensa-esp32s3-elf-nm -u <temporary>/wayback.o
```

Sum the sections whose names start with `.text`, `.literal` and `.rodata`. `undefined` is the list of names from `nm -u`.

- [ ] **Step 2: Run it and record the result**

Run: `mkdir -p .local/wayback && python3 -I tools/wayback_size.py | tee .local/wayback/size-a.json`
Expected: a JSON object with `"undefined": []`.

For comparison, the old legs core (`firmware/recovery/recovery.c`) measures 5,394 B of `.text` with these flags and has two undefined symbols. The usable room is 4,376 B.

- If `undefined` is not empty: the core uses a library call. Find the C operation that causes it (a 64-bit division, a float, a struct copy) and replace it with 32-bit integer code. Run Task 3 Step 4 again.
- If `fits` is false: do not remove checks to make it fit. Record the value and continue. The owner decides.

- [ ] **Step 3: Commit**

```bash
git add tools/wayback_size.py
git commit -m "Add the way-back core size measure"
```

---

### Task 5: Build and replay on the recorded ride (tree A)

**Files:**
- Create: `tools/wayback_build.mjs`, `tools/wayback_replay.mjs`

**Interfaces:**
- Consumes: `buildWaybackModel`, `encodeWayback`, `runCore`; `readNativeRoute` from `tools/recovery_planner.mjs`; `buildTransitionGraph` from `tools/recovery_transitions.mjs`; `conservativeWayPolicy` from `tools/recovery_study.mjs`.
- The private config is `.local/eq/v4.json` with the keys `snapshot`, `route`, `track`, `timeline` (paths from the repository root).
- Produces:
  - `node tools/wayback_build.mjs <config.json> <out.ccwb> [--reach line2k|ride1500] [--exceptions] [--max-bytes N]` writes the file and prints one JSON report.
  - `node tools/wayback_replay.mjs <config.json> <file.ccwb> <line2k|ride1500>` prints one JSON report.

**Build rules:**

- Graph (strict policy), exactly:
  ```js
  buildTransitionGraph(snapshot, {wayPolicy: t => t.motorroad && t.motorroad !== 'no' ? {reason: 'motorroad-not-admitted'} : conservativeWayPolicy(t)})
  ```
- Route: `readNativeRoute(fs.readFileSync(config.route))`. Route identity: the first 16 bytes of the SHA-256 of the route file.
- `--max-bytes N`: if the file is larger than N with `line2k`, build it again with `ride1500`. If it is still larger, write no file and exit with code 3.
- Report: `{reach, exceptions, routeKm, bytes, sections: {header, cells, nodes, extras, chunkTable, exceptions}, kbPerKm, mbAt70km, totalAt70km: {routeFile2_5: n, routeFile4_0: n}, freeMb: 5.58, stats}`. `mbAt70km = bytes / routeKm * 70 / 1048576`. `totalAt70km` adds 2.5 and 4.0.

**Replay rules:**

- An episode is a run of timeline rows with `provider_reason === 'off-route'`.
- Exit progress of an episode: `original_progress_m` of the row before its first row. If the episode starts at row 0, the exit is not trusted.
- For each row `i` of an episode: position `track[i][1]` (latitude), `track[i][2]` (longitude); flags `WB_GPS_VALID | WB_OFF_ROUTE`, plus `WB_EXIT_TRUSTED` if the exit is trusted; `exitCm = exit * 100`; `maxPoints = 4096`.
- A frame "leads to the wrong part" if it has a line, its exit is trusted, and the last line point has no route sample (5 m spacing) within 10 m with a progress in the forward window of `c = floor(exit / 1000)`: from `c*1000 - 50 - R` to `c*1000 + 4000` metres. Read `R` from the build report of the file (`--reach`), given as a third argument `line2k` or `ride1500`.
- Report: `{frames, lineFrames, forwardFrames, distanceUnknown, wrongPart, noStreet, maxReadsPerFrame, maxPoints, episodes: [{exit, frames, lineFrames, wrongPart}]}`.

- [ ] **Step 1: Write both tools**

- [ ] **Step 2: Build the two tree A files and replay them**

```bash
node tools/wayback_build.mjs .local/eq/v4.json .local/wayback/a-line2k.ccwb --reach line2k | tee .local/wayback/a-line2k-build.json
node tools/wayback_build.mjs .local/eq/v4.json .local/wayback/a-ride1500.ccwb --reach ride1500 | tee .local/wayback/a-ride1500-build.json
node tools/wayback_replay.mjs .local/eq/v4.json .local/wayback/a-line2k.ccwb line2k | tee .local/wayback/a-line2k-replay.json
node tools/wayback_replay.mjs .local/eq/v4.json .local/wayback/a-ride1500.ccwb ride1500 | tee .local/wayback/a-ride1500-replay.json
```

Expected, from the prototype on the same ride:

- `frames` is 809; `lineFrames` is about 636; `wrongPart` is about 72, all in the episode with an exit near 21,815 m.
- File size: `ride1500` about 235,000 B (0.70 MB at 70 km); `line2k` about 471,000 B (1.39 MB at 70 km).

- If a file is more than 1.5 times its expected size: stop and report the section sizes.

- If `lineFrames` is below 600 or above 700, or `wrongPart` is above 150: stop and report. Do not change the 15 m limit.
- If `.local/eq/v4.json` is missing: record "not measured" and continue with Task 6.

- [ ] **Step 3: Commit**

```bash
git add tools/wayback_build.mjs tools/wayback_replay.mjs
git commit -m "Add the way-back build and replay tools"
```

---

### Task 6: Exception lists (forward way for each route km)

**Files:**
- Modify: `tools/wayback_fixture.mjs` (add `loopFixture`), `tools/wayback_tree.mjs`, `tools/wayback_format.mjs`, `firmware/wayback/wayback.h`, `firmware/wayback/wayback.c`
- Test: `tools/test_wayback_tree.mjs`, `tools/test_wayback_format.mjs`, `tools/test_wayback_core.mjs` (add tests)

**Interfaces:**
- Produces: `loopFixture()` → `{graph, route, p}`. `buildWaybackModel(..., {exceptions: true})` fills `chunks: [[{node, next, dist}]]` (indexes into `nodes`, `dist` in metres), one list for each route km. `encodeWayback` writes flags bit 0, the chunk table and the exception records when `chunks.length > 0`. `wb_tick` sets `forward = 1` when it uses a chunk.

**The loop fixture** (all edges in both directions). The route passes the street x=0 two times, 4,420 m apart:

- Route points: `p(-300,0)` progress 0; `p(2000,0)` progress 230000; `p(2000,420)` progress 272000; `p(-300,420)` progress 502000. The route is 5,020 m, so there are 6 chunks.
- Graph nodes on the route: `(-300,0)`, `(0,0)`, `(2000,0)`, `(2000,420)`, `(0,420)`, `(-300,420)`, with edges between neighbours along the route.
- Street x=0: nodes `(0,50)`, `(0,100)`, … `(0,400)` each 50 m, joined in a chain from `(0,0)` to `(0,420)`.
- The tests use the reach `ride1500`. The route node `(0,0)` has progress 300 m. The route node `(0,420)` has progress 4,720 m.

**Exception rules** (generator). `A` is the tree A result. `R` is 4,000 for `line2k` and 1,500 for `ride1500`.

For each chunk `c` from 0 to `ceil(route metres / 1000) - 1`:

1. Goals: the route nodes that have a `progress` value from `c*1000 - 50 - R` to `c*1000 + 4000`.
2. Forward search `F`: a reversed Dijkstra search from the goals, with the ride distance limited to `2*R + 4000`.
3. Own nodes: the stored nodes at most `R` of ride from the route nodes that have a `progress` value from `c*1000 - 50` to `c*1000 + 1000` (a second search with the limit `R`).
4. For a node `n` in `F`, `opt(n)` is the set of nodes `m` with an edge `n→m` and `F.dist(m) + meters <= F.dist(n) + 0.01`.
5. Visit each own node that is in `F`. From it, follow the forward chain: go to `A.next(n)` if it is in `opt(n)`, or else to the first node of `opt(n)`. Stop at `F.dist = 0` or at a node that was visited before.
6. A visited node `n` with `F.dist(n) > 0` gets a record `{node: n, next, dist: F.dist(n)}` only if `A.next(n)` is not in `opt(n)`. `next` is the node chosen in rule 5. Do not make a record because of a distance difference: that rule was measured and makes 7 times the records.
7. If the `next` of a record is not a stored node, drop the record and count it in `stats.droppedExceptions`.
8. Sort the records of the chunk by `node` (after the encoder changes the indexes, by the new index).

**Core rules** (additions to Task 3). Add `#define WB_DIST_UNKNOWN 0xFFFFFFFFu` to `wayback.h`.

- Forward mode is on in a tick if `WB_EXIT_TRUSTED` is set, `chunk_count > 0`, and `c = exit_progress_cm / 100000` is less than `chunk_count`. If not, the core works as in Task 3.
- `rec(n)`: the record of node `n` in chunk `c`, found with a binary search, or none. `enext(n)` is `rec(n).next` if a record exists, and the `next` of the node record if not.
- The match uses the same pieces as Task 3 (node records and extra records, not the exceptions).
- End of a tree piece `u → v` in forward mode: the end is `u` if `enext(v) == u`, and `v` if not. The way to the end is `len * t / 256` for `u` and `len * (256 - t) / 256` for `v`, with `len = dist(u) - dist(v)` from the node records.
- End of an extra piece in forward mode: as in Task 3.
- Distance from the end to the route (`end_dm`): go from the end along `enext`, at most 64 steps. At the first node `k` with a record: `end_dm = dist(end) - dist(k) + rec(k).dist * 10`. At a node with `enext = NONE`: `end_dm = dist(end)`. If neither occurs in 64 steps: not known. `dist()` is the value of the node record.
- `distance_dm` is the way to the end plus `end_dm`, or `WB_DIST_UNKNOWN`.
- Calculate the end and `end_dm` only when `changed` is 1. Keep them in the engine for the next ticks on the same piece.
- `wb_read_point` follows `enext`.
- `forward = 1` in the output. `changed = 1` also when the mode or the chunk is different from the last tick with a line.
- Stop a line after 4,096 points.

- [ ] **Step 1: Write the fixture and the failing tests**

```js
// add to tools/test_wayback_tree.mjs
import {loopFixture} from './wayback_fixture.mjs';
test('a chunk holds only the nodes whose forward next node is different from tree A', () => {
  const L = loopFixture(), m = buildWaybackModel(L.graph, L.route, {reach: 'ride1500', exceptions: true});
  const ix = (x, y) => m.nodes.findIndex(n => hav(n.point, L.p(x, y)) < 1);
  assert.equal(m.chunks.length, 6);
  assert.equal(m.nodes[ix(0, 150)].next, ix(0, 100));          // tree A goes to the first pass
  assert.equal(m.nodes[ix(0, 250)].next, ix(0, 300));          // tree A goes to the second pass
  const e = m.chunks[4].find(r => r.node === ix(0, 150));       // exit in km 4: go to the second pass
  assert(e); assert.equal(e.next, ix(0, 200)); near(e.dist, 270);
  assert(!m.chunks[4].some(r => r.node === ix(0, 250)));
  const f = m.chunks[0].find(r => r.node === ix(0, 250));       // exit in km 0: go to the first pass
  assert(f); assert.equal(f.next, ix(0, 200)); near(f.dist, 250);
  assert(!m.chunks[0].some(r => r.node === ix(0, 150)));
});
test('with exceptions off the model has no chunks', () => {
  const L = loopFixture();
  assert.deepEqual(buildWaybackModel(L.graph, L.route, {reach: 'ride1500'}).chunks, []);
});
```

```js
// add to tools/test_wayback_format.mjs
import {loopFixture} from './wayback_fixture.mjs';
test('exception lists survive encode and decode, sorted by node', () => {
  const L = loopFixture(), m = buildWaybackModel(L.graph, L.route, {reach: 'ride1500', exceptions: true});
  const bytes = encodeWayback(m, id), d = decodeWayback(bytes);
  assert.equal(d.header.flags & 1, 1); assert.equal(d.chunks.length, 6);
  assert.equal(d.chunks[4].length, m.chunks[4].length); assert(d.chunks[4].length > 0);
  d.chunks[4].forEach((r, i) => { if (i) assert(d.chunks[4][i - 1].node < r.node); });
  const n = d.chunks.reduce((s, c) => s + c.length, 0);
  assert.equal(bytes.length, 64 + (d.header.cellCount + 1) * 12 + d.nodes.length * 12 + d.extras.length * 8 + 7 * 4 + n * 8);
});
```

```js
// add to tools/test_wayback_core.mjs
import {loopFixture} from './wayback_fixture.mjs';
const L = loopFixture();
const loopFile = encodeWayback(buildWaybackModel(L.graph, L.route, {reach: 'ride1500', exceptions: true}), id);
const le7 = (x, y) => { const q = L.p(x, y); return {latE7: Math.round(q[0] * 1e7), lonE7: Math.round(q[1] * 1e7)}; };
const yOf = pt => (pt[0] / 1e7 - 51) * 111320;
test('a trusted exit in km 4 leads forward to the second pass of the route', () => {
  const [r] = runCore(loopFile, id, [{...le7(4, 150), flags: 7, exitCm: 450000}]);
  assert.equal(r.state, 1); assert.equal(r.forward, 1);
  assert(Math.abs(yOf(r.points.at(-1)) - 420) <= 1.5); assert(Math.abs(r.distanceDm - 2700) <= 30);
});
test('an exit that is not trusted uses tree A', () => {
  const [r] = runCore(loopFile, id, [{...le7(4, 150), flags: 3, exitCm: 450000}]);
  assert.equal(r.forward, 0); assert(Math.abs(yOf(r.points.at(-1))) <= 1.5); assert(Math.abs(r.distanceDm - 1500) <= 30);
});
test('a trusted exit in km 0 leads to the first pass, also from a node that is nearer to the second pass', () => {
  const [r, q] = runCore(loopFile, id, [{...le7(4, 150), flags: 7, exitCm: 10000}, {...le7(4, 270), flags: 7, exitCm: 10000}]);
  assert.equal(r.forward, 1); assert(Math.abs(yOf(r.points.at(-1))) <= 1.5); assert(Math.abs(r.distanceDm - 1500) <= 30);
  assert(Math.abs(yOf(q.points.at(-1))) <= 1.5); assert(Math.abs(q.distanceDm - 2700) <= 30);
});
test('an exit km that is not in the file uses tree A', () => {
  const [r] = runCore(loopFile, id, [{...le7(4, 150), flags: 7, exitCm: 900000}]);
  assert.equal(r.state, 1); assert.equal(r.forward, 0); assert(Math.abs(yOf(r.points.at(-1))) <= 1.5);
});
test('a file with no exception lists uses tree A with a trusted exit', () => {
  const [r] = runCore(file, id, [{...e7(5, 120), flags: 7, exitCm: 10000}]);
  assert.equal(r.forward, 0); assert.equal(r.points.length, 4);
});
test('changed is 1 when the exit km changes on the same piece', () => {
  const r = runCore(loopFile, id, [{...le7(4, 150), flags: 7, exitCm: 10000}, {...le7(4, 150), flags: 7, exitCm: 450000}]);
  assert.deepEqual(r.map(x => x.changed), [1, 1]);
});
```

- [ ] **Step 2: Run the tests and make sure that the new tests fail**

Run: `node --test tools/test_wayback_tree.mjs tools/test_wayback_format.mjs tools/test_wayback_core.mjs`
Expected: the new tests fail. The tests of Tasks 1 to 3 pass.

- [ ] **Step 3: Add `loopFixture`, the exception rules in `wayback_tree.mjs`, the chunk sections in `wayback_format.mjs`, and forward mode in `wayback.c`**

The forward search and the `opt` rule in `.local/eq/tree-middle.mjs` are the reference.

- [ ] **Step 4: Run all way-back tests and make sure that they pass**

Run: `node --test tools/test_wayback_tree.mjs tools/test_wayback_format.mjs tools/test_wayback_core.mjs`
Expected: all tests pass, with no sanitizer message.

- [ ] **Step 5: Commit**

```bash
git add tools/wayback_fixture.mjs tools/wayback_tree.mjs tools/wayback_format.mjs firmware/wayback/wayback.h firmware/wayback/wayback.c tools/test_wayback_tree.mjs tools/test_wayback_format.mjs tools/test_wayback_core.mjs
git commit -m "Add forward exception lists to the way-back tree and core"
```

---

### Task 7: Measure tree A plus exceptions

**Files:** none (measurement only; outputs are private).

- [ ] **Step 1: Size**

Run: `python3 -I tools/wayback_size.py | tee .local/wayback/size-aplus.json`
Expected: `"undefined": []`. Apply the two rules of Task 4 Step 2.

- [ ] **Step 2: Build and replay**

```bash
node tools/wayback_build.mjs .local/eq/v4.json .local/wayback/aplus-line2k.ccwb --reach line2k --exceptions | tee .local/wayback/aplus-line2k-build.json
node tools/wayback_build.mjs .local/eq/v4.json .local/wayback/aplus-ride1500.ccwb --reach ride1500 --exceptions | tee .local/wayback/aplus-ride1500-build.json
node tools/wayback_replay.mjs .local/eq/v4.json .local/wayback/aplus-line2k.ccwb line2k | tee .local/wayback/aplus-line2k-replay.json
node tools/wayback_replay.mjs .local/eq/v4.json .local/wayback/aplus-ride1500.ccwb ride1500 | tee .local/wayback/aplus-ride1500-replay.json
```

Expected:

- `lineFrames` is the same as in Task 5. `forwardFrames` is `lineFrames` less the line frames of the episode that starts at row 0. `wrongPart` is at most 10.
- Exception records: about 2,450 for `ride1500` and about 12,100 for `line2k`. File size: about 255,000 B (0.75 MB at 70 km) and about 568,000 B (1.68 MB at 70 km).

- If `wrongPart` is above 10: stop and report the episode list. Do not change the rules.
- If the records are more than 2 times the expected number: stop and report the count for each chunk.

- [ ] **Step 3: Run the repository validation**

Run: `python3 -I tools/validate_local.py`
Expected: exit code 0 or 2 (2 means that known gaps remain; it was 2 before this plan). Exit code 1 is a failure: stop and report.

---

### Task 8: Contract and results docs

**Files:**
- Create: `firmware/wayback/README.md`, `docs/research/way-back-tree-2026-11-16.md`

- [ ] **Step 1: Write `firmware/wayback/README.md`**

It must contain these sections, in ASD-STE100:

- **Status:** host only. Nothing is on the device. No adapter to the map patch exists.
- **Normal behaviour:** the rider is off the route and at most 15 m from a stored street piece. The core gives a line along streets to the route and the ride distance.
- **Admission:** `wb_mount` accepts a file only with the correct magic, version, size and route identity. Forward mode needs a trusted exit km from the caller.
- **Unavailable state:** list each `reason` value and what the device shows (no line; the stock off-route display stays).
- **Fallback:** tree A values when the exit km is not trusted, when the file has no exception lists, or when the chunk is not in the file.
- **Restoration:** `wb_unmount`, or remove the file. The core changes no stock state.
- **Drawing contract (not built):** the adapter calls `wb_tick` one time for each position. When `changed` is 1, it reads at most 64 points with `wb_read_point` into its own buffer. It draws nothing if a read fails. It converts each point from E7 to float degrees and gives the list to the firmware projection callback (`0x4204c1bc`), which calls `cc_line`. This step is behind the owner gate: the cause of the cc24 map-view restart is not known.
- **File format:** copy the section "File format CCWB version 1" from this plan.

- [ ] **Step 2: Write `docs/research/way-back-tree-2026-11-16.md`**

Start with the answer in two sentences. Then give these tables, with values from the files in `.local/wayback/` only:

1. Code size: `text`, `literal`, `rodata`, `total` for tree A and for tree A plus exceptions, against 4,376 B. State `fits` or `does not fit`.
2. File size for each of the four builds: bytes, bytes for each section, KB for each km, MB at 70 km, total with a 2.5 MB and a 4.0 MB route file against 5.58 MB free.
3. Replay for each of the four builds: frames, line frames, forward frames, wrong part, largest number of reads in one frame, and the number of forward frames with `WB_DIST_UNKNOWN`.

Then the section **Gaps**, with these items and any new ones that you found:

- One ride on one 22.56 km loop. The 70 km values are scaled.
- No device provider gives a trusted exit km. The replay took it from the ride record.
- The time of the reads on the device is not measured.
- No adapter draws the line. The cause of the cc24 map-view restart is not known.
- The map paints main roads up to 1,000 m from the route. A line at 2 km can cross an area with no painted streets. This is not measured.
- Parallel streets less than 15 m apart can give a wrong match.
- Turn restrictions are not in the tree.
- About 11 % of the street nodes inside 2 km have no permitted way to the route.
- The route app does not make the file. Only `tools/wayback_build.mjs` does.

Do not write coordinates or file paths below `.local/` other than `.local/wayback/` names.

- [ ] **Step 3: Commit**

```bash
git add firmware/wayback/README.md docs/research/way-back-tree-2026-11-16.md
git commit -m "Record the way-back tree contract and results"
```

- [ ] **Step 4: Final report to the owner**

Report in ASD-STE100, answer first: does the core fit 4,376 B; does the file fit for 70 km; how many frames get a line; how many lead to the wrong part with and without exceptions; which steps failed or were skipped. Do not push.
