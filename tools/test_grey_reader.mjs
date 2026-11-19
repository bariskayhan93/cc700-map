// tools/test_grey_reader.mjs: the grey reader (firmware/wayback/wb_grey.c) and the grey draw (wb_grey_draw.c) on the
// host, with the raster and view modules (cc27 Task 8). Synthetic street grids only. Way-back units: 1/16 m.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodeGreyLayer, greyCellLines, readGreyLayer} from '../js/wayback_grey_layer.js';
import {greyCells} from '../js/screen_proof.js';
import {gridParts} from './grey_fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'grey-reader-'));
process.on('exit', () => { try { fs.rmSync(work, {recursive: true, force: true}); } catch {} });
const exe = path.join(work, 'grey');
const W = d => path.join(root, 'firmware', d);
execFileSync('cc', ['-std=gnu11', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-DHOST', '-fsanitize=address,undefined',
  '-fno-sanitize-recover=all', '-I', W('common'), '-I', W('raster'), '-I', W('view'), '-I', W('wayback'),
  path.join(root, 'tools/grey_host.c'), W('wayback/wb_grey.c'), W('wayback/wb_grey_draw.c'), W('raster/raster.c'),
  W('view/view.c'), '-lm', '-o', exe], {stdio: ['ignore', 'pipe', 'pipe']});

// A 60 m street grid of 21 x 21 crossings with its corner at (40000, 40000) units; the layer starts 100 B into its file.
const cells = greyCellLines(gridParts({spacingM: 60, count: 21, x0: 40000, y0: 40000}));
const LEAD = 100;
function layerFile(bytes, name = 'layer.bin') {
  const f = path.join(work, name), out = new Uint8Array(LEAD + bytes.length + 50).fill(0xAA);
  out.set(bytes, LEAD); fs.writeFileSync(f, out);
  return {file: f, size: bytes.length};
}
const good = layerFile(encodeGreyLayer(cells, {pixCap: 1e9, ptCap: 1e6}));   // caps far above this grid: every line is drawn
const rider = {x: 40000 + 600 * 16, y: 40000 + 600 * 16};
// draw({file, size, x, y, course, scale, failAt, pixCap, ptCap})
const draw = (o = {}) => JSON.parse(execFileSync(exe, ['draw', o.file ?? good.file, LEAD, o.size ?? good.size, o.x ?? rider.x, o.y ?? rider.y,
  o.course ?? 0, o.scale ?? 2.5, o.failAt ?? 0, o.pixCap ?? 0, o.ptCap ?? 0].map(String), {encoding: 'utf8', maxBuffer: 1 << 24}));
const byKey = new Map(cells.map(c => [c.key, c]));
function reference(course, x = rider.x, y = rider.y) {
  const sel = greyCells(x, y, course), withBody = sel.filter(k => byKey.has(k));
  return {sel, withBody, rows: new Set(sel.map(k => k >>> 16)).size, lines: withBody.reduce((s, k) => s + byKey.get(k).lines.length, 0)};
}

test('every line of the selected cells is drawn: the line count equals the JS reference', () => {
  for (const course of [0, 45, 90, 200]) {
    const r = draw({course}), ref = reference(course);
    assert.deepEqual([r.view, r.open, r.done], [1, 1, 1], `course ${course}`);
    assert.equal(r.lines, ref.lines, `course ${course}`);
    assert(r.px > 1000);
  }
});

test('reads for grey are 1 + rows + cells with a body', () => {
  for (const course of [0, 30, 135]) {
    const r = draw({course}), ref = reference(course);
    assert.equal(r.reads, 1 + ref.rows + ref.withBody.length, `course ${course}`);
  }
});

const subset = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] === '1' && b[i] !== '1') return false; return true; };
test('the pixel cap stops at a line boundary: the drawn lines are a prefix of the full order', () => {
  const full = draw({course: 45}), cap = Math.floor(full.work / 2), part = draw({course: 45, pixCap: cap});
  assert.equal(full.done, 1);
  assert.equal(part.done, 0);
  assert(part.lines > 0 && part.lines < full.lines && part.work <= cap, `${part.lines} ${part.work}`);
  assert(subset(part.bits, full.bits), 'every grey pixel of the capped draw is in the full draw');
  const exact = draw({course: 45, pixCap: part.work});
  assert.deepEqual([exact.lines, exact.hash], [part.lines, part.hash]);
  assert(draw({course: 45, pixCap: part.work - 1}).lines < part.lines);
  const pts = draw({course: 45, ptCap: Math.floor(full.points / 2)});
  assert(pts.lines < full.lines && pts.points <= Math.floor(full.points / 2) && subset(pts.bits, full.bits));
});

