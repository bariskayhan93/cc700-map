// Per-frame far-map cell costs in unit draw order (cells nearest first; groups by class as stored), for heading sweeps.
import fs from 'node:fs';
const R = new URL('../../js/', import.meta.url).pathname;
const {readFar, FAR} = await import(R + 'far_map.js'); const {readNativeRoute} = await import(R + 'native_route.js');
const {readSections} = await import(R + 'wayback_embed.js'); const {greyCells} = await import(R + 'screen_proof.js');
const file = new Uint8Array(fs.readFileSync(process.argv[2])), OUT = process.argv[3];
const secs = readSections(file), s4 = secs.find(s => s.type === 4), far = readFar(file.subarray(s4.offset, s4.offset + s4.size)), fr = far.frame;
const route = readNativeRoute(file).map(r => r.point), lat0 = route[0][0], mE = 111320 * Math.cos(lat0 * Math.PI / 180), mN = 111320;
const toM = (la, lo) => [lo * mE, la * mN], RM = route.map(p => toM(...p));
const uToM = ([x, y]) => toM((y * 65536 / fr.latU + fr.lat0E7) / 1e7, (x * 65536 / fr.lonU + fr.lon0E7) / 1e7);
const mToU = ([x, y]) => [Math.floor((Math.round(x / mE * 1e7) - fr.lon0E7) * fr.lonU / 65536), Math.floor((Math.round(y / mN * 1e7) - fr.lat0E7) * fr.latU / 65536)];
const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)); return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); };
const dRoute = p => { let b = 1e9; for (let i = 1; i < RM.length; i++) b = Math.min(b, segD(p, RM[i - 1], RM[i])); return b; };
const FW = {[FAR.MAIN]: [4], [FAR.MINOR]: [6, 3], [FAR.CYCLE]: [2], [FAR.TRACK]: [2], [FAR.PATH]: [1], [FAR.WATERLINE]: [2]};
const cells = new Map(far.cells.map(c => [c.key, c.items.map(i => ({cls: i.cls, pts: i.pts.map(uToM)}))]));
const SW = 240, SH = 256;
const proj = (rider, head) => { const c = Math.cos(head * Math.PI / 180), s = Math.sin(head * Math.PI / 180);
  return ([x, y]) => { const dx = x - rider[0], dy = y - rider[1]; return [120 + (dx * c - dy * s) / 2.5, 216 - (dx * s + dy * c) / 2.5]; }; };
function fill(mask, p) { let n = 0; for (let y = 0; y < SH; y++) { const yc = y + .5, xs = [];
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xa, ya] = p[i], [xb, yb] = p[j]; if ((ya > yc) !== (yb > yc)) xs.push(xa + (yc - ya) * (xb - xa) / (yb - ya)); }
  xs.sort((a, b) => a - b); for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - .5)); x < Math.min(SW, xs[k + 1] - .5); x++) { n++; if (mask) mask[y * SW + x] = 1; } } return n; }
const work = (p, w) => { let s = 0; for (let i = 1; i < p.length; i++) s += (Math.max(Math.abs(p[i][0] - p[i - 1][0]), Math.abs(p[i][1] - p[i - 1][1])) + 1) * w; if (w >= 3) s += p.length * w * w; return s; };
function frame(rider, head) {
  const P = proj(rider, head), u = mToU(rider), sel = greyCells(u[0], u[1], ((Math.round(head) % 360) + 360) % 360);
  const rows = new Set(sel.map(k => k >>> 16)).size, out = [];
  for (const k of sel) {
    const cx = (k & 0xffff) * 4096, cy = (k >>> 16) * 4096, sq = [[cx, cy], [cx + 4096, cy], [cx + 4096, cy + 4096], [cx, cy + 4096]].map(uToM).map(P);
    const area = fill(null, sq), items = cells.get(k) || [], groups = new Map(), um = new Uint8Array(SW * SH);
    for (const it of items) { const s = it.pts.map(P), g = groups.get(it.cls) || groups.set(it.cls, {cls: it.cls, n: 0, px: 0, upx: 0}).get(it.cls); g.n++;
      if (it.cls >= 8) { const before = um.reduce((a, b) => a + b, 0); g.px += fill(um, s); g.upx += um.reduce((a, b) => a + b, 0) - before; } else for (const w of FW[it.cls] || [2]) g.px += work(s, w); }
    out.push({key: k, area, body: items.length > 0, groups: [...groups.values()].map(g => [g.cls, g.n, Math.round(g.px), Math.round(g.cls >= 8 ? g.upx : g.px)])});
  }
  return {rows, cells: out};
}
const offs = [0, 300, 700, 1000, 1500, 2200, 3000], res = [];
let acc = 0, spot = 0;
for (let i = 1; i < RM.length; i++) {
  const a = RM[i - 1], b = RM[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += L; if (acc < 600) continue; acc = 0; spot++;
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
  for (const d of offs) for (const side of [1, -1]) {
    const p = [b[0] + side * uy * d, b[1] - side * ux * d]; if (Math.abs(dRoute(p) - d) > Math.max(60, d * 0.15)) continue;
    const sweep = []; for (let h = 0; h < 360; h += 15) sweep.push(frame(p, h));
    res.push({spot, d, side, sweep});
  }
}
fs.writeFileSync(OUT, JSON.stringify(res)); console.log(res.length, 'spots x 24 headings');
