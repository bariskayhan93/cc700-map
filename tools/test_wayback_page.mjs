// tools/test_wayback_page.mjs: the page path of the way-back build (js/wayback.js) on a synthetic street grid.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {waybackBbox, waybackFromSnapshot, loadWaybackSnapshot, routeIdentity, addWayback, checkWayback, waybackSections} from '../js/wayback.js';
import {readGreyLayer} from '../js/wayback_grey_layer.js';
import {proveGreyLayer} from '../js/screen_proof.js';
import {buildRoute} from '../js/route.js';
import {decodeWayback} from '../js/wayback_format.js';
import {readNativeRoute} from '../js/native_route.js';
import {SECTION as SEC, embedSections as embedS, readSections as readS} from '../js/wayback_embed.js';
// cc27: test adapters over the section table (one way-back section)
const embedWayback = (r, w) => embedS(r, [{type: SEC.WAYBACK, bytes: w}]);
const readTrailer = f => { const s = readS(f), w = s && s.find(x => x.type === SEC.WAYBACK); return w ? {offset: w.offset, size: w.size} : null; };

// Streets every 100 m on a 1 km square at (51, 7). The route is the bottom street.
const K = Math.cos(51 * Math.PI / 180), pt = (x, y) => [51 + y / 111320, 7 + x / (111320 * K)];
const nodeId = (i, j) => 1000 + i * 11 + j + 1;
function elements({drop = 0} = {}) {
  const els = [];
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const [lat, lon] = pt(i * 100, j * 100);
    if (nodeId(i, j) !== drop) els.push({type: 'node', id: nodeId(i, j), lat, lon});
  }
  for (let k = 0; k <= 10; k++) {
    els.push({type: 'way', id: 100 + k, nodes: Array.from({length: 11}, (_, i) => nodeId(i, k)), tags: {highway: 'residential'}});
    els.push({type: 'way', id: 200 + k, nodes: Array.from({length: 11}, (_, j) => nodeId(k, j)), tags: {highway: k === 5 ? 'motorway' : 'residential'}});
  }
  return els;
}
const response = opt => ({osm3s: {timestamp_osm_base: '2026-11-01T00:00:00Z'}, elements: elements(opt)});
const route = Array.from({length: 11}, (_, i) => ({point: pt(i * 100, 0), progress: i * 10000}));
const fetchOf = answers => { let n = 0; const f = async u => { const a = answers[Math.min(n++, answers.length - 1)]; return {url: u, ok: a.ok ?? true, status: a.status ?? 200, json: async () => a.body}; }; f.calls = () => n; return f; };
// A replay: the answer of a saved file (no server URL), as the build pages give it.
const replayOf = body => { let n = 0; const f = async () => { n++; return new Response(JSON.stringify(body), {status: 200}); }; f.calls = () => n; return f; };

test('the box holds the route with a margin of at least 2.2 km on each side', () => {
  const [s, w, n, e] = waybackBbox(route);
  assert(51 - s >= 2200 / 111320 && n - pt(0, 0)[0] >= 2200 / 111320);
  assert((7 - w) * 111320 * K >= 2200 && (e - pt(1000, 0)[1]) * 111320 * K >= 2200);
  assert(n - s < 0.06 && e - w < 0.09);
});

test('the page path gives a file whose nodes lead to the route, and never uses the motorway', async () => {
  const snapshot = await loadWaybackSnapshot(route, fetchOf([{body: response()}]));
  assert.equal(snapshot.integrity, 'pass');
  const id = await routeIdentity(new Uint8Array(4096));
  const made = waybackFromSnapshot(snapshot, route, id);
  const d = decodeWayback(made.bytes);
  assert.equal(made.reach, 'line2k');
  assert.deepEqual([...d.header.routeId], [...id]);
  assert.equal(d.nodes.filter(n => n.distDm === 0).length, 11);
  for (const n of d.nodes) {
    let k = n, steps = 0;
    while (k.next >= 0 && steps++ < 200) k = d.nodes[k.next];
    assert.equal(k.distDm, 0);
  }
  // Column 5 is a motorway. Its top node is reached along the row: 1,000 m down plus 100 m to the side.
  const far = Math.max(...d.nodes.map(n => n.distDm));
  assert(far >= 10980 && far <= 11020, String(far));
  // Same input, same bytes.
  assert.deepEqual(waybackFromSnapshot(snapshot, route, id).bytes, made.bytes);
});

