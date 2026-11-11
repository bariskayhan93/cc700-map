// GPX -> complete CC700 route file (sections, turn icons, name images, map layer).
// Layout: header(0x80) | records | 16xFF | name images | 16xFF | u32 0x80 + 128-byte title | map section
import { fu, fs, fb, f32, u32le, sc, Bytes } from './pb.js';
import { hav, brg, adiff, frame } from './geo.js';
import { buildMapSection } from './mapsec.js';
// header template from a server route file, route-specific values cleared (all set in buildRoute)
const HEADER = Uint8Array.from(atob('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANAAAAAAAAAAAAAAD//wAAPv///wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAKVaVao='), c => c.charCodeAt(0));
export const TURN = { STRAIGHT: 0, LEFT: 1, SLIGHT_LEFT: 2, RIGHT: 3, SLIGHT_RIGHT: 4, UTURN: 5 };
const UNNAMED = { 1: 'Straße', 2: 'Straße', 3: 'Straße', 4: 'Zufahrt', 5: 'Radweg', 6: 'Schotterweg' };
export function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const num = (e, a) => parseFloat(e.getAttribute(a));
  const ele = e => { const x = e.getElementsByTagName('ele')[0]; return x ? parseFloat(x.textContent) : null; };
  let pts = [...doc.getElementsByTagName('trkpt')]; if (!pts.length) pts = [...doc.getElementsByTagName('rtept')];
  const wpts = [...doc.getElementsByTagName('wpt')].map(w => ({ lat: num(w, 'lat'), lon: num(w, 'lon'), name: (w.getElementsByTagName('name')[0] || {}).textContent || 'Checkpoint' }));
  const name = (doc.getElementsByTagName('name')[0] || {}).textContent || 'GPX route';
  return { name, wpts, pts: pts.map(p => [num(p, 'lat'), num(p, 'lon'), ele(p)]) };
}
function turnCode(a) {                        // a: degrees, + = right
  const x = Math.abs(a);
  if (x < 20) return [TURN.STRAIGHT, ''];
  if (x >= 160) return [TURN.UTURN, 'wenden'];
  if (x < 55) return [a > 0 ? TURN.SLIGHT_RIGHT : TURN.SLIGHT_LEFT, ''];
  return [a > 0 ? TURN.RIGHT : TURN.LEFT, x >= 120 ? (a > 0 ? 'scharf rechts' : 'scharf links') : ''];
}
// nearest road for each point (name, kind, roundabout)
function matchRoads(P, lines, F) {
  const G = new Map(), cell = 50;
  lines.forEach((L, li) => { for (let i = 1; i < L.pts.length; i++) {
    const a = F.m(...L.pts[i - 1]), b = F.m(...L.pts[i]);
    for (let x = Math.floor(Math.min(a[0], b[0]) / cell); x <= Math.floor(Math.max(a[0], b[0]) / cell); x++)
      for (let y = Math.floor(Math.min(a[1], b[1]) / cell); y <= Math.floor(Math.max(a[1], b[1]) / cell); y++) { const k = x + ',' + y; (G.get(k) || G.set(k, []).get(k)).push([li, a, b]); }
  } });
  return P.map((p, i) => {
    const [x, y] = F.m(p[0], p[1]), h = brg(P[Math.max(0, i - 1)], P[Math.min(P.length - 1, i + 1)]); let best = null;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const [li, a, b] of G.get((Math.floor(x / cell) + dx) + ',' + (Math.floor(y / cell) + dy)) || []) {
      const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1e-9, t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / L2));
      const d = Math.hypot(x - a[0] - t * vx, y - a[1] - t * vy); const sh = Math.atan2(vx, vy) * 180 / Math.PI;
      const ang = Math.abs(((h - sh) % 180 + 180) % 180); const pen = Math.min(ang, 180 - ang) / 6;   // prefer roads along the route
      if (d < 20 && (!best || d + pen < best[0])) best = [d + pen, li];
    }
    const L = best ? lines[best[1]] : null;
    return L ? { name: L.name, kind: L.kind & 0x7f, round: !!(L.kind & 0x80) } : { name: '', kind: 0, round: false };
  });
}
export function buildRoute(gpx, lines, opt) {
  const speed = (opt.speedKmh || 18) / 3.6, F = frame(gpx.pts[0][0]);
  // 1. clean points + cumulative distance
  const P = []; for (const p of gpx.pts) if (!P.length || hav(P.at(-1), p) >= 1) P.push(p);
  const D = [0]; for (let i = 1; i < P.length; i++) D.push(D[i - 1] + hav(P[i - 1], P[i]));
  const at = d => { let i = D.findIndex(x => x >= d); if (i < 0) return P.at(-1); if (i === 0) return P[0]; const f = (d - D[i - 1]) / ((D[i] - D[i - 1]) || 1); return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * f, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * f]; };
  const angle = i => adiff(brg(at(D[i]), at(D[i] + 25)), brg(at(D[i] - 25), at(D[i])));
  const road = matchRoads(P, lines, F);
  // smooth road names (majority of 5)
  const nm = road.map((_, i) => { const c = {}; for (let k = Math.max(0, i - 2); k <= Math.min(P.length - 1, i + 2); k++) c[road[k].name] = (c[road[k].name] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; });
  // 2. section boundaries: turns, name changes, checkpoints
  const A = P.map((_, i) => (D[i] > 10 && D[i] < D.at(-1) - 10) ? angle(i) : 0), cut = new Set();
  for (let i = 1; i < P.length - 1; i++) {
    if (Math.abs(A[i]) >= 30) { let m = true; for (let k = i - 1; k >= 0 && D[i] - D[k] < 20; k--) if (Math.abs(A[k]) > Math.abs(A[i])) m = false; for (let k = i + 1; k < P.length && D[k] - D[i] < 20; k++) if (Math.abs(A[k]) >= Math.abs(A[i])) m = false; if (m) cut.add(i); }
    if (nm[i] !== nm[i - 1] && nm[i] && nm[i - 1]) cut.add(i);
  }
  const wp = {}; for (const w of gpx.wpts || []) { let bi = -1, bd = 40; P.forEach((p, i) => { const d = hav(p, [w.lat, w.lon]); if (d < bd) { bd = d; bi = i; } }); if (bi > 0 && bi < P.length - 1) { cut.add(bi); wp[bi] = w.name; } }
  let B = [0, ...[...cut].sort((a, b) => a - b), P.length - 1].filter((v, k, a) => k === 0 || v !== a[k - 1]);
  B = B.filter((v, k) => k === 0 || k === B.length - 1 || (D[v] - D[B[k - 1]] >= 15 || wp[v]));
  for (let k = 0; k < B.length - 1; k++) while (B[k + 1] - B[k] > 150) B.splice(k + 1, 0, B[k] + 150), k++;   // record size limit
  // 3. sections
  const secs = [];
  for (let k = 0; k < B.length - 1; k++) {
    const i0 = B[k], i1 = B[k + 1], r = road[Math.min(i1 - 1, i0 + Math.floor((i1 - i0) / 2))];
    const [dir, q] = k + 1 < B.length - 1 ? turnCode(A[i1]) : [0, ''];
    secs.push({ i0, i1, name: nm[Math.floor((i0 + i1) / 2)] || UNNAMED[r.kind] || 'Weg', round: r.round, type: k + 1 < B.length - 1 ? 1 : 2, dir, q });
  }
  // text shown for a section: street name; unnamed ways by type; checkpoints. The map and the icon show the rest.
  secs.forEach((s, k) => {
    let t = s.name;
    if (s.round && secs[k + 1]) t = secs[k + 1].name;          // roundabout: show the exit road
    if (wp[s.i0]) t = '▶ ' + wp[s.i0];
    s.text = t;
  });
  // 4. points (elevation in cm, distance in cm, bearing float)
  const ele = P.map(p => p[2] == null ? 0 : p[2]);
  const pt = i => [...fs(1, sc(P[i][0])), ...fs(2, sc(P[i][1])), ...fs(3, Math.round(ele[i] * 100)), ...fu(4, 0), ...fu(5, Math.round(D[i] * 100)),
    ...f32(8, brg(P[i], P[Math.min(P.length - 1, i + 1)]))];
  const imgs = secs.map(s => opt.nameImage(s.text)); let off = 0;
  const recs = new Bytes();
  secs.forEach((s, k) => {
    const len = D[s.i1] - D[s.i0];
    const info = [...fu(1, Math.round(len)), ...fu(2, Math.round(len / speed)), ...fb(3, pt(s.i0)), ...fb(4, pt(s.i1)),
      ...fb(5, [...fu(1, s.type), ...fu(2, s.dir)]), ...fb(6, [...new TextEncoder().encode(s.name)]), ...fu(7, off)];
    off += imgs[k].length;
    const m = [...fb(1, info), ...fu(2, s.i1 - s.i0 + 1)]; for (let i = s.i0; i <= s.i1; i++) m.push(...fb(3, pt(i)));
    recs.push(u32le(m.length)).push(m);
  });
  // 5. assemble
  const out = new Bytes(); const h = HEADER.slice(); const dv = new DataView(h.buffer);
  dv.setUint32(0, Math.floor(Date.now() / 1000), true);
  let id = new TextEncoder().encode(String(opt.label || opt.id));   // 0x04..0x23: name shown in the CC700 route menu
  while (id.length > 31) id = new TextEncoder().encode([...new TextDecoder().decode(id)].slice(0, -1).join(''));
  h.fill(0, 4, 0x24); h.set(id, 4);
  const total = D.at(-1), ups = ele.slice(1).reduce((s, e, i) => s + Math.max(0, e - ele[i]), 0), downs = ele.slice(1).reduce((s, e, i) => s + Math.min(0, e - ele[i]), 0);
  dv.setUint32(0x24, Math.round(total / speed), true); dv.setUint32(0x28, Math.round(total), true);
  dv.setInt32(0x2c, Math.round(ups * 100), true); dv.setInt32(0x30, Math.round(downs * 100), true);
  dv.setUint16(0x34, Math.max(0, Math.min(65535, Math.round(Math.min(...ele) * 100))), true); dv.setUint16(0x36, Math.max(0, Math.min(65535, Math.round(Math.max(...ele) * 100))), true);
  dv.setUint32(0x38, Math.max(0, Math.round(Math.min(...ele) * 100)), true); dv.setUint32(0x40, secs.length - 1, true); dv.setUint16(0x46, secs.length, true);
  const la = P.map(p => p[0]), lo = P.map(p => p[1]);
  dv.setInt32(0x48, sc((Math.min(...la) + Math.max(...la)) / 2), true); dv.setInt32(0x4c, sc((Math.min(...lo) + Math.max(...lo)) / 2), true);
  out.push(h).push(recs.bytes).push(new Array(16).fill(0xff));
  const base = out.n; dv.setUint32(0x60, base, true); dv.setUint32(0x64, base, true);
  imgs.forEach(b => out.push(b));
  const title = new Uint8Array(128); let tb = new TextEncoder().encode(String(opt.title || opt.id));
  while (tb.length > 127) tb = new TextEncoder().encode([...new TextDecoder().decode(tb)].slice(0, -1).join(''));   // cut on a character boundary
  title.set(tb);
  out.push(new Array(16).fill(0xff)).push(u32le(0x80)).push(title);
  while (out.n % 4) out.push([0]);
  // 6. map layer
  const sections = secs.map(s => { const a = []; for (let i = s.i0; i <= s.i1; i++) a.push([P[i][0], P[i][1], D[i] * 100]); return a; });
  const map = buildMapSection(sections, lines.map(L => ({ ...L, box: box(L.pts, F) })), F);
  const ioa = out.n; out.push(map.bytes);
  const file = out.bytes.slice(); new DataView(file.buffer).setUint32(0x5c, ioa, true); file.set(h.subarray(0, 0x5c), 0); file.set(h.subarray(0x60, 0x80), 0x60);
  const padded = new Uint8Array(Math.ceil(file.length / 4096) * 4096); padded.set(file);
  return { file: padded, sections: secs, distance: total, mapBlocks: map.blocks, maxBlock: map.maxBlock };
}
function box(pts, F) { let b = [1e18, 1e18, -1e18, -1e18]; for (const p of pts) { const [x, y] = F.m(p[0], p[1]); b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]; } return b; }
