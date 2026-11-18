// tools/test_wayback_format.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gridFixture, loopFixture} from './wayback_fixture.mjs';
import {buildWaybackModel} from './wayback_tree.mjs';
import {makeFrame, encodeWayback, decodeWayback, encodeWaybackV2} from './wayback_format.mjs';
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
test('exception lists survive encode and decode, sorted by node', () => {
  const L = loopFixture(), m = buildWaybackModel(L.graph, L.route, {reach: 'ride1500', exceptions: true});
  const bytes = encodeWayback(m, id), d = decodeWayback(bytes);
  assert.equal(d.header.flags & 1, 1); assert.equal(d.chunks.length, 6);
  assert.equal(d.chunks[4].length, m.chunks[4].length); assert(d.chunks[4].length > 0);
  d.chunks[4].forEach((r, i) => { if (i) assert(d.chunks[4][i - 1].node < r.node); });
  const n = d.chunks.reduce((s, c) => s + c.length, 0);
  assert.equal(bytes.length, 64 + (d.header.cellCount + 1) * 12 + d.nodes.length * 12 + d.extras.length * 8 + 7 * 4 + n * 8);
});

// Version 2 (cc26, D1): 8-byte nodes, no exception lists.
test('version 2 round trip: positions within 1 unit, distance within 0.5 m, next exact', () => {
  const v2 = decodeWayback(encodeWaybackV2(model, id)), v1 = decodeWayback(encodeWayback(model, id));
  assert.equal(v2.header.version, 2);
  assert.equal(v2.nodes.length, v1.nodes.length);
  v2.nodes.forEach((n, i) => {
    assert(Math.abs(n.x - v1.nodes[i].X) <= 1, `x ${i}`);
    assert(Math.abs(n.y - v1.nodes[i].Y) <= 1, `y ${i}`);
    assert.equal(n.next, v1.nodes[i].next, `next ${i}`);
    assert(Math.abs(n.distM - v1.nodes[i].distDm / 10) <= 0.5, `distance ${i}`);
  });
});

test('version 2 size: header, cells, 8-byte nodes and 8-byte extras', () => {
  const cells = decodeWayback(encodeWayback(model, id)).header.cellCount;
  assert.equal(encodeWaybackV2(model, id).length, 64 + 12 * (cells + 1) + 8 * model.nodes.length + 8 * model.extras.length);
});

test('version 2 refuses a position outside 65.5 km, a distance over 4,095 m and a next delta over 4,095', () => {
  const far = (lat, lon) => ({nodes: [{point: [51, 7], dist: 5, next: -1}, {point: [lat, lon], dist: 5, next: -1}], extras: [], chunks: []});
  assert.throws(() => encodeWaybackV2(far(51, 8.0), id), /does not fit version 2: x$/);
  assert.throws(() => encodeWaybackV2(far(51.7, 7), id), /does not fit version 2: y$/);
  const dist = {nodes: [{point: [51, 7], dist: 4096, next: -1}], extras: [], chunks: []};
  assert.throws(() => encodeWaybackV2(dist, id), /does not fit version 2: dist$/);
  // 4,225 nodes on a 1 m grid. The first node in file order links to the node 4,096 places later (edge under 1,700 units).
  const pts = [];
  for (let i = 0; i < 65; i++) for (let j = 0; j < 65; j++) pts.push([51 + (i / 111320), 7 + (j / (111320 * Math.cos(51 * Math.PI / 180)))]);
  const nodes = pts.map(point => ({point, dist: 5, next: -1}));
  const f = makeFrame(pts), key = ([X, Y]) => ((Y >> 11) << 16) | (X >> 11);
  const order = pts.map((q, i) => i).sort((a, b) => (key(f.toUnits(pts[a])) - key(f.toUnits(pts[b]))) || (a - b));
  nodes[order[0]].next = order[4096];
  const long = {nodes, extras: [], chunks: []};
  assert.doesNotThrow(() => encodeWayback(long, id));
  assert.throws(() => encodeWaybackV2(long, id), /does not fit version 2: next$/);
});

// Version 2 grey flag (cc26, D1b): bit 63 of a node is the flag of its piece to next; extra bit 13 is the flag.
test('version 2 keeps the grey flag of each piece: nodes with a next, and extras', () => {
  const a = p(0, 0), b = p(100, 0);
  const pair = {nodes: [{point: a, dist: 4095.4, next: 1}, {point: b, dist: 0, next: -1}],
    extras: [{a: 0, b: 1, meters: 100, toA: false, toB: true}], chunks: []};
  const on = decodeWayback(encodeWaybackV2(pair, id, () => 1)), off = decodeWayback(encodeWaybackV2(pair, id, () => 0));
  const withNext = on.nodes.filter(n => n.next >= 0);
  assert.equal(withNext.length, 1);
  assert.equal(withNext[0].grey, 1);
  assert.equal(withNext[0].distM, 4095);
  assert.equal(on.nodes.find(n => n.next < 0).grey, 0);
  assert.equal(off.nodes.find(n => n.next >= 0).grey, 0);
  assert.equal(on.extras[0].grey, 1); assert.equal(off.extras[0].grey, 0);
  assert.equal(on.extras[0].lenDm, 1000); assert.equal(on.extras[0].toB, true); assert.equal(on.extras[0].toA, false);
});
test('version 2 with no flag function sets every flag of a piece to 1', () => {
  const pair = {nodes: [{point: p(0, 0), dist: 1, next: 1}, {point: p(100, 0), dist: 1, next: -1}], extras: [], chunks: []};
  const d = decodeWayback(encodeWaybackV2(pair, id));
  assert.equal(d.nodes.find(n => n.next >= 0).grey, 1);
});
test('version 2 refuses a distance of 4,096 m, and an extra piece longer than 8,191 dm', () => {
  const pair = (dist, meters) => ({nodes: [{point: p(0, 0), dist, next: 1}, {point: p(100, 0), dist: 0, next: -1}],
    extras: meters === undefined ? [] : [{a: 0, b: 1, meters, toA: false, toB: false}], chunks: []});
  assert.throws(() => encodeWaybackV2(pair(4096, undefined), id), /does not fit version 2: dist$/);
  assert.doesNotThrow(() => encodeWaybackV2(pair(4095.4, undefined), id));
  assert.throws(() => encodeWaybackV2(pair(1, 819.2), id), /does not fit version 2/);
  assert.doesNotThrow(() => encodeWaybackV2(pair(1, 819.1), id));
});
