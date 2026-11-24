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
import {encodeWaybackV3, decodeWayback} from './wayback_format.mjs';
import {encodeGreyLayer, greyCellLines} from '../js/wayback_grey_layer.js';
import {greyCells} from '../js/screen_proof.js';
import {elevationFromPoints} from '../js/elevation_section.js';
import {SECTION, embedSections, readSections} from './wayback_embed.mjs';
// cc27: test adapters over the section table (one way-back section)
const embedWayback = (r, w) => embedSections(r, [{type: SECTION.WAYBACK, bytes: w}]);
const readTrailer = f => { const s = readSections(f), w = s && s.find(x => x.type === SECTION.WAYBACK); return w ? {offset: w.offset, size: w.size} : null; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wayback-device-'));
process.on('exit', () => { try { fs.rmSync(work, {recursive: true, force: true}); } catch {} });
const exe = path.join(work, 'host');
const F = d => path.join(root, 'firmware', d);
execFileSync('cc', ['-std=gnu11', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-DHOST', '-DWBD_KM_WHY', '-DWBD_GREY', '-DWBD_NO_KEEP',
  '-fsanitize=address,undefined', '-fno-sanitize-recover=all', '-I', F('wayback'), '-I', F('common'), '-I', F('raster'), '-I', F('view'), '-I', F('elev'),
  path.join(root, 'tools/wayback_device_host.c'), F('wayback/wb_device.c'), F('wayback/wayback.c'), F('wayback/wb_grey.c'),
  F('wayback/wb_grey_draw.c'), F('wayback/wb_far.c'), F('wayback/wb_cache.c'), F('raster/raster.c'), F('view/view.c'), F('elev/elev.c'), '-lm', '-o', exe], {stdio: ['ignore', 'pipe', 'pipe']});

const {graph, route, p} = gridFixture();
const id = Uint8Array.from({length: 16}, (_, i) => i + 1);
const wayback = encodeWaybackV3(buildWaybackModel(graph, route, {reach: 'line2k'}), id, () => 1);   // version 2 only (R-GREEN); every piece grey
const routeBytes = new Uint8Array(8192).fill(7);
const withData = path.join(work, 'route-wb.bin'), plain = path.join(work, 'route.bin');
fs.writeFileSync(withData, embedWayback(routeBytes, wayback));
fs.writeFileSync(plain, routeBytes);
// run({file, x, y, off, stack, part, pathMode, gps, step, openOk, failAt, head, scale})
function run(o) {
  const q = p(o.x ?? 5, o.y ?? 120);
  const args = [o.file ?? withData, q[0], q[1], o.off ?? 1, o.stack ?? 4096, o.part ?? 0, o.pathMode ?? 1, o.gps ?? 1, o.step ?? 100, o.openOk ?? 1].map(String);
  args.push(String(o.failAt ?? 0), String(o.head ?? 90), String(o.scale ?? 2.5));   // the failAt-th read fails; map heading 90 = course 0; m/px
  args.push(String(o.flags ?? F_TEXT), String(o.mallocOk ?? 1));   // block flags (-1: no flags entry, cc26 block); 0: the heap allocation fails
  args.push(String(o.U ?? 0), String(o.T ?? 0), String(o.sel ?? 0));   // stock progress: remaining U (u32 m), total T (float), selector
  if (o.km) args.push(...o.km.map(String));                         // KM mode: wb_km(left, total, bar_w, show_text)
  if (o.exe) return JSON.parse(execFileSync(o.exe, args, {encoding: 'utf8'}));
  return JSON.parse(execFileSync(exe, args, {encoding: 'utf8'}));
}
const F_OWN = 1, F_TEXT = 2, F_ROUTE = 4;

// The unit build (24 Nov): kept page cache in the task's pthread key list (WP 4), no grey fallback. The other tests use
// the cc27 build (grey, no cache). FRAME2: the same frame again.
const keepExe = path.join(work, 'host-keep');
execFileSync('cc', ['-std=gnu11', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-DHOST',
  '-fsanitize=address,undefined', '-fno-sanitize-recover=all', '-I', F('wayback'), '-I', F('common'), '-I', F('raster'), '-I', F('view'), '-I', F('elev'),
  path.join(root, 'tools/wayback_device_host.c'), F('wayback/wb_device.c'), F('wayback/wayback.c'), F('wayback/wb_grey.c'),
  F('wayback/wb_grey_draw.c'), F('wayback/wb_far.c'), F('wayback/wb_cache.c'), F('raster/raster.c'), F('view/view.c'), F('elev/elev.c'), '-lm', '-o', keepExe], {stdio: ['ignore', 'pipe', 'pipe']});
const twice = (o, e) => { process.env.FRAME2 = '1'; try { return run({...o, exe: e}); } finally { delete process.env.FRAME2; } };
test('WP 5/7: with the kept page cache the second off-route frame reads almost nothing and draws the same', () => {
  const plain = twice({}, exe), kept = twice({}, keepExe), one = run({});
  assert.equal(plain.reads, one.reads);                          // no cache: frame 2 reads as frame 1
  assert.ok(one.reads > 20, String(one.reads));
  assert.equal(kept.reads, 0);                                 // 24 Nov: the trailer goes through the cache too
  assert.equal(kept.seekEnd, 0);                               // 24 Nov: the size comes from the kept cache (no stdio seek)
  assert.equal(plain.seekEnd, 1);
  assert.equal(kept.hash, plain.hash);
  assert.deepEqual(kept.lines, plain.lines);
  assert.equal(kept.mallocs - kept.frees, plain.mallocs - plain.frees);
});
test('WP 4: a stock pthread key in the task list keeps its value; the cache still works', () => {
  process.env.STOCKKEY = '1';
  try { const r = twice({}, keepExe); assert.ok(r.reads <= 2, String(r.reads)); } finally { delete process.env.STOCKKEY; }
});
test('unit build: the off-route text has no grey part (grey fallback retired)', () => {
  const r = run({exe: keepExe});
  assert.match(r.text, /m.* w\d+ r\d+$/);
});
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
  assert.match(r.text, /^1[12]\dm w\d+ r\d+ g0$/);                 // 120 m to the route, then ms, then reads
  assert.deepEqual([r.takes, r.gives, r.dashAfter, r.badDash, r.labelCol, r.anchors, r.mallocs], [2, 2, 0, 0, 0x1234, 0, 0]);   // no grey section: no anchor, no heap
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
  assert.deepEqual([r.lines.length, r.opens, r.closes], [0, 1, 1]); assert.match(r.text, /^wb4 w\d+ r\d+ g0$/);
});
test('a route file without way-back data shows code 7 and is closed again', () => {
  const r = run({file: plain});
  assert.deepEqual([r.lines.length, r.opens, r.closes], [0, 1, 1]); assert.match(r.text, /^wb7 /);
});
test('a cc26 file (CCWT trailer) gives wb7 and the file is closed', () => {
  const total = Math.ceil((routeBytes.length + wayback.length + 12) / 4096) * 4096, old = new Uint8Array(total);
  old.set(routeBytes); old.set(wayback, routeBytes.length);
  const v = new DataView(old.buffer); v.setUint32(total - 12, 0x54574343, true); v.setUint32(total - 8, routeBytes.length, true); v.setUint32(total - 4, wayback.length, true);
  const f = path.join(work, 'route-cc26.bin'); fs.writeFileSync(f, old);
  const r = run({file: f});
  assert.deepEqual([r.lines.length, r.opens, r.closes], [0, 1, 1]); assert.match(r.text, /^wb7 /);
});
test('the unit refuses a version 2 file with code 7 (cc27: version 3 only)', () => {
  const v2 = wayback.slice(); v2[4] = 2;
  const f = path.join(work, 'route-v2.bin'); fs.writeFileSync(f, embedWayback(routeBytes, v2));
  const r = run({file: f});
  assert.equal(r.lines.length, 0); assert.match(r.text, /^wb7 /);
});
test('low stack shows code 8 and makes no lock or file call', () => {
  const r = run({stack: 3967});                                  // WBD_STACK is 3,968 B on cc26
  assert.deepEqual([r.lines.length, r.opens, r.reads, r.takes], [0, 0, 0, 0]); assert.equal(r.text, 'wb8');   // the switches are not read: no tail
});
test('exactly 3,968 B of free stack is enough for the file calls', () => {
  assert.doesNotMatch(run({stack: 3968}).text, /^wb8/);
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
  assert.deepEqual([r.lines.length, r.opens, r.closes], [0, 1, 1]); assert.match(r.text, /^wb5 w\d+ r\d+ g0$/);
  assert(r.reads <= 3);
});
// Ride 18 Nov: most detour frames showed wb10. A line of more than 32 points now draws its first 32 points (from the rider)
// and the text has '+'. A chain of 91 nodes, 10 m apart, runs south to the route.
const chainModel = {nodes: Array.from({length: 91}, (_, i) => ({point: p(0, i * 10), dist: i * 10, next: i > 0 ? i - 1 : -1})),
  extras: [], chunks: []};
