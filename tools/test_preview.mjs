import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRoute } from '../js/route.js';
import { draw, readFile } from '../js/preview.js';

const start = [51.22, 6.78];
const at = (east, north) => [start[0] + north / 111320, start[1] + east / 70000];
const route = { name: 'Preview test', pts: [0, 50, 100, 150, 200].map(n => [...at(0, n), 0]) };
const road = { kind: 1, name: 'Teststrasse', pts: [at(70, -30), at(70, 240)] };
const pond = [[at(-150, 20), at(-60, 20), at(-60, 160), at(-150, 160), at(-150, 20)]];
const features = {
  water: [pond], green: [pond.map(ring => ring.map(([lat, lon]) => [lat, lon + 0.003]))],
  signals: [at(28, 60)], trams: [[at(-90, 30), at(90, 30)]],
};
const nameImage = () => new Uint8Array(42);
function generate(styled, map = {}, data = features) {
  return buildRoute(route, [road], { id: '11120000', speedKmh: 18, nameImage,
    ...data, map: { styled, ...map } });
}
function render(model, distance = 40, styled) {
  const calls = { stroke: [], fill: [], labels: [], positions: [] };
  const context = {
    beginPath() {}, closePath() {}, fillRect() {}, setLineDash() {}, arc() {}, scale() {},
    moveTo(...point) { calls.positions.push(point); },
    lineTo(...point) { calls.positions.push(point); },
    stroke() { calls.stroke.push(this.strokeStyle); },
    fill(rule) { calls.fill.push([this.fillStyle, rule]); },
    strokeText() {}, fillText(label) { calls.labels.push(label); },
    measureText(label) { return { width: label.length * 6 }; },
  };
  draw({ getContext: () => context }, model, distance, styled);
  assert(calls.positions.every(point => point.every(Number.isFinite)));
  return calls;
}
test('stock route draws white and grey junction segments and a blue route', () => {
  const model = readFile(generate(false).file);
  const calls = render(model);
  assert(calls.stroke.includes('#c8d0de'));
  assert(calls.stroke.includes('#ffffff'));
  assert(calls.stroke.includes('#1f6fe0'));
  assert(!calls.stroke.includes('#d62828'));
  assert(calls.fill.every(([, rule]) => rule !== 'evenodd'));
  assert.deepEqual(calls.labels, []);
});
test('patched route reads encoded areas, lines, street names and signals', () => {
  const built = generate(true);
  const model = readFile(built.file);
  assert.equal(model.blocks.length, built.sections.length);
  const calls = render(model);
  assert(calls.fill.some(([colour, rule]) => colour === '#72b8f2' && rule === 'evenodd'));
  assert(calls.fill.some(([colour, rule]) => colour === '#a2d683' && rule === 'evenodd'));
  assert(calls.stroke.includes('#ffc640'));
  assert(calls.stroke.includes('#3b1f6e'));
  assert(calls.fill.some(([colour]) => colour === '#ffb300'));
  assert(calls.stroke.includes('#d62828'));
  assert(calls.labels.includes('Teststr.'));
});
test('disabled patched layers are absent from the generated preview', () => {
  const model = readFile(generate(true, { names: false }, { water: [pond] }).file);
  const calls = render(model);
  assert.deepEqual(calls.labels, []);
  assert(!calls.stroke.includes('#3b1f6e'));
  assert(!calls.fill.some(([colour]) => colour === '#ffb300'));
  assert(calls.stroke.includes('#d62828'));
});
test('the selected patch palette also works without map entries', () => {
  const built = buildRoute(route, [], { id: '11120000', speedKmh: 18, nameImage, map: { styled: true } });
  const calls = render(readFile(built.file), 40, true);
  assert(calls.stroke.includes('#d62828'));
});

test('the patched preview draws the turn arrow at a nearby corner', () => {
  const corner = {
    secs: [
      [[...at(0, 0), 0], [...at(0, 100), 10000]],
      [[...at(0, 100), 10000], [...at(100, 100), 20000]],
    ],
    blocks: [[], []],
    styled: true,
  };
  assert(!render(corner, 50).stroke.includes('#111111'));             // arrow option off: the file has no arrow entries
  const arrow = { style: 15 | (2 << 4) | (1 << 16), center: at(0, 100), points: [at(0, 80), at(0, 100), at(20, 100)] };
  corner.blocks = [[arrow], [arrow]];                                   // arrow option on: class 15 entries in the file
  assert(render(corner, 50).stroke.includes('#111111'));
  assert(!render(corner, 150).stroke.includes('#111111'));
  assert(!render(corner, 50, false).stroke.includes('#111111'));
});
