// tools/test_screen_proof.mjs: the page proof of the grey work (js/screen_proof.js) against the unit C code (cc27 Task 7):
// gl_cells (wb_grey.c), rs_work (raster.c) and vw_map (view.c) through tools/grey_host.c. Synthetic data only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {greyCells, lineWorkBound, proveGreyLayer, fitGreyLayer} from '../js/screen_proof.js';
import {encodeGreyLayer, greyCellLines, readGreyLayer} from '../js/wayback_grey_layer.js';
import {gridParts, plusParts} from './grey_fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-proof-'));
process.on('exit', () => { try { fs.rmSync(work, {recursive: true, force: true}); } catch {} });
const exe = path.join(work, 'grey');
const W = d => path.join(root, 'firmware', d);
execFileSync('cc', ['-std=gnu11', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-DHOST', '-fsanitize=address,undefined',
  '-fno-sanitize-recover=all', '-I', W('common'), '-I', W('raster'), '-I', W('view'), '-I', W('wayback'),
  path.join(root, 'tools/grey_host.c'), W('wayback/wb_grey.c'), W('wayback/wayback.c'), W('wayback/wb_grey_draw.c'), W('raster/raster.c'),
  W('view/view.c'), '-lm', '-o', exe], {stdio: ['ignore', 'pipe', 'pipe']});
const batch = lines => execFileSync(exe, ['batch'], {input: lines.join('\n') + '\n', encoding: 'utf8', maxBuffer: 1 << 26}).trim().split('\n');
let seed = 12345;
const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;

test('greyCells equals the C cell selection for 2,000 positions and 16 headings', () => {
  const asks = [];
  for (let i = 0; i < 2000; i++) {
    const x = i < 40 ? Math.floor(rand() * 8000) : Math.floor(rand() * 400000), y = i < 40 ? Math.floor(rand() * 8000) : Math.floor(rand() * 400000);
    for (let h = 0; h < 16; h++) asks.push([x, y, h < 15 ? Math.round(h * 22.5) : Math.floor(rand() * 360)]);
  }
  const got = batch(asks.map(([x, y, c]) => `c ${x} ${y} ${c}`));
  let n = 0;
  asks.forEach(([x, y, c], i) => { assert.equal(greyCells(x, y, c).join(' '), got[i], `${x} ${y} ${c}`); n += got[i] ? 1 : 0; });
  assert(n > 31000, 'most positions select cells');
});

// The anchors that the stock projection gives at 2.5 m/px, heading-up, rider at screen (120, 216), rounded to pixels.
const anchors = (course, scale = 2.5) => [[0, 0], [16384, 0], [0, 16384], [16384, 16384]].map(([dx, dy]) => {
  const c = course * Math.PI / 180, e = dx / 16, n = dy / 16;
  return [Math.round(120 + (e * Math.cos(c) - n * Math.sin(c)) / scale), Math.round(216 - (e * Math.sin(c) + n * Math.cos(c)) / scale)];
});
test('rs_work of the drawn screen points is never above lineWorkBound at 2.5 m/px', () => {
  const cases = [];
  for (let i = 0; i < 6000; i++) {
    const ux = 60000 + Math.floor(rand() * 20000), uy = 60000 + Math.floor(rand() * 20000), course = Math.floor(rand() * 360);
    const n = 2 + Math.floor(rand() * 31), pts = [[ux + Math.floor(rand() * 8000) - 4000, uy + Math.floor(rand() * 8000) - 4000]];
    for (let k = 1; k < n; k++) {
      const step = i % 3 === 0 ? rand() * 64 : rand() * 6400, a = rand() * 2 * Math.PI;
      pts.push([Math.round(pts[k - 1][0] + step * Math.cos(a)), Math.round(pts[k - 1][1] + step * Math.sin(a))]);
    }
    cases.push({ux, uy, course, pts});
  }
  const got = batch(cases.map(c => `w ${c.pts.length} ${c.ux} ${c.uy} ${anchors(c.course).flat().join(' ')} ${c.pts.flat().join(' ')}`));
  let sumWork = 0, sumBound = 0;
  cases.forEach((c, i) => {
    const [ok, w] = got[i].split(' ').map(Number), bound = lineWorkBound(c.pts);
    assert.equal(ok, 1);
    assert(w <= bound, `case ${i}: work ${w} above the bound ${bound}`);
    sumWork += w; sumBound += bound;
  });
  assert(sumWork / sumBound > 0.6, `the bound is not loose: ${(sumWork / sumBound).toFixed(3)}`);
});