test('a size limit falls back to the shorter reach and then to no file', async () => {
  const snapshot = await loadWaybackSnapshot(route, fetchOf([{body: response()}]));
  const id = new Uint8Array(16), full = waybackFromSnapshot(snapshot, route, id).bytes.length;
  const less = waybackFromSnapshot(snapshot, route, id, {maxBytes: full - 1});
  assert(less === null || (less.reach === 'line1k' && less.bytes.length < full));
  assert.equal(waybackFromSnapshot(snapshot, route, id, {maxBytes: 64}), null);
});

// Review finding 3: a reach whose way-back bytes are over the size limit gets no grey fit (the fit is the slow part).
test('a reach over the size limit makes no grey fit', async () => {
  const N = 31, big = [], id3 = (i, j) => 1000 + i * N + j + 1;   // 3 km grid: the 1 km reach covers less of it than 2 km
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const [lat, lon] = pt(i * 100, j * 100); big.push({type: 'node', id: id3(i, j), lat, lon}); }
  for (let k = 0; k < N; k++) {
    big.push({type: 'way', id: 100 + k, nodes: Array.from({length: N}, (_, i) => id3(i, k)), tags: {highway: 'residential'}});
    big.push({type: 'way', id: 200 + k, nodes: Array.from({length: N}, (_, j) => id3(k, j)), tags: {highway: 'residential'}});
  }
  const snapshot = await loadWaybackSnapshot(route, fetchOf([{body: {osm3s: {timestamp_osm_base: '2026-11-01T00:00:00Z'}, elements: big}}]));
  const id = new Uint8Array(16), none = new Uint8Array(0);
  const full = waybackFromSnapshot(snapshot, route, id, {format: 2, routeBytes: none}).bytes.length;
  let reads = 0;
  const caps = {get pixCap() { reads++; return 60000; }, ptCap: 2048};
  const stepped = waybackFromSnapshot(snapshot, route, id, {format: 2, routeBytes: none, layer: true, caps, maxBytes: full - 1});
  const steppedReads = reads;
  reads = 0;
  const direct = waybackFromSnapshot(snapshot, route, id, {format: 2, routeBytes: none, layer: true, caps, reach: 'line1k'});
  assert.equal(stepped.reach, 'line1k');
  assert.deepEqual(stepped.grey, direct.grey);
  assert.equal(steppedReads, reads, 'the line2k fit ran although its bytes were over the limit');
});

test('street data that is not complete gives no snapshot', async () => {
  await assert.rejects(loadWaybackSnapshot(route, fetchOf([{body: response({drop: nodeId(3, 3)})}])), /not complete: missing-way-node/);
  await assert.rejects(loadWaybackSnapshot(route, fetchOf([{body: {elements: []}}])), /not complete/);
});

test('a busy server is skipped and the next server is used', async () => {
  const f = fetchOf([{ok: false, status: 504, body: {}}, {body: {remark: 'runtime error', elements: []}}, {body: response()}]);
  assert.equal((await loadWaybackSnapshot(route, f)).integrity, 'pass');
  assert.equal(f.calls(), 3);
});

test('a route area above the bounded region is refused before any request', async () => {
  const far = [{point: [51, 7], progress: 0}, {point: [51.6, 7.9], progress: 9000000}], f = fetchOf([{body: response()}]);
  await assert.rejects(loadWaybackSnapshot(far, f), /bounded/);
  assert.equal(f.calls(), 0);
});

