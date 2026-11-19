// tools/test_elev.mjs: the elevation section (js/elevation_section.js) and the strip (firmware/elev) on the host
// (cc27 Task 10). Synthetic routes only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {elevationFromPoints, elevationSection} from '../js/elevation_section.js';
import {buildRoute} from '../js/route.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'elev-'));
process.on('exit', () => { try { fs.rmSync(work, {recursive: true, force: true}); } catch {} });
const exe = path.join(work, 'elev');
const F = d => path.join(root, 'firmware', d);
execFileSync('cc', ['-std=gnu11', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-DHOST', '-fsanitize=address,undefined',
  '-fno-sanitize-recover=all', '-I', F('common'), '-I', F('raster'), '-I', F('elev'), path.join(root, 'tools/elev_host.c'),
  F('elev/elev.c'), F('raster/raster.c'), '-o', exe], {stdio: ['ignore', 'pipe', 'pipe']});
const host = (...a) => JSON.parse(execFileSync(exe, a.map(String), {encoding: 'utf8'}));
const head = b => { const v = new DataView(b.buffer, b.byteOffset); return {magic: String.fromCharCode(...b.subarray(0, 4)), lenCm: v.getUint32(4, true), K: v.getUint16(8, true), step: b[10], version: b[11]}; };
const col = (b, c) => { const k = Math.floor(c / 224), o = 12 + 450 * k, v = new DataView(b.buffer, b.byteOffset); return {base: v.getInt16(o, true), min: b[o + 2 + 2 * (c % 224)], max: b[o + 3 + 2 * (c % 224)]}; };
const profile = (L, f, every = 10) => Array.from({length: Math.floor(L / every) + 1}, (_, i) => ({distance: i * every, elevation: f(i * every)}));

test('a 70 km route with elevation gives 12 + 70 * 450 B', () => {
  const b = elevationFromPoints(profile(70000, d => 100 + 30 * Math.sin(d / 3000), 25), 7000000);
  assert.equal(b.length, 12 + 70 * 450);
  assert.deepEqual(head(b), {magic: 'CCEL', lenCm: 7000000, K: 70, step: 5, version: 1});
  const c = col(b, 224 * 10 + 100), at = 10000 + 100 * 1000 / 224;
  assert(Math.abs(c.base + c.max * 0.5 - (100 + 30 * Math.sin(at / 3000))) <= 1.5, JSON.stringify(c));
});

test('a gap over 250 m gives 255 columns; all-zero elevation gives no section', () => {
  const pts = [...profile(400, () => 120), ...profile(200, () => 130).map(p => ({...p, distance: p.distance + 800}))];
  const b = elevationFromPoints(pts, 100000);
  for (let c = 0; c < 224; c++) {
    const v = col(b, c), inGap = c * 1000 / 224 >= 400 && (c + 1) * 1000 / 224 <= 800;
    assert.equal(v.min === 255 && v.max === 255, inGap, `column ${c}`);
  }
  assert.equal(elevationFromPoints(profile(5000, () => 0), 500000), null);
  assert.equal(elevationFromPoints(profile(5000, () => null), 500000), null);
});

test('the step is the smallest of 0.5, 1 and 2 m that fits the range of every block', () => {
  assert.equal(head(elevationFromPoints(profile(2000, d => d / 10), 200000)).step, 5);      // 100 m in a block
  assert.equal(head(elevationFromPoints(profile(2000, d => d / 5), 200000)).step, 10);     // 200 m
  assert.equal(head(elevationFromPoints(profile(2000, d => d / 2.5), 200000)).step, 20);   // 400 m
  assert.equal(elevationFromPoints(profile(2000, d => d), 200000), null);                  // 1,000 m in a block: no step fits
});