const longFile = path.join(work, 'long.bin');
fs.writeFileSync(longFile, embedWayback(routeBytes, encodeWaybackV3(chainModel, id, () => 1)));
test('a line of more than 32 points draws its first 32 points from the rider and shows the full distance with +', () => {
  const r = run({file: longFile, x: 5, y: 900});
  assert.deepEqual(r.lines.map(l => [l.op, l.n]), [[17, 32], [14, 32]]);
  assert.equal(r.closes, 1);
  near(r.lines[0].first, 0, 900); near(r.lines[0].last, 0, 590);
  assert.match(r.text, /^(89|90)\dm\+ w\d+ r\d+ g0$/);
});
test('a line of exactly 32 points has no +', () => {
  const r = run({file: longFile, x: 5, y: 310});
  assert.deepEqual(r.lines.map(l => l.n), [32, 32]);
  assert.match(r.text, /^3\d\dm w\d+ r\d+ g0$/);
});
test('damaged way-back data shows code 7 and no line', () => {
  const bad = embedWayback(routeBytes, wayback); bad[8192] = 88;
  const f = path.join(work, 'bad.bin'); fs.writeFileSync(f, bad);
  const r = run({file: f});
  assert.deepEqual([r.lines.length, r.closes], [0, 1]); assert.match(r.text, /^wb7 /);
});