// Owner 24 Nov: query bound 700 km2. A 95 km route to the north: its 3 km box is about 650 km2, so 3 km stays.
test('a 3 km box of about 650 km2 keeps the 3 km reach', async () => {
  const gpx = {name: 'C2-size', pts: Array.from({length: 96}, (_, k) => [51 + k * 1000 / 111320, 7, 0])};
  const plain = buildRoute(gpx, [], {id: '11120000', nameImage: () => new Uint8Array(42), map: {styled: true}, speedKmh: 18}).file;
  const f = async url => ({url, ok: true, status: 200, json: async () => response()});
  const w = await addWayback(plain, {fetchImpl: f, format: 2, reach: 'line3k'});
  assert.equal(w.reach, 'line3k');
});

// A 105 km route to the north: its 3 km box is about 710 km2 (over the 700 km2 query bound), its 2 km box about 480 km2.
test('the fetch steps the reach down when the box of the chosen reach is over the bounded area', async () => {
  const gpx = {name: 'Long', pts: Array.from({length: 106}, (_, k) => [51 + k * 1000 / 111320, 7, 0])};
  const plain = buildRoute(gpx, [], {id: '11120000', nameImage: () => new Uint8Array(42), map: {styled: true}, speedKmh: 18}).file;
  const boxes = [], f = async (url, opt) => { boxes.push(/\(([^)]*)\)/.exec(opt.body.get('data'))[1]); return {url, ok: true, status: 200, json: async () => response()}; };
  const w = await addWayback(plain, {fetchImpl: f, format: 2, reach: 'line3k'});
  assert.equal(w.reach, 'line2k');
  assert.deepEqual(boxes, [waybackBbox(readNativeRoute(plain), 'line2k').join(',')]);
  const far = {name: 'Far', pts: [[51, 7, 0], [51.6, 7.9, 0]]}, g = fetchOf([{body: response()}]);
  const wide = buildRoute(far, [], {id: '11120000', nameImage: () => new Uint8Array(42), map: {styled: true}, speedKmh: 18}).file;
  // far map (23 Nov): the corridor boxes along the diagonal fit where the bounding box does not; one union query
  const bodies = [], h = async (url, opt) => { bodies.push(opt.body.get('data')); return {url, ok: true, status: 200, json: async () => response()}; };
  const ww = await addWayback(wide, {fetchImpl: h, format: 2, reach: 'line3k'}).catch(e => e);
  assert(bodies.length >= 1 && (bodies[0].match(/way\[highway\]\(/g) || []).length > 1, 'one query with several boxes');
  assert(!(ww instanceof Error) || !/bounded/.test(ww.message), 'not refused for the area');
  assert.equal(g.calls(), 0);
});

test('the trailer points at the way-back bytes and the route bytes do not change', async () => {
  const snapshot = await loadWaybackSnapshot(route, fetchOf([{body: response()}]));
  const plain = Uint8Array.from({length: 8192}, (_, i) => i & 255), made = waybackFromSnapshot(snapshot, route, await routeIdentity(plain));
  const out = embedWayback(plain, made.bytes), t = readTrailer(out);
  assert.equal(out.length % 4096, 0);
  assert.deepEqual([...out.subarray(0, 8192)], [...plain]);
  assert.deepEqual(t, {offset: 8192, size: made.bytes.length});
  assert.deepEqual(out.subarray(t.offset, t.offset + t.size), made.bytes);
  assert.throws(() => embedWayback(out, made.bytes), /already has/);
});

test('format 2 writes way-back version 3 (cc27) and format 1 keeps version 1 (cc26, D1)', async () => {
  const snapshot = await loadWaybackSnapshot(route, fetchOf([{body: response()}]));
  const id = new Uint8Array(16);
  assert.equal(decodeWayback(waybackFromSnapshot(snapshot, route, id, {format: 2, routeBytes: new Uint8Array(0)}).bytes).header.version, 3);   // no map: every flag 1
  assert.equal(decodeWayback(waybackFromSnapshot(snapshot, route, id).bytes).header.version, 1);
});