test('proveGreyLayer: worstWork and worstPoints are the largest screen sums, and over lists the screens above a cap', () => {
  const cells = greyCellLines(gridParts({spacingM: 60, count: 21}));
  const free = proveGreyLayer(cells, {pixCap: 1e9, ptCap: 1e9});
  assert.equal(free.over.length, 0);
  assert(free.screens >= 16 * 16 * cells.length, `screens ${free.screens}`);
  assert(free.worstWork > 0 && free.worstPoints > 0);
  const tight = proveGreyLayer(cells, {pixCap: free.worstWork - 1, ptCap: 1e9});
  assert(tight.over.length >= 1);
  const s = tight.over[0], sum = greyCells(s.x, s.y, s.course).reduce((t, k) => t + (cells.find(c => c.key === k)?.lines ?? []).reduce((u, l) => u + lineWorkBound(l), 0), 0);
  assert.equal(sum, free.worstWork);
  assert.equal(proveGreyLayer(cells, {pixCap: 1e9, ptCap: free.worstPoints}).over.length, 0);
  assert(proveGreyLayer(cells, {pixCap: 1e9, ptCap: free.worstPoints - 1}).over.length >= 1);
});

test('a layer over the pixel cap loses its shortest dead ends until every screen passes', () => {
  const at = 30 * 4096 + 2048, parts = plusParts(at, at);
  const lines = greyCellLines(parts)[0].lines;
  assert.equal(lines.length, 4);
  const byLen = [...lines].sort((a, b) => lineWorkBound(a) - lineWorkBound(b)), total = lines.reduce((t, l) => t + lineWorkBound(l), 0);
  const one = fitGreyLayer(parts, {pixCap: total - lineWorkBound(byLen[0]), ptCap: 2048});
  assert.equal(one.removedLines, 1);
  assert(Math.abs(one.removedKm - 0.030) < 0.002, String(one.removedKm));
  assert.equal(one.proof.over.length, 0);
  assert.deepEqual(readGreyLayer(one.bytes).cells[0].lines, lines.filter(l => l !== byLen[0]));
  const two = fitGreyLayer(parts, {pixCap: total - lineWorkBound(byLen[0]) - 1, ptCap: 2048});
  assert.equal(two.removedLines, 2);
  assert.deepEqual(readGreyLayer(two.bytes).cells[0].lines, lines.filter(l => l !== byLen[0] && l !== byLen[1]));
  const none = fitGreyLayer(parts, {pixCap: total, ptCap: 2048});
  assert.deepEqual([none.removedLines, none.removedKm], [0, 0]);
  assert.deepEqual(readGreyLayer(none.bytes).pixCap, total);
  assert.equal(fitGreyLayer(parts, {pixCap: 0, ptCap: 2048}).bytes, null);   // every line removed: no layer
});

test('a 30 m street grid over the default caps is fitted: the proof passes and the caps are in the header', () => {
  const fit = fitGreyLayer(gridParts({spacingM: 30, count: 41}), {pixCap: 60000, ptCap: 2048});
  assert.equal(fit.proof.over.length, 0);
  assert(fit.removedLines > 0, 'the 30 m grid is over the default cap');
  const r = readGreyLayer(fit.bytes);
  assert.deepEqual([r.pixCap, r.ptCap], [60000, 2048]);
  assert.equal(proveGreyLayer(r.cells, {pixCap: 60000, ptCap: 2048}).over.length, 0);
});

test('zoom 1.25 m/px: the unit work can exceed the proof; the cap stops at a line boundary', () => {
  const cells = greyCellLines(gridParts({spacingM: 60, count: 21})), byKey = new Map(cells.map(c => [c.key, c]));
  const x = 40000 + 9600, y = 40000 + 9600, course = 30;
  const bound = greyCells(x, y, course).reduce((t, k) => t + (byKey.get(k)?.lines ?? []).reduce((u, l) => u + lineWorkBound(l), 0), 0);
  const bytes = encodeGreyLayer(cells, {pixCap: bound, ptCap: 1e6}), f = path.join(work, 'zoom.bin');   // the proof of this screen
  fs.writeFileSync(f, bytes);
  const run = (scale, pixCap = 0) => JSON.parse(execFileSync(exe, ['draw', f, 0, bytes.length, x, y, course, scale, 0, pixCap, 0].map(String), {encoding: 'utf8', maxBuffer: 1 << 24}));
  const at25 = run(2.5), at125 = run(1.25), free125 = run(1.25, 1e9);
  assert.deepEqual([at25.done, at25.lines], [1, free125.lines]);
  assert(at25.work <= bound);
  assert(free125.work > bound, `the zoomed work ${free125.work} is above the proof ${bound}`);
  assert.equal(at125.done, 0);
  assert(at125.lines > 0 && at125.lines < free125.lines && at125.work <= bound);
  for (let i = 0; i < at125.bits.length; i++) if (at125.bits[i] === '1') assert.equal(free125.bits[i], '1', `pixel ${i}`);
});