// ---- cc27 Task 8: the grey section (type 2). 4 anchors give the view; every line of the screen cells is drawn with the
// raster, before the way-back line. A denser street grid (60 m, 13 by 13 crossings).
const dl = [], dlinks = [], DN = 13;
for (let i = 0; i < DN; i++) for (let j = 0; j < DN; j++) dl.push([(i - 6) * 60, (j - 6) * 60]);
for (let i = 0; i < DN; i++) for (let j = 0; j < DN; j++) {
  const a = i * DN + j;
  if (j + 1 < DN) dlinks.push([a, a + 1]);
  if (i + 1 < DN) dlinks.push([a, a + DN]);
}
const denseWb = encodeWaybackV3(buildWaybackModel(makeGraph(dl, dlinks), [{point: pt(-360, 0), progress: 0}, {point: pt(360, 0), progress: 720000}], {reach: 'line2k'}), id, () => 1);
const denseCells = greyCellLines(decodeWayback(denseWb)), byKey = new Map(denseCells.map(c => [c.key, c]));
const fileWith = (name, wb, grey) => { const f = path.join(work, name); fs.writeFileSync(f, embedSections(routeBytes, [{type: SECTION.WAYBACK, bytes: wb}, ...(grey ? [{type: SECTION.GREY, bytes: grey}] : [])])); return f; };
const BIG = {pixCap: 1e9, ptCap: 1e6};
const denseGrey = fileWith('dense-grey.bin', denseWb, encodeGreyLayer(denseCells, BIG)), densePlain = fileWith('dense-plain.bin', denseWb);
const dense = {file: denseGrey, x: 5, y: 90};
const gOf = r => Number(/ g(\d+)\+?$/.exec(r.text)[1]);
// The rider units and the course as the unit computes them: float position, (int32)(deg * 1e7f), the grid of the header.
const f32 = Math.fround, e7 = v => Math.trunc(f32(f32(v) * f32(1e7)));
function reference(o) {
  const dv = new DataView(denseWb.buffer, denseWb.byteOffset), [la, lo] = p(o.x, o.y), head = o.head ?? 90;
  const ux = Math.floor((e7(lo) - dv.getInt32(28, true)) * dv.getUint32(36, true) / 65536), uy = Math.floor((e7(la) - dv.getInt32(24, true)) * dv.getUint32(32, true) / 65536);
  const sel = greyCells(ux, uy, Math.trunc(810.5 - head) % 360), withBody = sel.filter(k => byKey.has(k));
  return {rows: new Set(sel.map(k => k >>> 16)).size, cells: withBody.length, lines: withBody.reduce((t, k) => t + byKey.get(k).lines.length, 0), first: byKey.get(withBody[0]).lines.length};
}