test('format 2 with layer: true gives a fitted grey section of its own; the way-back bytes do not change (cc27)', async () => {
  const snapshot = await loadWaybackSnapshot(route, fetchOf([{body: response()}]));
  const id = new Uint8Array(16), none = new Uint8Array(0);   // no map: every piece is grey
  const bare = waybackFromSnapshot(snapshot, route, id, {format: 2, routeBytes: none});
  const withLayer = waybackFromSnapshot(snapshot, route, id, {format: 2, routeBytes: none, layer: true});
  assert.equal(bare.grey, null);
  assert.deepEqual(withLayer.bytes, bare.bytes);
  const g = readGreyLayer(withLayer.grey);
  assert.deepEqual([g.version, g.pixCap, g.ptCap], [2, 60000, 2048]);
  assert.equal(proveGreyLayer(g.cells).over.length, 0);
  assert(withLayer.greyReport.removedLines >= 0 && withLayer.greyReport.screens > 0, JSON.stringify(withLayer.greyReport));
  const small = waybackFromSnapshot(snapshot, route, id, {format: 2, routeBytes: none, layer: true, caps: {pixCap: 2000, ptCap: 2048}});
  assert(small.greyReport.removedLines > 0 && readGreyLayer(small.grey).pixCap === 2000);
});

test('checkWayback keeps the way-back and grey sections when the identity holds, and drops both after a byte change', async () => {
  const snapshot = await loadWaybackSnapshot(route, fetchOf([{body: response()}]));
  const plain = Uint8Array.from({length: 8192}, (_, i) => (i * 7) & 255);
  const made = waybackFromSnapshot(snapshot, route, await routeIdentity(plain), {format: 2, routeBytes: new Uint8Array(0), layer: true});
  const out = embedS(plain, waybackSections({wayback: made.bytes, grey: made.grey}));
  assert.deepEqual(readS(out).map(x => x.type), [SEC.WAYBACK, SEC.GREY]);
  assert.equal((await checkWayback(out)).status, 'ok');
  const changed = out.slice();
  changed[100] ^= 1;   // a byte of the route bytes in front of the sections
  const dropped = await checkWayback(changed);
  assert.equal(dropped.status, 'dropped');
  assert.equal(readS(dropped.file), null);
  assert.equal(dropped.file.length, plain.length);
});

test('format 2 without routeBytes throws: there is no default grey flag (D0 item 4)', async () => {
  const snapshot = await loadWaybackSnapshot(route, fetchOf([{body: response()}]));
  assert.throws(() => waybackFromSnapshot(snapshot, route, new Uint8Array(16), {format: 2}), /routeBytes/);
});

// Owner ruling (18 Nov, option a): before a file is sent, the way-back data stays only when its route identity equals the
// identity of the route bytes in front of it. A changed route byte (a rename) removes the trailer.
test('a route file whose bytes changed after addWayback loses its way-back trailer before it is sent', async () => {
  const gpx = {name: 'Identity', pts: route.map(r => [...r.point, 0])};
  const plain = buildRoute(gpx, [], {id: '11120000', nameImage: () => new Uint8Array(42), map: {styled: true}, speedKmh: 18}).file;
  const w = await addWayback(plain, {fetchImpl: fetchOf([{body: response()}]), format: 2});
  assert(w.grey, 'format 2 gives the grey section by default');
  w.file = embedS(plain, waybackSections(w));
  const kept = await checkWayback(w.file);
  assert.equal(kept.status, 'ok');
  assert.notEqual(readTrailer(kept.file), null);
  const renamed = w.file.slice();
  renamed[1] ^= 0xff;                                  // one header byte of the route part
  const dropped = await checkWayback(renamed);
  assert.equal(dropped.status, 'dropped');
  assert.equal(readTrailer(dropped.file), null);
  assert.equal(dropped.file.length, plain.length);
});


