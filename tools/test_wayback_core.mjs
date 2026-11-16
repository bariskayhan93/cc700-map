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
