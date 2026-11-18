// tools/test_wayback_replay.mjs
import fs from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeSamples} from './wayback_tree.mjs';
import {episodesOf, exitOf, isWrongPart, reversedAtPoint1} from './wayback_replay.mjs';
import {encodeWaybackV2, decodeWayback} from './wayback_format.mjs';
import {compareLine} from './wayback_precision.mjs';
import {buildWaybackModel} from './wayback_tree.mjs';
import {gridFixture} from './wayback_fixture.mjs';
import {runCore} from './wayback_core_host.mjs';

const K = Math.cos(51 * Math.PI / 180);
const at = g => [51, 7 + g / (111320 * K)];   // metres east along one street
const route = [{point: at(0), progress: 0}, {point: at(5000), progress: 500000}];
const samples = routeSamples(route, 5);

test('an episode is a run of off-route rows, and a run from row 0 has no trusted exit', () => {
  const tl = [
    {provider_reason: 'off-route', original_progress_m: 0},
    {provider_reason: 'off-route', original_progress_m: 0},
    {provider_reason: 'on-route', original_progress_m: 100},
    {provider_reason: 'off-route', original_progress_m: 250},
  ];
  assert.deepEqual(episodesOf(tl), [{a: 0, b: 1}, {a: 3, b: 3}]);
  assert.deepEqual(exitOf(tl, {a: 0, b: 1}), {exitM: 0, trusted: false});
  assert.deepEqual(exitOf(tl, {a: 3, b: 3}), {exitM: 100, trusted: true});
});
test('a last point is wrong part when no route sample in the forward window is within 10 m', () => {
  assert.equal(isWrongPart(at(2000), 4500, samples, 1500), true);   // window 2450 m to 8000 m
  assert.equal(isWrongPart(at(2000), 4500, samples, 4000), false);  // window 450 m to 8000 m
  assert.equal(isWrongPart(at(4000), 4500, samples, 1500), false);
});
test('a reversal at point 1 is a line that comes back toward the rider', () => {
  assert.equal(reversedAtPoint1([[51, 7], [51, 7.001], [51, 7.0005]]), true);
  assert.equal(reversedAtPoint1([[51, 7], [51, 7.001], [51, 7.002]]), false);
  assert.equal(reversedAtPoint1([[51, 7], [51, 7.001]]), false);
});
// cc26 (D2): replay of 1,500 rider points on the synthetic grid. Version 2 against the recorded version 1 output
// (tools/wayback_core_fixture.json, lines 215 to 1714) within the precision rules (R-PREC).
test('replay of 1,500 rider points: version 2 matches version 1 within the precision rules (R-PREC)', () => {
  const {graph, route: r2} = gridFixture();
  const model = buildWaybackModel(graph, r2, {reach: 'line2k'});
  const id = Uint8Array.from({length: 16}, (_, i) => i + 1);
  const fixture = JSON.parse(fs.readFileSync(new URL('./wayback_core_fixture.json', import.meta.url), 'utf8'));
  const lines = fixture.lines.slice(215);
  assert.equal(lines.length, 1500);
  const bytes = encodeWaybackV2(model, id);
  const dec = decodeWayback(bytes);
  const v2 = runCore(bytes, id, lines);
  assert.equal(v2.length, 1500);
  let band = 0;
  v2.forEach((r, i) => { if (compareLine(`replay ${i}`, dec, r, fixture.v1[215 + i], lines[i].latE7, lines[i].lonE7, graph) === 'band') band++; });
  console.log(`replay: states in the 14.5 m to 15.5 m band: ${band} of 1500`);
});
