import assert from 'node:assert/strict';
import {test} from 'node:test';
import {encodeBlockD, decodeBlockD, isBlockD} from '../js/map_codec.js';
import {parse, fu, fs, fb, sc} from '../js/pb.js';

// Synthetic data near latitude 51, longitude 7 (semicircles), plus int32 edge values.
let seed = 0x2f1d;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const EDGE = [2147483647, -2147483648, 0, -1, 1];
const near = sc(51.2), nearLon = sc(7.1);
const coord = base => (rnd() < 0.08 ? EDGE[Math.floor(rnd() * EDGE.length)] : (base + Math.floor(rnd() * 2 ** 21) - 2 ** 20) | 0);
function randomEntries(n) {
  return Array.from({length: n}, (_, i) => {
    const cls = 1 + (i % 15);                                  // every class 1 to 15 appears
    const style = cls | (Math.floor(rnd() * 4) << 4) | (rnd() < 0.5 ? 0x800 : 0);
    const cnt = Math.floor(rnd() * 61);                        // 0 to 60 points
    const lat = coord(near), lon = coord(nearLon);
    const pts = Array.from({length: cnt}, () => (cls === 12
      ? [-Math.floor(rnd() * 2 ** 31) | 0, -Math.floor(rnd() * 2 ** 20) - 1]   // label words, negative
      : [coord(lat), coord(lon)]));
    return {style, lat, lon, pts};
  });
}
// The protobuf block that stock code reads today (the same shape as mapsec.js sentry()).
const protoBlock = entries => [...fu(1, entries.length), ...entries.flatMap(e => fb(2, [
  ...fu(2, e.style), ...fs(3, e.lat), ...fs(4, e.lon), ...fu(5, e.pts.length),
  ...e.pts.flatMap(q => fb(6, [...fs(1, q[0]), ...fs(2, q[1])])),
]))];

test('round trip of 200 random entries across every class and the int32 limits', () => {
  const entries = randomEntries(200);
  assert.deepEqual(new Set(entries.map(e => e.style & 15)), new Set([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]));
  assert(entries.some(e => e.pts.some(q => q[0] === -2147483648 || q[0] === 2147483647)));
  assert(entries.some(e => (e.style & 15) === 12 && e.pts.some(q => q[0] < 0)));
  const bytes = encodeBlockD(entries);
  assert.deepEqual(decodeBlockD(bytes), entries);
  assert.equal(isBlockD(bytes), true);
});

test('decodeBlockD returns null for a protobuf block', () => {
  const bytes = Uint8Array.from(protoBlock(randomEntries(5)));
  assert.equal(decodeBlockD(bytes), null);
  assert.equal(isBlockD(bytes), false);
});

test('every truncation of an encoded block throws', () => {
  const bytes = encodeBlockD(randomEntries(3));
  for (let k = 1; k < bytes.length; k++) {
    assert.throws(() => decodeBlockD(bytes.slice(0, k)), /scheme D/, `truncated at ${k} of ${bytes.length}`);
  }
});

test('a payload N that differs from field 1 throws', () => {
  const bytes = encodeBlockD(randomEntries(3));
  assert.equal(bytes[0], 0x08);
  assert.equal(bytes[1], 3);
  const bad = Uint8Array.from(bytes); bad[1] = 4;
  assert.throws(() => decodeBlockD(bad), /scheme D/);
});

test('the empty array round-trips to one style 0 entry', () => {
  assert.deepEqual(decodeBlockD(encodeBlockD([])), [{style: 0, lat: 0, lon: 0, pts: []}]);
});

test('the field 2 record starts with the stock-safe prefix, then the payload length', () => {
  const bytes = Uint8Array.from(encodeBlockD(randomEntries(4)));
  const [f1, f2] = parse(bytes);
  assert.deepEqual(f1.slice(0, 2), [1, 0]);
  assert.deepEqual(f2.slice(0, 2), [2, 2]);
  const body = f2[2];
  assert.deepEqual(Array.from(body.slice(0, 7)), [0x08, 0x00, 0x10, 0x00, 0x28, 0x00, 0x7a]);
  let i = 7, len = 0, m = 1, x;
  do { x = body[i++]; len += (x & 127) * m; m *= 128; } while (x & 128);
  assert.equal(i + len, body.length);
});

// ---- cc27 Task 12: the flags entry (class 15, no points, lat 0x7F434346, lon = flags) is the last entry of a block ----
import {flagsEntry} from '../js/mapsec.js';
import {entryOf} from '../js/map_codec.js';
test('flags entry after a southern entry (lat -2^30) decodes to lat 0x7F434346 and the right lon', () => {
  const south = {style: 6, lat: -(2 ** 30), lon: sc(7.1), pts: [[-(2 ** 30), sc(7.1)], [-(2 ** 30) + 99, sc(7.1) + 99]]};
  const flags = entryOf(flagsEntry(7));
  assert.deepEqual(flags, {style: 15, lat: 0x7F434346, lon: 7, pts: []});
  const d = decodeBlockD(encodeBlockD([south, flags]));
  assert.deepEqual(d.at(-1), {style: 15, lat: 0x7F434346, lon: 7, pts: []});
  assert.deepEqual(d[0], south);
  const north = decodeBlockD(encodeBlockD([{...south, lat: 2 ** 30, pts: []}, entryOf(flagsEntry(5))]));
  assert.deepEqual(north.at(-1), {style: 15, lat: 0x7F434346, lon: 5, pts: []});
});
