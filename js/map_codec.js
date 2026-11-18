// Scheme D map block, version 1 (cc25). The outer message stays protobuf, so the stock decoder
// reads one empty entry (style 0, count 0) and does not fault. The payload holds all entries in
// zigzag deltas. Lat and lon are int32 semicircles; all arithmetic wraps to int32.
import {uv, zz, unzz, fu, fb} from './pb.js';

const PREFIX = [0x08, 0x00, 0x10, 0x00, 0x28, 0x00, 0x7a];   // n 0, style 0, cnt 0, field 15 (skipped by stock)
const LABEL = 12;
const CNT_MAX = 4096;
const i32 = v => v | 0;

function encodePayload(entries) {
  const out = [1, ...uv(entries.length)];
  let pLat = 0, pLon = 0;
  for (const e of entries) {
    const lat = i32(e.lat), lon = i32(e.lon), label = (e.style & 15) === LABEL;
    out.push(...uv(e.style >>> 0), ...uv(e.pts.length), ...uv(zz(i32(lat - pLat))), ...uv(zz(i32(lon - pLon))));
    pLat = lat; pLon = lon;
    let qa = lat, qb = lon;
    for (const [a0, b0] of e.pts) {
      const a = i32(a0), b = i32(b0);
      if (label) out.push(...uv(zz(a)), ...uv(zz(b)));
      else { out.push(...uv(zz(i32(a - qa))), ...uv(zz(i32(b - qb)))); qa = a; qb = b; }
    }
  }
  return out;
}

export function encodeBlockD(entries) {
  const list = entries.length ? entries : [{style: 0, lat: 0, lon: 0, pts: []}];   // E3: empty block
  const payload = encodePayload(list);
  const body = [...PREFIX, ...uv(payload.length), ...payload];
  return [...fu(1, list.length), ...fb(2, body)];
}

// Reads one varint of at most 5 bytes. Returns [value, next] or null at the end.
function readVar(b, pos) {
  let v = 0, m = 1;
  for (let k = 0; k < 5; k++) {
    if (pos >= b.length) return null;
    const x = b[pos++];
    v += (x & 127) * m; m *= 128;
    if (!(x & 128)) return [v, pos];
  }
  throw new Error('scheme D: varint too long');
}

// 'proto' = not a scheme D block; 'd' = prefix matches; 'dbad' = the bytes stop inside the header.
function classify(b) {
  if (!b.length || b[0] !== 0x08) return 'proto';
  let r = readVar(b, 1);
  if (!r) return 'dbad';
  let pos = r[1];
  if (pos >= b.length) return 'dbad';
  if (b[pos] !== 0x12) return 'proto';
  r = readVar(b, pos + 1);
  if (!r) return 'dbad';
  const len = r[0], start = r[1], avail = b.length - start;
  for (let i = 0; i < Math.min(7, len, avail); i++) if (b[start + i] !== PREFIX[i]) return 'proto';
  return len < 7 || avail < 7 ? 'dbad' : 'd';
}

function decodePayload(p, N) {
  const fail = msg => { throw new Error('scheme D: ' + msg); };
  const rdU = pos => { const r = readVar(p, pos); if (!r) fail('truncated payload'); return r; };
  if (!p.length || p[0] !== 1) fail('payload version is not 1');
  let [n, pos] = rdU(1);
  if (n !== N) fail('payload N differs from field 1');
  if (N < 1) fail('N is 0');
  const out = [];
  let pLat = 0, pLon = 0;
  for (let i = 0; i < N; i++) {
    let style, cnt, u;
    [style, pos] = rdU(pos);
    if (style > 0xffffffff) fail('style out of range');
    [cnt, pos] = rdU(pos);
    if (cnt > CNT_MAX) fail('count above 4096');
    [u, pos] = rdU(pos); const lat = i32(pLat + unzz(u));
    [u, pos] = rdU(pos); const lon = i32(pLon + unzz(u));
    pLat = lat; pLon = lon;
    const label = (style & 15) === LABEL, pts = [];
    let qa = lat, qb = lon;
    for (let j = 0; j < cnt; j++) {
      let a, b;
      [u, pos] = rdU(pos); a = unzz(u);
      [u, pos] = rdU(pos); b = unzz(u);
      if (label) pts.push([i32(a), i32(b)]);
      else { a = i32(qa + a); b = i32(qb + b); pts.push([a, b]); qa = a; qb = b; }
    }
    out.push({style, lat, lon, pts});
  }
  if (pos !== p.length) fail('trailing payload bytes');
  return out;
}

export function decodeBlockD(bytes) {
  const b = Uint8Array.from(bytes);
  if (classify(b) === 'proto') return null;
  const fail = msg => { throw new Error('scheme D: ' + msg); };
  const f1 = readVar(b, 1);
  if (!f1) fail('truncated field 1');
  const N = f1[0];
  let pos = f1[1];
  if (pos >= b.length || b[pos] !== 0x12) fail('missing entry record');
  const f2 = readVar(b, pos + 1);
  if (!f2) fail('truncated record length');
  const L = f2[0], start = f2[1];
  if (L > b.length - start) fail('truncated record');
  if (L < 7) fail('record shorter than prefix');
  for (let i = 0; i < 7; i++) if (b[start + i] !== PREFIX[i]) fail('record prefix');
  const rec = b.subarray(start, start + L);
  const pl = readVar(rec, 7);
  if (!pl || pl[1] + pl[0] !== rec.length) fail('payload length');
  if (start + L !== b.length) fail('trailing bytes after the entry record');
  return decodePayload(rec.subarray(pl[1]), N);
}

export function isBlockD(bytes) {
  return classify(Uint8Array.from(bytes)) !== 'proto';
}