// ---- cc27 Task 6: trailer version 2, the section table (last 64 B) ----
import {SECTION, embedSections, readSections} from '../js/wayback_embed.js';
const fakeRoute = () => new Uint8Array(8192).fill(7);
const wbBytes = n => { const b = new Uint8Array(n).fill(1); b.set([0x43, 0x43, 0x57, 0x42]); return b; };
test('embedSections then readSections gives the same three sections; the route bytes are unchanged', () => {
  const r = fakeRoute(), w = wbBytes(5000), g = new Uint8Array(3000).fill(2), e = new Uint8Array(900).fill(3);
  const f = embedSections(r, [{type: SECTION.WAYBACK, bytes: w}, {type: SECTION.GREY, bytes: g}, {type: SECTION.ELEV, bytes: e}]);
  assert.equal(f.length % 4096, 0);
  assert.deepEqual(f.subarray(0, r.length), r);
  const s = readSections(f);
  assert.deepEqual(s.map(x => x.type), [1, 2, 3]);
  for (const [x, b] of [[s[0], w], [s[1], g], [s[2], e]]) assert.deepEqual(f.subarray(x.offset, x.offset + x.size), b);
  assert.equal(s[0].offset, r.length);
  assert.throws(() => embedSections(f, [{type: SECTION.WAYBACK, bytes: w}]), /already has/);
});
test('a table with an overlap, a section past the trailer, or count 5 is refused', () => {
  const f = embedSections(fakeRoute(), [{type: SECTION.WAYBACK, bytes: wbBytes(5000)}, {type: SECTION.ELEV, bytes: new Uint8Array(100)}]);
  const at = f.length - 64, edit = (fn) => { const c = f.slice(); fn(new DataView(c.buffer), c); return readSections(c); };
  assert.notEqual(readSections(f), null);
  assert.equal(edit(v => v.setUint32(at + 4, 5, true)), null);                                  // count 5
  assert.equal(edit(v => v.setUint32(at + 24, v.getUint32(at + 12, true) + 10, true)), null);   // elevation inside the way-back bytes
  assert.equal(edit(v => v.setUint32(at + 28, f.length, true)), null);                          // elevation past the trailer
  assert.equal(edit(v => v.setUint32(at + 20, 1, true)), null);                                 // the way-back type two times
  assert.equal(edit(v => v.setUint32(at, 0x54574343, true)), null);                             // the cc26 magic CCWT
});

// Final review: a grey fit above its removal limit gives no grey section; the way-back data stays.
test('a grey fit over its removal limit gives no grey section and keeps the way-back bytes', async () => {
  const snapshot = await loadWaybackSnapshot(route, fetchOf([{body: response()}]));
  const id = new Uint8Array(16), none = new Uint8Array(0);
  const ok = waybackFromSnapshot(snapshot, route, id, {format: 2, routeBytes: none, layer: true});
  const over = waybackFromSnapshot(snapshot, route, id, {format: 2, routeBytes: none, layer: true, caps: {pixCap: 0, ptCap: 2048, maxRemovals: 3}});
  assert.equal(over.grey, null);
  assert.match(over.greyReport.reason, /more than 3 removals/);
  assert.deepEqual(over.bytes, ok.bytes);
});

