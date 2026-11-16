import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyOutside} from './recovery_outside_audit.mjs';

// An east-running leg along latitude 51. The rider starts on the route, then reports one outside fix.
const leg = [[51, 7.0000], [51, 7.0020]];
const timeline = [
  {off_original_route_m: 0, ambiguous_with_other_pass: false, original_progress_m: 100},   // ordered on-route fix
  {off_original_route_m: 40, ambiguous_with_other_pass: false, original_progress_m: 0},    // outside fix
];
const events = [{reason: 0}, {reason: 6}];
const manifest = {packages: [{name: 'r0001.rcp', entryMin: 0, entryMax: 100000000}]};
const run = ({track, legs}) => classifyOutside({track, timeline, events, manifest,
  legsOf: () => legs.map((poly, i) => ({index: i + 1, poly}))});

test('a rider on the leg, heading against it, is reported as facing against the leg', () => {
  // Heading west, from 7.0010 to 7.0000 along the same street.
  const out = run({track: [[0, 51, 7.0010], [2, 51, 7.0000]], legs: [leg]});
  assert.equal(out.total, 1);
  assert.equal(out.rows[0].category, 'within-15m-heading-against-leg');
  assert.equal(out.rows[0].headingVsNearestLegDeg, 180);
});

test('a rider 50 m from every leg is reported as having no leg within 15 m', () => {
  const out = run({track: [[0, 51, 7.0010], [2, 51.00045, 7.0000]], legs: [leg]});
  assert.equal(out.rows[0].category, 'no-leg-within-15m');
  assert(out.rows[0].distanceToNearestLegM > 15);
});

test('a package with no legs is reported as such', () => {
  const out = run({track: [[0, 51, 7.0010], [2, 51, 7.0000]], legs: []});
  assert.equal(out.rows[0].category, 'package-has-no-legs');
  assert.equal(out.counts['r0001.rcp package-has-no-legs'], 1);
});
