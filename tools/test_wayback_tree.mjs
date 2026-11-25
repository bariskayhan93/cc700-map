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

// cc27 Task 5: the reach 1, 2 or 3 km (air limit; the ride limit is two times the air limit)
test('line3k keeps a street 2,900 m from the route and line2k does not; line1k stops at 1,000 m', async () => {
  const {makeGraph} = await import('./wayback_fixture.mjs');
  const list = [[-300, 0], [0, 0], [300, 0]], links = [[0, 1], [1, 2]];
  for (let k = 1; k <= 35; k++) { list.push([0, 100 * k]); links.push([k === 1 ? 1 : list.length - 2, list.length - 1]); }
  const g = makeGraph(list, links), r = [{point: p(-300, 0), progress: 0}, {point: p(300, 0), progress: 60000}];
  const has = (m, y) => m.nodes.some(n => hav(n.point, p(0, y)) < 1);
  assert.ok(has(buildWaybackModel(g, r, {reach: 'line3k'}), 2900));
  assert.ok(!has(buildWaybackModel(g, r, {reach: 'line3k'}), 3100));
  assert.ok(!has(buildWaybackModel(g, r, {reach: 'line2k'}), 2900));
  assert.ok(has(buildWaybackModel(g, r, {reach: 'line1k'}), 1000) && !has(buildWaybackModel(g, r, {reach: 'line1k'}), 1100));
});

// Exit edges (far map design, 23 Nov): a track with no bicycle tag leads out, never in.
test('exit policy: an untagged track or path is an exit edge, an explicit no stays out', async () => {
  const {exitWayPolicy} = await import('../js/recovery_graph.js');
  assert.equal(exitWayPolicy({highway: 'track'}).exit, true);
  assert.equal(exitWayPolicy({highway: 'path'}).exit, true);
  assert.equal(exitWayPolicy({highway: 'bridleway'}).exit, true);
  assert.equal(exitWayPolicy({highway: 'track', bicycle: 'no'}).reason, 'bicycle-access-not-admitted');
  assert.equal(exitWayPolicy({highway: 'track', access: 'private'}).reason, 'access-not-admitted');
  assert.equal(exitWayPolicy({highway: 'footway'}).reason, 'highway-needs-explicit-bicycle-access');
  assert.equal(exitWayPolicy({highway: 'residential'}).exit, undefined);
});
test('a street node never takes its next over an exit edge; a track node leads out along the track', async () => {
  const {makeGraph} = await import('./wayback_fixture.mjs');
  // route y = 0 from x -500 to 500; street A(0,500) -> (-300,500) -> (-300,0): 800 m; track A -> (0,0): 500 m
  const g = makeGraph([[-500, 0], [0, 0], [500, 0], [-300, 0], [0, 500], [-300, 500], [300, 500]], [[0, 3], [3, 1], [1, 2], [4, 5], [5, 3]]);
  const ex = (i, j) => { for (const [a, b] of [[i, j], [j, i]]) g.edges.push({from: a, to: b, meters: hav(g.nodes[a].point, g.nodes[b].point), exit: true}); };
  ex(4, 1); ex(6, 4);                                               // track A-(0,0), track (300,500)-A
  const r = [{point: p(-500, 0), progress: 0}, {point: p(500, 0), progress: 100000}];
  const m = buildWaybackModel(g, r, {reach: 'line2k'});
  assert.equal(m.nodes[at(m, 0, 500)].next, at(m, -100, 500), 'street node A keeps the street');
  assert.equal(m.nodes[at(m, 0, 200)].next, at(m, 0, 100), 'track node leads out along the track');
  assert.equal(m.nodes[at(m, 300, 500)].next, at(m, 200, 500), 'track-only node leads to the street node');
});
test('an extra piece never gives a ride over an exit edge that the tree refuses (25 Nov)', async () => {
  const {makeGraph} = await import('./wayback_fixture.mjs');
  // as above: street node A(0,500) has its tree next along the street (800 m); the track A -> (0,0) is 500 m
  const g = makeGraph([[-500, 0], [0, 0], [500, 0], [-300, 0], [0, 500], [-300, 500], [300, 300], [300, 0]], [[0, 3], [3, 1], [1, 2], [4, 5], [5, 3], [4, 6]]);
  const ex = (i, j, one) => { for (const [a, b] of one ? [[i, j]] : [[i, j], [j, i]]) g.edges.push({from: a, to: b, meters: hav(g.nodes[a].point, g.nodes[b].point), exit: true}); };
  ex(4, 1); ex(6, 7, true);                                         // track A-(0,0); one-way track (300,300) -> (300,0)
  const r = [{point: p(-500, 0), progress: 0}, {point: p(500, 0), progress: 100000}];
  const m = buildWaybackModel(g, r, {reach: 'line2k'});
  const A = at(m, 0, 500), T = at(m, 0, 400), x = m.extras.find(e => (e.a === A && e.b === T) || (e.a === T && e.b === A));
  assert(x, 'the first track piece at A is an extra piece');
  assert.equal(x.a === A ? x.toA : x.toB, true, 'a rider on the track piece may ride to the street node');
  assert.equal(x.a === A ? x.toB : x.toA, false, 'no ride from the street node into the track');
  const S = at(m, 300, 300), S1 = at(m, 300, 200);
  assert(!m.extras.some(e => (e.a === S && e.b === S1) || (e.a === S1 && e.b === S)), 'the one-way track piece with no end left is not stored');
  assert.equal(m.stats.exitDropped, 1);
  assert.equal(m.stats.exitEnds, 2);
  for (const e of m.extras) for (const [s0, t0, ok] of [[e.a, e.b, e.toB], [e.b, e.a, e.toA]])
    if (ok) assert(e.meters + m.nodes[t0].dist >= m.nodes[s0].dist - 1e-6, 'no extra piece end is shorter than the tree');
});
