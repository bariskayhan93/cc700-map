// tools/test_wayback_tree.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hav} from '../js/geo.js';
import {gridFixture, loopFixture} from './wayback_fixture.mjs';
import {buildWaybackModel, removeForwardCycles, forwardChainsOpen} from './wayback_tree.mjs';
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
test('a forward record that closes a loop with tree A is removed', () => {
  // Tree A: 0 -> 1 -> 2 -> route. The record of 1 goes to 0, and 0 has no record, so 0 goes back to 1.
  const {records, removed} = removeForwardCycles([{x: 1, nx: 0, dist: 100}], [1, 2, -1]);
  assert.deepEqual(records, []);
  assert.equal(removed, 1);
});
test('a forward record that leads to the route is kept', () => {
  const recs = [{x: 0, nx: 2, dist: 300}];
  const {records, removed} = removeForwardCycles(recs, [1, 2, -1]);
  assert.deepEqual(records, recs);
  assert.equal(removed, 0);
});
test('no forward chain in any chunk stays open, on the loop and grid fixtures', () => {
  const L = loopFixture(), G = gridFixture();
  for (const reach of ['line2k', 'ride1500']) {
    assert.deepEqual(forwardChainsOpen(buildWaybackModel(L.graph, L.route, {reach, exceptions: true})).open, 0);
    assert.deepEqual(forwardChainsOpen(buildWaybackModel(G.graph, G.route, {reach, exceptions: true})).open, 0);
  }
});
