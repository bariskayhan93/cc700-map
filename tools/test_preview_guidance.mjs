// Synthetic cumulative distances; no recorded coordinates or private route files.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewGuidance } from '../js/preview_guidance.js';
const section = (dist, dir = 0, text = 'Road', type = 1) => ({dist, dir, text, caption:text, type});
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
for (const gap of [22, 27]) test(`close ${gap} m turn pair uses one outgoing caption row`, () => {
  const route = [section(100, 3, 'First road'), section(100 + gap, 1, 'then left · Second road'), section(300, 0, 'Third road', 2)];
  const first = previewGuidance(route, 90, 300);
  assert.equal(first.caption, 'then left · Second road');
  assert.equal(first.dir, 3);
  assert(!('nextDir' in first), 'native card has no separate following-turn row');
  const second = previewGuidance(route, 100.1, 300);
  assert.equal(second.caption, 'Third road');
  assert.equal(second.dir, 1);
});
test('near maneuver reads outgoing serialized caption including explicit waypoint', () => {
  const route = [section(100, 3, 'Approach'), section(500, 0, 'Legacy text', 2)];
  route[1].caption = '▶ Water stop';
  assert.equal(previewGuidance(route, 50, 500).caption, '▶ Water stop');
});
test('far maneuver shows Go straight rather than a future caption', () => {
  const route = [section(800, 3, 'Approach'), section(1000, 0, '▶ Future waypoint', 2)];
  assert.equal(previewGuidance(route, 400, 1000).caption, 'Go straight');
  assert.equal(previewGuidance(route, 500, 1000).caption, '▶ Future waypoint');
});
test('caption fallback supports legacy fixtures without adding a third line', () => {
  const route = [section(100, 3), section(300, 0, 'Exit street', 2)];
  delete route[1].caption;
  assert.equal(previewGuidance(route, 50, 300).caption, 'Exit street');
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
  assert.equal(arrival.caption, 'Arrived');
  assert.equal(previewGuidance(route, 200, 100.4).remaining, 0);
  assert.equal(previewGuidance(route, -5, 100.4).remaining, 100.4);
});