test('off the route with a grey section: 4 anchors, no projection call for a grey line, then the line (17, 14)', () => {
  const r = run(dense);
  assert.equal(r.anchors, 4);
  assert.deepEqual(r.lines.map(l => l.op), [17, 14]);
  assert(r.greyPx > 500 && gOf(r) > 0, `${r.greyPx} ${r.text}`);
  assert.deepEqual([r.mallocs, r.frees, r.dashAfter, r.badDash, r.takes, r.gives], [1, 1, 0, 0, 2, 2]);
  assert.deepEqual(r.dsc, [0x5555, 7, 0]);                     // the anchors give back the colour and the width
});
test('the line and the distance are the same with and without the grey section', () => {
  const a = run(dense), b = run({...dense, file: densePlain});
  assert.deepEqual(a.lines, b.lines);
  assert.equal(a.text.split(' ')[0], b.text.split(' ')[0]);
  assert.deepEqual([b.anchors, b.mallocs, b.greyPx, gOf(b)], [0, 0, 0, 0]);
});
test('every line of the selected cells is drawn: the drawn line count equals the JS reference', () => {
  for (const head of [90, 45, 0, 300]) {
    const r = run({...dense, head});
    assert.equal(gOf(r), reference({...dense, head}).lines, `map heading ${head}`);
    assert.match(r.text, / g\d+$/);                            // no '+': every line is drawn
  }
});
test('the same position and heading give the same canvas hash with a fast and a slow clock (below 300 ms)', () => {
  const fast = run({...dense, step: 1}), slow = run({...dense, step: Math.floor(250000 / (fast.reads + 4))});   // one clock call per read
  assert.doesNotMatch(slow.text, /^wb/);
  assert(Number(/ w(\d+) /.exec(slow.text)[1]) < 300, slow.text);
  assert.equal(slow.hash, fast.hash);
  assert.equal(gOf(slow), gOf(fast));
});
// S5 (23 Nov): fixed frames. hash = the canvas (the grey layer; the host records the way-back line in lines and does
// not draw it), greyPx, and each line record. A change of a grey pixel or a line point shows here; same on 6b9dea5.
const PINNED = [                                               // [run options, hash, greyPx, [op, own, n, first, last] per line]
  [{...dense, head: 0, flags: F_OWN}, 322481757, 13414, [[17, 1, 3, [51.0008087, 7], [51, 7]], [14, 1, 3, [51.0008087, 7], [51, 7]]]],
  [{...dense, head: 90, flags: F_OWN}, 1923005861, 11598, [[17, 1, 3, [51.0008087, 7], [51, 7]], [14, 1, 3, [51.0008087, 7], [51, 7]]]],
  [{...dense, head: 200, flags: F_OWN}, 1071876485, 17120, [[17, 1, 3, [51.0008087, 7], [51, 7]], [14, 1, 3, [51.0008087, 7], [51, 7]]]],
  [{...dense, head: 90, flags: 0}, 1923005861, 11598, [[17, 0, 3, [51.0008087, 7], [51, 7]], [14, 0, 3, [51.0008087, 7], [51, 7]]]],
  [{flags: F_OWN}, 3095223749, 0, [[17, 1, 4, [51.0010796, 7], [51, 7]], [14, 1, 4, [51.0010796, 7], [51, 7]]]],
  [{x: 130, y: 203, flags: F_OWN}, 3095223749, 0, [[17, 1, 5, [51.0017967, 7.0018554], [51, 7.00314]], [14, 1, 5, [51.0017967, 7.0018554], [51, 7.00314]]]]];
