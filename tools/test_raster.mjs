// tools/test_raster.mjs: firmware/raster on the host (cc27 Task 2). The same C runs on the unit.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'raster-'));
process.on('exit', () => { try { fs.rmSync(work, {recursive: true, force: true}); } catch {} });
const exe = path.join(work, 'raster');
execFileSync('cc', ['-std=gnu11', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-DHOST',
  '-fsanitize=address,undefined', '-fno-sanitize-recover=all', '-I', path.join(root, 'firmware/common'),
  '-I', path.join(root, 'firmware/raster'), path.join(root, 'tools/raster_host.c'),
  path.join(root, 'firmware/raster/raster.c'), '-o', exe], {stdio: ['ignore', 'pipe', 'pipe']});
const run = (...a) => JSON.parse(execFileSync(exe, a.map(String), {encoding: 'utf8'}));
const probe = (x, y, ...a) => JSON.parse(execFileSync(exe, a.map(String), {encoding: 'utf8', env: {...process.env, PROBE: `${x},${y}`}})).probe;
const WHITE = 0xffff;
// pixels of a disk of diameter d (rule of rs_disk: 4i^2 + 4j^2 <= d^2) with i < 0: the part beyond a line end
const halfDisk = d => { let k = 0; for (let i = -d; i < 0; i++) for (let j = -d; j <= d; j++) if (4 * i * i + 4 * j * j <= d * d) k++; return k; };

test('a horizontal line of width 7 from (10,50) to (110,50) sets 101 x 7 pixels plus the two end disks', () => {
  const r = run('line', 7, WHITE, 255, 1, 10, 50, 110, 50);
  assert.equal(r.changed, 101 * 7 + 2 * halfDisk(7));
  assert.deepEqual(r.box, [7, 47, 113, 53]);
});

test('a width-1 line from (0,0) to (9,3) sets exactly 10 pixels, the same set in both directions', () => {
  const a = run('line', 1, WHITE, 255, 0, 0, 0, 9, 3), b = run('line', 1, WHITE, 255, 0, 9, 3, 0, 0);
  assert.equal(a.changed, 10);
  assert.equal(a.hash, b.hash);
});

test('a 45 degree line of width 4 without ends sets exactly its work: 101 steps of 6 pixels', () => {
  const r = run('line', 4, WHITE, 255, 0, 20, 20, 120, 120);
  assert.equal(r.work, 101 * 6 + 2 * 16);   // rs_work charges the 2 point disks of w >= 3
  assert.equal(r.changed, 101 * 6);
});

test('a line fully outside the canvas changes no pixel; a line from (-500,-500) to (500,500) stays in bounds', () => {
  assert.equal(run('line', 7, WHITE, 255, 1, -300, -50, -100, -60).changed, 0);
  const r = run('line', 13, WHITE, 255, 1, -500, -500, 500, 500);
  assert.ok(r.changed > 0);
  assert.deepEqual([r.box[0], r.box[1]], [0, 0]);
  assert.ok(r.box[2] <= 239 && r.box[3] <= 255);
});

test('rs_fill gives the same pixels as the v21 fill on the renderer fixtures', () => {
  const cases = [
    [0xd4d4, 10, 10, 200, 30, 120, 220],                                   // triangle
    [0xa2d6, -40, -40, 300, -10, 280, 300, -20, 290],                      // over every canvas edge
    [0x82cb, 20, 20, 220, 20, 220, 220, 20, 220, 20, 20, 60, 60, 60, 180, 180, 180, 180, 60, 60, 60, 20, 20],   // hole with a doubled bridge
  ];
  for (const c of cases) { const r = run('fill', ...c); assert.equal(r.hash, r.ref); assert.ok(r.changed > 0); }
});

test('white at opa 115 over black gives RGB565 0x6b8d (R 13, G 28, B 13)', () => {
  assert.equal(run('line', 1, WHITE, 115, 0, 5, 5, 5, 5).first, 0x6b8d);
});

test('rs_work of a 3-point line of width 4 is (40+1)*4 + (20+1)*4 + 3*16', () => {
  assert.equal(run('work', 4, 0, 255, 1, 10, 10, 50, 10, 50, 30).work, 41 * 4 + 21 * 4 + 3 * 16);
});

test('the same line drawn two times gives the same hash (no state)', () => {
  const a = run('line', 5, 0x1234, 255, 1, 3, 200, 230, 17, 100, 250), b = run('line', 5, 0x1234, 255, 1, 3, 200, 230, 17, 100, 250);
  assert.equal(a.hash, b.hash);
});

test('rs_rect fills [x0, x1) x [y0, y1) and clips at the canvas', () => {
  assert.equal(run('rect', 4, 68, 236, 100, WHITE).changed, 232 * 32);
  assert.equal(run('rect', -10, 250, 5, 300, WHITE).changed, 5 * 6);
});