test('elevationSection reads the route file points (field 3 cm, field 5 cm)', () => {
  const K = Math.cos(51 * Math.PI / 180), at = m => [51, 7 + m / (111320 * K)];
  const gpx = {name: 'Elev', pts: Array.from({length: 31}, (_, i) => [...at(i * 100), 50 + i])};
  const file = buildRoute(gpx, [], {id: '11120000', nameImage: () => new Uint8Array(42), map: {styled: true}, speedKmh: 18}).file;
  const b = elevationSection(file), h = head(b);
  assert(Math.abs(h.lenCm - 300000) < 2000, String(h.lenCm));
  assert.equal(h.K, 3);
  const flat = buildRoute({name: 'Flat', pts: gpx.pts.map(p => [p[0], p[1], null])}, [], {id: '11120000', nameImage: () => new Uint8Array(42), map: {styled: true}, speedKmh: 18}).file;
  assert.equal(elevationSection(flat), null);
});

test('the window across two blocks reads 900 B from the right offset', () => {
  assert.deepEqual(host('window', 300000, 3, 5, 1500), {ok: 1, off: 12 + 450, bytes: 900, col0: 112});
  assert.deepEqual(host('window', 300000, 3, 5, 0), {ok: 1, off: 12, bytes: 900, col0: 0});
  assert.deepEqual(host('window', 300000, 3, 5, 2500), {ok: 1, off: 12 + 900, bytes: 450, col0: 112});   // the last block
  assert.equal(host('window', 300000, 3, 5, 3000).ok, 0);                                            // past the end
  assert.equal(host('window', 300000, 3, 5, 99999).ok, 0);
});

test('a ramp of 0 to 30 m over 1 km draws a rising edge with a 40 m vertical range', () => {
  const b = elevationFromPoints(profile(2000, d => (d <= 1000 ? 30 * d / 1000 : 30)), 200000), f = path.join(work, 'ramp.bin');
  fs.writeFileSync(f, b);
  const r = host('draw', f, 0);
  assert.equal(r.ok, 1);
  assert(r.top.every(y => y >= 68 && y < 100), 'every column has a value');
  for (let i = 1; i < 224; i++) assert(r.top[i] <= r.top[i - 1], `column ${i} is not below column ${i - 1}`);
  assert.equal(r.top[0], 68 + 31);                                      // 0 m: the bottom row
  assert(Math.abs(r.top[223] - (68 + 31 - Math.round(31 * 30 / 40))) <= 1, String(r.top[223]));   // 30 of 40 m
  assert.equal(r.grey[0], 0);                                           // the bottom column has only its dark pixel
  assert.equal(r.grey[223], 99 - r.top[223]);                           // grey from below the dark pixel to the bottom
  assert.equal(r.white, 232 * 32 - 224 - r.grey.reduce((s, g) => s + g, 0));
});

test('columns without a value stay white; a strip with no value is only the white rectangle', () => {
  const pts = [...profile(300, () => 120), ...profile(300, () => 125).map(p => ({...p, distance: p.distance + 700}))];
  const f = path.join(work, 'gap.bin');
  fs.writeFileSync(f, elevationFromPoints(pts, 100000));
  const r = host('draw', f, 0);
  const gap = r.top.map((y, i) => [y, i]).filter(([y]) => y < 0).map(([, i]) => i);
  assert(gap.length > 60 && gap.every(i => i * 1000 / 224 > 290 && i * 1000 / 224 < 710), gap.join());
  const none = new Uint8Array(12 + 450).fill(255); none.set([0x43, 0x43, 0x45, 0x4C], 0);
  new DataView(none.buffer).setUint32(4, 100000, true); none[8] = 1; none[9] = 0; none[10] = 5; none[11] = 1; none[12] = 0; none[13] = 0;
  const g = path.join(work, 'none.bin'); fs.writeFileSync(g, none);
  const e = host('draw', g, 0);
  assert.deepEqual([e.ok, e.white], [1, 232 * 32]);
});

test('el_head_parse refuses a bad magic, version 2 and step 7', () => {
  const b = elevationFromPoints(profile(2000, d => d / 10), 200000);
  for (const [at, v] of [[0, 0x42], [11, 2], [10, 7]]) {
    const c = b.slice(); c[at] = v; const f = path.join(work, `bad${at}.bin`); fs.writeFileSync(f, c);
    assert.equal(host('draw', f, 0).ok, 0, `byte ${at}`);
  }
});
