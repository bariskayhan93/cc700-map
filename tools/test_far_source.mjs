// Far-map source (green, water, rivers): query per box with geometry, capture into areas and water lines.
import assert from 'node:assert/strict';
import {farQuery, captureFarSource} from '../js/far_source.js';
const ok = n => console.log('PASS ' + n);
const q = farQuery([[51, 7, 51.01, 7.01], [51.01, 7, 51.02, 7.01]]);
assert(/out geom/.test(q) && (q.match(/\(51,7,51\.01,7\.01\)/g) || []).length >= 3, 'statements per box');
assert.throws(() => farQuery([[51, 7, 52.5, 7.01]]), /exceeds|Invalid/);
ok('query');
const g = pts => pts.map(([lat, lon]) => ({lat, lon}));
const json = {elements: [
  {type: 'way', id: 1, tags: {landuse: 'forest'}, geometry: g([[51, 7], [51, 7.01], [51.01, 7.01], [51, 7]])},
  {type: 'way', id: 2, tags: {waterway: 'stream'}, geometry: g([[51, 7], [51.005, 7.002]])},
  {type: 'way', id: 3, tags: {natural: 'water'}},                                       // no geometry: dropped
  {type: 'relation', id: 4, tags: {type: 'multipolygon', natural: 'wood'}, members: [  // outer ring from two member ways
    {type: 'way', ref: 5, role: 'outer', geometry: g([[51.1, 7], [51.1, 7.01], [51.11, 7.01]])},
    {type: 'way', ref: 6, role: 'outer', geometry: g([[51.1, 7], [51.11, 7.01]])},
    {type: 'way', ref: 7, role: 'inner', geometry: g([[51.102, 7.002], [51.102, 7.003], [51.103, 7.003], [51.102, 7.002]])}]},
  {type: 'way', id: 1, tags: {landuse: 'forest'}, geometry: g([[51, 7], [51, 7.01], [51.01, 7.01], [51, 7]])}]};   // repeated in two boxes
const s = captureFarSource(json);
assert.equal(s.areas.length, 2, 'repeated way once, geometry-less way dropped');
assert.deepEqual(s.areas.find(a => a.tags.natural === 'wood').rings.length, 1, 'two outer members joined into one ring; inner not drawn');
const ring = s.areas.find(a => a.tags.natural === 'wood').rings[0];
assert.deepEqual(ring[0], ring.at(-1), 'closed ring');
assert.equal(s.waterLines.length, 1);
ok('capture');
