import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as pb from '../js/pb.js';
import {encodeBlockD} from '../js/map_codec.js';

// Host tests for firmware/mapdec/mapdec.c (cc25, E4). Synthetic data near latitude 51, longitude 7.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, '.local', 'mapdec-test');
const bin = path.join(work, 'mapdec_host');
fs.mkdirSync(work, {recursive: true});
let built = false, runs = 0;
function build() {
  if (built) return;
  const r = spawnSync('cc', ['-std=c11', '-O1', '-g', '-DHOST', '-fsanitize=address,undefined', '-fno-sanitize-recover=all',
    '-Wall', '-Wextra', '-Werror', '-o', bin, 'tools/mapdec_host.c', 'firmware/mapdec/mapdec.c'], {cwd: root, encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
  built = true;
}
// One host run: each record is one stock-style load. Returns one JSON object per record, then the final line.
function run(records, mode = 'normal', failAt = 0) {
  build();
  const parts = [];
  for (const r of records) { const b = Buffer.alloc(4); b.writeUInt32LE(r.length); parts.push(b, Buffer.from(r)); }
  const file = path.join(work, `records_${runs++}.bin`);
  fs.writeFileSync(file, Buffer.concat(parts));
  const res = spawnSync(bin, [file, mode, String(failAt)], {encoding: 'utf8', maxBuffer: 1 << 30});
  fs.rmSync(file, {force: true});
  assert.equal(res.status, 0, `host run failed: ${res.stderr.slice(0, 1500)}`);
  return res.stdout.trim().split('\n').map(l => JSON.parse(l));
}

let seed = 0x5a17;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const near = pb.sc(51.2), nearLon = pb.sc(7.1);
const coord = base => (rnd() < 0.05 ? [2147483647, -2147483648, 0][Math.floor(rnd() * 3)] : (base + Math.floor(rnd() * 2 ** 21) - 2 ** 20) | 0);
function randomEntries(n) {
  return Array.from({length: n}, (_, i) => {
    const cls = 1 + (i % 15);
    const style = cls | (Math.floor(rnd() * 4) << 4) | (rnd() < 0.5 ? 0x800 : 0);
    const cnt = Math.floor(rnd() * 40);
    const lat = coord(near), lon = coord(nearLon);
    const pts = Array.from({length: cnt}, () => (cls === 12
      ? [-Math.floor(rnd() * 2 ** 31) | 0, -Math.floor(rnd() * 2 ** 20) - 1]
      : [coord(lat), coord(lon)]));
    return {style, lat, lon, pts};
  });
}
// The protobuf block that stock code reads today (the shape of mapsec.js line 469: field 1 = count, each entry starts with its index).
const protoBlock = entries => [...pb.fu(1, entries.length), ...entries.flatMap((e, n) => pb.fb(2, [
  ...pb.fu(1, n), ...pb.fu(2, e.style), ...pb.fs(3, e.lat), ...pb.fs(4, e.lon), ...pb.fu(5, e.pts.length),
  ...e.pts.flatMap(q => pb.fb(6, [...pb.fs(1, q[0]), ...pb.fs(2, q[1])])),
]))];
// Expected entries of a protobuf block, field by field (n = index).
function protoEntries(bytes) {
  const out = [];
  for (const [field, , v] of pb.parse(Uint8Array.from(bytes))) {
    if (field !== 2) continue;
    const g = {}, pts = [];
    for (const [k, , x] of pb.parse(v)) {
      if (k === 6) { const q = {}; for (const [a, , y] of pb.parse(x)) q[a] = y; pts.push([pb.unzz(q[1] ?? 0), pb.unzz(q[2] ?? 0)]); }
      else g[k] = x;
    }
    out.push({n: out.length, style: g[2] ?? 0, lat: pb.unzz(g[3] ?? 0), lon: pb.unzz(g[4] ?? 0), cnt: pts.length, pts});
  }
  return out;
}
const want = entries => entries.map((e, n) => ({n, style: e.style, lat: e.lat, lon: e.lon, cnt: e.pts.length, pts: e.pts}));
// Stored map blocks of a step 1 route file: map offset at 0x5c, index length at the map offset, then blocks.
function storedBlocks(file) {
  const f = new Uint8Array(fs.readFileSync(file)), dv = new DataView(f.buffer, f.byteOffset, f.byteLength);
  const mo = dv.getUint32(0x5c, true), L = dv.getUint32(mo, true), out = [];
  for (let pos = mo + 4 + L; pos + 4 <= f.length;) {
    const len = dv.getUint32(pos, true);
    if (!len || len > 5000000 || pos + 4 + len > f.length) break;
    out.push(f.subarray(pos + 4, pos + 4 + len)); pos += 4 + len;
  }
  return out;
}
const real = ['t70S1.bin', 'cityS1.bin'].map(n => path.join(root, '.local', 'study', 'out', n));
const haveReal = real.every(f => fs.existsSync(f));

test('exact compare with the stock entries of the step 1 blocks (skipped when the files are absent)', {skip: !haveReal}, () => {
  let compared = 0;
  for (const file of real) {
    const blocks = storedBlocks(file);
    const records = blocks.map(b => encodeBlockD(protoEntries(b)));
    const out = run(records);
    blocks.forEach((b, i) => {
      const exp = protoEntries(b);
      assert.deepEqual(out[i].entries, want(exp), `block ${i} of ${path.basename(file)}`);
      compared++;
    });
  }
  console.log(`compared blocks: ${compared}`);
  assert(compared > 0);
});

test('synthetic exact compare: random entries across every class and the int32 limits', () => {
  const sets = [randomEntries(200), randomEntries(7), randomEntries(1)];
  const out = run(sets.map(encodeBlockD));
  sets.forEach((s, i) => assert.deepEqual(out[i].entries, want(s)));
});

test('truncation: every length of three blocks gives no fault and a consistent header', () => {
  for (const entries of [randomEntries(3), randomEntries(5), [{style: 0x0c, lat: 5, lon: -7, pts: [[1, 2], [3, 4]]}]]) {
    const bytes = encodeBlockD(entries);
    const recs = [];
    for (let k = 0; k <= bytes.length; k++) recs.push(bytes.slice(0, k));
    const out = run(recs);
    out.slice(0, -1).forEach((o, k) => {
      if (!o.array) assert.equal(o.count, 0, `length ${k}: array null needs count 0`);
      else assert.equal(o.entries.length, o.count, `length ${k}: entries match count`);
    });
  }
});

test('random bytes after the prefix: 10,000 cases, no sanitizer error, consistent header', () => {
  const recs = [];
  for (let c = 0; c < 10000; c++) {
    const n = 1 + Math.floor(rnd() * 20), plen = Math.floor(rnd() * 200);
    const payload = Array.from({length: plen}, () => Math.floor(rnd() * 256));
    const body = [0x08, 0x00, 0x10, 0x00, 0x28, 0x00, 0x7a, ...pb.uv(plen), ...payload];
    recs.push([...pb.fu(1, n), ...pb.fb(2, body)]);
  }
  const out = run(recs);
  assert.equal(out.length, 10001);
  out.slice(0, -1).forEach((o, c) => {
    assert.equal(o.count, o.entries.length, `case ${c}`);
    assert(o.array, `case ${c} keeps the array`);
  });
  assert.equal(out.at(-1).live, 0, 'no live allocation after the last case');
});

test('allocation failure at every allocation: count 0, no array, no live allocation', () => {
  const block = encodeBlockD([{style: 0x05, lat: 100, lon: 200, pts: [[1, 2], [3, 4]]},
    {style: 0x0c, lat: 101, lon: 201, pts: [[-1, -2]]}, {style: 0x06, lat: 99, lon: 199, pts: []},
    {style: 0x07, lat: 98, lon: 198, pts: [[5, 6], [7, 8], [9, 10]]}]);
  const total = run([block])[0].allocs;
  assert(total >= 3, `allocations seen: ${total}`);
  for (let k = 1; k <= total; k++) {
    const [o, fin] = run([block], 'normal', k);
    assert.equal(o.count, 0, `fail at ${k}: count`);
    assert.equal(o.array, false, `fail at ${k}: array`);
    assert.equal(o.live, 0, `fail at ${k}: live allocations`);
    assert.equal(fin.live, 0, `fail at ${k}: final live`);
  }
});

test('sequence: protobuf, scheme D, protobuf, scheme D: no leak, no double free', () => {
  const p1 = protoBlock(randomEntries(6)), d1 = randomEntries(9), p2 = protoBlock(randomEntries(4)), d2 = randomEntries(2);
  const out = run([Uint8Array.from(p1), encodeBlockD(d1), Uint8Array.from(p2), encodeBlockD(d2)]);
  assert.deepEqual(out[0].entries, want(protoEntries(Uint8Array.from(p1))));
  assert.deepEqual(out[1].entries, want(d1));
  assert.deepEqual(out[2].entries, want(protoEntries(Uint8Array.from(p2))));
  assert.deepEqual(out[3].entries, want(d2));
  assert.equal(out[4].live, 0, 'live after the last load');
  assert.equal(out[4].final, true);
});

test('fallback: a protobuf block reaches the stock model', () => {
  const p = Uint8Array.from(protoBlock(randomEntries(5)));
  const [o] = run([p]);
  assert.equal(o.stock, 5, 'one stock call per entry record');
});

test('fallback: a stream with another callback reaches the stock model', () => {
  const [o] = run([encodeBlockD(randomEntries(3))], 'othercb');
  assert(o.stock >= 1, 'stock model called');
  assert.equal(o.entries[0].cnt, 0);
});

test('payload N that differs from field 1 is refused: no entry is made, the count is kept', () => {
  const entries = randomEntries(3);
  const bad = Uint8Array.from(encodeBlockD(entries));
  assert.equal(bad[0], 0x08);
  assert.equal(bad[1], 3);
  bad[1] = 4;   // field 1 now says 4; the payload says 3
  const [o, fin] = run([bad]);
  assert.equal(o.count, 4);
  assert.equal(o.array, true);
  assert.deepEqual(o.entries.map(e => e.cnt), [0, 0, 0, 0]);
  assert.deepEqual(o.rc, [0]);
  assert.equal(fin.live, 0);
});

// cc27 Task 12 (Review focus 5): the unit decoder adds the int32 delta from a southern entry to the flags entry with wrap.
test('the flags entry after a southern entry decodes on the unit decoder (int32 wrap)', () => {
  const south = {style: 6, lat: -(2 ** 30), lon: 85000000, pts: [[-(2 ** 30), 85000000], [-(2 ** 30) + 99, 85000099]]};
  const flags = {style: 15, lat: 0x7F434346, lon: 7, pts: []};
  const out = run([encodeBlockD([south, flags])]);
  assert.deepEqual(out[0].entries, want([south, flags]));
});
