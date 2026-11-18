// tools/test_wayback_core.mjs
import fs from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hav} from '../js/geo.js';
import {gridFixture} from './wayback_fixture.mjs';
import {buildWaybackModel} from './wayback_tree.mjs';
import {encodeWayback, encodeWaybackV2, decodeWayback} from './wayback_format.mjs';
import {runCore, runSelfTest} from './wayback_core_host.mjs';
import {compareLine} from './wayback_precision.mjs';
const {graph, route, p} = gridFixture();
const id = Uint8Array.from({length: 16}, (_, i) => i + 1);
const model = buildWaybackModel(graph, route, {reach: 'line2k'});
const file = encodeWaybackV2(model, id, () => 1), v1file = encodeWayback(model, id);   // every piece grey: the core reads states
const e7 = (x, y) => { const q = p(x, y); return {latE7: Math.round(q[0] * 1e7), lonE7: Math.round(q[1] * 1e7)}; };
const ll = pt => [pt[0] / 1e7, pt[1] / 1e7];
const isAt = (pt, x, y, tol = 1.5) => assert(hav(ll(pt), p(x, y)) <= tol, `${ll(pt)} is not at ${x},${y}`);
const ON = 3; // WB_GPS_VALID | WB_OFF_ROUTE
// Recorded output of the version 1 core (commit 6091401) on the same grid: tools/wayback_core_fixture.json.
const fixture = JSON.parse(fs.readFileSync(new URL('./wayback_core_fixture.json', import.meta.url), 'utf8'));
const FIXTURE_SEEDED_END = 215;   // lines 0-14: core tests; 15-214: 200 seeded positions; 215-1714: replay

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
test('a file with no exception lists uses tree A with a trusted exit', () => {
  const [r] = runCore(file, id, [{...e7(5, 120), flags: 7, exitCm: 10000}]);
  assert.equal(r.forward, 0); assert.equal(r.points.length, 4);
});
test('the core on version 2 matches the version 1 fixture within the precision rules (R-PREC)', () => {
  const lines = fixture.lines.slice(0, FIXTURE_SEEDED_END);
  const out = runCore(file, id, lines);
  const dec = decodeWayback(file);
  assert.equal(out.length, FIXTURE_SEEDED_END);
  let band = 0;
  out.forEach((r, i) => { if (compareLine(lines[i].name, dec, r, fixture.v1[i], lines[i].latE7, lines[i].lonE7, graph) === 'band') band++; });
  console.log(`fixture lines 0-214: states in the 14.5 m to 15.5 m band: ${band}`);
});
test('the core output is the same as before the shared scan: state, reason, distance, piece and points', () => {
  const out = runCore(file, id, fixture.lines);
  assert.equal(out.length, fixture.v2pre.length);
  out.forEach((r, i) => {
    const b = fixture.v2pre[i];
    assert.deepEqual([r.state, r.reason, r.distanceDm, r.changed, r.piece, r.points], [b.state, b.reason, b.distanceDm, b.changed, b.piece, b.points], `line ${i} ${fixture.lines[i].name}`);
  });
});
test('forward is 0 for every rider point of the fixture (version 2 has no forward mode)', () => {
  const out = runCore(file, id, fixture.lines);
  assert.equal(out.filter(r => r.forward !== 0).length, 0);
});
test('a file with the flags bit 0 set is refused: version 2 has no exception lists', () => {
  const bad = file.slice(); new DataView(bad.buffer).setUint16(6, 1, true);
  assert.equal(runCore(bad, id, [{...e7(5, 120), flags: ON}])[0].mounted, 0);
});
test('a file with a chunk count that is not 0 is refused', () => {
  const bad = file.slice(); new DataView(bad.buffer).setUint32(60, 1, true);
  assert.equal(runCore(bad, id, [{...e7(5, 120), flags: ON}])[0].mounted, 0);
});
const u32at = (b, off, v) => new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(off, v, true);
const u32of = (b, off) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(off, true);
test('mount refuses a sentinel cell record whose first extra index is wrong', () => {
  const bad = file.slice();
  u32at(bad, 64 + u32of(bad, 52) * 12 + 8, 0x7FFFFF);
  assert.equal(runCore(bad, id, [{...e7(5, 120), flags: ON}])[0].mounted, 0);
});

