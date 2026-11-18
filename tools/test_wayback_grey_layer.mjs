// tools/test_wayback_grey_layer.mjs (cc26, D3a): the grey layer section of way-back version 2 (E15).
// Synthetic street graphs only. Way-back units: 1/16 m, cells of 4,096 units.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {greyLayer, readGreyLayer} from '../js/wayback_grey_layer.js';
import {encodeWaybackV2, decodeWayback} from '../js/wayback_format.js';
import {gridFixture} from './wayback_fixture.mjs';
import {buildWaybackModel} from './wayback_tree.mjs';

// A parts object as decodeWayback returns it: nodes {x, y, next, grey}, extras {a, b, grey}. next -1 = no next.
const node = (x, y, next = -1, grey = 1) => ({x, y, next, grey, distM: 0});
const parts = (nodes, extras = []) => ({header: {version: 2}, nodes, extras});
const polyline = (pts) => pts.map(([x, y]) => ({x, y}));

// Distance in units from a point to a polyline (the chain before simplification).
function distanceTo(p, line) {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1];
    const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy;
    const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a.x) * vx + (p[1] - a.y) * vy) / L));
    best = Math.min(best, Math.hypot(p[0] - a.x - t * vx, p[1] - a.y - t * vy));
  }
  return best;
}

test('a Y crossing of three grey streets gives three chains', () => {
  const nodes = [node(1500, 1000, 3), node(1000, 1500, 3), node(500, 1000, 3), node(1000, 1000, -1, 0)];
  const layer = greyLayer(parts(nodes));
  const cells = readGreyLayer(layer).cells;
  const lines = cells.flatMap(c => c.lines);
  assert.equal(lines.length, 3);
  for (const l of lines) assert.equal(l.length, 2);
});

test('a straight street of 10 pieces gives one line of two points', () => {
  const nodes = Array.from({length: 11}, (_, i) => node(100 + 100 * i, 500, i < 10 ? i + 1 : -1));
  const lines = readGreyLayer(greyLayer(parts(nodes))).cells.flatMap(c => c.lines);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, 2);
});

test('a street that crosses a cell border gives two lines that share the cross point', () => {
  const nodes = [node(4000, 100, 1), node(4200, 100)];
  const cells = readGreyLayer(greyLayer(parts(nodes))).cells;
  assert.equal(cells.length, 2);
  const [a, b] = cells.map(c => c.lines[0]);
  const shared = a[a.length - 1], first = b[0];
  assert(Math.abs(shared[0] - first[0]) <= 8 && Math.abs(shared[1] - first[1]) <= 8, `${shared} ${first}`);
});

test('a line of 40 points gives two lines of at most 32 points', () => {
  const nodes = Array.from({length: 40}, (_, i) => node(100 + 40 * i, 1000 + (i % 2) * 100, i < 39 ? i + 1 : -1));
  const lines = readGreyLayer(greyLayer(parts(nodes))).cells.flatMap(c => c.lines);
  assert.deepEqual(lines.map(l => l.length).sort((p, q) => q - p), [32, 9]);
  assert(lines.every(l => l.length >= 2 && l.length <= 32));
});

test('every point of the layer is within 20 + 8 units of the joined street', () => {
  const nodes = Array.from({length: 40}, (_, i) => node(100 + 40 * i, 1000 + (i % 2) * 100, i < 39 ? i + 1 : -1));
  const chain = polyline(nodes.map(n => [n.x, n.y]));
  const lines = readGreyLayer(greyLayer(parts(nodes))).cells.flatMap(c => c.lines);
  for (const l of lines) for (const p of l) assert(distanceTo(p, chain) <= 28, `${p}`);
});

test('a piece with grey 0 is in no line', () => {
  const nodes = [node(100, 100, 1, 0), node(200, 100), node(300, 300, 3), node(400, 300)];
  const lines = readGreyLayer(greyLayer(parts(nodes))).cells.flatMap(c => c.lines);
  assert.equal(lines.length, 1);
  assert(lines[0].every(([, y]) => Math.abs(y - 300) <= 4), 'only the grey street, within half a quantum');
});

test('a file with no grey piece has no section', () => {
  assert.equal(greyLayer(parts([node(100, 100, 1, 0), node(200, 100)])), null);
});

test('a cell body over 2,048 B throws', () => {
  const nodes = Array.from({length: 1100}, (_, i) => node(100 + 3 * i, 1000 + (i % 2) * 200, i < 1099 ? i + 1 : -1));
  assert.throws(() => greyLayer(parts(nodes)), /grey cell over 2048 B/);
});

test('the layer of a version 2 file keeps the nodes and extras, and a bad magic is refused', () => {
  const {graph, route} = gridFixture();
  const model = buildWaybackModel(graph, route, {reach: 'line2k'});
  const id = Uint8Array.from({length: 16}, (_, i) => i + 1);
  const grey = () => 1;
  const bare = encodeWaybackV2(model, id, grey);
  const layer = greyLayer(decodeWayback(bare));
  assert(layer, 'the grid has grey pieces');
  const file = new Uint8Array(bare.length + layer.length);
  file.set(bare, 0); file.set(layer, bare.length);
  const plain = decodeWayback(bare), withLayer = decodeWayback(file);
  assert.deepEqual(withLayer.nodes, plain.nodes);
  assert.deepEqual(withLayer.extras, plain.extras);
  const bad = file.slice();
  bad[bare.length] ^= 0xFF;   // first byte of the magic
  assert.throws(() => decodeWayback(bad));
});
