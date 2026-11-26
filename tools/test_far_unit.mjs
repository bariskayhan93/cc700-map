// tools/test_far_unit.mjs: the unit far-map reader and draw (firmware/wayback/wb_far.c) on the host with the raster and
// view modules, against the page format (js/far_map.js). Synthetic data only. ASan and UBSan on.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeFrame} from '../js/wayback_format.js';
import {buildFarCells, encodeFar, FAR} from '../js/far_map.js';
import {greyCells} from '../js/screen_proof.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'far-unit-'));
process.on('exit', () => { try { fs.rmSync(work, {recursive: true, force: true}); } catch {} });
const exe = path.join(work, 'far'), W = d => path.join(root, 'firmware', d);
execFileSync('cc', ['-std=gnu11', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-DHOST', '-DWB_DIAG', '-fsanitize=address,undefined',
  '-fno-sanitize-recover=all', '-I', W('common'), '-I', W('raster'), '-I', W('view'), '-I', W('wayback'),
  path.join(root, 'tools/far_host.c'), W('wayback/wb_far.c'), W('wayback/wb_grey.c'), W('wayback/wayback.c'), W('raster/raster.c'),
  W('view/view.c'), '-lm', '-o', exe], {stdio: ['ignore', 'pipe', 'pipe']});
// WB_DIAG (27 Nov): exe is the test image (line and area counters); rideExe is the ride image without them.
const rideExe = path.join(work, 'far-ride');
execFileSync('cc', ['-std=gnu11', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-DHOST', '-fsanitize=address,undefined',
  '-fno-sanitize-recover=all', '-I', W('common'), '-I', W('raster'), '-I', W('view'), '-I', W('wayback'),
  path.join(root, 'tools/far_host.c'), W('wayback/wb_far.c'), W('wayback/wb_grey.c'), W('wayback/wayback.c'), W('raster/raster.c'),
  W('view/view.c'), '-lm', '-o', rideExe], {stdio: ['ignore', 'pipe', 'pipe']});

// A 1.2 km street grid of residential streets 1 km north of a route, a track and a forest and a lake.
const LAT = 51.0, mN = 1 / 111320, mE = 1 / (111320 * Math.cos(LAT * Math.PI / 180)), P = (e, n) => [LAT + n * mN, 7.0 + e * mE];
const route = [P(0, 0), P(3000, 0)], frame = makeFrame([P(-3500, -3500), P(6500, 3500)]);
const ways = [];
for (let k = 0; k <= 12; k++) { ways.push({tags: {highway: 'residential'}, pts: [P(900 + k * 100, 900), P(900 + k * 100, 2100)]}); ways.push({tags: {highway: 'residential'}, pts: [P(900, 900 + k * 100), P(2100, 900 + k * 100)]}); }
ways.push({tags: {highway: 'track'}, pts: [P(1500, 2100), P(1600, 2600), P(1800, 2900)]}, {tags: {highway: 'secondary'}, pts: [P(0, 1500), P(3000, 1600)]});
const sq = (e, n, s) => [P(e, n), P(e + s, n), P(e + s, n + s), P(e, n + s), P(e, n)];
const areas = [{tags: {landuse: 'forest'}, rings: [sq(1300, 1650, 400)]}, {tags: {natural: 'water'}, rings: [sq(2200, 1000, 300)]}];
const cells = buildFarCells({ways, areas, route, frame, reachM: 3000});
const LEAD = 64, bytes = encodeFar(cells, {pixCap: 1e9, ptCap: 1e6, fillCap: 61440}, frame);
const put = (b, name) => { const f = path.join(work, name), o = new Uint8Array(LEAD + b.length + 40).fill(0xAA); o.set(b, LEAD); fs.writeFileSync(f, o); return f; };
const good = put(bytes, 'far.bin');
const rider = P(1500, 1500), e7 = v => Math.round(v * 1e7);
const draw = (o = {}) => JSON.parse(execFileSync(o.exe ?? exe, ['draw', o.file ?? good, LEAD, o.size ?? bytes.length, e7(o.at?.[0] ?? rider[0]), e7(o.at?.[1] ?? rider[1]),
  o.course ?? 0, 2.5, o.failAt ?? 0, o.pixCap ?? 0, o.ptCap ?? 0, o.limitUs ?? 1000000].map(String), {encoding: 'utf8', maxBuffer: 1 << 24}));
const byKey = new Map(cells.map(c => [c.key, c]));
function reference(course) {
  const [x, y] = frame.toUnits(rider).map(Math.floor), sel = greyCells(x, y, course).filter(k => byKey.has(k));
  const items = sel.flatMap(k => byKey.get(k).items);
  return {x, y, lines: items.filter(i => i.cls < FAR.WATER).length, areas: items.filter(i => i.cls >= FAR.WATER).length};
}

test('the unit draws every item of the screen cells, as the page wrote them', () => {
  for (const course of [0, 90, 225]) {
    const r = draw({course}), ref = reference(course);
    assert.deepEqual([r.open, r.x, r.y], [1, ref.x, ref.y], 'header and the rider units');
    assert.deepEqual([r.done, r.lines, r.areas], [1, ref.lines, ref.areas], 'course ' + course);
    assert(r.streetPx > 0 && (course !== 0 || r.forestPx > 0), 'areas filled and lines drawn');
  }
});
test('far streets: style D of 24 Nov (grey edge 4 px, white core 2 px)', () => {
  const r = draw();
  assert(r.streetPx > 0 && r.corePx > 0, 'edge and white core drawn');
});
test('a damaged section never crashes and draws no far map past the damage', () => {
  for (let n = 0; n < bytes.length; n += Math.max(1, Math.floor(bytes.length / 300))) {
    const f = put(bytes.slice(0, n), 'cut.bin'), r = draw({file: f, size: n});
    assert(r.done === 0 || n === bytes.length, 'cut at ' + n);
  }
  for (let k = 1; k <= 6; k++) assert.equal(draw({failAt: k}).done, 0, 'read ' + k + ' fails');
  const bad = bytes.slice(); bad[bad.length - 3] ^= 0xFF; const r = draw({file: put(bad, 'bad.bin')});
  assert(r.done === 0 || r.done === 1);
});
test('the caps and the time stop end the far map at an item boundary', () => {
  const all = draw(), cap = draw({pixCap: 2000});
  assert.equal(cap.done, 0); assert(cap.lines < all.lines && cap.work <= 2000);
  const late = draw({limitUs: 0});
  assert.equal(late.done, 0); assert.equal(late.lines + late.areas, 0);
});
test('a grey section (CCGL) is not a far map', () => {
  const g = bytes.slice(); g[2] = 0x47; g[3] = 0x4C;
  assert.equal(draw({file: put(g, 'grey.bin')}).open, 0);
});
test('ride image (no WB_DIAG): the same far map pixels, caps and stop as the test image; no line and area counts', () => {
  for (const o of [{}, {course: 90}, {pixCap: 4000}, {ptCap: 40}, {limitUs: 1}]) {
    const r = draw({...o, exe: rideExe}), d = draw(o), k = ['open', 'view', 'x', 'y', 'done', 'points', 'work', 'stop', 'reads', 'forestPx', 'streetPx', 'corePx'];
    assert.deepEqual(k.map(n => r[n]), k.map(n => d[n]), JSON.stringify(o));
    assert.deepEqual([r.lines, r.areas], [0, 0]);
  }
});