// cc26 (D2): version 2 mounts; version 1 does not; the piece id and the piece entry (wb_tick_piece).
test('a version 1 file is refused: the core mounts version 2 only', () => {
  const [r] = runCore(v1file, id, [{...e7(5, 120), flags: ON}]);
  assert.equal(r.mounted, 0);
});
test('a next value that names no node gives WB_READ (reason 5)', () => {
  const bad = Uint8Array.from(file), dv = new DataView(bad.buffer), h = decodeWayback(file).header;
  const nodes = 64 + 12 * (h.cellCount + 1);
  for (let i = 0; i < h.nodeCount; i++) {
    const o = nodes + 8 * i, v = dv.getBigUint64(o, true);
    if (((v >> 38n) & 0x1fffn) !== 0n) dv.setBigUint64(o, (v & ~(0x1fffn << 38n)) | (100n << 38n), true);
  }
  const [r] = runCore(bad, id, [{...e7(5, 120), flags: ON}]);
  assert.equal(r.reason, 5);
  assert.equal(r.state, 0);
});
test('wb_tick_piece on the piece of a tick gives the same state, reason, distance and points', () => {
  const [r] = runCore(file, id, [{...e7(5, 120), flags: ON}]);
  assert(r.piece > 0 && r.piece < 0x1000000, 'the piece id is bits 0-23 of a stored piece');
  assert.equal(r.pieceAt.state, r.state);
  assert.equal(r.pieceAt.reason, r.reason);
  assert.equal(r.pieceAt.distanceDm, r.distanceDm);
  assert.deepEqual(r.pieceAt.points, r.points);
});
test('a piece farther than 15 m from the rider gives WB_NO_STREET (reason 4)', () => {
  const [a] = runCore(file, id, [{...e7(5, 120), flags: ON}]);
  const [b] = runCore(file, id, [{...e7(300, 400), flags: ON, pieceId: a.piece}]);
  assert.equal(b.pieceAt.reason, 4);
  assert.equal(b.pieceAt.state, 0);
});
test('the self test: wb_out equals the old near test for 100,000 random pairs and the edges; scan order holds', () => {
  const t = runSelfTest(file, id);
  assert.equal(t.wbOutMismatch, 0);
  assert(t.wbOutCases >= 100000);
  assert.equal(t.scanOrderErrors, 0);
  assert(t.scanVisited > 0);
  assert(t.scanCoverCases >= 250, 'the 5 x 6 window was tested at 250 or more rider points that got a line (300 riders tried)');
  assert.equal(t.scanCoverErrors, 0, 'every piece that wb_tick chooses is visited by the 5 x 6 window');
});

