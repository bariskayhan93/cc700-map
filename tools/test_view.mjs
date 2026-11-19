// tools/test_view.mjs: firmware/view on the host (cc27 Task 4). A fake heading-up projection, truncated to int16 as
// the stock projection gives cc_line its points.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'view-'));
process.on('exit', () => { try { fs.rmSync(work, {recursive: true, force: true}); } catch {} });
const exe = path.join(work, 'view');
execFileSync('cc', ['-std=gnu11', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-DHOST',
  '-fsanitize=address,undefined', '-fno-sanitize-recover=all', '-I', path.join(root, 'firmware/common'),
  '-I', path.join(root, 'firmware/view'), path.join(root, 'tools/view_host.c'),
  path.join(root, 'firmware/view/view.c'), '-o', exe], {stdio: ['ignore', 'pipe', 'pipe']});
const REF = 16384;
// units (1/16 m, x east, y north) -> screen; heading-up: course c points up; upx units per pixel
const projector = (c, upx, x0 = 50000, y0 = 70000) => ([x, y]) => {
  const r = c * Math.PI / 180, du = x - x0, dv = y - y0;
  return [120 + (du * Math.cos(r) - dv * Math.sin(r)) / upx, 218 - (du * Math.sin(r) + dv * Math.cos(r)) / upx];
};
const trunc = ([x, y]) => [Math.trunc(x), Math.trunc(y)];
function fit(proj, ux, uy, queries, bend = [0, 0]) {
  const s = [[ux, uy], [ux + REF, uy], [ux, uy + REF], [ux + REF, uy + REF]].map(p => trunc(proj(p)));
  s[3] = [s[3][0] + bend[0], s[3][1] + bend[1]];
  const out = execFileSync(exe, [ux, uy, ...s.flat(), ...queries.flat()].map(String), {encoding: 'utf8'});
  return JSON.parse(out);
}

test('vw_map is within 2 px of the true projection up to 700 m from the rider, 16 headings, 2 scales', () => {
  for (const upx of [40, 20]) for (let h = 0; h < 16; h++) {
    const proj = projector(h * 22.5, upx), q = [];
    for (let k = 0; k < 40; k++) { const a = k * 0.7, d = (k % 8 + 1) * 1400; q.push([Math.round(50000 + d * Math.cos(a)), Math.round(70000 + d * Math.sin(a))]); }
    const r = fit(proj, 50000, 70000, q);
    assert.equal(r.ok, 1);
    r.pts.forEach((p, i) => { const t = proj(q[i]); assert.ok(Math.abs(p[0] - t[0]) <= 2 && Math.abs(p[1] - t[1]) <= 2, `${h} ${upx} ${p} ${t}`); });
  }
});

test('a fourth anchor 4 px off is refused; 3 px is accepted', () => {
  const proj = projector(33, 40);
  assert.equal(fit(proj, 50000, 70000, [], [4, 0]).ok, 0);
  assert.equal(fit(proj, 50000, 70000, [], [0, -4]).ok, 0);
  assert.equal(fit(proj, 50000, 70000, [], [3, -3]).ok, 1);
});

test('an axis offset above 4000 px is refused, and so are equal anchors', () => {
  assert.equal(fit(projector(0, 4), 50000, 70000, []).ok, 0);    // 0.25 m per pixel: 4,096 px for 1,024 m
  const out = execFileSync(exe, ['1', '2', '5', '5', '5', '5', '5', '5', '5', '5'], {encoding: 'utf8'});
  assert.equal(JSON.parse(out).ok, 0);
});

test('points 8 km away do not overflow (UBSan) and clamp to ±4000', () => {
  const r = fit(projector(45, 40), 50000, 70000, [[50000 + 128000, 70000], [50000 - 2000000, 70000 + 2000000]]);
  assert.equal(r.ok, 1);
  for (const p of r.pts) assert.ok(Math.abs(p[0]) <= 4000 && Math.abs(p[1]) <= 4000, String(p));
  assert.ok(Math.abs(r.pts[1][0]) === 4000 || Math.abs(r.pts[1][1]) === 4000);
});
