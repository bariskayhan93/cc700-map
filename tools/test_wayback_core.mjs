// tools/test_wayback_core.mjs
import fs from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hav} from '../js/geo.js';
import {gridFixture} from './wayback_fixture.mjs';
import {buildWaybackModel} from './wayback_tree.mjs';
import {encodeWayback, encodeWaybackV3, decodeWayback} from './wayback_format.mjs';
import {runCore, runSelfTest} from './wayback_core_host.mjs';
import {compareLine} from './wayback_precision.mjs';
const {graph, route, p} = gridFixture();
const id = Uint8Array.from({length: 16}, (_, i) => i + 1);
const model = buildWaybackModel(graph, route, {reach: 'line2k'});
const file = encodeWaybackV3(model, id, () => 1), v1file = encodeWayback(model, id);   // every piece grey: the core reads states
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

// ---- cc27: the grey layer is its own section (type 2); its reader is tested in tools/test_grey_reader.mjs ----
test('bytes after the extras refuse the mount (no grey tail since cc27)', () => {
  const tail = new Uint8Array(file.length + 16); tail.set(file);
  const q = gridFixture().p(300, 400);
  assert.equal(runCore(tail, id, [{latE7: Math.round(q[0] * 1e7), lonE7: Math.round(q[1] * 1e7), flags: ON}])[0].mounted, 0);
});