test('6 fixed frames are pinned: canvas hash, grey pixels and the way-back line records', () => {
  for (const [o, hash, greyPx, lines] of PINNED) {
    const r = run(o);
    assert.deepEqual([r.hash, r.greyPx, r.lines.map(l => [l.op, l.own, l.n, l.first, l.last])], [hash, greyPx, lines], JSON.stringify(o));
  }
});
test('reads for grey are at most 1 + rows + cells', () => {
  for (const head of [90, 0]) {
    const r = run({...dense, head}), plainRun = run({...dense, head, file: densePlain}), ref = reference({...dense, head});
    assert(r.reads - plainRun.reads <= 1 + ref.rows + ref.cells, `${r.reads - plainRun.reads} > 1 + ${ref.rows} + ${ref.cells}`);
    assert(r.reads - plainRun.reads >= 2);
  }
});
test('the pixel cap of the header stops at a line boundary: fewer lines, a + in the text, the same line', () => {
  const capped = fileWith('dense-cap.bin', denseWb, encodeGreyLayer(denseCells, {pixCap: 3000, ptCap: 1e6}));
  const full = run(dense), r = run({...dense, file: capped});
  assert(gOf(r) > 0 && gOf(r) < gOf(full), `${gOf(r)} ${gOf(full)}`);
  assert.match(r.text, / g\d+\+$/);
  assert(r.greyPx < full.greyPx);
  assert.deepEqual(r.lines, full.lines);
});
test('an anchor that fails (outside ±4000 px) or a NaN heading: no grey, the same line and text', () => {
  const ref = run({...dense, file: densePlain});
  const far = run({...dense, scale: 0.2}), nan = run({...dense, head: 'nan'});
  assert(far.anchors >= 1 && nan.anchors === 0, `${far.anchors} ${nan.anchors}`);
  for (const r of [far, nan]) {
    assert.deepEqual([r.greyPx, gOf(r)], [0, 0]);
    assert.deepEqual(r.lines, ref.lines);
    assert.equal(r.text.split(' ')[0], ref.text.split(' ')[0]);
    assert.deepEqual(r.dsc, [0x5555, 7, 0]);
  }
  for (const h of [721, -361]) assert.equal(run({...dense, head: h}).greyPx, 0, `head ${h}`);
});
test('a read error in a cell body: no more grey, the same line and distance', () => {
  const clean = run(dense), ref = reference(dense), plainRun = run({...dense, file: densePlain});
  const first = run({...dense, failAt: clean.anchorReads + 1 + ref.rows + 1});   // the first body read
  assert.deepEqual([first.greyPx, gOf(first)], [0, 0]);
  assert.deepEqual(first.lines, plainRun.lines);
  assert.equal(first.text.split(' ')[0], plainRun.text.split(' ')[0]);
  const second = run({...dense, failAt: clean.anchorReads + 1 + ref.rows + 2});
  assert.equal(gOf(second), ref.first);
  assert.deepEqual(second.lines, plainRun.lines);
  const open = run({...dense, failAt: clean.anchorReads + 1});                     // the header read
  assert.deepEqual([open.greyPx, gOf(open)], [0, 0]);
});
test('a grey section that is not layer version 2 draws no grey and the same line', () => {
  const v1 = encodeGreyLayer(denseCells, BIG).slice(); v1[6] = 1;
  const r = run({...dense, file: fileWith('dense-v1.bin', denseWb, v1)});
  assert.deepEqual([r.greyPx, gOf(r)], [0, 0]);
  assert.deepEqual(r.lines, run({...dense, file: densePlain}).lines);
});
test('the heap buffer is freed on each path (malloc count == free count)', () => {
  const clean = run(dense);
  for (const o of [dense, {...dense, scale: 0.2}, {...dense, head: 'nan'}, {...dense, failAt: clean.anchorReads + 3}, {...dense, x: 30, y: 30},
    {...dense, step: 200000}, {...dense, file: densePlain}, {...dense, stack: 100}, {...dense, openOk: 0}]) {
    const r = run(o);
    assert.equal(r.mallocs, r.frees, JSON.stringify(o));
    assert(r.mallocs <= 1);
  }
});
// The course comes from the stock map heading (450 - course): 90 is course 0, also at the start of a new navigation.
const hashOf = h => run({...dense, head: h}).hash;
test('map heading 90 and 450 are course 0, 0 and 720 are course 90, 180 and -180 are course 270', () => {
  assert.equal(hashOf(450), hashOf(90));
  assert.equal(hashOf(720), hashOf(0));
  assert.equal(hashOf(-180), hashOf(180));
  assert.notEqual(hashOf(0), hashOf(90));
});

