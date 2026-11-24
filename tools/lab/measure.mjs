// Per-screen work of the detail map and the far map at rider positions beside the route (host model, not unit time).
import fs from 'node:fs';
const R = new URL('../../js/', import.meta.url).pathname;
const {readFar, FAR} = await import(R + 'far_map.js'); const {decodeBlockD, isBlockD} = await import(R + 'map_codec.js');
const {readNativeRoute} = await import(R + 'native_route.js'); const {readSections} = await import(R + 'wayback_embed.js');
const {greyCells} = await import(R + 'screen_proof.js');
const file = new Uint8Array(fs.readFileSync(process.argv[2])), OUT = process.argv[3];
const secs = readSections(file), get = t => secs.find(s => s.type === t);
const route = readNativeRoute(file).map(r => r.point);
const v = new DataView(file.buffer), mapAt = v.getUint32(0x5c, true), mapEnd = secs.length ? Math.min(...secs.map(s => s.offset)) : file.length;
const map = file.subarray(mapAt, mapEnd), mv = new DataView(map.buffer, map.byteOffset), blocks = [];
for (let o = 4 + mv.getUint32(0, true); o + 4 <= map.length;) { const n = mv.getUint32(o, true); if (!n || o + 4 + n > map.length) break; const b = map.subarray(o + 4, o + 4 + n); if (isBlockD(b)) blocks.push({bytes: n, ents: decodeBlockD(b)}); o += 4 + n; }
const fs4 = get(4), far = fs4 ? readFar(file.subarray(fs4.offset, fs4.offset + fs4.size)) : null;
const K = 180 / 2 ** 31, lat0 = route[0][0], mE = 111320 * Math.cos(lat0 * Math.PI / 180), mN = 111320;
const toM = (la, lo) => [lo * mE, la * mN];
const routeM = route.map(p => toM(...p));
const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)); return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); };
const dRoute = p => { let b = 1e9; for (let i = 1; i < routeM.length; i += 1) b = Math.min(b, segD(p, routeM[i - 1], routeM[i])); return b; };
// detail entries in metres with class, widths
const W = {4: [3], 5: [10, 7], 6: [8, 5], 7: [5, 3], 8: [2], 9: [2], 10: [2], 11: [4, 2]};
const det = blocks.map(b => b.ents.filter(e => e.style && (e.style & 15) !== 15 && (e.style & 15) !== 12 && (e.style & 15) !== 13 && (e.style & 15) !== 14).map(e => {
  const c = e.style & 15, pts = [[e.lat, e.lon], ...e.pts].map(([a, o]) => toM(a * K, o * K));
  const cen = pts[Math.floor(pts.length / 2)], far150 = c === 6 && dRoute(cen) > 150;
  return {c, pts, fill: c <= 3, w: far150 ? [6, 3] : c === 7 && dRoute(cen) > 150 ? [4, 2] : W[c] || [2], dist: dRoute(cen)};
}));
// far items in metres
const fr = far?.frame, uToM = fr && (([x, y]) => { const lo = (x * 65536 / fr.lonU + fr.lon0E7) / 1e7, la = (y * 65536 / fr.latU + fr.lat0E7) / 1e7; return toM(la, lo); });
const FW = {[FAR.MAIN]: [4], [FAR.MINOR]: [6, 3], [FAR.CYCLE]: [2], [FAR.TRACK]: [2], [FAR.PATH]: [1], [FAR.WATERLINE]: [2]};
const DROP = +(process.env.DROP || 0);
const farCells = new Map((far?.cells || []).map(c => [c.key, c.items.map(i => ({cls: i.cls, fill: i.cls >= 8, w: FW[i.cls] || [2], pts: i.pts.map(uToM)}))]));
const dropped = new Map();
if (DROP) for (const [k, items] of farCells) { const cx = (k & 0xffff) * 4096 + 2048, cy = (k >>> 16) * 4096 + 2048, cm = uToM([cx, cy]);
  if (dRoute(cm) <= DROP) { dropped.set(k, items.filter(i => i.fill)); farCells.set(k, items.filter(i => !i.fill)); } }
const mToU = fr && (([x, y]) => { const lo = x / mE, la = y / mN; return [Math.floor((Math.round(lo * 1e7) - fr.lon0E7) * fr.lonU / 65536), Math.floor((Math.round(la * 1e7) - fr.lat0E7) * fr.latU / 65536)]; });
// screen: rider at (120,216), heading-up, 2.5 m/px
const SW = 240, SH = 256;
function proj(rider, head) { const c = Math.cos(head * Math.PI / 180), s = Math.sin(head * Math.PI / 180);
  return ([x, y]) => { const dx = x - rider[0], dy = y - rider[1], r = dx * c - dy * s, f = dx * s + dy * c; return [120 + r / 2.5, 216 - f / 2.5]; }; }
