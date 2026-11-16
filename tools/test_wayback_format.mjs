// tools/test_wayback_format.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gridFixture, loopFixture} from './wayback_fixture.mjs';
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
test('exception lists survive encode and decode, sorted by node', () => {
  const L = loopFixture(), m = buildWaybackModel(L.graph, L.route, {reach: 'ride1500', exceptions: true});
  const bytes = encodeWayback(m, id), d = decodeWayback(bytes);
  assert.equal(d.header.flags & 1, 1); assert.equal(d.chunks.length, 6);
  assert.equal(d.chunks[4].length, m.chunks[4].length); assert(d.chunks[4].length > 0);
  d.chunks[4].forEach((r, i) => { if (i) assert(d.chunks[4][i - 1].node < r.node); });
  const n = d.chunks.reduce((s, c) => s + c.length, 0);
  assert.equal(bytes.length, 64 + (d.header.cellCount + 1) * 12 + d.nodes.length * 12 + d.extras.length * 8 + 7 * 4 + n * 8);
});
