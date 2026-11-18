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
import {encodeWaybackV2} from './wayback_format.mjs';
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
const wayback = encodeWaybackV2(buildWaybackModel(graph, route, {reach: 'line2k'}), id, () => 1);   // version 2 only (R-GREEN); every piece grey
const routeBytes = new Uint8Array(8192).fill(7);
const withData = path.join(work, 'route-wb.bin'), plain = path.join(work, 'route.bin');
fs.writeFileSync(withData, embedWayback(routeBytes, wayback));
fs.writeFileSync(plain, routeBytes);
// run({file, x, y, off, stack, part, pathMode, gps, step, openOk})
function run(o) {
  const q = p(o.x ?? 5, o.y ?? 120);
  const args = [o.file ?? withData, q[0], q[1], o.off ?? 1, o.stack ?? 4096, o.part ?? 0, o.pathMode ?? 1, o.gps ?? 1, o.step ?? 100, o.openOk ?? 1].map(String);
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
test('off the route near a street: the line is drawn two times, with the distance and the frame time', () => {
  const r = run({});
  assert.equal(r.rt, 1); assert.equal(r.opens, 1); assert.equal(r.closes, 1);
  assert.equal(r.opened, withData);                            // the name of the route handle, not of record 0
  assert.deepEqual(r.lines.map(l => [l.op, l.n]), [[17, 4], [14, 4]]);
  near(r.lines[0].first, 0, 120); near(r.lines[0].last, 0, 0);
  assert.match(r.text, /^1[12]\dm \d+ \d+$/);                 // 120 m to the route, then ms, then reads
  assert.deepEqual([r.takes, r.gives, r.dashAfter, r.badDash, r.labelCol], [2, 2, 0, 0, 0x1234]);
});
test('the route call of state 3 (part 1) is handled as part 0', () => {
  assert.equal(run({part: 1}).lines.length, 2);
});
test('on the route, the test image shows wb3 and makes no lock, file or line call', () => {
  const r = run({off: 0});
  assert.deepEqual([r.rt, r.opens, r.reads, r.lines.length, r.text, r.takes], [1, 0, 0, 0, 'wb3', 0]);
});
test('no street within 15 m shows code 4 and no line', () => {
  const r = run({x: 60, y: 100});
  assert.deepEqual([r.lines.length, r.opens, r.closes], [0, 1, 1]); assert.match(r.text, /^wb4 \d+ \d+$/);
});
test('a route file without way-back data shows code 7 and is closed again', () => {
  const r = run({file: plain});
  assert.deepEqual([r.lines.length, r.opens, r.closes], [0, 1, 1]); assert.match(r.text, /^wb7 /);
});
test('low stack shows code 8 and makes no lock or file call', () => {
  const r = run({stack: 3071});
  assert.deepEqual([r.lines.length, r.opens, r.reads, r.takes], [0, 0, 0, 0]); assert.match(r.text, /^wb8 /);
});
test('no position and a busy navigation lock show code 2; no route handle shows 7; a busy table lock shows 6', () => {
  const code = o => run(o).text.slice(0, 3);
  assert.deepEqual([code({gps: 0}), code({pathMode: 2}), code({pathMode: 0}), code({pathMode: -1})], ['wb2', 'wb2', 'wb7', 'wb6']);
  for (const o of [{gps: 0}, {pathMode: 2}, {pathMode: 0}, {pathMode: -1}]) { const r = run(o); assert.equal(r.opens, 0); assert.equal(r.takes, r.gives); }
});
test('a failed open shows code 9 and no close is made', () => {
  const r = run({openOk: 0});
  assert.deepEqual([r.lines.length, r.closes], [0, 0]); assert.match(r.text, /^wb9 /);
});
test('file work above 300 ms stops with code 5, no line, and the file is closed', () => {
  const r = run({step: 200000});
  assert.deepEqual([r.lines.length, r.opens, r.closes], [0, 1, 1]); assert.match(r.text, /^wb5 \d+ \d+$/);
  assert(r.reads <= 3);
});
// D0 item 5: a line of more than 32 points is not cut. A chain of 91 nodes, 10 m apart, runs south to the route.
const chainModel = {nodes: Array.from({length: 91}, (_, i) => ({point: p(0, i * 10), dist: i * 10, next: i > 0 ? i - 1 : -1})),
  extras: [], chunks: []};
const longFile = path.join(work, 'long.bin');
fs.writeFileSync(longFile, embedWayback(routeBytes, encodeWaybackV2(chainModel, id, () => 1)));
test('a line of more than 32 points is not cut: the frame shows code 10 and draws no line (D0 item 5)', () => {
  const r = run({file: longFile, x: 5, y: 900});
  assert.deepEqual([r.lines.length, r.closes], [0, 1]);
  assert.match(r.text, /^wb10 \d+ \d+$/);
});
test('damaged way-back data shows code 7 and no line', () => {
  const bad = embedWayback(routeBytes, wayback); bad[8192] = 88;
  const f = path.join(work, 'bad.bin'); fs.writeFileSync(f, bad);
  const r = run({file: f});
  assert.deepEqual([r.lines.length, r.closes], [0, 1]); assert.match(r.text, /^wb7 /);
});