// ---- cc27 Task 9: the block switches (flags entry of the map block), the frame order and the text ----
test('on the route without F_ROUTE: no block-flag text, no file call, no heap call (cc26)', () => {
  for (const flags of [-1, 0, F_TEXT | F_OWN]) {
    const r = run({...dense, off: 0, flags});
    assert.deepEqual([r.rt, r.opens, r.reads, r.texts, r.mallocs, r.lines.length, r.takes], [1, 0, 0, 0, 0, 0, 0], `flags ${flags}`);
  }
});
test('off the route without F_TEXT the text is only the distance; with F_TEXT it has w and r', () => {
  assert.match(run({...dense, flags: 0}).text, /^\d+m$/);
  assert.match(run({...dense, flags: -1}).text, /^\d+m$/);     // a block without the flags entry: cc26 switches
  assert.match(run({...dense, flags: F_TEXT}).text, /^\d+m w\d+ r\d+ g\d+$/);
  assert.match(run({...dense, x: 30, y: 30, flags: 0}).text, /^wb4$/);
  assert.match(run({...dense, x: 30, y: 30, flags: F_TEXT}).text, /^wb4 w\d+ r\d+ g0$/);
});
test('a failed heap allocation shows the line and code 11 in the text with F_TEXT', () => {
  const r = run({...dense, mallocOk: 0}), ok = run(dense);
  assert.deepEqual(r.lines, ok.lines);
  assert.deepEqual([r.greyPx, r.anchors, r.mallocs, r.frees], [0, 0, 1, 0]);   // the failed call is counted, nothing to free
  assert.match(r.text, /^\d+m w\d+ r\d+ wb11$/);
  assert.equal(r.text.split(' ')[0], ok.text.split(' ')[0]);
  assert.match(run({...dense, mallocOk: 0, flags: 0}).text, /^\d+m$/);
});
test('the stack check comes before the block lock and before any file call', () => {
  const low = run({...dense, stack: 3967});
  assert.deepEqual([low.blockLocks, low.opens, low.reads, low.takes, low.mallocs], [0, 0, 0, 0, 0]);
  assert.equal(low.text, 'wb8');
  const lowOn = run({...dense, stack: 3967, off: 0, flags: F_ROUTE | F_TEXT});
  assert.deepEqual([lowOn.blockLocks, lowOn.opens, lowOn.texts], [0, 0, 0]);
  const ok = run(dense);
  assert.equal(ok.blockLocks, 2);                              // one lock and one unlock, before the file work
  assert.equal(ok.fileUnderBlockLock, 0);
});
test('without F_OWN the way-back line goes through LVGL (no OP_OWN), with F_OWN through the raster', () => {
  const lv = run({...dense, flags: F_TEXT}), own = run({...dense, flags: F_TEXT | F_OWN});
  assert.deepEqual(lv.lines.map(l => [l.op, l.own]), [[17, 0], [14, 0]]);
  assert.deepEqual(own.lines.map(l => [l.op, l.own]), [[17, 1], [14, 1]]);
  assert.equal(own.hash, lv.hash);                             // the grey is the raster in both
});

