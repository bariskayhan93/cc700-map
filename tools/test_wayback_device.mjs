// tools/test_wayback_device.mjs: the device adapter on the host, with stubs for the firmware calls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hav} from '../js/geo.js';
import {gridFixture} from './wayback_fixture.mjs';
import {buildWaybackModel} from './wayback_tree.mjs';
import {encodeWayback} from './wayback_format.mjs';
import {embedWayback, readTrailer} from './wayback_embed.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wayback-device-'));
process.on('exit', () => { try { fs.rmSync(work, {recursive: true, force: true}); } catch {} });
const exe = path.join(work, 'host');
execFileSync('cc', ['-std=gnu11', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-DHOST',
  '-fsanitize=address,undefined', '-fno-sanitize-recover=all', '-I', path.join(root, 'firmware/wayback'),
  path.join(root, 'tools/wayback_device_host.c'), path.join(root, 'firmware/wayback/wb_device.c'),
  path.join(root, 'firmware/wayback/wayback.c'), '-o', exe], {stdio: ['ignore', 'pipe', 'pipe']});

const {graph, route, p} = gridFixture();
const id = Uint8Array.from({length: 16}, (_, i) => i + 1);
const wayback = encodeWayback(buildWaybackModel(graph, route, {reach: 'line2k'}), id);
const routeBytes = new Uint8Array(8192).fill(7);
const withData = path.join(work, 'route-wb.bin'), plain = path.join(work, 'route.bin');
fs.writeFileSync(withData, embedWayback(routeBytes, wayback));
fs.writeFileSync(plain, routeBytes);
// run({file, x, y, off, stack, part, pathMode, gps})
function run(o) {
  const q = p(o.x ?? 5, o.y ?? 120);
  const args = [o.file ?? withData, q[0], q[1], o.off ?? 1, o.stack ?? 4096, o.part ?? 0, o.pathMode ?? 1, o.gps ?? 1].map(String);
  return JSON.parse(execFileSync(exe, args, {encoding: 'utf8'}));
}
const near = (pt, x, y, tol = 2) => assert(hav(pt, p(x, y)) <= tol, `${pt} is not at ${x},${y}`);

test('the embedded file keeps the route bytes and has a trailer at the end', () => {
  const out = embedWayback(routeBytes, wayback), t = readTrailer(out);
  assert.equal(out.length % 4096, 0);
  assert.deepEqual(t, {offset: 8192, size: wayback.length});
  assert.deepEqual(out.subarray(0, 8192), routeBytes);
  assert.deepEqual(out.subarray(t.offset, t.offset + t.size), wayback);
  assert.throws(() => embedWayback(out, wayback)); assert.throws(() => embedWayback(routeBytes.subarray(1), wayback));
});
test('off the route near a street: the line is drawn two times and the distance is shown', () => {
  const r = run({});
  assert.equal(r.rt, 1); assert.equal(r.opens, 1); assert.equal(r.closes, 1);
  assert.deepEqual(r.lines.map(l => [l.op, l.n]), [[17, 4], [14, 4]]);
  near(r.lines[0].first, 0, 120); near(r.lines[0].last, 0, 0);
  assert.match(r.text, /^1[12]\d m$/);                       // 120 m to the route
});
test('on the route, and on the first route call of a frame, nothing is opened or drawn', () => {
  for (const o of [{off: 0}, {part: 1}]) {
    const r = run(o);
    assert.deepEqual([r.rt, r.opens, r.lines.length, r.texts], [1, 0, 0, 0]);
  }
});
test('no street within 15 m shows code 4 and no line', () => {
  const r = run({x: 60, y: 100});
  assert.deepEqual([r.lines.length, r.text, r.opens, r.closes], [0, 'wb 4', 1, 1]);
});
test('a route file without way-back data shows code 7 and is closed again', () => {
  const r = run({file: plain});
  assert.deepEqual([r.lines.length, r.text, r.opens, r.closes], [0, 'wb 7', 1, 1]);
});
test('low stack shows code 8 and makes no file call', () => {
  const r = run({stack: 3071});
  assert.deepEqual([r.lines.length, r.text, r.opens, r.reads], [0, 'wb 8', 0, 0]);
});
test('no position shows code 2; no open route file shows code 7; a busy lock shows code 6', () => {
  assert.deepEqual([run({gps: 0}).text, run({pathMode: 0}).text, run({pathMode: -1}).text], ['wb 2', 'wb 7', 'wb 6']);
  assert.equal(run({gps: 0}).opens, 0);
});
test('damaged way-back data shows code 7 and no line', () => {
  const bad = embedWayback(routeBytes, wayback); bad[8192] = 88;
  const f = path.join(work, 'bad.bin'); fs.writeFileSync(f, bad);
  const r = run({file: f});
  assert.deepEqual([r.lines.length, r.text, r.closes], [0, 'wb 7', 1]);
});
