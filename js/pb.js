// Minimal protobuf (nanopb 0.3 wire format) + byte helpers.
export const SC = 180 / 2 ** 31;                       // semicircle -> degree
export const sc = deg => Math.round(deg / SC);
export function uv(v) {                                // unsigned varint (v < 2^53)
  const o = [];
  for (;;) {
    const x = v % 128; v = Math.floor(v / 128);
    if (v) o.push(x | 0x80); else { o.push(x); return o; }
  }
}
export const zz = v => v >= 0 ? 2 * v : -2 * v - 1;   // zigzag for svarint (32-bit range)
export const unzz = v => (v % 2) ? -(v + 1) / 2 : v / 2;
export const key = (f, t) => uv(f * 8 + t);
export const fu = (f, v) => [...key(f, 0), ...uv(v)];          // uvarint field
export const fs = (f, v) => [...key(f, 0), ...uv(zz(v))];      // svarint field
export const fb = (f, b) => [...key(f, 2), ...uv(b.length), ...b]; // bytes/submsg field
export function f32(f, x) {                            // fixed32 float field
  const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x, true);
  return [...key(f, 5), ...b];
}
export function u32le(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
export function parse(b) {                             // -> [[field, type, value]] (value: number or Uint8Array)
  const out = []; let i = 0;
  const vi = () => { let r = 0, m = 1, x; do { x = b[i++]; r += (x & 127) * m; m *= 128; } while (x & 128); return r; };
  while (i < b.length) {
    const k = vi(), f = Math.floor(k / 8), t = k % 8; let v;
    if (t === 0) v = vi();
    else if (t === 2) { const L = vi(); v = b.subarray(i, i + L); i += L; }
    else if (t === 5) { v = new DataView(b.buffer, b.byteOffset + i, 4).getUint32(0, true); i += 4; }
    else if (t === 1) { i += 8; v = 0; }
    else throw new Error('wire type ' + t);
    out.push([f, t, v]);
  }
  return out;
}
export class Bytes {                                   // growable byte buffer
  constructor() { this.a = new Uint8Array(1 << 16); this.n = 0; }
  push(arr) {
    if (this.n + arr.length > this.a.length) { const b = new Uint8Array(Math.max(this.a.length * 2, this.n + arr.length)); b.set(this.a.subarray(0, this.n)); this.a = b; }
    this.a.set(arr, this.n); this.n += arr.length; return this;
  }
  get bytes() { return this.a.subarray(0, this.n); }
}
export function crc16xmodem(d) {
  let c = 0;
  for (const b of d) { c ^= b << 8; for (let k = 0; k < 8; k++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; }
  return c;
}
