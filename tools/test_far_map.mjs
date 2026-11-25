// Far map (section type 4, design docs/superpowers/specs/2026-11-23-far-map-design.md): classes, far pieces at the
// detail reach, area clipping, encode/read round trip, body limit, fit to the caps. Host only, synthetic data.
import assert from 'node:assert/strict';
import {makeFrame} from '../js/wayback_format.js';
import {HANDOVER_M, HANDOVER_LONG_M} from '../js/mapsec.js';
import {farClassOf, areaClassOf, buildFarCells, encodeFar, readFar, fitFar, proveFar, FAR_CAPS, FILL_STACK, FAR} from '../js/far_map.js';

const ok = name => console.log('PASS ' + name);
const LAT = 51.0, mN = 1 / 111320, mE = 1 / (111320 * Math.cos(LAT * Math.PI / 180));
const P = (e, n) => [LAT + n * mN, 7.0 + e * mE];                    // metres east/north of (51.0, 7.0)
const route = [P(0, 0), P(4000, 0)];
const frame = makeFrame([...route, P(0, 3500), P(4000, 3500), P(0, -3500)]);
const U = 16;                                                          // way-back units per metre
const dist = q => { const [x, y] = frame.toUnits(q), [x0, y0] = frame.toUnits(route[0]); return Math.abs(y - y0) / U; };

// 1. classes
assert.equal(farClassOf({highway: 'track'}), FAR.TRACK, 'WP 6: exit tracks are drawn, so the violet line never runs on an empty map');
assert.equal(farClassOf({highway: 'path'}), FAR.PATH, 'WP 6: exit path drawn');
assert.equal(farClassOf({highway: 'track', tracktype: 'grade2'}), FAR.TRACK);
assert.equal(farClassOf({highway: 'motorway'}), null);
assert.equal(farClassOf({highway: 'service', service: 'driveway'}), null);
assert.equal(farClassOf({highway: 'path', bicycle: 'yes'}), FAR.PATH);
assert.equal(areaClassOf({landuse: 'residential'}), FAR.BUILT);
assert.equal(farClassOf({highway: 'primary'}), FAR.MAIN);
assert.equal(farClassOf({highway: 'residential'}), FAR.MINOR);
assert.equal(farClassOf({highway: 'cycleway'}), FAR.CYCLE);
assert.equal(farClassOf({highway: 'bridleway'}), FAR.PATH, 'WP 6: exit way');
assert.equal(farClassOf({highway: 'path', informal: 'yes'}), null, 'cut ways stay out');
assert.equal(farClassOf({waterway: 'stream'}), FAR.WATERLINE);
assert.equal(farClassOf({highway: 'footway'}), null);
assert.equal(farClassOf({highway: 'service'}), FAR.MINOR, 'plain service roads stay (bike rule); driveways are cut');
assert.equal(areaClassOf({landuse: 'forest'}), FAR.FOREST);
assert.equal(areaClassOf({natural: 'water'}), FAR.WATER);
assert.equal(areaClassOf({leisure: 'park'}), FAR.GREEN);
assert.equal(areaClassOf({landuse: 'farmland'}), null);
assert.equal(HANDOVER_M, 300, 'WP 6 handover: line classes at 300 m');
assert.equal(HANDOVER_LONG_M, 450, '25 Nov option a: main roads, rails and trams at 450 m');
ok('classes');

// 2. a street that leaves and enters the 300 m minor reach (WP 6 handover) two times gives two far pieces that start at the reach
const zig = {tags: {highway: 'residential'}, pts: [P(2000, 0), P(2000, 1000), P(2040, 220), P(2080, 1000)]};
const lines = buildFarCells({ways: [zig], areas: [], route, frame, reachM: 3000}).flatMap(c => c.items.filter(i => i.cls === FAR.MINOR));
const ends = lines.flatMap(l => [l.pts[0], l.pts.at(-1)]).map(([x, y]) => (y - frame.toUnits(route[0])[1]) / U).filter(d => d < 400);
assert.equal(ends.length, 3, 'three reach crossings: out, in, out');
for (const d of ends) assert(Math.abs(d - 300) <= 40, 'piece end at the reach: ' + d);
const zigMain = {...zig, tags: {highway: 'primary'}}, zigTer = {...zig, tags: {highway: 'tertiary'}};
const nearest = w => Math.min(...buildFarCells({ways: [w], areas: [], route, frame, reachM: 3000}).flatMap(c => c.items.filter(i => i.cls === FAR.MAIN))
  .flatMap(l => l.pts).map(([x, y]) => (y - frame.toUnits(route[0])[1]) / U));