test('a disk of diameter 7 at the canvas corner stays in bounds', () => {
  const r = run('disk', 0, 0, 7, WHITE, 255);
  assert.deepEqual([r.box[0], r.box[1]], [0, 0]);
  assert.equal(r.changed, 4 + 4 + 3 + 2);   // the quarter i, j >= 0 of the rule i^2 + j^2 <= 12.25: rows of 4, 4, 3, 2
});

// cc28 smooth lines (rs_line_aa): exact width, edge pixels blended by their coverage, pixel (x, y) centred at (x, y).
test('smooth: a horizontal line of width 4 at y = 50 has 3 full rows and 2 half rows (0x7bef) over 101 columns', () => {
  const r = run('aa', 4, WHITE, 255, 0, 10, 50, 110, 50);
  assert.equal(r.changed, 101 * 5);
  assert.equal(r.first, 0x7bef);                 // row 48: coverage 1/2 of white over black (rs_blend rounds down)
  assert.equal(probe(60, 50, 'aa', 4, WHITE, 255, 0, 10, 50, 110, 50), WHITE);
  assert.equal(probe(60, 52, 'aa', 4, WHITE, 255, 0, 10, 50, 110, 50), 0x7bef);
});

test('smooth: a width-1 horizontal line at a whole-pixel y sets exactly one full pixel per column', () => {
  const r = run('aa', 1, WHITE, 255, 0, 10, 50, 110, 50);
  assert.equal(r.changed, 101);
  assert.equal(r.sum, 101 * 63);
});

test('smooth: a 45 degree line of width 4 covers w * sqrt(2) pixels per column (within 2 %)', () => {
  const r = run('aa', 4, WHITE, 255, 0, 20, 20, 120, 120), area = 101 * 4 * Math.SQRT2;
  assert.ok(Math.abs(r.sum / 63 - area) / area < 0.02, `coverage ${r.sum / 63} against ${area}`);
});

test('smooth: the same pixels in both directions', () => {
  assert.equal(run('aa', 5, WHITE, 255, 1, 3, 200, 230, 17).hash, run('aa', 5, WHITE, 255, 1, 230, 17, 3, 200).hash);
});

test('smooth: a straight 3-point line gives the same pixels as the 2-point line (no second blend at the joint)', () => {
  assert.equal(run('aa', 4, WHITE, 255, 1, 10, 50, 60, 50, 110, 50).hash, run('aa', 4, WHITE, 255, 1, 10, 50, 110, 50).hash);
  assert.equal(run('aa', 3, WHITE, 255, 1, 10, 10, 60, 40, 110, 70).hash, run('aa', 3, WHITE, 255, 1, 10, 10, 110, 70).hash);
});

test('smooth: a right-angle corner of width 6 has no gap at the outer corner', () => {
  assert.ok(probe(102, 102, 'aa', 6, WHITE, 255, 1, 20, 100, 100, 100, 100, 20) > 0);
});

test('smooth: a line from (-500,-500) to (500,500) of width 13 stays in the canvas; a line outside changes nothing', () => {
  const r = run('aa', 13, WHITE, 255, 1, -500, -500, 500, 500);
  assert.ok(r.changed > 0);
  assert.deepEqual([r.box[0], r.box[1]], [0, 0]);
  assert.equal(run('aa', 7, WHITE, 255, 1, -300, -50, -100, -60).changed, 0);
});

test('smooth: opacity 115 scales the coverage (a full pixel of white over black is 0x6b8d, as rs_line)', () => {
  assert.equal(probe(60, 50, 'aa', 1, WHITE, 115, 0, 10, 50, 110, 50), 0x6b8d);
});

// cc28b: rs_line_aa takes the width in half pixels ('aa2'; 'aa' passes w * 2).
test('smooth: a width of 8 half pixels equals width 4', () => {
  assert.equal(run('aa2', 8, WHITE, 255, 1, 10, 10, 200, 90).hash, run('aa', 4, WHITE, 255, 1, 10, 10, 200, 90).hash);
});

test('smooth: a 1.5 px horizontal line has one full row and two quarter rows', () => {
  const a = [3, WHITE, 255, 0, 10, 50, 110, 50];
  assert.equal(probe(60, 50, 'aa2', ...a), WHITE);
  assert.equal(probe(60, 48, 'aa2', ...a), 0);
  assert.equal(probe(60, 52, 'aa2', ...a), 0);
  const q = probe(60, 49, 'aa2', ...a);
  assert.ok(q > 0 && q < 0x7bef, q.toString(16));
  assert.equal(probe(60, 51, 'aa2', ...a), q);
  const r = run('aa2', ...a), want = 1.5 * 101 * 63;
  assert.ok(Math.abs(r.sum - want) / want < 0.03, `${r.sum} ${want}`);
});
