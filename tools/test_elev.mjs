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
const col = (b, c) => { const k = Math.floor(c / 224), o = 1168 + 450 * k, v = new DataView(b.buffer, b.byteOffset); return {base: v.getInt16(o, true), min: b[o + 2 + 2 * (c % 224)], max: b[o + 3 + 2 * (c % 224)]}; };
const profile = (L, f, every = 10) => Array.from({length: Math.floor(L / every) + 1}, (_, i) => ({distance: i * every, elevation: f(i * every)}));

test('version 2: a 70 km route gives 1168 + 70 * 450 B', () => {
  const b = elevationFromPoints(profile(70000, d => 100 + 30 * Math.sin(d / 3000), 25), 7000000);
  assert.equal(b.length, 1168 + 70 * 450);
  assert.deepEqual(head(b), {magic: 'CCEL', lenCm: 7000000, K: 70, step: 5, version: 2});
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

const coarse = (b, c) => { const v = new DataView(b.buffer, b.byteOffset); return {base: v.getInt16(12, true), step: b[14], min: b[16 + 2 * c], max: b[17 + 2 * c]}; };

test('coarse cell c holds the min and max of [c L / 576, (c + 1) L / 576)', () => {
  const b = elevationFromPoints(profile(57600, d => d / 100, 25), 5760000), c = coarse(b, 100);   // 0 -> 576 m, 1 m per cell
  assert.equal(c.step, 50);
  const lo = c.base + c.min * c.step / 10, hi = c.base + c.max * c.step / 10;
  assert(lo <= 100 && lo > 100 - 5 && hi >= 101 && hi < 101 + 5, JSON.stringify({lo, hi}));
});

test('the coarse step is the smallest of 0.5, 1, 2, 5, 10 and 20 m that fits 254 steps', () => {
  assert.equal(coarse(elevationFromPoints(profile(20000, d => 100 + d / 2000), 2000000), 0).step, 5);   // 10 m range
  assert.equal(coarse(elevationFromPoints(profile(60000, d => d / 100, 25), 6000000), 0).step, 50);     // 600 m range
  assert.equal(coarse(elevationFromPoints(profile(100000, d => d / 50, 25), 10000000), 0).step, 100);   // 2,000 m range
  assert.equal(coarse(elevationFromPoints(profile(200000, d => d / 50, 25), 20000000), 0).step, 200);   // 4,000 m range
});

test('a coarse cell with no point gives 255 / 255', () => {
  const pts = [...profile(10000, () => 120, 25), ...profile(5000, () => 130, 25).map(p => ({...p, distance: p.distance + 30000}))];
  const b = elevationFromPoints(pts, 3500000), c = coarse(b, Math.floor(20000 * 576 / 35000));
  assert.deepEqual([c.min, c.max], [255, 255]);
});

// ---- the lens chart core (firmware/elev, design 6.1-6.4): host commands geom, core, fmt ----
const Z = {NONE: 0, PAST: 1, CTX: 2, LENS: 3};
const fileOf = (name, b) => { const f = path.join(work, name); fs.writeFileSync(f, b); return f; };

test('geometry: lens x0 / x1 and the zone of each column', () => {
  const g = (L, P) => host('geom', L, P);
  assert.deepEqual([g(45000, 0).lx0, g(45000, 0).lx1], [0, 96]);
  assert.deepEqual([g(45000, 21000).lx0, g(45000, 21000).lx1], [72, 168]);
  assert.deepEqual([g(45000, 42000).lx0, g(45000, 42000).lx1], [144, 240]);
  const e = g(45000, 44000);
  assert.deepEqual([e.lx0, e.lx1], [144, 176]);
  assert(e.ranges.slice(176).every(r => r[0] === Z.NONE));
  assert.deepEqual([g(45000, 45000).lx0, g(45000, 45000).lx1], [144, 144]);
  const s = g(2400, 600);
  assert.deepEqual([s.lx0, s.lx1], [60, 240]);
  assert(s.ranges.every((r, x) => r[0] === (x < 60 ? Z.PAST : Z.LENS)));
  for (const [L, P] of [[45000, 0], [45000, 21000], [45000, 42000], [2400, 600], [70000, 69999]]) {
    const r = host('geom', L, P).ranges.filter(c => c[0] !== Z.NONE);
    assert.equal(r[0][1], 0, `${L} ${P} start`);
    for (let i = 1; i < r.length; i++) assert.equal(r[i][1], r[i - 1][2], `${L} ${P} column ${i} joins`);
    assert.equal(r.at(-1)[2], L, `${L} ${P} end`);
    const lens = host('geom', L, P).ranges.filter(c => c[0] === Z.LENS);
    if (L > 3000 && L - P >= 3000) assert.deepEqual([lens[0][1], lens.at(-1)[2]], [P, P + 3000]);
  }
});

test('spans: lens columns use the fine blocks, context columns use the coarse table', () => {
  const b = elevationFromPoints(profile(45000, d => 100 + 20 * Math.sin(d / 700), 10), 4500000), f = fileOf('sin.bin', b);
  const r = host('core', f, 21000), g = host('geom', 45000, 21000);
  assert.equal(r.ok, 1);
  for (let x = 0; x < 240; x++) {
    const [z, d0, d1] = g.ranges[x], [ok, lo, hi] = r.spans[x];
    assert.equal(ok, 1, `column ${x}`);
    if (z === Z.LENS) {                                                // fine: the min/max of the 4.464 m columns in [d0, d1)
      let mn = Infinity, mx = -Infinity;
      for (let c = Math.floor(d0 * 224 / 1000); c < Math.max(Math.floor(d0 * 224 / 1000) + 1, Math.ceil(d1 * 224 / 1000)); c++) {
        const v = col(b, c); mn = Math.min(mn, v.base * 10 + v.min * 5); mx = Math.max(mx, v.base * 10 + v.max * 5);
      }
      assert.deepEqual([lo, hi], [mn, mx], `lens column ${x}`);
    } else {                                                           // coarse: the cells that overlap [d0, d1)
      let mn = Infinity, mx = -Infinity;
      for (let c = Math.floor(d0 * 576 / 45000); c < Math.max(Math.floor(d0 * 576 / 45000) + 1, Math.ceil(d1 * 576 / 45000)); c++) {
        const v = coarse(b, Math.min(575, c)); mn = Math.min(mn, v.base * 10 + v.min * v.step); mx = Math.max(mx, v.base * 10 + v.max * v.step);
      }
      assert.deepEqual([lo, hi], [mn, mx], `context column ${x}`);
    }
  }
});

test('lens scale: bottom floored to 5 m, range at least 20 m in 10 m steps; route scale at least 40 m', () => {
  const flat = fileOf('flat.bin', elevationFromPoints(profile(10000, d => 42 + 1.1 * d / 10000, 10), 1000000));
  assert.deepEqual(host('core', flat, 2000).lens, [400, 200]);
  assert.equal(host('core', flat, 2000).route[1], 400);
  const climb = fileOf('climb.bin', elevationFromPoints(profile(10000, d => (d < 2000 ? 100 : d < 5000 ? 100 + 37 * (d - 2000) / 3000 : 137), 10), 1000000));
  assert.deepEqual(host('core', climb, 2000).lens, [1000, 400]);
});

test('grade and climb: a 7 % ramp gives 70 dm per 100 m; the climb sums the rises of the next 3 km', () => {
  const f = fileOf('ramp7.bin', elevationFromPoints(profile(10000, d => (d < 3000 ? 50 : d < 3500 ? 50 + 0.07 * (d - 3000) : 85), 10), 1000000));
  const r = host('core', f, 2000);
  assert(Math.abs(r.grade[11] - 70) <= 2, JSON.stringify(r.grade));   // window [3100, 3200)
  assert(Math.abs(r.climb - 35) <= 1, String(r.climb));
});

test('a lens with no value: no spans, lens range 0, climb 0', () => {
  const pts = [...profile(5000, () => 120, 25), ...profile(5000, () => 130, 25).map(p => ({...p, distance: p.distance + 15000}))];
  const r = host('core', fileOf('gap.bin', elevationFromPoints(pts, 2000000)), 8000), g = host('geom', 20000, 8000);
  assert.equal(r.ok, 1);
  g.ranges.forEach((c, x) => { if (c[0] === Z.LENS) assert.equal(r.spans[x][0], 0, `lens column ${x}`); });
  assert.deepEqual([r.lens[1], r.climb], [0, 0]);
});

test('text format: distance and climb', () => {
  const cases = [[0, '0', 'm'], [9, '10', 'm'], [850, '850', 'm'], [999, '1.0', 'km'], [12940, '12.9', 'km'], [12980, '13.0', 'km'],
    [99949, '99.9', 'km'], [99950, '100', 'km'], [250000, '250', 'km'], [4000000000, '4000000', 'km']];
  for (const [m, num, unit] of cases) assert.deepEqual([host('fmt', m, 0).num, host('fmt', m, 0).unit], [num, unit], String(m));
  assert.equal(host('fmt', 0, 4).climb, '');
  assert.equal(host('fmt', 0, 46).climb, '+46 m');
  assert.equal(host('fmt', 0, 123456).climb, '+9999 m');
});

test('version 1 and bad headers are refused', () => {
  const b = elevationFromPoints(profile(5000, d => 100 + d / 100), 500000);
  const v1 = b.slice(); v1[11] = 1;
  assert.equal(host('core', fileOf('v1.bin', v1), 0).ok, 0);
  const bad = b.slice(); bad[14] = 7;
  assert.equal(host('core', fileOf('bad.bin', bad), 0).ok, 0);
});

// ---- drawing (design 5): host commands draw, plain, mix; the canvas comes back as raw RGB565 ----
const RGB = h => ((h >> 8) & 0xf800) | ((h >> 5) & 0x07e0) | ((h >> 3) & 0x001f);
const bg = (x, y) => ((x >> 3) & 31) << 11 | ((y >> 2) & 63) << 5 | (((x + y) >> 4) & 31);   // the host background
const mix = (d, s, a) => (((d >> 11) * (256 - a) + (s >> 11) * a) >> 8) << 11 | ((((d >> 5) & 63) * (256 - a) + ((s >> 5) & 63) * a) >> 8) << 5 | (((d & 31) * (256 - a) + (s & 31) * a) >> 8);
const canvas = (...a) => { const out = path.join(work, `cv${a.join('_').replace(/[^0-9a-z_]/gi, '')}`); host(...a, out); const b = fs.readFileSync(out + '.raw'); return (x, y) => b.readUInt16LE(2 * (y * 240 + x)); };

test('el_mix blends RGB565 per channel', () => {
  assert.equal(host('mix', 0x0000, 0xffff, 128).v, 0x7bef);
  assert.equal(host('mix', 0x1234, 0xffff, 0).v, 0x1234);
  assert.equal(host('mix', 0x1234, 0xabcd, 256).v, 0xabcd);
});

test('el_draw: rows above 237 stay; lens edge, rider mark and lens end at the design positions', () => {
  const f = fileOf('sin45.bin', elevationFromPoints(profile(45000, d => 100 + 20 * Math.sin(d / 700), 10), 4500000));
  const px = canvas('draw', f, 21000);
  for (let y = 0; y < 237; y++) for (let x = 0; x < 240; x++) if (px(x, y) !== bg(x, y)) assert.fail(`pixel ${x},${y} changed`);
  assert.equal(px(72, 250), RGB(0x1f6fe0));                           // rider line at lx0 72
  for (let x = 73; x < 168; x++) assert.equal(px(x, 237), RGB(0x202327), `edge ${x}`);
  let dots = 0; for (let y = 238; y <= 255; y++) dots += px(168, y) === RGB(0x6d7279);
  assert(dots >= 8, `dotted lens end ${dots}`);
  assert.equal(px(104, 238), RGB(0x202327));                          // km tick at lx0 + 32
});

test('el_draw: a 7 % ramp in the lens is red; the rest of the route has no grade colour', () => {
  const f = fileOf('ramp45.bin', elevationFromPoints(profile(45000, d => (d < 22000 ? 50 : d < 22600 ? 50 + 0.07 * (d - 22000) : 92), 10), 4500000));
  const px = canvas('draw', f, 21000);
  let red = 0, ctxRed = 0;
  for (let y = 238; y <= 255; y++) { for (let x = 72; x < 168; x++) red += px(x, y) === RGB(0xd0182b); for (let x = 169; x < 240; x++) ctxRed += px(x, y) === RGB(0xd0182b); }
  assert(red > 0 && ctxRed === 0, `${red} ${ctxRed}`);
});

test('el_draw: lens columns with no value show only the lens background', () => {
  const pts = [...profile(5000, () => 120, 25), ...profile(5000, () => 130, 25).map(p => ({...p, distance: p.distance + 15000}))];
  const px = canvas('draw', fileOf('gap20.bin', elevationFromPoints(pts, 2000000)), 8000);   // lx0 67
  for (let x = 75; x <= 95; x++) for (let y = 242; y <= 255; y++)
    assert.equal(px(x, y), mix(mix(bg(x, y), 0xffff, 128), 0xffff, 128), `${x},${y}`);
});

test('el_plain: scrim, ridden line dark, rest light, rider mark at 240 P / L', () => {
  const px = canvas('plain', 45000, 22500);
  assert.equal(px(100, 246), RGB(0x202327));
  assert.equal(px(200, 246), RGB(0xb7bac0));
  assert.equal(px(120, 250), RGB(0x1f6fe0));
  assert.equal(px(10, 240), mix(bg(10, 240), 0xffff, 128));
  assert.equal(px(10, 236), bg(10, 236));
});

test('review fix: a route with a 2,000 m range keeps its section and the unit reads it', () => {
  const b = elevationFromPoints(profile(100000, d => d / 50, 25), 10000000), r = host('core', fileOf('alps.bin', b), 50000);
  assert.equal(r.ok, 1);
  assert(r.route[1] >= 19000, JSON.stringify(r.route));
});

test('review fix: on a route of 3 km or less the km ticks are at 1 km and 2 km of the linear chart', () => {
  const px = canvas('draw', fileOf('short24.bin', elevationFromPoints(profile(2400, d => 60 + d / 100, 10), 240000)), 0);
  assert.equal(px(100, 238), RGB(0x202327));                          // 240 * 1000 / 2400
  assert.equal(px(200, 238), RGB(0x202327));
  assert.notEqual(px(32, 239), RGB(0x202327));
  assert.notEqual(px(64, 239), RGB(0x202327));
});
