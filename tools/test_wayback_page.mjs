// tools/test_wayback_page.mjs: the page path of the way-back build (js/wayback.js) on a synthetic street grid.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {waybackBbox, waybackFromSnapshot, loadWaybackSnapshot, routeIdentity} from '../js/wayback.js';
import {decodeWayback} from '../js/wayback_format.js';
import {embedWayback, readTrailer} from '../js/wayback_embed.js';

// Streets every 100 m on a 1 km square at (51, 7). The route is the bottom street.
const K = Math.cos(51 * Math.PI / 180), pt = (x, y) => [51 + y / 111320, 7 + x / (111320 * K)];
const nodeId = (i, j) => 1000 + i * 11 + j + 1;
function elements({drop = 0} = {}) {
  const els = [];
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const [lat, lon] = pt(i * 100, j * 100);
    if (nodeId(i, j) !== drop) els.push({type: 'node', id: nodeId(i, j), lat, lon});
  }
  for (let k = 0; k <= 10; k++) {
    els.push({type: 'way', id: 100 + k, nodes: Array.from({length: 11}, (_, i) => nodeId(i, k)), tags: {highway: 'residential'}});
    els.push({type: 'way', id: 200 + k, nodes: Array.from({length: 11}, (_, j) => nodeId(k, j)), tags: {highway: k === 5 ? 'motorway' : 'residential'}});
  }
  return els;
}
const response = opt => ({osm3s: {timestamp_osm_base: '2026-11-01T00:00:00Z'}, elements: elements(opt)});
const route = Array.from({length: 11}, (_, i) => ({point: pt(i * 100, 0), progress: i * 10000}));
const fetchOf = answers => { let n = 0; const f = async () => { const a = answers[Math.min(n++, answers.length - 1)]; return {ok: a.ok ?? true, status: a.status ?? 200, json: async () => a.body}; }; f.calls = () => n; return f; };

test('the box holds the route with a margin of at least 2.2 km on each side', () => {
  const [s, w, n, e] = waybackBbox(route);
  assert(51 - s >= 2200 / 111320 && n - pt(0, 0)[0] >= 2200 / 111320);
  assert((7 - w) * 111320 * K >= 2200 && (e - pt(1000, 0)[1]) * 111320 * K >= 2200);
  assert(n - s < 0.06 && e - w < 0.09);
});

test('the page path gives a file whose nodes lead to the route, and never uses the motorway', async () => {
  const snapshot = await loadWaybackSnapshot(route, fetchOf([{body: response()}]));
  assert.equal(snapshot.integrity, 'pass');
  const id = await routeIdentity(new Uint8Array(4096));
  const made = waybackFromSnapshot(snapshot, route, id);
  const d = decodeWayback(made.bytes);
  assert.equal(made.reach, 'line2k');
  assert.deepEqual([...d.header.routeId], [...id]);
  assert.equal(d.nodes.filter(n => n.distDm === 0).length, 11);
  for (const n of d.nodes) {
    let k = n, steps = 0;
    while (k.next >= 0 && steps++ < 200) k = d.nodes[k.next];
    assert.equal(k.distDm, 0);
  }
  // Column 5 is a motorway. Its top node is reached along the row: 1,000 m down plus 100 m to the side.
  const far = Math.max(...d.nodes.map(n => n.distDm));
  assert(far >= 10980 && far <= 11020, String(far));
  // Same input, same bytes.
  assert.deepEqual(waybackFromSnapshot(snapshot, route, id).bytes, made.bytes);
});

test('a size limit falls back to the shorter reach and then to no file', async () => {
  const snapshot = await loadWaybackSnapshot(route, fetchOf([{body: response()}]));
  const id = new Uint8Array(16), full = waybackFromSnapshot(snapshot, route, id).bytes.length;
  const less = waybackFromSnapshot(snapshot, route, id, {maxBytes: full - 1});
  assert(less === null || (less.reach === 'ride1500' && less.bytes.length < full));
  assert.equal(waybackFromSnapshot(snapshot, route, id, {maxBytes: 64}), null);
});

test('street data that is not complete gives no snapshot', async () => {
  await assert.rejects(loadWaybackSnapshot(route, fetchOf([{body: response({drop: nodeId(3, 3)})}])), /not complete: missing-way-node/);
  await assert.rejects(loadWaybackSnapshot(route, fetchOf([{body: {elements: []}}])), /not complete/);
});

test('a busy server is skipped and the next server is used', async () => {
  const f = fetchOf([{ok: false, status: 504, body: {}}, {body: {remark: 'runtime error', elements: []}}, {body: response()}]);
  assert.equal((await loadWaybackSnapshot(route, f)).integrity, 'pass');
  assert.equal(f.calls(), 3);
});

test('a route area above the bounded region is refused before any request', async () => {
  const far = [{point: [51, 7], progress: 0}, {point: [51.6, 7.9], progress: 9000000}], f = fetchOf([{body: response()}]);
  await assert.rejects(loadWaybackSnapshot(far, f), /bounded/);
  assert.equal(f.calls(), 0);
});

test('the trailer points at the way-back bytes and the route bytes do not change', async () => {
  const snapshot = await loadWaybackSnapshot(route, fetchOf([{body: response()}]));
  const plain = Uint8Array.from({length: 8192}, (_, i) => i & 255), made = waybackFromSnapshot(snapshot, route, await routeIdentity(plain));
  const out = embedWayback(plain, made.bytes), t = readTrailer(out);
  assert.equal(out.length % 4096, 0);
  assert.deepEqual([...out.subarray(0, 8192)], [...plain]);
  assert.deepEqual(t, {offset: 8192, size: made.bytes.length});
  assert.deepEqual(out.subarray(t.offset, t.offset + t.size), made.bytes);
  assert.throws(() => embedWayback(out, made.bytes), /already has/);
});
