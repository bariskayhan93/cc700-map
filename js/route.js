// GPX -> complete CC700 route file (sections, turn icons, name images, map layer).
// Layout: header(0x80) | records | 16xFF | name images | 16xFF | u32 0x80 + 128-byte title | map section
import { fu, fs, fb, f32, u32le, sc, SC, Bytes } from './pb.js';
import { hav, brg, adiff, frame, rdp, geohash } from './geo.js';
import { buildMapSection, buildStyledSection } from './mapsec.js';
export const lo_hi = a => { let lo = Infinity, hi = -Infinity; for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; };   // no spread: long routes exceed the argument limit on phones
// header template from a server route file, route-specific values cleared (all set in buildRoute)
const HEADER = Uint8Array.from(atob('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANAAAAAAAAAAAAAAD//wAAPv///wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAKVaVao='), c => c.charCodeAt(0));
export const TURN = { STRAIGHT: 0, LEFT: 1, SLIGHT_LEFT: 2, RIGHT: 3, SLIGHT_RIGHT: 4, UTURN: 5 };
const THEN = 50, THEN_WORD = { 1: 'left', 2: 'slight left', 3: 'right', 4: 'slight right', 5: 'U-turn' };
// route name in the header and title: ASCII only (a GPX name with 'ü' stopped the device at start, 2026-11-12)
const ascii = t => String(t).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss').normalize('NFD').replace(/[^\x20-\x7e]/g, '');
const UNNAMED = { 1: 'Straße', 2: 'Straße', 3: 'Straße', 4: 'Zufahrt', 5: 'Radweg', 6: 'Schotterweg', 7: 'Fußweg' };
export function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const num = (e, a) => parseFloat(e.getAttribute(a));
  const ele = e => { const x = e.getElementsByTagName('ele')[0]; return x ? parseFloat(x.textContent) : null; };
  let pts = [...doc.getElementsByTagName('trkpt')]; if (!pts.length) pts = [...doc.getElementsByTagName('rtept')];
  const wpts = [...doc.getElementsByTagName('wpt')].map(w => ({ lat: num(w, 'lat'), lon: num(w, 'lon'), name: (w.getElementsByTagName('name')[0] || {}).textContent || 'Checkpoint' }));
  // route name: metadata > trk > rte; never a waypoint name (in a GPX without <metadata> the <wpt> come first)
  const own = tag => { for (const e of doc.getElementsByTagName(tag)) for (const c of e.children) if (c.localName === 'name' && c.textContent.trim()) return c.textContent.trim(); return ''; };
  const name = own('metadata') || own('trk') || own('rte') || 'GPX route';
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
  lines.forEach((L, li) => { if ((L.kind & 0x7f) === 8) return;      // motorways are not ridden: no name match
    for (let i = 1; i < L.pts.length; i++) {
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
// is there a road branching off the track near point i? (junction = another road that leaves the track corridor)
function junctionAt(i, P, D, lines, F, grid) {
  const [x, y] = F.m(P[i][0], P[i][1]), cell = 50, near = new Set();
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const [li, a, b] of grid.get((Math.floor(x / cell) + dx) + ',' + (Math.floor(y / cell) + dy)) || []) {
    const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1e-9, t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / L2));
    if (Math.hypot(x - a[0] - t * vx, y - a[1] - t * vy) < 25) near.add(li);
  }
  if (!near.size) return false;
  const T = []; for (let k = i; k >= 0 && D[i] - D[k] < 150; k--) T.push(F.m(P[k][0], P[k][1])); for (let k = i + 1; k < P.length && D[k] - D[i] < 150; k++) T.push(F.m(P[k][0], P[k][1]));
  const offTrack = (px, py) => { let m = 1e9; for (let k = 1; k < T.length; k++) { const a = T[k - 1], b = T[k], vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1e-9, t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / L2)); m = Math.min(m, Math.hypot(px - a[0] - t * vx, py - a[1] - t * vy)); } return m; };
  for (const li of near) for (const q of lines[li].pts) {           // a vertex of this road within 80 m of the point, but 20 m away from the track
    const [px, py] = F.m(q[0], q[1]); if (Math.hypot(px - x, py - y) < 80 && offTrack(px, py) > 20) return true;
  }
  return false;
}
function roadGrid(lines, F) {
  const G = new Map(), cell = 50;
  lines.forEach((L, li) => { for (let i = 1; i < L.pts.length; i++) {
    const a = F.m(...L.pts[i - 1]), b = F.m(...L.pts[i]);
    for (let x = Math.floor(Math.min(a[0], b[0]) / cell); x <= Math.floor(Math.max(a[0], b[0]) / cell); x++)
      for (let y = Math.floor(Math.min(a[1], b[1]) / cell); y <= Math.floor(Math.max(a[1], b[1]) / cell); y++) { const k = x + ',' + y; (G.get(k) || G.set(k, []).get(k)).push([li, a, b]); }
  } });
  return G;
}
// Decision points from the road network, not only from the track shape. A prompt is needed where the rider has a choice
// and the track does not take the obvious way: another branch is straighter than the taken one (forks, bridge ramps),
// or the track turns 45° or more at a junction (T-junctions). A bend of a road without a junction needs no prompt.
// Bike scale: such points can be 10 to 30 m apart (commute 2026-11-12, lake: right onto the bridge, left after it).
// -> { points: [{ d, a }], judge(d) -> angle or null, matched(d) -> bool }   (d: m along the track, a: deg, + = right)
export function decisionPoints(P, D, lines, F, grid) {
  const STEP = 2, total = D.at(-1), cell = 50, at = d => { let lo = 1, hi = D.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (D[m] < d) lo = m + 1; else hi = m; } const i = lo;
    const f = Math.max(0, Math.min(1, (d - D[i - 1]) / ((D[i] - D[i - 1]) || 1)));
    return F.m(P[i - 1][0] + (P[i][0] - P[i - 1][0]) * f, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * f); };
  const hdg = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI;      // compass heading in the local frame
  const segs = (x, y) => { const out = []; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const s of grid.get((Math.floor(x / cell) + dx) + ',' + (Math.floor(y / cell) + dy)) || []) out.push(s); return out; };
  const foot = (x, y, a, b) => { const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1e-9, t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / L2));
    return Math.hypot(x - a[0] - t * vx, y - a[1] - t * vy); };
  const ridable = li => (lines[li].kind & 0x7f) !== 8;
  const LM = new Map(), local = li => { let v = LM.get(li); if (!v) { const q = lines[li].pts.map(x => F.m(x[0], x[1])), s = [0];
    for (let i = 1; i < q.length; i++) s.push(s[i - 1] + Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1])); LM.set(li, v = [q, s]); } return v; };
  const along = (q, s, d) => { let i = 1; while (i < q.length - 1 && s[i] < d) i++; const f = Math.max(0, Math.min(1, (d - s[i - 1]) / ((s[i] - s[i - 1]) || 1)));
    return [q[i - 1][0] + (q[i][0] - q[i - 1][0]) * f, q[i - 1][1] + (q[i][1] - q[i - 1][1]) * f]; };
  const branches = (li, p) => {                                                     // headings of a road away from its point nearest to p
    const [q, s] = local(li); let best = [1e9, 0];
    for (let i = 1; i < q.length; i++) { const a = q[i - 1], b = q[i], vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1e-9, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2));
      const dd = Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy); if (dd < best[0]) best = [dd, s[i - 1] + t * (s[i] - s[i - 1])]; }
    const f = best[1], o = along(q, s, f), out = [];
    if (s.at(-1) - f > 6) out.push(hdg(o, along(q, s, Math.min(s.at(-1), f + 12))));
    if (f > 6) out.push(hdg(o, along(q, s, Math.max(0, f - 12))));
    return out; };
  // 1. map matching every 2 m: nearest ridable road along the direction of travel
  const M = [], runs = [];
  for (let d = 0; d + STEP <= total; d += STEP) {
    const [x, y] = at(d), h = hdg([x, y], at(d + STEP)); let best = null;
    for (const [li, a, b] of segs(x, y)) { if (!ridable(li)) continue;
      const dd = foot(x, y, a, b); if (dd >= 14) continue; const sh = hdg(a, b), da = Math.abs(((h - sh) % 180 + 270) % 180 - 90);
      const sc = dd + da * 0.25; if (!best || sc < best[0]) best = [sc, li]; }
    M.push(best ? best[1] : -1); if (!best) continue; const r = runs.at(-1);
    if (r && r.li === best[1]) r.d1 = d; else runs.push({ li: best[1], d0: d, d1: d });
  }
  const matched = d => { const k = Math.round(d / STEP); for (let j = k - 5; j <= k + 5; j++) if (M[j] === -1) return false; return k >= 0 && k < M.length; };
  // 2. the choice at a point: branches of all roads that pass within 8 m, relative to the arriving direction
  const judge = d => {
    if (d < 15 || d > total - 15) return null;
    const p = at(d), hin = hdg(at(d - 15), p), tk = adiff(hdg(p, at(d + 15)), hin), alts = [];
    const near = new Set(); for (const [li, a, b] of segs(p[0], p[1])) if (ridable(li) && foot(p[0], p[1], a, b) < 8) near.add(li);
    for (const li of near) for (const q of branches(li, p)) alts.push(adiff(q, hin));   // per road: onwards and back, 12 m along it
    // A single road's forward and backward arms cannot form a junction.
    // Recording heading error must not turn its own forward arm into an exit.
    const arms = []; for (const q of alts) if (!arms.some(a => Math.abs(adiff(a, q)) < 20)) arms.push(q);
    if (arms.length < 3) return null;
    const other = alts.filter(q => Math.abs(q) < 150 && Math.abs(adiff(q, tk)) > 20);
    if (!other.length) return null;                                                    // no choice: the road only bends
    if (other.some(q => Math.abs(q) < Math.abs(tk) + 10)) return Math.abs(tk) >= 20 ? tk : (tk >= 0 ? 25 : -25);   // another way is as straight or straighter: at least "slight"
    return Math.abs(tk) >= 45 ? tk : null;                                             // the straightest way: only a real turn needs a prompt
  };
  const R = runs.filter(r => r.d1 - r.d0 >= 6), points = [];
  for (let k = 1; k < R.length; k++) { if (R[k].li === R[k - 1].li) continue; const d = R[k - 1].d1, a = judge(d); if (a !== null) points.push({ d, a }); }
  return { points, judge, matched };
}
const short = t => t.replace(/straße\b/g, 'str.').replace(/Straße\b/g, 'Str.').replace(/strasse\b/g, 'str.').replace(/Strasse\b/g, 'Str.');
export function buildRoute(gpx, allLines, opt) {
  const lines = allLines.filter(L => !(L.fl & 256));   // 512 (dual-carriageway centreline) stays here: turns and the original map use it   // detail ways (park footways, short paths, cycle tracks next to a street): map only, not for turns
  const speed = (opt.speedKmh || 18) / 3.6, F = frame(gpx.pts[0][0]);
  // 1. clean points + cumulative distance
  const P0 = []; for (const p of gpx.pts) if (!P0.length || hav(P0.at(-1), p) >= 1) P0.push(p);
  const P = [];                                  // shape kept within 2.5 m (points are added again in the file, see GAP)
  // long straight pieces get a point every 100 m: sections can only end at a track point (a GPX with 2 points gave one
  // section with 180 file points, above the record limit of 150)
  for (const q of rdp(P0, 2.5, F.m)) { const r = P.at(-1), L = r ? hav(r, q) : 0, n = Math.floor(L / 100);
    for (let k = 1; k <= n; k++) { const f = k / (n + 1); P.push([r[0] + (q[0] - r[0]) * f, r[1] + (q[1] - r[1]) * f, r[2] == null || q[2] == null ? null : r[2] + (q[2] - r[2]) * f]); }
    P.push(q); }
  let D = [0]; for (let i = 1; i < P.length; i++) D.push(D[i - 1] + hav(P[i - 1], P[i]));
  const grid = roadGrid(lines, F);
  // decision points from the road network; each gets a track point of its own, so a section can end exactly there
  const NET = opt.classic || !lines.length ? null : decisionPoints(P, D, lines, F, grid), DP = NET ? NET.points : [], dpAngle = new Map();
  for (const q of DP) { let i = D.findIndex(x => x >= q.d); if (i <= 0) continue;
    if (D[i] - q.d > 1 && q.d - D[i - 1] > 1) { const f = (q.d - D[i - 1]) / (D[i] - D[i - 1]), a = P[i - 1], b = P[i];
      P.splice(i, 0, [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] == null || b[2] == null ? null : a[2] + (b[2] - a[2]) * f]); D.splice(i, 0, q.d); }
    else if (q.d - D[i - 1] <= 1) i--;
    q.i = i; }
  D = [0]; for (let i = 1; i < P.length; i++) D.push(D[i - 1] + hav(P[i - 1], P[i]));
  for (const q of DP) if (q.i !== undefined) { let i = q.i; while (i + 1 < P.length && Math.abs(D[i + 1] - q.d) < Math.abs(D[i] - q.d)) i++; dpAngle.set(i, q.a); }
  const at = d => { let i = D.findIndex(x => x >= d); if (i < 0) return P.at(-1); if (i === 0) return P[0]; const f = (d - D[i - 1]) / ((D[i] - D[i - 1]) || 1); return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * f, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * f]; };
  const road = matchRoads(P, lines, F);
  // smooth road names (majority of 5)
  const nm = road.map((_, i) => { const c = {}; for (let k = Math.max(0, i - 2); k <= Math.min(P.length - 1, i + 2); k++) c[road[k].name] = (c[road[k].name] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; });
  const T = Object.assign({ win: 25, sep: 12, hi: 35, lo: 20, jog: 45, jogWin: 10, jogSep: 8, minSec: 5 }, opt.turn);   // tuned against server (Mapbox) turns
  // Average only the heading probes: recording jitter must not rotate a short
  // approach chord. The supplied route geometry and elevation stay untouched.
  const courseAt = d => { const a = at(d - 6), b = at(d), c = at(d + 6); return [(a[0] + 2*b[0] + c[0])/4, (a[1] + 2*b[1] + c[1])/4]; };
  const angle = (i, w) => adiff(brg(courseAt(D[i]), courseAt(D[i] + w)), brg(courseAt(D[i] - w), courseAt(D[i])));
  const inner = i => D[i] > 10 && D[i] < D.at(-1) - 10;
  const A = P.map((_, i) => inner(i) ? angle(i, T.win) : 0), J = P.map((_, i) => inner(i) ? angle(i, T.jogWin) : 0);
  const peak = (X, i, sep) => { for (let k = i - 1; k >= 0 && D[i] - D[k] < sep; k--) if (Math.abs(X[k]) > Math.abs(X[i])) return false;
    for (let k = i + 1; k < P.length && D[k] - D[i] < sep; k++) if (Math.abs(X[k]) >= Math.abs(X[i])) return false; return true; };
  const junctionNear = i => { for (let k = i; k >= 0 && D[i] - D[k] <= 20; k--) if (junctionAt(k, P, D, lines, F, grid)) return true;
    for (let k = i + 1; k < P.length && D[k] - D[i] <= 20; k++) if (junctionAt(k, P, D, lines, F, grid)) return true; return false; };
  const cut = new Set(), turnAngle = {};
  for (let i = 1; i < P.length - 1; i++) {
    const a = Math.abs(A[i]);
    if (a >= T.lo && peak(A, i, T.sep) && (a >= T.hi || junctionNear(i))) { cut.add(i); turnAngle[i] = A[i]; }
    else if (Math.abs(J[i]) >= T.jog && peak(J, i, T.jogSep) && ![...cut].some(c => Math.abs(D[c] - D[i]) < T.jogSep)) { cut.add(i); turnAngle[i] = J[i]; }   // jogs, close double turns
    if (nm[i] !== nm[i - 1] && nm[i] && nm[i - 1]) cut.add(i);
  }
  // decision points win over shape turns and name changes close to them (one junction = one section end)
  // (angle: the larger of the two when they agree, the 15 m chord of the junction test cuts corners)
  for (const [i, a] of dpAngle) { let ang = a;
    for (const c of [...cut]) if (Math.abs(D[c] - D[i]) < (turnAngle[c] !== undefined ? 12 : 15)) { if (turnAngle[c] !== undefined && turnAngle[c] * a > 0 && Math.abs(turnAngle[c]) > Math.abs(ang)) ang = turnAngle[c]; cut.delete(c); delete turnAngle[c]; }
    cut.add(i); turnAngle[i] = ang; }
  // shape turns on matched roads need a choice at the junction; a bend of the road or cycleway is not a turn
  if (NET) for (const c of [...cut]) if (turnAngle[c] !== undefined && !dpAngle.has(c) && NET.matched(D[c]) && Math.abs(turnAngle[c]) < 160) {
    let keep = false; for (let e = -10; e <= 10 && !keep; e += 2) keep = NET.judge(D[c] + e) !== null;
    if (!keep) { delete turnAngle[c]; cut.delete(c); if (nm[c] !== nm[c - 1] && nm[c] && nm[c - 1]) cut.add(c); }
  }
  const wp = {}; for (const w of gpx.wpts || []) { let bi = -1, bd = 40; P.forEach((p, i) => { const d = hav(p, [w.lat, w.lon]); if (d < bd) { bd = d; bi = i; } }); if (bi > 0 && bi < P.length - 1) { cut.add(bi); wp[bi] = w.name; } }
  let B = [0, ...[...cut].sort((a, b) => a - b), P.length - 1].filter((v, k, a) => k === 0 || v !== a[k - 1]);
  B = B.filter((v, k) => k === 0 || k === B.length - 1 || (D[v] - D[B[k - 1]] >= (turnAngle[v] !== undefined ? T.minSec : 15) || wp[v]));
  // a section end without a turn (name change) shortly before a turn: drop it. The short section is often passed between
  // two GPS fixes, and the firmware then never shows the turn at its end (desk simulator, ride 2026-11-12 at 775 m).
  if (!opt.classic) B = B.filter((v, k) => k === 0 || k === B.length - 1 || turnAngle[v] !== undefined || wp[v] || !(turnAngle[B[k + 1]] !== undefined && D[B[k + 1]] - D[v] < THEN));
  // file points: no gap > GAP m. The CC700 measures off-route as distance to the nearest route POINT (log min_dst), so the
  // 2.5 m simplification left 350 m gaps on straight roads and a false "off route" at ~220 m (ride 2026-11-11).
  // OnelapFit routes: median gap 9 m. Points are added only in the file; turn and name analysis use P as before.
  // Near a turn the points are 5 m apart: a section of 10 to 30 m between two close turns then has points that a 1 Hz GPS
  // fix can land on. With 20 m the firmware passed such sections between two fixes and never showed their icon (desk
  // simulator, ride 2026-11-12: turns at 856 m and 3527 m).
  const TD = B.filter(i => turnAngle[i] !== undefined).map(i => D[i]), NEAR = 40;
  const nearTurn = d => { let lo = 0, hi = TD.length; while (lo < hi) { const m = (lo + hi) >> 1; if (TD[m] < d) lo = m + 1; else hi = m; }
    return (lo < TD.length && TD[lo] - d <= NEAR) || (lo > 0 && d - TD[lo - 1] <= NEAR); };
  const GAP = 20, GAP_TURN = opt.classic ? 20 : 5, extra = i => { if (i + 1 >= P.length) return 0; const L = D[i + 1] - D[i];
    const g = nearTurn(D[i]) || nearTurn(D[i + 1]) || nearTurn((D[i] + D[i + 1]) / 2) ? GAP_TURN : GAP; return Math.max(0, Math.ceil(L / g) - 1); };
  // At most 50 points per record, as in the server files. A record with 55 points (1572 B) stopped the device at start,
  // 39 points worked (device tests 2026-11-12). The firmware has checks at 50 and 150 (0x4204bdb8), not traced further.
  const MAXP = 50;
  for (let k = 0; k < B.length - 1; k++) {                      // record size (<= MAXP file points) and map block area (<= 600 m per section)
    const maxLen = opt.map && opt.map.ground ? 300 : 600;      // ground on: shorter sections = smaller block windows
    // equal parts: a split by length alone left a 21 m tail before a turn (commute, 775 m), see the rule above
    let N = 0; for (let i = B[k]; i < B[k + 1]; i++) N += 1 + extra(i);
    const parts = Math.max(Math.ceil((D[B[k + 1]] - D[B[k]]) / maxLen), Math.ceil(N / (MAXP - 5))), lim = opt.classic ? maxLen : (D[B[k + 1]] - D[B[k]]) / parts;
    let j = B[k] + 1, n = 1 + extra(B[k]); while (j < B[k + 1] && n + 1 + extra(j) <= MAXP && D[j] - D[B[k]] < Math.min(maxLen, lim)) { n += 1 + extra(j); j++; }   // n: points of the record so far, the end point included
    if (j < B[k + 1]) B.splice(k + 1, 0, j);
  }
  // 3. sections
  const secs = [];
  for (let k = 0; k < B.length - 1; k++) {
    const i0 = B[k], i1 = B[k + 1], r = road[Math.min(i1 - 1, i0 + Math.floor((i1 - i0) / 2))];
    const [dir, q] = k + 1 < B.length - 1 ? turnCode(turnAngle[i1] ?? (NET ? 0 : A[i1])) : [0, ''];
    secs.push({ dist: D[i1], i0, i1, name: nm[Math.floor((i0 + i1) / 2)] || UNNAMED[r.kind] || 'Weg', round: r.round, type: k + 1 < B.length - 1 ? 1 : 2, dir, q });
  }
  // text shown for a section: street name; unnamed ways by type; checkpoints. The map and the icon show the rest.
  secs.forEach((s, k) => {
    let t = s.name;
    if (s.round && secs[k + 1]) t = secs[k + 1].name;          // roundabout: show the exit road
    if (wp[s.i0]) t = '▶ ' + wp[s.i0];
    // close turns: a second turn follows within THEN m. The firmware shows only the next turn, and a short section is
    // often passed before its icon is drawn, so the first section already names the second turn.
    const n = secs[k + 1];
    if (!opt.classic && s.type === 1 && s.dir && n && n.type === 1 && n.dir && D[n.i1] - D[n.i0] <= THEN) t = 'then ' + THEN_WORD[n.dir] + ' · ' + t;
    s.text = t;
  });
  // 4. points (elevation in cm, distance in cm, direction float). As in server route files (read back from the device):
  // field 8 is the direction to the next point as a COMPASS BEARING (0 = north, 90 = east). Checked 2026-11-12 evening:
  // official file route_1918853.bin matches the bearing with median error 0.0 deg, and 131 deg off for "90 - bearing".
  // The "90 - bearing" version (Zurueck farbig, route_11122400.bin) was wrong.
  const ele = P.map(p => p[2] == null ? 0 : p[2]);
  const pt = (i, f = 0) => { const j = Math.min(P.length - 1, i + 1), la = sc(P[i][0] + (P[j][0] - P[i][0]) * f), lo = sc(P[i][1] + (P[j][1] - P[i][1]) * f);
    return Object.assign([...fs(1, la), ...fs(2, lo), ...fs(3, Math.round((ele[i] + (ele[j] - ele[i]) * f) * 100)), ...fu(4, 0), ...fu(5, Math.round((D[i] + (D[j] - D[i]) * f) * 100)),
      ...f32(8, (brg(P[i], P[j]) + 360) % 360), ...(opt.noF9 ? [] : fu(9, 0))], { cell: geohash(la * SC, lo * SC) }); };
  // geohash index of a record (info field 8): for each 6-character cell the record passes, the first and the last point
  // (index * 2). Without it the firmware cannot place the rider in the record points: it then knows only the section
  // start points, the turn position never advances and "off route" is measured to those points (ride 2026-11-12).
  const cells = ps => { const runs = []; ps.forEach((q, i) => { const r = runs.at(-1); if (r && r[0] === q.cell) r[2] = i; else runs.push([q.cell, i, i]); });
    return [...fu(1, runs.length), ...runs.flatMap(([c, a, b]) => fb(2, [...fb(1, [...new TextEncoder().encode(c)]), ...fu(2, 2 * a), ...fu(3, 2 * b)]))]; };
  const imgs = secs.map(s => opt.nameImage(short(s.text))); let off = 0;
  const recs = new Bytes();
  secs.forEach((s, k) => {
    const len = D[s.i1] - D[s.i0];
    const ps = []; for (let i = s.i0; i <= s.i1; i++) { ps.push(pt(i)); if (i < s.i1) { const e = extra(i); for (let t = 1; t <= e; t++) ps.push(pt(i, t / (e + 1))); } }
    const info = [...fu(1, Math.round(len)), ...fu(2, Math.round(len / speed)), ...fb(3, pt(s.i0)), ...fb(4, pt(s.i1)),
      ...fb(5, [...fu(1, s.type), ...fu(2, s.dir)]), ...fb(6, [...new TextEncoder().encode([...s.name].slice(0, 48).join(''))]), ...fu(7, off), ...(opt.noCells ? [] : fb(8, cells(ps)))];
    off += imgs[k].length;
    const m = [...fb(1, info), ...fu(2, ps.length)]; for (const q of ps) m.push(...fb(3, q));
    recs.push(u32le(m.length)).push(m);
  });
  // 5. assemble
  const out = new Bytes(); const h = HEADER.slice(); const dv = new DataView(h.buffer);
  dv.setUint32(0, Math.floor(Date.now() / 1000), true);
  let id = new TextEncoder().encode(ascii(opt.label || opt.id));   // 0x04..0x23: name shown in the CC700 route menu
  while (id.length > 31) id = new TextEncoder().encode([...new TextDecoder().decode(id)].slice(0, -1).join(''));
  h.fill(0, 4, 0x24); h.set(id, 4);
  const total = D.at(-1), ups = ele.slice(1).reduce((s, e, i) => s + Math.max(0, e - ele[i]), 0), downs = ele.slice(1).reduce((s, e, i) => s + Math.min(0, e - ele[i]), 0);
  dv.setUint32(0x24, Math.round(total / speed), true); dv.setUint32(0x28, Math.round(total), true);
  dv.setInt32(0x2c, Math.round(ups * 100), true); dv.setInt32(0x30, Math.round(downs * 100), true);
  const [eMin, eMax] = lo_hi(ele);
  dv.setUint16(0x34, Math.max(0, Math.min(65535, Math.round(eMin * 100))), true); dv.setUint16(0x36, Math.max(0, Math.min(65535, Math.round(eMax * 100))), true);
  dv.setUint32(0x38, Math.max(0, Math.round(eMin * 100)), true); dv.setUint32(0x40, secs.length - 1, true); dv.setUint16(0x46, secs.length, true);
  const [la0, la1] = lo_hi(P.map(p => p[0])), [lo0, lo1] = lo_hi(P.map(p => p[1]));
  dv.setInt32(0x48, sc((la0 + la1) / 2), true); dv.setInt32(0x4c, sc((lo0 + lo1) / 2), true);
  // 0x44 plotting_scale: web-map zoom of the route preview. The firmware starts one level above it and zooms out until
  // the route fits, so the value only has to be high enough (server: 13 for a route 261 px wide at zoom 13).
  const my = l => Math.log(Math.tan(Math.PI / 4 + l * Math.PI / 360)), ext = Math.max((lo1 - lo0) / 360, (my(la1) - my(la0)) / (2 * Math.PI)) * 256;
  h[0x44] = Math.max(1, Math.min(18, Math.floor(Math.log2(300 / (ext || 1e-9)))));
  out.push(h).push(recs.bytes).push(new Array(16).fill(0xff));
  const base = out.n; dv.setUint32(0x60, base, true); dv.setUint32(0x64, base, true);
  imgs.forEach(b => out.push(b));
  const title = new Uint8Array(128); let tb = new TextEncoder().encode(ascii(opt.title || opt.id));
  while (tb.length > 127) tb = new TextEncoder().encode([...new TextDecoder().decode(tb)].slice(0, -1).join(''));   // cut on a character boundary
  title.set(tb);
  out.push(new Array(16).fill(0xff)).push(u32le(0x80)).push(title);
  while (out.n % 4) out.push([0]);
  // 6. map layer
  const sections = secs.map(s => { const a = []; for (let i = s.i0; i <= s.i1; i++) a.push([P[i][0], P[i][1], D[i] * 100]); return a; });
  const RG = new Map(); for (let i = 0; i < P.length; i++) { const [x, y] = F.m(P[i][0], P[i][1]); RG.set(Math.floor(x / 600) + ',' + Math.floor(y / 600), 1); }
  const nearRoute = L => L.pts.some(q => { const [x, y] = F.m(q[0], q[1]), gx = Math.floor(x / 600), gy = Math.floor(y / 600);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (RG.has((gx + dx) + ',' + (gy + dy))) return true; return false; });
  const mopt = { ...(opt.map || {}) }; if (mopt.ground) mopt.areas = (opt.areas || []).filter(a => nearRoute({ pts: a[0] }));   // option B ground
  if (mopt.water) mopt.water = (opt.water || []).filter(a => nearRoute({ pts: a[0] }));
  if (mopt.rails) mopt.rails = (opt.rails || []).filter(pts => nearRoute({ pts }));
  const map = mopt.styled                                       // patched firmware: styled polylines and areas (patch v1)
    ? buildStyledSection(sections, { lines: allLines.filter(L =>      // options: real carriageways (lanes), detail ways (details)
        L.fl & 1024 ? mopt.lanes !== false : L.fl & 512 ? mopt.lanes === false : L.fl & 256 ? mopt.details !== false : true).filter(nearRoute), areas: (opt.areas || []).filter(a => nearRoute({ pts: a[0] })),
        green: (opt.green || []).filter(a => nearRoute({ pts: a[0] })), water: (opt.water || []).filter(a => nearRoute({ pts: a[0] })),
        rails: (opt.rails || []).filter(pts => nearRoute({ pts })), trams: (opt.trams || []).filter(pts => nearRoute({ pts })), wlines: (opt.wlines || []).filter(pts => nearRoute({ pts })),
        signals: (opt.signals || []).filter(p => nearRoute({ pts: [p] })), stops: (opt.stops || []).filter(p => nearRoute({ pts: [p] })), opt: mopt, turns: secs.map((s, k) => s.dir ? k : -1).filter(k => k >= 0),
        routeNames: new Set(secs.map(s => s.name)),                                   // A3: names of the route streets first
        rough: P.reduce((a, p, i) => { if (road[i] && road[i].kind === 6) { const l = a.at(-1); if (l && l[1] >= D[i - 1] * 100) l[1] = D[i] * 100; else a.push([D[i] * 100, D[i] * 100]); } return a; }, []).filter(x => x[1] - x[0] >= 2000) }, F)
    : buildMapSection(sections, lines.filter(nearRoute), F, mopt);   // only roads near the route (600 m grid)
  const ioa = out.n; out.push(map.bytes);
  const file = out.bytes.slice(); new DataView(file.buffer).setUint32(0x5c, ioa, true); file.set(h.subarray(0, 0x5c), 0); file.set(h.subarray(0x60, 0x80), 0x60);
  const padded = new Uint8Array(Math.ceil(file.length / 4096) * 4096); padded.set(file);
  return { file: padded, sections: secs, distance: total, mapBlocks: map.blocks, maxBlock: map.maxBlock, mapStat: map.stat };
}
function box(pts, F) { let b = [1e18, 1e18, -1e18, -1e18]; for (const p of pts) { const [x, y] = F.m(p[0], p[1]); b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]; } return b; }