// Final review: the 1,536 KB cap is for the way-back section; the grey section has its own section (file guard 4 MB).
test('the way-back size limit counts the way-back section only, not the grey section', async () => {
  const snapshot = await loadWaybackSnapshot(route, fetchOf([{body: response()}]), 'line3k');
  const id = new Uint8Array(16), none = new Uint8Array(0);
  const full = waybackFromSnapshot(snapshot, route, id, {format: 2, routeBytes: none, layer: true, reach: 'line3k'});
  assert(full.grey && full.grey.length > 0);
  const tight = waybackFromSnapshot(snapshot, route, id, {format: 2, routeBytes: none, layer: true, reach: 'line3k', maxBytes: full.bytes.length});
  assert.equal(tight.reach, 'line3k');
  assert.deepEqual(tight.bytes, full.bytes);
});

// 20 Nov (owner): a replayed answer (not from a server URL) must hold its covered box [S, W, N, E] (key coverBbox), and the
// box must hold reach + 200 m on every side. A missing box or a short side fails; the live path needs no box.
test('a replayed answer that covers the box of the reach is used', async () => {
  const f = replayOf({...response(), coverBbox: waybackBbox(route, 'line2k')});
  assert.equal((await loadWaybackSnapshot(route, f, 'line2k')).integrity, 'pass');
});

test('a replayed answer without its covered box fails', async () => {
  await assert.rejects(loadWaybackSnapshot(route, replayOf(response()), 'line2k'), /replayed street data has no covered box/);
  await assert.rejects(loadWaybackSnapshot(route, replayOf({...response(), coverBbox: [1, 2, 3]}), 'line2k'), /no covered box/);
});

test('a replayed answer short on a side fails with the side and the metres', async () => {
  const [s, w, n, e] = waybackBbox(route, 'line3k');
  const f = replayOf({...response(), coverBbox: [s, w + 500 / (111320 * K), n - 953 / 111320, e]});
  await assert.rejects(loadWaybackSnapshot(route, f, 'line3k'), /does not cover line3k \+ 200 m: W short by (49|50)\d m, N short by 95\d m/);
});

test('a live answer needs no covered box', async () => {
  assert.equal((await loadWaybackSnapshot(route, fetchOf([{body: response()}]), 'line3k')).integrity, 'pass');
});

// 20 Nov (owner): snapshot.json carries the covered box too (captureRoutingSnapshot), and waybackFromSnapshot checks it
// against the box of the reach, so a host build from snapshot.json (tools/wayback_build.mjs, tools/release_budget.mjs) never cuts silently.
test('a snapshot without its covered box fails in waybackFromSnapshot', async () => {
  const snapshot = await loadWaybackSnapshot(route, fetchOf([{body: response()}]), 'line2k'), {coverBbox, ...bare} = snapshot;
  assert.deepEqual(coverBbox, waybackBbox(route, 'line2k'));
  assert.throws(() => waybackFromSnapshot(bare, route, new Uint8Array(16)), /replayed street data has no covered box/);
  assert.throws(() => waybackFromSnapshot({...bare, coverBbox: [1, 2]}, route, new Uint8Array(16)), /no covered box/);
});

test('a snapshot short on a side fails with the side and the metres; a covering box passes', async () => {
  const snapshot = await loadWaybackSnapshot(route, fetchOf([{body: response()}]), 'line2k'), [s, w, n, e] = snapshot.coverBbox;
  const short = {...snapshot, coverBbox: [s + 300 / 111320, w, n, e - 700 / (111320 * K)]};
  assert.throws(() => waybackFromSnapshot(short, route, new Uint8Array(16)), /does not cover line2k \+ 200 m: S short by 30\d m, E short by (69|70)\d m/);
  assert.throws(() => waybackFromSnapshot(snapshot, route, new Uint8Array(16), {reach: 'line3k'}), /does not cover line3k \+ 200 m: S short by/);
  assert(waybackFromSnapshot(snapshot, route, new Uint8Array(16)).bytes.length > 0);
});

test('a replayed answer gives its own covered box to the snapshot', async () => {
  const cover = waybackBbox(route, 'line3k');
  assert.deepEqual((await loadWaybackSnapshot(route, replayOf({...response(), coverBbox: cover}), 'line2k')).coverBbox, cover);
});
