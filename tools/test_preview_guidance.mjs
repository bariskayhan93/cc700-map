// Synthetic cumulative distances; no recorded coordinates or private route files.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewGuidance } from '../js/preview_guidance.js';
const section = (dist, dir = 0, text = 'Road', type = 1) => ({dist, dir, text, type});
const synthetic = [section(15281.84), section(15591.02), section(15858, 3), section(22562.58, 0, 'Finish', 2)];

test('photo-derived synthetic countdown spans straight record boundaries', () => {
  const initial = previewGuidance(synthetic, 15192.58, 22562.58);
  assert(Math.abs(initial.remaining - 665.42) < 0.001);
  assert.equal(initial.dir, 0);
  assert.equal(initial.targetIndex, 2);
  for (const distance of [15281.83, 15281.84, 15281.85, 15591.01, 15591.02, 15591.03]) {
    assert(Math.abs(previewGuidance(synthetic, distance, 22562.58).remaining - (15858 - distance)) < 0.001);
  }
});
test('maneuver icon changes at 300 m inclusive independently of section boundaries', () => {
  assert.equal(previewGuidance(synthetic, 15557.99, 22562.58).dir, 0);
  assert.equal(previewGuidance(synthetic, 15558, 22562.58).dir, 3);
  assert.equal(previewGuidance(synthetic, 15558.01, 22562.58).dir, 3);
});
test('passed maneuver advances, while its exact point still has a zero countdown', () => {
  assert.equal(previewGuidance(synthetic, 15858, 22562.58).remaining, 0);
  const passed = previewGuidance(synthetic, 15858.01, 22562.58);
  assert.equal(passed.targetIndex, 3);
  assert.equal(passed.dir, 6);
  assert(Math.abs(passed.remaining - 6704.57) < 0.001);
});
for (const gap of [22, 27]) test(`close ${gap} m turn pair keeps then hint until first maneuver passes`, () => {
  const route = [section(100, 3, 'then left · First road'), section(100 + gap, 1, 'Second road'), section(300, 0, 'Finish', 2)];
  const first = previewGuidance(route, 90, 300);
  assert.equal(first.nextDir, 1);
  assert.equal(first.street, 'First road');
  assert.equal(first.dir, 3);
  const second = previewGuidance(route, 100.1, 300);
  assert.equal(second.nextDir, null);
  assert.equal(second.street, 'Second road');
  assert.equal(second.dir, 1);
});
test('lookahead preserves current street and explicit waypoint rather than exposing future names', () => {
  const route = [section(100, 0, '▶ Water stop'), section(250, 3, 'Future street'), section(500, 0, 'Finish', 2)];
  assert.equal(previewGuidance(route, 50, 500).street, '▶ Water stop');
  assert.equal(previewGuidance(route, 100.1, 500).street, 'Future street');
});
test('then hint requires a real nearby subsequent maneuver and preserves literal street text', () => {
  const route = [section(100, 3, 'then left · Street'), section(200, 1), section(300, 0, 'Finish', 2)];
  assert.equal(previewGuidance(route, 90, 300).nextDir, null);
  const literal = [section(100, 3, 'then market street'), section(300, 0, 'Finish', 2)];
  assert.equal(previewGuidance(literal, 90, 300).street, 'then market street');
});
test('straight-only and empty routes count to destination without inventing a turn', () => {
  const route = [section(100), section(300, 0, 'Finish', 2)];
  assert.equal(previewGuidance(route, 120, 300).remaining, 180);
  assert.equal(previewGuidance(route, 120, 300).dir, 6);
  assert.equal(previewGuidance([], 20, 100).remaining, 80);
  assert.equal(previewGuidance([], 20, 100).dir, 6);
});
test('arrival uses exact total distance and clamps negative or overshooting replay positions', () => {
  const route = [section(100.4, 0, 'Finish', 2)];
  assert.equal(previewGuidance(route, 100, 100.4).finished, false);
  const arrival = previewGuidance(route, 100.4, 100.4);
  assert.equal(arrival.finished, true);
  assert.equal(arrival.remaining, 0);
  assert.equal(arrival.nextDir, null);
  assert.equal(previewGuidance(route, 200, 100.4).remaining, 0);
  assert.equal(previewGuidance(route, -5, 100.4).remaining, 100.4);
});
