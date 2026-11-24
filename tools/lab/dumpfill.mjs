// Dump projected fill rings per screen (detail: worst block per spot and heading; far: selected cells) for the C fill bench.
// Format: u32 screens; per screen: u32 rings; per ring: u16 n, u16 cls, n x (i16 x, i16 y).
import fs from 'node:fs';
const R = new URL('../../js/', import.meta.url).pathname;
const {decodeBlockD, isBlockD} = await import(R + 'map_codec.js'); const {readNativeRoute} = await import(R + 'native_route.js'); const {readSections} = await import(R + 'wayback_embed.js');
const {readFar} = await import(R + 'far_map.js'); const {greyCells} = await import(R + 'screen_proof.js');
const [,, inp, outp, mode] = process.argv;
const file = new Uint8Array(fs.readFileSync(inp)), secs = readSections(file), v = new DataView(file.buffer);
const route = readNativeRoute(file).map(r => r.point), lat0 = route[0][0], mE = 111320 * Math.cos(lat0 * Math.PI / 180), K = 180 / 2 ** 31, toM = (a, o) => [o * mE, a * 111320];
const RM = route.map(p => toM(...p));
const W = 240, H = 256, screens = [];
const P0 = (rider, h) => { const c = Math.cos(h), s = Math.sin(h); return ([x, y]) => [Math.round(120 + ((x - rider[0]) * c - (y - rider[1]) * s) / 2.5), Math.round(216 - ((x - rider[0]) * s + (y - rider[1]) * c) / 2.5)]; };
const vis = p => { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); } return !(x1 < -16 || x0 > W + 16 || y1 < -16 || y0 > H + 16); };
let rings;
if (mode === 'detail') { const mapAt = v.getUint32(0x5c, true), map = file.subarray(mapAt, Math.min(...secs.map(s => s.offset))), mv = new DataView(map.buffer, map.byteOffset);
  const blocks = []; for (let o = 4 + mv.getUint32(0, true); o + 4 <= map.length;) { const n = mv.getUint32(o, true); if (!n || o + 4 + n > map.length) break; const b = map.subarray(o + 4, o + 4 + n); if (isBlockD(b)) blocks.push(decodeBlockD(b)); o += 4 + n; }
  rings = blocks.map(ents => ents.filter(e => (e.style & 15) >= 1 && (e.style & 15) <= 3).sort((a, b) => (a.style & 15) - (b.style & 15)).map(e => ({c: (e.style & 15) | (((e.style & 15) > 1 && !(e.style & 0x400)) ? 16 : 0), m: [[e.lat, e.lon], ...e.pts].map(([a, o]) => toM(a * K, o * K))}))); }
const s4 = secs.find(s => s.type === 4), far = s4 && readFar(file.subarray(s4.offset, s4.offset + s4.size)), fr = far && far.frame;
const uToM = ([x, y]) => toM((y * 65536 / fr.latU + fr.lat0E7) / 1e7, (x * 65536 / fr.lonU + fr.lon0E7) / 1e7);
const mToU = ([x, y]) => [Math.floor((Math.round(x / mE * 1e7) - fr.lon0E7) * fr.lonU / 65536), Math.floor((Math.round(y / mN * 1e7) - fr.lat0E7) * fr.latU / 65536)], mN = 111320;
const fcells = far && new Map(far.cells.map(c => [c.key, c.items.filter(i => i.cls >= 8).map(i => ({c: i.cls, m: i.pts.map(uToM)}))]));
let acc = 0;
for (let i = 1; i < RM.length; i++) { const a = RM[i - 1], b = RM[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += L; if (acc < 300) continue; acc = 0;
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
  for (const d of mode === 'detail' ? [0] : [0, 700, 2200]) { const rider = [b[0] + uy * d, b[1] - ux * d];
    for (let hh = 0; hh < 8; hh++) { const h = hh * Math.PI / 4, P = P0(rider, h);
      if (mode === 'detail') { let best = null; for (const rs of rings) { const scr = rs.map(r => ({c: r.c, p: r.m.map(P)})).filter(r => vis(r.p)); const w = scr.reduce((s, r) => s + r.p.length, 0); if (!best || w > best.w) best = {w, scr}; } screens.push(best.scr); }
      else { const u = mToU(rider), sel = greyCells(u[0], u[1], hh * 45), scr = []; for (const k of sel) for (const it of fcells.get(k) || []) scr.push({c: it.c, p: it.m.map(P)}); screens.push(scr); } } } }
const parts = [Buffer.alloc(4)]; parts[0].writeUInt32LE(screens.length);
for (const s of screens) { const h = Buffer.alloc(4); h.writeUInt32LE(s.length); parts.push(h); for (const r of s) { const b = Buffer.alloc(4 + 4 * r.p.length); b.writeUInt16LE(r.p.length, 0); b.writeUInt16LE(r.c, 2); r.p.forEach(([x, y], k) => { b.writeInt16LE(Math.max(-32000, Math.min(32000, x)), 4 + 4 * k); b.writeInt16LE(Math.max(-32000, Math.min(32000, y)), 6 + 4 * k); }); parts.push(b); } }
fs.writeFileSync(outp, Buffer.concat(parts)); console.log(outp, 'screens', screens.length, 'rings', screens.reduce((s, x) => s + x.length, 0));