// ---- D3c: the grey layer reader on the unit core (heading-up screen, 20 cells at most, rows read once) ----
import {greyLayer, readGreyLayer} from '../js/wayback_grey_layer.js';
import {runGrey} from './wayback_core_host.mjs';
const bare = file;   // every piece grey, version 2, no layer
const withLayer = (() => { const s = greyLayer(decodeWayback(bare)); const out = new Uint8Array(bare.length + s.length); out.set(bare); out.set(s, bare.length); return out; })();
const CELL = 4096, floorDiv = (a, b) => Math.floor(a / b);
// The section table and bodies, as bytes after the bare file.
function sectionOf(fileBytes, at) {
  const sec = fileBytes.subarray(at), dv = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
  const n = dv.getUint32(8, true), keys = [], offs = [];
  for (let i = 0; i <= n; i++) { keys.push(dv.getUint32(16 + 8 * i, true)); offs.push(dv.getUint32(16 + 8 * i + 4, true)); }
  return {sec, n, keys, offs, bodyAt: 16 + 8 * (n + 1)};
}
// Line ends in one cell body: [{end, pts: [[qx, qy], ...]}] with end = bytes consumed through the line.
function bodyLines(sec, at, len) {
  const b = sec.subarray(at, at + len);
  let p = 0;
  const v = () => { let x = 0, s = 0, c; do { c = b[p++]; x += (c & 0x7F) * 2 ** s; s += 7; } while (c & 0x80); return x; };
  const zz = z => (z % 2 === 0 ? z / 2 : -(z + 1) / 2);
  const lines = [], count = v();
  for (let l = 0; l < count; l++) {
    const m = v(); let qx = b[p] | (b[p + 1] << 8), qy = b[p + 2] | (b[p + 3] << 8); p += 4;
    const pts = [[qx, qy]];
    for (let k = 1; k < m; k++) { qx += zz(v()); qy += zz(v()); pts.push([qx, qy]); }
    lines.push({end: p, pts});
  }
  return lines;
}
// The read model of the unit (D3c): a binary search per new row (one 4 B read per step), one read of up to 8 records
// per new row, and one read per 192 B of body consumed. The cap stops after the line that reaches it.
function readModel(fileBytes, at, keys, cap = 1e9) {
  const H = decodeWayback(fileBytes.subarray(0, at)).header, S = sectionOf(fileBytes, at);
  const cells = keys.map(key => ({key, cx: key & 0xFFFF, cy: key >>> 16}));
  let reads = 0, segs = 0;
  const rows = new Map(), out = {lines: []};
  const lowerBound = key => { let lo = 0, hi = S.n; while (lo < hi) { const mid = lo + Math.floor((hi - lo) / 2); reads++; if (S.keys[mid] < key) lo = mid + 1; else hi = mid; } return lo; };
  for (const c of cells) {
    if (segs >= cap) break;
    if (!rows.has(c.cy)) {
      const minCx = Math.min(...cells.filter(d => d.cy === c.cy).map(d => d.cx));
      const at0 = lowerBound(((c.cy << 16) | minCx) >>> 0);
      const cnt = Math.min(8, S.n + 1 - at0); reads++;
      rows.set(c.cy, {keys: S.keys.slice(at0, at0 + cnt), offs: S.offs.slice(at0, at0 + cnt)});
    }
    const rec = rows.get(c.cy), j = rec.keys.indexOf(c.key);
    if (j < 0) continue;
    const len = rec.offs[j + 1] - rec.offs[j];
    let consumed = len;
    for (const ln of bodyLines(S.sec, S.bodyAt + rec.offs[j], len)) {
      const pts = ln.pts.map(([qx, qy]) => [H.lat0E7 + Math.floor((c.cy * CELL + qy * 8) * H.latE / 65536), H.lon0E7 + Math.floor((c.cx * CELL + qx * 8) * H.lonE / 65536)]);
      out.lines.push(pts);
      segs += pts.length - 1;
      if (segs >= cap) { consumed = ln.end; break; }
    }
    reads += Math.ceil(consumed / 192);
  }
  return {reads, lines: out.lines, segs};
}
// Frames inside the grid: a grid of rider positions (E7) with a rider at most 1 km around the grid.
const frameAt = (x, y) => { const q = p(x, y); return {latE7: Math.round(q[0] * 1e7), lonE7: Math.round(q[1] * 1e7)}; };
const frames50 = Array.from({length: 50}, (_, i) => ({...frameAt(-50 + (i % 10) * 120, -50 + Math.floor(i / 10) * 230), course: (i * 37) % 360}));
const layerAt = bare.length;
// The cells under the turned screen (600 m wide, 520 m ahead, 100 m behind), in float: separating axes, gap < 0 is
// under the screen. Cells within 2 m of an edge may go either way (the unit uses an integer sine).
function screenCells(latE7, lonE7, course) {
  const H = decodeWayback(bare).header, X = floorDiv((lonE7 - H.lon0E7) * H.lonU, 65536), Y = floorDiv((latE7 - H.lat0E7) * H.latU, 65536);
  const ux = Math.sin(course * Math.PI / 180), uy = Math.cos(course * Math.PI / 180), ax = Math.abs(ux), ay = Math.abs(uy);
  const mx = X + 3360 * ux, my = Y + 3360 * uy, hx = 4960 * ax + 4800 * ay, hy = 4960 * ay + 4800 * ax, r = 2048 * (ax + ay);
  const sure = [], edge = new Set();
  for (let cy = floorDiv(my - hy, CELL) - 1; cy <= floorDiv(my + hy, CELL) + 1; cy++) for (let cx = floorDiv(mx - hx, CELL) - 1; cx <= floorDiv(mx + hx, CELL) + 1; cx++) {
    if (cx < 0 || cy < 0) continue;
    const px = cx * CELL + 2048, py = cy * CELL + 2048, dx = px - mx, dy = py - my;
    const gap = Math.max(Math.abs(dx) - hx - 2048, Math.abs(dy) - hy - 2048, Math.abs(dx * ux + dy * uy) - 4960 - r, Math.abs(dx * uy - dy * ux) - 4800 - r);
    const key = ((cy << 16) | cx) >>> 0;
    if (gap < -32) sure.push(key); else if (gap <= 32) edge.add(key);
  }
  return {X, Y, sure, edge};
}
test('the cells are the cells under the turned screen, nearest first, for 360 courses and 16 offsets', () => {
  const frames = [];
  for (let course = 0; course < 360; course++) for (let i = 0; i < 16; i++) frames.push({...frameAt(300 + i * 16, 300 + ((i * 5) % 16) * 16), course, cap: 1});
  let most = 0;
  runGrey(withLayer, id, frames).forEach((g, i) => {
    const f = frames[i], m = screenCells(f.latE7, f.lonE7, f.course), tag = `course ${f.course} offset ${i % 16}`;
    for (const k of m.sure) assert(g.cells.includes(k), `${tag}: cell ${k} is missing`);
    for (const k of g.cells) assert(m.sure.includes(k) || m.edge.has(k), `${tag}: cell ${k} is not under the screen`);
    const d = g.cells.map(k => ((k & 0xFFFF) * CELL + 2048 - m.X) ** 2 + ((k >>> 16) * CELL + 2048 - m.Y) ** 2);
    assert(d.every((v, j) => j === 0 || d[j - 1] <= v), `${tag}: not nearest first`);
    most = Math.max(most, g.cells.length);
  });
  assert(most >= 12 && most <= 20, `most cells ${most}`);
});

