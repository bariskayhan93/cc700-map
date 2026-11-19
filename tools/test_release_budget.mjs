// tools/test_release_budget.mjs: the cc27 budget gate (tools/release_budget.mjs) on a synthetic street grid at (51, 7).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {budgetOf, gate} from './release_budget.mjs';
import {buildRoute} from '../js/route.js';
import {loadWaybackSnapshot} from '../js/wayback.js';

const K = Math.cos(51 * Math.PI / 180), pt = (x, y) => [51 + y / 111320, 7 + x / (111320 * K)], nodeId = (i, j) => 1000 + i * 11 + j + 1;
const els = [];
for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { const [lat, lon] = pt(i * 100, j * 100); els.push({type: 'node', id: nodeId(i, j), lat, lon}); }
for (let k = 0; k <= 10; k++) {
  els.push({type: 'way', id: 100 + k, nodes: Array.from({length: 11}, (_, i) => nodeId(i, k)), tags: {highway: 'residential'}});
  els.push({type: 'way', id: 200 + k, nodes: Array.from({length: 11}, (_, j) => nodeId(k, j)), tags: {highway: 'residential'}});
}
const fetchImpl = async () => ({ok: true, status: 200, json: async () => ({osm3s: {timestamp_osm_base: '2026-11-01T00:00:00Z'}, elements: els})});
const gpx = {name: 'budget', pts: Array.from({length: 11}, (_, i) => [...pt(i * 100, 0), 50 + i])};
const file = buildRoute(gpx, [], {id: '11120000', nameImage: () => new Uint8Array(42), speedKmh: 18, noF9: true, map: {styled: true, codec: 'd', blockFlags: 7}}).file;
const ride = Array.from({length: 40}, (_, i) => pt(i * 25, 60));   // 60 m north of the route: off the route

test('the gate fails for a file over 4,000,000 B and passes for the fixture', async () => {
  const snapshot = await loadWaybackSnapshot(gpx.pts.map((p, i) => ({point: [p[0], p[1]], progress: i * 10000})), fetchImpl, 'line3k');
  const r = await budgetOf(file, {snapshot, reaches: ['line3k', 'line1k'], ride});
  assert.deepEqual(gate(r), []);
  const f = r.files.line3k;
  assert(f.waybackBytes > 0 && f.greyBytes > 0 && f.elevationBytes > 0 && f.fileBytes % 4096 === 0, JSON.stringify(f));
  assert.equal(f.reachUsed, 'line3k');
  assert.equal(f.grey.over, 0);
  assert(f.greyReads.p50 >= 2 && f.greyReads.p90 >= f.greyReads.p50, JSON.stringify(f.greyReads));
  assert(r.blocks > 0 && r.blockMax.decodedBytes[0] <= r.blockMax.decodedBytes[1]);
  assert.equal(r.flags.every(x => x === 7), true);
  const big = structuredClone(r); big.files.line3k.fileBytes = 4000001;
  assert.match(gate(big).join(), /line3k: file 4000001 B over 4,000,000 B/);
  const wide = structuredClone(r); wide.files.line1k.waybackBytes = 1536 * 1024 + 1;
  assert.match(gate(wide).join(), /line1k: way-back section .* over 1,572,864 B/);
  const block = structuredClone(r); block.blockFailures = ['decodedBytes'];
  assert.match(gate(block).join(), /block limits: decodedBytes/);
  const grey = structuredClone(r); grey.files.line3k.grey.over = 2;
  assert.match(gate(grey).join(), /line3k: 2 grey screens over a cap/);
});

test('without a snapshot the report has the map, the flags and the elevation, and no way-back bytes', async () => {
  const r = await budgetOf(file, {reaches: ['line2k']});
  assert.deepEqual(gate(r), []);
  assert.deepEqual([r.files.line2k.waybackBytes, r.files.line2k.greyBytes], [0, 0]);
  assert(r.files.line2k.elevationBytes > 0);
  assert.equal(r.files.line2k.reachUsed, null);
});
