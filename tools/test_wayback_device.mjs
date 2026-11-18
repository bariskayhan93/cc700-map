// tools/test_wayback_device.mjs: the device adapter on the host, with stubs for the firmware calls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hav} from '../js/geo.js';
import {gridFixture, makeGraph, p as pt} from './wayback_fixture.mjs';
import {buildWaybackModel} from './wayback_tree.mjs';
import {encodeWaybackV2, decodeWayback} from './wayback_format.mjs';
import {greyLayer} from '../js/wayback_grey_layer.js';
import {embedWayback, readTrailer} from './wayback_embed.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wayback-device-'));
process.on('exit', () => { try { fs.rmSync(work, {recursive: true, force: true}); } catch {} });
const exe = path.join(work, 'host');
execFileSync('cc', ['-std=gnu11', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-DHOST',
  '-fsanitize=address,undefined', '-fno-sanitize-recover=all', '-I', path.join(root, 'firmware/wayback'),
  path.join(root, 'tools/wayback_device_host.c'), path.join(root, 'firmware/wayback/wb_device.c'),
  path.join(root, 'firmware/wayback/wayback.c'), path.join(root, 'firmware/wayback/wb_grey.c'), '-o', exe], {stdio: ['ignore', 'pipe', 'pipe']});

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
  args.push(String(o.failAt ?? 0), String(o.head ?? 90));   // the failAt-th read fails; map heading 90 = course 0
  if (o.exe) return JSON.parse(execFileSync(o.exe, args, {encoding: 'utf8'}));
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
test('on the route there is no text, no lock, no file call and no line (wb3 removed, D5)', () => {
  const r = run({off: 0});
  assert.deepEqual([r.rt, r.opens, r.reads, r.lines.length, r.texts, r.takes], [1, 0, 0, 0, 0, 0]);
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

// ---- D5: the grey draw (heading-up screen, before the line, at most 400 segments, 60 ms) ----
const layerBytes = greyLayer(decodeWayback(wayback));
const withLayer = path.join(work, 'route-layer.bin');
fs.writeFileSync(withLayer, embedWayback(routeBytes, Buffer.concat([Buffer.from(wayback), Buffer.from(layerBytes)])));
const other = Uint8Array.from({length: 16}, (_, i) => 255 - i);
const otherWayback = encodeWaybackV2(buildWaybackModel(graph, route, {reach: 'line2k'}), other, () => 1);
const otherLayer = path.join(work, 'route-other.bin');
fs.writeFileSync(otherLayer, embedWayback(routeBytes, Buffer.concat([Buffer.from(otherWayback), Buffer.from(greyLayer(decodeWayback(otherWayback)))])));
const exeCap = path.join(work, 'host-cap');   // the same adapter with 3 segments for the grey draw: the cap test
execFileSync('cc', ['-std=gnu11', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-DHOST', '-DWBD_GREY_SEGS=3u',
  '-fsanitize=address,undefined', '-fno-sanitize-recover=all', '-I', path.join(root, 'firmware/wayback'),
  path.join(root, 'tools/wayback_device_host.c'), path.join(root, 'firmware/wayback/wb_device.c'),
  path.join(root, 'firmware/wayback/wayback.c'), path.join(root, 'firmware/wayback/wb_grey.c'), '-o', exeCap], {stdio: ['ignore', 'pipe', 'pipe']});
const greyOps = r => r.lines.filter(l => l.op === 30);
const segsOf = ls => ls.reduce((s, l) => s + l.n - 1, 0);

test('off the route with a layer: the grey lines come first (operation 30), then the line (17, 14)', () => {
  const r = run({file: withLayer});
  const ops = r.lines.map(l => l.op);
  assert.deepEqual(ops.slice(-2), [17, 14]);
  assert(ops.length > 2 && ops.slice(0, -2).every(o => o === 30), ops.join());
  assert(r.lines.slice(0, -2).every(l => l.n >= 2));
  assert.equal(r.takes, r.gives); assert.equal(r.dashAfter, 0); assert.equal(r.badDash, 0);
});
test('the line is the same with and without the layer', () => {
  const plainRun = run({}), layerRun = run({file: withLayer});
  assert.deepEqual(layerRun.lines.slice(-2), plainRun.lines);
  assert.match(layerRun.text, /^1[12]\dm /);
  assert.equal(layerRun.text.split(' ')[0], plainRun.text.split(' ')[0]);
});
test('at most 400 segments of grey are drawn (cap 3 in this build): the cap cuts the last line', () => {
  const r = run({file: withLayer, exe: exeCap});
  assert.deepEqual(r.lines.slice(-2).map(l => l.op), [17, 14]);
  assert(segsOf(greyOps(r)) <= 3, `grey segments ${segsOf(greyOps(r))}`);
  assert(segsOf(greyOps(r)) >= 1);
});
test('the grey draw stops 60 ms after the frame start: a fast clock draws less grey and the same line', () => {
  const full = run({file: withLayer, step: 1}), late = run({file: withLayer, step: 5000});
  assert(greyOps(late).length < greyOps(full).length, `${greyOps(late).length} against ${greyOps(full).length}`);
  assert.deepEqual(late.lines.slice(-2).map(l => l.op), [17, 14]);
  assert.equal(late.text.split(' ')[0], full.text.split(' ')[0]);
});
// A denser street grid (60 m, 13 by 13 crossings) for the read-error tests: the grey pass then has 20 reads and more.
const dl = [], dlinks = [], DN = 13;
for (let i = 0; i < DN; i++) for (let j = 0; j < DN; j++) dl.push([(i - 6) * 60, (j - 6) * 60]);
for (let i = 0; i < DN; i++) for (let j = 0; j < DN; j++) {
  const a = i * DN + j;
  if (j + 1 < DN) dlinks.push([a, a + 1]);
  if (i + 1 < DN) dlinks.push([a, a + DN]);
}
const denseGraph = makeGraph(dl, dlinks);
const denseRoute = [{point: pt(-360, 0), progress: 0}, {point: pt(360, 0), progress: 720000}];
const denseWb = encodeWaybackV2(buildWaybackModel(denseGraph, denseRoute, {reach: 'line2k'}), id, () => 1);
const denseLayer = path.join(work, 'route-dense.bin'), densePlain = path.join(work, 'route-dense-plain.bin');
fs.writeFileSync(denseLayer, embedWayback(routeBytes, Buffer.concat([Buffer.from(denseWb), Buffer.from(greyLayer(decodeWayback(denseWb)))])));
fs.writeFileSync(densePlain, embedWayback(routeBytes, denseWb));
const dense = {file: denseLayer, x: 5, y: 90};
for (const k of [1, 5, 20]) {
  test(`a read error at grey read ${k} keeps the line and the distance of the run without it`, () => {
    const clean = run(dense), plainRun = run({...dense, file: densePlain});
    assert(clean.greyFirstReads >= 0 && clean.reads >= clean.greyFirstReads + 20, `${clean.greyFirstReads} ${clean.reads}`);
    const r = run({...dense, failAt: clean.greyFirstReads + k});
    assert.deepEqual(r.lines.slice(-2), plainRun.lines.slice(-2));
    assert.equal(r.text.split(' ')[0], plainRun.text.split(' ')[0]);
    assert(greyOps(r).length < greyOps(clean).length, `k=${k}: ${greyOps(r).length} against ${greyOps(clean).length}`);
  });
}
test('a route change mid-ride: the grey and the line come from the file of that frame', () => {
  const otherPlain = path.join(work, 'route-other-plain.bin');
  fs.writeFileSync(otherPlain, embedWayback(routeBytes, otherWayback));
  const changed = run({file: otherLayer}), plainOther = run({file: otherPlain});
  assert(greyOps(changed).length >= 1);
  assert.deepEqual(changed.lines.slice(-2), plainOther.lines.slice(-2));
  assert.match(changed.text, /^1[12]\dm /);
});
// The course comes from the stock map heading (450 - course): 90 is course 0, also at the start of a new navigation.
const greyOf = h => greyOps(run({...dense, head: h}));
test('map heading 90 and 450 are course 0, 0 and 720 are course 90, 180 and -180 are course 270', () => {
  assert.deepEqual(greyOf(450), greyOf(90));
  assert.deepEqual(greyOf(720), greyOf(0));
  assert.deepEqual(greyOf(-180), greyOf(180));
  assert.notDeepEqual(greyOf(0), greyOf(90));
});
test('course 90 draws the grey east of the rider, course 270 west', () => {
  const lon = ls => ls.reduce((s, l) => s + l.first[1], 0) / ls.length;
  assert(lon(greyOf(0)) > lon(greyOf(180)));
});
test('a NaN or bad map heading draws no grey and the same line', () => {
  const ref = run({...dense, file: densePlain});
  for (const h of ['nan', 721, -361]) {
    const r = run({...dense, head: h});
    assert.equal(greyOps(r).length, 0, `head ${h}`);
    assert.deepEqual(r.lines, ref.lines);
  }
});
