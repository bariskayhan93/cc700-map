// Render one detail-map screen (worst outline spot on the route) three ways: today, no outline, fused (same as today in pixels).
import fs from 'node:fs'; import zlib from 'node:zlib';
const R = new URL('../../js/', import.meta.url).pathname;
const {decodeBlockD, isBlockD} = await import(R + 'map_codec.js'); const {readNativeRoute} = await import(R + 'native_route.js'); const {readSections} = await import(R + 'wayback_embed.js');
const file = new Uint8Array(fs.readFileSync(process.argv[2])), secs = readSections(file), v = new DataView(file.buffer);
const mapAt = v.getUint32(0x5c, true), map = file.subarray(mapAt, Math.min(...secs.map(s => s.offset))), mv = new DataView(map.buffer, map.byteOffset);
const route = readNativeRoute(file).map(r => r.point), lat0 = route[0][0], mE = 111320 * Math.cos(lat0 * Math.PI / 180), K = 180 / 2 ** 31, toM = (a, o) => [o * mE, a * 111320];
const RM = route.map(p => toM(...p));
const blocks = []; for (let o = 4 + mv.getUint32(0, true); o + 4 <= map.length;) { const n = mv.getUint32(o, true); if (!n || o + 4 + n > map.length) break; const b = map.subarray(o + 4, o + 4 + n); if (isBlockD(b)) blocks.push(decodeBlockD(b)); o += 4 + n; }
const ents = blocks.flat().map(e => ({c: e.style & 15, ol: !(e.style & 0x400), m: [[e.lat, e.lon], ...e.pts].map(([a, o]) => toM(a * K, o * K))}));
const W = 240, H = 256, hex = h => [h >> 16, (h >> 8) & 255, h & 255];
const FILLC = {1: 0xd4d4d4, 2: 0xa2d683, 3: 0x82cbd5}, OLC = {2: 0x5f9e45, 3: 0x378b98};
const LINES = {4: [[3, 0x82cbd5]], 5: [[10, 0x202326], [7, 0xffc640]], 6: [[8, 0x3d4146], [5, 0xffffff]], 7: [[5, 0x6a6e73], [3, 0xffffff]], 8: [[2, 0x66615a]], 9: [[2, 0x202326]], 10: [[2, 0x7040b0]], 11: [[4, 0x3b1f6e], [2, 0xffffff]]};
function render(P, mode) { const img = new Uint8Array(W * H * 3).fill(255); const put = (x, y, c) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; };
  const fill = (p, c) => { for (let y = 0; y < H; y++) { const yc = y + .5, xs = []; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xa, ya] = p[i], [xb, yb] = p[j]; if ((ya > yc) !== (yb > yc)) xs.push(xa + (yc - ya) * (xb - xa) / (yb - ya)); } xs.sort((a, b) => a - b); for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.round(xs[k])); x < Math.min(W, Math.round(xs[k + 1])); x++) put(x, y, c); } };
  const line = (p, w, c) => { const r = w / 2; for (let i = 1; i < p.length; i++) { const [x0, y0] = p[i - 1], [x1, y1] = p[i], L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L)); for (let j = 0; j <= n; j++) { const x = x0 + (x1 - x0) * j / n, y = y0 + (y1 - y0) * j / n; if (w <= 1) put(x, y, c); else for (let dy = -r; dy < r; dy++) for (let dx = -r; dx < r; dx++) if (dx * dx + dy * dy <= r * r) put(x + dx, y + dy, c); } } };
  for (const c of [1, 2, 3]) for (const e of ents) if (e.c === c) { const sp = e.m.map(P); fill(sp, hex(FILLC[c])); if (mode === 'today' && c > 1 && e.ol) line([...sp, sp[0]], 1, hex(OLC[c])); }
  for (const c of [4, 9, 8, 10, 7, 6, 5, 11]) for (const [w, col] of LINES[c] || []) for (const e of ents) if (e.c === c) line(e.m.map(P), w, hex(col));
  line(RM.map(P), 6, hex(0xd0021b)); return img; }
function png(img, f) { const S = 2, w = W * S, h = H * S, raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const s = ((y / S | 0) * W + (x / S | 0)) * 3, d = y * (w * 3 + 1) + 1 + x * 3; raw[d] = img[s]; raw[d + 1] = img[s + 1]; raw[d + 2] = img[s + 2]; } }
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c >>> 1 ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(f, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])); }
// pick the route spot with the most green outline on screen
let best = null, acc = 0;
for (let i = 1; i < RM.length; i++) { const a = RM[i - 1], b = RM[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += L; if (acc < 150) continue; acc = 0;
  const hd = Math.atan2(b[0] - a[0], b[1] - a[1]), c = Math.cos(hd), s = Math.sin(hd), P = ([x, y]) => { const dx = x - b[0], dy = y - b[1]; return [120 + (dx * c - dy * s) / 2.5, 216 - (dx * s + dy * c) / 2.5]; };
  let n = 0; for (const e of ents) if (e.c === 2 && e.ol) for (const p of e.m.map(P)) if (p[0] >= 0 && p[0] < W && p[1] >= 0 && p[1] < H) n++;
  if (!best || n > best.n) best = {n, P}; }
for (const m of ['today', 'none']) png(render(best.P, m), `${process.argv[3]}_${m}.png`);
console.log('outline points on screen', best.n);