assert(Math.abs(nearest(zigMain) - 430) <= 20, 'main road: the far line starts at 450 m - OVERLAP_M: ' + nearest(zigMain));
assert(Math.abs(nearest(zigTer) - 280) <= 20, 'tertiary (detail class MIN): the far line starts at 300 m - OVERLAP_M: ' + nearest(zigTer));
ok('far pieces start at the detail reach');

// 3. an area over several cells: one clipped ring per cell, each inside its cell, area kept; a small area is dropped
const sq = (e, n, s) => [P(e, n), P(e + s, n), P(e + s, n + s), P(e, n + s), P(e, n)];
const L = [P(1000, 1500), P(1700, 1500), P(1700, 1800), P(1300, 1800), P(1300, 2200), P(1000, 2200), P(1000, 1500)];   // concave
const cells = buildFarCells({ways: [], areas: [{tags: {landuse: 'forest'}, rings: [sq(2500, 1500, 600)]}, {tags: {natural: 'water'}, rings: [L]},
  {tags: {leisure: 'park'}, rings: [sq(3000, 3000, 50)]}], route, frame, reachM: 3000});
const rings = cls => cells.flatMap(c => c.items.filter(i => i.cls === cls).map(i => ({key: c.key, pts: i.pts})));
const shoe = r => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2) / (U * U);
for (const [cls, want] of [[FAR.FOREST, 360000], [FAR.WATER, 300 * 700 + 400 * 300]]) {
  const r = rings(cls);
  assert(r.length >= 3, 'clipped into several cells');
  for (const {key, pts} of r) { const cx = (key & 0xFFFF) * 4096, cy = (key >>> 16) * 4096;
    for (const [x, y] of pts) assert(x >= cx - 8 && x <= cx + 4096 + 8 && y >= cy - 8 && y <= cy + 4096 + 8, 'inside the cell'); }
  const sum = r.reduce((s, x) => s + shoe(x.pts), 0);
  assert(Math.abs(sum - want) / want < 0.03, `area kept: ${sum} of ${want}`);
}
assert.equal(rings(FAR.GREEN).length, 0, 'area under 5,000 m2 dropped');
ok('areas clipped per cell, concave kept, small dropped');

// 4. encode -> read round trip
const both = buildFarCells({ways: [zig, {tags: {highway: 'track'}, pts: [P(500, 1200), P(900, 1700), P(1500, 1650)]}, {tags: {highway: 'track', tracktype: 'grade1'}, pts: [P(600, 1300), P(1000, 1900)]}],
  areas: [{tags: {landuse: 'forest'}, rings: [sq(2500, 1500, 600)]}], route, frame, reachM: 3000});
const bytes = encodeFar(both, FAR_CAPS, frame), back = readFar(bytes);
assert.deepEqual(back.caps, FAR_CAPS);
assert.deepEqual(back.frame, {lat0E7: frame.lat0E7, lon0E7: frame.lon0E7, latU: frame.latU, lonU: frame.lonU}, 'own frame in the header');
assert.deepEqual(back.cells.map(c => c.key), both.map(c => c.key));
const norm = cs => cs.map(c => c.items.map(i => i.cls + ':' + i.pts.map(p => p.join(',')).join(';')).sort());
assert.deepEqual(norm(back.cells), norm(both));
ok('encode and read round trip');

// 5. a cell body over 2,048 B throws
const many = Array.from({length: 120}, (_, k) => ({tags: {highway: 'track', tracktype: 'grade1'}, pts: Array.from({length: 30}, (_, j) => P(2010 + j * 7, 1510 + k * 2 + (j % 2) * 3))}));
assert.throws(() => encodeFar(buildFarCells({ways: many, areas: [], route, frame, reachM: 3000}), FAR_CAPS, frame), /far cell over 2048 B/);
ok('cell body limit');