const work = (p, w) => { let s = 0; for (let i = 1; i < p.length; i++) { const dx = Math.abs(p[i][0] - p[i - 1][0]), dy = Math.abs(p[i][1] - p[i - 1][1]); s += (Math.max(dx, dy) + 1) * w; } if (w >= 3) s += p.length * w * w; return s; };
const onScreen = p => { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return !(x1 < -16 || y1 < -16 || x0 > SW + 16 || y0 > SH + 16); };
function fillMask(mask, p) { let n = 0; for (let y = 0; y < SH; y++) { const yc = y + .5, xs = [];
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xa, ya] = p[i], [xb, yb] = p[j]; if ((ya > yc) !== (yb > yc)) xs.push(xa + (yc - ya) * (xb - xa) / (yb - ya)); }
    xs.sort((a, b) => a - b); for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - .5)); x < Math.min(SW, xs[k + 1] - .5); x++) { n++; mask[y * SW + x] = 1; } } return n; }
function lineMask(mask, p, w) { const r = w / 2; for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i];
    for (let y = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r)); y <= Math.min(SH - 1, Math.ceil(Math.max(a[1], b[1]) + r)); y++)
      for (let x = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r)); x <= Math.min(SW - 1, Math.ceil(Math.max(a[0], b[0]) + r)); x++) if (segD([x + .5, y + .5], a, b) <= r) mask[y * SW + x] = 1; } }
function frame(rider, head) {
  const P = proj(rider, head), o = {};
  // detail: the one block with most on-screen work (upper bound for the loaded block)
  let best = null;
  for (const ents of det) { let lw = 0, fill = 0, n = 0, pts = 0, fillV = 0; const fm = new Uint8Array(SW * SH), lm = new Uint8Array(SW * SH);
    for (const e of ents) { const s = e.pts.map(P); if (!onScreen(s)) continue; n++; pts += s.length;
      if (e.fill) { fill += fillMask(fm, s); fillV += s.length; } else { for (const w of e.w) lw += work(s, w); lineMask(lm, s, e.w[0]); } }
    if (!best || lw + fill > best.lw + best.fill) best = {lw, fill, n, pts, fm, lm, fillV}; }
  o.det = best;
  // far: unit cell selection, nearest 20
  const u = mToU(rider), sel = greyCells(u[0], u[1], ((Math.round(head) % 360) + 360) % 360), body = sel.filter(k => farCells.has(k));
  let lw = 0, fill = 0, n = 0, pts = 0, nearFill = 0, rawFill = 0, areas = 0; const ffm = new Uint8Array(SW * SH), flm = new Uint8Array(SW * SH);
  for (const k of body) for (const it of farCells.get(k)) { const s = it.pts.map(P); n++; pts += s.length;
    if (it.fill) { rawFill += fillMask(ffm, s); areas++; } else { for (const w of it.w) lw += work(s, w); lineMask(flm, s, it.w[0]); } }
  const dm = new Uint8Array(SW * SH); for (const k of sel) for (const it of dropped.get(k) || []) fillMask(dm, it.pts.map(P));
  let holes = 0; for (let i = 0; i < SW * SH; i++) if (dm[i] && !ffm[i] && !best.fm[i]) holes++;
  let uLine = 0, uFill = 0; for (let i = 0; i < SW * SH; i++) { if (flm[i] || best.lm[i]) uLine++; if (ffm[i] || best.fm[i]) uFill++; }
  let underFill = 0, fillHidden = 0, lineHidden = 0, farLinePx = 0, farFillPx = 0;
  for (let i = 0; i < SW * SH; i++) { if (ffm[i]) { farFillPx++; if (best.fm[i]) fillHidden++; } if (flm[i]) { farLinePx++; if (best.fm[i] || best.lm[i]) lineHidden++; if (best.fm[i] && !best.lm[i]) underFill++; } }
  const k512 = new Set(body.map(k => ((k >>> 17) << 16) | ((k & 0xffff) >> 1))), rows512 = new Set(sel.map(k => k >>> 17));
  o.far = {lw, fill: farFillPx, rawFill, areas, reads512: 2 + rows512.size + k512.size, n, pts, reads: 2 + new Set(sel.map(k => k >>> 16)).size + body.length, cells: body.length, uLine, uFill, underFill, holes, fillHidden, lineHidden, farLinePx};
  return o;
}
// rider positions: every 200 m along the route, offsets both sides, 4 headings
const offs = [0, 100, 200, 300, 500, 700, 1000, 1500, 2000, 3000], rows = [];
let acc = 0;
for (let i = 1; i < routeM.length; i++) {
  const a = routeM[i - 1], b = routeM[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += L; if (acc < 200) continue; acc = 0;
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, h = Math.atan2(ux, uy) * 180 / Math.PI;
  for (const d of offs) for (const side of [1, -1]) {
    const p = [b[0] + side * uy * d, b[1] - side * ux * d], real = dRoute(p);
    if (Math.abs(real - d) > Math.max(60, d * 0.15)) continue;   // the route bends back: skip
    for (const hd of [h, h + 180, h + 90, h - 90]) rows.push({d, ...frame(p, hd)});
  }
}
fs.writeFileSync(OUT, JSON.stringify(rows.map(r => ({d: r.d, det: {lw: r.det.lw, fill: r.det.fill, raw: r.det.raw, n: r.det.n, pts: r.det.pts, fillV: r.det.fillV}, far: r.far}))));
console.log(rows.length, 'frames', blocks.length, 'blocks', far?.cells.length, 'far cells');