// Legacy type 3 can accompany both retained sections.
const elevBytes = elevationFromPoints(Array.from({length: 501}, (_, i) => ({distance: i * 10, elevation: 100 + i / 10})), 500000);
const elevFile = path.join(work, 'route-elev5.bin');
const retainedFile = fs.readFileSync(dense.file);
const retained = readSections(retainedFile).map(s => ({
  type: s.type, bytes: retainedFile.subarray(s.offset, s.offset + s.size),
}));
assert.deepEqual(retained.map(s => s.type), [SECTION.WAYBACK, SECTION.GREY]);
fs.writeFileSync(elevFile, embedSections(routeBytes, [...retained, {type: SECTION.ELEV, bytes: elevBytes}]));

test('on-route frames forward the stock draw and skip the legacy strip, file, heap and text', () => {
  for (const file of [elevFile, dense.file]) {
    const r = run({...dense, file, off: 0, flags: F_ROUTE | F_TEXT, U: 2999, T: 5000, sel: 0});
    assert.deepEqual([r.rt, r.opens, r.reads, r.closes, r.mallocs, r.frees, r.texts, r.greyPx, r.anchors, r.lines.length],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  }
});
test('legacy type 3 leaves off-route way-back and grey identical', () => {
  const {opened, ...legacy} = run({...dense, file: elevFile});
  const {opened: currentPath, ...current} = run(dense);
  assert.equal(opened, elevFile);
  assert.equal(currentPath, dense.file);
  assert.deepEqual(legacy, current);
});

// ---- the lens chart (design 2026-11-23): wb_km in place of the stock remaining-distance overlay ----
const v1 = elevBytes.slice(); v1[11] = 1;
const elevV1File = path.join(work, 'route-elev-v1.bin');
fs.writeFileSync(elevV1File, embedSections(routeBytes, [...retained, {type: SECTION.ELEV, bytes: v1}]));
const km = o => run({file: elevFile, off: 0, flags: F_OWN, U: 2999, T: 5000, sel: 0, ...o, km: o.km ?? [2999, 5000, 10, 1]});
const RGB = h => ((h >> 8) & 0xf800) | ((h >> 5) & 0x07e0) | ((h >> 3) & 0x001f);

test('lens: the stock second mode (show_text 0) calls the stock overlay with the same arguments', () => {
  const r = km({km: [2999, 5000, 10, 0]});
  assert.deepEqual([r.km, r.kmArgs, r.greyPx, r.texts, r.opens], [1, [2999, 5000, 10, 0], 0, 0, 0]);
});
test('lens: untrusted progress or low stack calls the stock overlay, nothing else', () => {
  for (const o of [{sel: 1}, {T: NaN}, {U: 5051}, {U: 0}, {flags: 0}, {stack: 3967}]) {   // no F_TEXT: no reason text
    const r = km(o);
    assert.deepEqual([r.km, r.kmArgs, r.greyPx, r.texts, r.opens], [1, [2999, 5000, 10, 1], 0, 0, 0], JSON.stringify(o));
  }
});
test('lens: with F_TEXT the stock fallback writes the reason code and the raw stock values at (6, 42)', () => {
  const ft = F_OWN | F_TEXT;
  for (const [o, s] of [[{sel: 1}, 'k4 u2999 t?'], [{T: NaN}, 'k5 u2999 t?'], [{U: 0}, 'k6 u0 t5000'], [{U: 5051}, 'k7 u5051 t5000'],
    [{flags: F_TEXT}, 'k8 u2999 t5000']]) {
    const r = km({flags: ft, ...o});
    assert.deepEqual([r.km, r.kmArgs, r.greyPx, r.opens], [1, [2999, 5000, 10, 1], 0, 0], JSON.stringify(o));
    assert.deepEqual(r.textCalls.map(c => [c.x, c.y, c.s]), [[7, 43, s], [6, 42, s]], JSON.stringify(o));
  }
  for (const o of [{km: [2999, 5000, 10, 0]}, {stack: 3967}]) assert.equal(km({flags: ft, ...o}).texts, 0, JSON.stringify(o));
});
test('lens: trusted progress and a version 2 section draw the chart and the text, not the stock overlay', () => {
  const r = km({});
  assert.deepEqual([r.km, r.opens, r.closes, r.mallocs, r.frees], [0, 1, 1, 1, 1]);
  assert.ok(r.greyPx > 240 * 10, `chart pixels ${r.greyPx}`);
  const t = r.textCalls;
  assert.deepEqual(t.filter((_, i) => i % 5 === 4).map(c => c.s), ['km', '3.0', '+29 m']);   // the climb: its own line
  assert.deepEqual(t.map(c => c.font), [2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
  assert(t.every(c => c.align === 3));
  assert.deepEqual(t.slice(0, 10).map(c => c.col), [0xffff, 0xffff, 0xffff, 0xffff, RGB(0x111316), 0xffff, 0xffff, 0xffff, 0xffff, RGB(0x111316)]);
  assert.deepEqual([t[14].x, t[14].y, t[14].w], [0, 197, 232]);      // right edge x 232, top y 197, above the number
  assert.deepEqual([t[4].x, t[4].y, t[4].w, t[9].y, t[9].w], [0, 217, 232, 215, 232 - 21 - 3]);   // "km" = 8 + 13 px
  assert.deepEqual(r.after, [7, 0x1234, 0, 1]);                       // font, colour, opacity, alignment restored
});
test('lens: the climb line is drawn for every distance and is not drawn below 5 m', () => {
  const t = km({U: 850, km: [850, 5000, 10, 1]}).textCalls;
  assert.deepEqual(t.filter((_, i) => i % 5 === 4).map(c => c.s), ['m', '850', '+8 m']);
  const flat = km({U: 30, km: [30, 5000, 10, 1]}).textCalls;      // 30 m left: no full 100 m window, no climb
  assert.deepEqual(flat.filter((_, i) => i % 5 === 4).map(c => c.s), ['m', '30']);
});
test('lens: version 1 section, size mismatch, heap failure: the plain progress line and the text', () => {
  for (const o of [{file: elevV1File}, {T: 5100, km: [2999, 5100, 10, 1]}, {mallocOk: 0}, {file: dense.file}]) {
    const r = km(o);
    assert.equal(r.km, 0, JSON.stringify(o));
    assert.ok(r.greyPx > 240 * 10, `plain pixels ${r.greyPx} ${JSON.stringify(o)}`);
    assert.equal(r.texts, 10, JSON.stringify(o));
    assert.equal(r.frees, o.mallocOk === 0 ? 0 : r.mallocs);           // a failed allocation counts as a malloc
    assert.equal(r.opens, r.closes);
  }
});
test('lens: wb_rt on the route draws nothing (the chart moved to wb_km)', () => {
  const r = run({file: elevFile, off: 0, flags: F_OWN, U: 2999, T: 5000, sel: 0});
  assert.deepEqual([r.rt, r.opens, r.greyPx, r.texts], [1, 0, 0, 0]);
});