// 6. fit: lines are removed until no screen is over the caps; low classes go first
const dense = [];
for (let k = 0; k < 60; k++) dense.push({tags: k % 2 ? {highway: 'path', bicycle: 'yes'} : {highway: 'tertiary'}, pts: [P(1500 + k * 15, 1200), P(1500 + k * 15, 2400)]});
const before = buildFarCells({ways: dense, areas: [], route, frame, reachM: 3000});
const caps = {pixCap: 20000, ptCap: 2048, fillCap: FAR_CAPS.fillCap};
assert(proveFar(before, caps).over > 0, 'dense test is over the cap');
const fit = fitFar(before, caps);
assert.equal(proveFar(fit.cells, caps).over, 0);
assert(fit.removedLines > 0);
const kept = c => fit.cells.flatMap(x => x.items).filter(i => i.cls === c).length;
assert(kept(FAR.MAIN) > kept(FAR.PATH), 'paths go before main roads');
ok('fit to the caps');

// 6b. fill stack: overlapping areas in one cell are cut to fillStack cell areas, the smallest area first
{
  const sq = (x0, y0, x1, y1) => ({tags: {landuse: 'forest'}, rings: [[P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1), P(x0, y0)]]});
  const big = sq(500, 500, 1500, 1500), areas = [big, big, big, big, sq(900, 900, 960, 960)];
  const cells = buildFarCells({ways: [], areas, route, frame, reachM: 3000});
  const p0 = proveFar(cells);
  assert(p0.worstStack > FILL_STACK && p0.fillOver > 0, 'test cell is over the fill stack');
  const f = fitFar(cells);
  assert(f.removedAreas > 0 && f.proof.fillOver === 0 && f.proof.worstStack <= FILL_STACK);
  // in each cell, every removed area is not larger than any kept area
  const area = r => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
  const after = new Map(f.cells.map(c => [c.key, c.items.map(i => area(i.pts))]));
  for (const c of cells) {
    const kept = after.get(c.key) || [], left = kept.slice(), removed = [];
    for (const a of c.items.map(i => area(i.pts))) { const j = left.indexOf(a); if (j >= 0) left.splice(j, 1); else removed.push(a); }
    if (removed.length && kept.length) assert(Math.max(...removed) <= Math.min(...kept), 'the smallest area goes first');
  }
  assert.equal(fitFar(fit.cells).removedAreas, 0, 'lines only: no area removal');
}
ok('fill stack');

// 7. owner decision 23 Nov (option 1): the far map reach is at most 2 km; the violet line keeps 3 km
{
  assert.deepEqual([FAR_CAPS.pixCap, FAR_CAPS.ptCap], [150000, 4096], 'time stop is the real limit; caps only guard');
  const w = {snapshot: {nodes: [{id: 1, point: P(1000, 2500)}, {id: 2, point: P(1200, 2500)}, {id: 3, point: P(1000, 1500)}, {id: 4, point: P(1200, 1500)}],
    ways: [{tags: {highway: 'residential'}, nodes: [1, 2]}, {tags: {highway: 'residential'}, nodes: [3, 4]}]},
    bbox: [P(0, -3200)[0], P(-3200, 0)[1], P(0, 3200)[0], P(7200, 0)[1]], route: route.map(p => ({point: p})), reach: 'line3k'};
  const {farSection: fs} = await import('../js/far_map.js'), out = readFar(fs(w, {areas: [], waterLines: []}, FAR_CAPS, 2000).bytes), full = readFar(fs(w, {areas: [], waterLines: []}).bytes);
  const ys = out.cells.flatMap(c => c.items.flatMap(i => i.pts.map(p => p[1]))), y0 = (Math.round(route[0][0] * 1e7) - out.frame.lat0E7) * out.frame.latU / 65536;
  assert(ys.length && ys.every(y => (y - y0) / U <= 2050), 'nothing beyond 2 km');
  const yf = full.cells.flatMap(c => c.items.flatMap(i => i.pts.map(p => p[1]))), y1 = (Math.round(route[0][0] * 1e7) - full.frame.lat0E7) * full.frame.latU / 65536;
  assert(yf.some(y => (y - y1) / U > 2200), 'default: the full 3 km reach of line3k');
  ok('far reach 3 km by default, 2 km on request (file guard)');
}
