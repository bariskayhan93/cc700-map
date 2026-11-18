// tools/test_wayback_grey.mjs (cc26, D1b): the page sets the grey flag of each way-back piece from the map.
// Synthetic data near latitude 51, longitude 7.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildRoute} from '../js/route.js';
import {greyFlags} from '../js/wayback_grey.js';
import {makeFrame} from '../js/wayback_format.js';

const origin = [51.2, 6.8], at = (x, y) => [origin[0] + y / 111320, origin[1] + x / 70000];
const route = {name: 'Grey', pts: Array.from({length: 41}, (_, i) => [...at(0, i * 50), 0])};
const mapRoad = {kind: 3, name: 'Map', pts: [at(200, -100), at(200, 3000)]};   // a map street 200 m east of the route
const build = lines => buildRoute(route, lines, {id: '11120000', nameImage: () => new Uint8Array(42), map: {styled: true}, speedKmh: 18}).file;
const onMap = [at(200, 500), at(200, 700)], away = [at(400, 500), at(400, 700)];
const frame = makeFrame([...onMap, ...away]);
const unitsOf = ([la, lo]) => frame.toUnits([la, lo]);

test('a piece on a map street is not grey; a piece 200 m away is grey', () => {
  const flagOf = greyFlags(build([mapRoad]), frame);
  assert.equal(flagOf(unitsOf(onMap[0]), unitsOf(onMap[1])), 0);
  assert.equal(flagOf(unitsOf(away[0]), unitsOf(away[1])), 1);
});

test('a piece with only one end on the map is grey', () => {
  const flagOf = greyFlags(build([mapRoad]), frame);
  assert.equal(flagOf(unitsOf(onMap[0]), unitsOf(away[0])), 1);
});

test('every piece is grey when the map has no street line', () => {
  const flagOf = greyFlags(build([]), frame);
  assert.equal(flagOf(unitsOf(onMap[0]), unitsOf(onMap[1])), 1);
});

test('every piece is grey when the route file has no map section', () => {
  const bytes = build([mapRoad]).slice();
  new DataView(bytes.buffer).setUint32(0x5c, 0, true);
  const flagOf = greyFlags(bytes, frame);
  assert.equal(flagOf(unitsOf(onMap[0]), unitsOf(onMap[1])), 1);
});