test('the grey lines of a frame equal the layer points, E7 exact, nearest cell first', () => {
  const got = runGrey(withLayer, id, frames50);
  got.forEach((g, i) => {
    const m = readModel(withLayer, layerAt, g.cells);
    assert.equal(g.layer, 1);
    assert.deepEqual(g.lines, m.lines, `frame ${i} lines`);
  });
});
test('the reads of the grey reader equal the model reads for 50 frames, with and without the cap', () => {
  for (const cap of [1000000000, 400, 5]) {
    const got = runGrey(withLayer, id, frames50.map(f => ({...f, cap})));
    got.forEach((g, i) => {
      const m = readModel(withLayer, layerAt, g.cells, cap);
      assert.equal(g.reads, m.reads, `cap ${cap} frame ${i} reads`);
      assert.equal(g.segs, m.segs, `cap ${cap} frame ${i} segments`);
    });
  }
});
test('a read error at read 1, 5 or 20 returns 0, and the lines before it are a prefix of the full list', () => {
  const all = runGrey(withLayer, id, frames50);
  const busy = frames50.map((f, i) => ({i, reads: readModel(withLayer, layerAt, all[i].cells).reads, f})).find(x => x.reads >= 25);
  assert(busy, 'a frame with at least 25 reads');
  const full = runGrey(withLayer, id, [busy.f])[0];
  for (const k of [1, 5, 20]) {
    const [g] = runGrey(withLayer, id, [{...busy.f, failAt: k - 1}]);
    assert.equal(g.ok, 0, `read ${k}`);
    assert.deepEqual(g.lines, full.lines.slice(0, g.lines.length), `read ${k} prefix`);
  }
});
test('a file with no layer: no line, return 1, no read', () => {
  const [g] = runGrey(bare, id, [frames50[12]]);
  assert.equal(g.layer, 0); assert.equal(g.ok, 1); assert.equal(g.reads, 0); assert.deepEqual(g.lines, []);
});
test('the wb_tick output of a file with the layer equals the output without it', () => {
  const lines = [{...frameAt(300, 400), flags: ON}, {...frameAt(0, 120), flags: ON}, {...frameAt(900, 60), flags: ON}];
  assert.deepEqual(runCore(withLayer, id, lines), runCore(bare, id, lines));
});
test('a section with a bad magic refuses the mount', () => {
  const bad = withLayer.slice(); bad[layerAt] ^= 0xFF;
  assert.equal(runGrey(bad, id, [frames50[0]])[0].mounted, 0);
  assert.equal(runCore(bad, id, [{...frameAt(300, 400), flags: ON}])[0].mounted, 0);
});
