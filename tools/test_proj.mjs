// tools/test_proj.mjs: the own projection (firmware/mapdraw/proj.c) against the decoded stock projection (cc28b).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
process.on('exit', () => { try { fs.rmSync(work, {recursive: true, force: true}); } catch {} });
const exe = path.join(work, 'proj');
execFileSync('cc', ['-std=gnu11', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-DHOST', '-fsanitize=address,undefined', '-fno-sanitize-recover=all',
  '-I', path.join(root, 'firmware/common'), '-I', path.join(root, 'firmware/mapdraw'), path.join(root, 'tools/proj_host.c'),
  path.join(root, 'firmware/mapdraw/proj.c'), '-lm', '-o', exe], {stdio: ['ignore', 'pipe', 'pipe']});
const run = (...a) => JSON.parse(execFileSync(exe, a.map(String), {encoding: 'utf8'}));

// The stock code truncates twice (world pixel, turned pixel), the reference point included: up to 2 px from it is its
// own noise (mean distance 0.5 to 1 px). dmax: our offsets against exact double Mercator; bias: the mean signed error
// against the stock points (9 stock probes at irregular steps set the origin: a regular step gives
// every probe the same pixel fraction and the same truncation).
test('north up, zoom 15: offsets within 0.05 px of exact, points within 2 px of the stock projection', () => {
  const r = run(15, 90, 0, 51.1, 6.9, 400, 2000);
  assert.equal(r.setup, 1);
  assert.ok(r.dmax < 0.05 && r.max <= 2 && r.bias < 0.35, JSON.stringify(r));
});

test('turned map, zooms 14 to 17, headings around the circle: offsets within 0.05 px, stock within 2 px', () => {
  for (const z of [14, 15, 16, 17]) for (const h of [0, 37.5, 90, 181, 269.9, 359]) {
    const r = run(z, h, 1, 51.1, 6.9, 400, 400);
    assert.ok(r.setup === 1 && r.dmax < 0.05 && r.max <= 2 && r.bias < 0.35, `z ${z} h ${h} ${JSON.stringify(r)}`);
  }
});

test('other latitudes, points up to 3,000 px away: offsets within 0.5 px of exact', () => {
  for (const lat of [-33.9, 0.5, 47.3, 60.2]) {
    const r = run(16, 123, 1, lat, 10.1, 3000, 400);
    assert.ok(r.setup === 1 && r.dmax < 0.5, `lat ${lat} ${JSON.stringify(r)}`);
  }
});

test('a zoom out of range gives no projection', () => {
  assert.equal(run(0, 0, 1, 51.1, 6.9, 10, 1).setup, 0);
  assert.equal(run(23, 0, 1, 51.1, 6.9, 10, 1).setup, 0);
});