test('a read error stops the grey: at the open no line, at the first body no line, at the second body one cell', () => {
  const ref = reference(0);
  const atOpen = draw({failAt: 1});
  assert.deepEqual([atOpen.open, atOpen.lines, atOpen.px], [0, 0, 0]);
  const atRow = draw({failAt: 2});
  assert.deepEqual([atRow.open, atRow.done, atRow.lines], [1, 0, 0]);
  const firstBody = draw({failAt: 1 + ref.rows + 1});
  assert.deepEqual([firstBody.done, firstBody.lines], [0, 0]);
  const secondBody = draw({failAt: 1 + ref.rows + 2});
  assert.deepEqual([secondBody.done, secondBody.lines], [0, byKey.get(ref.withBody[0]).lines.length]);
});

test('gl_open refuses a bad magic, layer version 1, a bad stride, a wrong directory count and a wrong size', () => {
  const bytes = encodeGreyLayer(cells, {pixCap: 1e9, ptCap: 1e6});
  const edit = (at, v, name) => { const b = bytes.slice(); b[at] = v; return layerFile(b, name); };
  for (const [at, v] of [[0, 0x42], [6, 1], [7, 3], [7, 7], [24, 99]]) assert.equal(draw(edit(at, v, `bad-${at}-${v}.bin`)).open, 0, `byte ${at} = ${v}`);
  assert.equal(draw({size: good.size - 1}).open, 0);
  assert.equal(draw({size: 27}).open, 0);
});

test('a malformed body stops the grey without a line: point count 33, a point outside its cell', () => {
  const one = [{key: (10 << 16) | 10, lines: [[[10 * 4096 + 800, 10 * 4096 + 800], [10 * 4096 + 1600, 10 * 4096 + 800]]]}];
  const bytes = encodeGreyLayer(one), body = 28 + 4 + 16;   // header, 1 directory key, 2 records
  const at = {x: 10 * 4096 + 1000, y: 10 * 4096 + 1000};
  const ok = layerFile(bytes, 'one.bin');
  assert.deepEqual([draw({...ok, ...at}).done, draw({...ok, ...at}).lines], [1, 1]);
  const m33 = bytes.slice(); m33[body + 1] = 33;
  const r1 = draw({...layerFile(m33, 'm33.bin'), ...at});
  assert.deepEqual([r1.open, r1.done, r1.lines, r1.px], [1, 0, 0, 0]);
  const far = bytes.slice(); far[body + 3] = 0x02;            // qx = 100 + 512: outside the cell
  const r2 = draw({...layerFile(far, 'far.bin'), ...at});
  assert.deepEqual([r2.done, r2.lines, r2.px], [0, 0, 0]);
  assert.equal(readGreyLayer(bytes).cells.length, 1);
});

// Review finding 5: a delta that would overflow int32 (qx 1, zigzag 0xFFFFFFFE = +2^31 - 1) is refused before the sum.
// This binary aborts on undefined behaviour, so a signed overflow fails the test.
test('a delta beyond the cell is refused without an int32 overflow', () => {
  const c = 10 * 4096, one = [{key: (10 << 16) | 10, lines: [[[c + 8, c + 8], [c + 16, c + 16], [c + 24, c + 8], [c + 32, c + 16]]]}];
  const bytes = encodeGreyLayer(one), body = 28 + 4 + 16, at = {x: c + 1000, y: c + 1000};
  assert.deepEqual([...bytes.subarray(body, body + 11)], [1, 4, 1, 0, 1, 0, 2, 2, 2, 1, 2]);
  const bad = bytes.slice(); bad.set([0xfe, 0xff, 0xff, 0xff, 0x0f, 0x00], body + 6);
  const r = draw({...layerFile(bad, 'overflow.bin'), ...at});
  assert.deepEqual([r.open, r.done, r.lines, r.px], [1, 0, 0, 0]);
});
