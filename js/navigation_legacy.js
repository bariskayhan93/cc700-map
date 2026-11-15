// Frozen production decision mechanism from 0c02d27; observational metadata only.
import {adiff} from './geo.js';
export function legacyDecisionPoints(P, D, lines, F, grid) {
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
  let unmatched=0,run=0,longestUnmatched=0;
  for(const li of M){run=li<0?run+STEP:0;if(li<0)unmatched+=STEP;longestUnmatched=Math.max(longestUnmatched,run);}
  return { points, judge, matched, evidence:{unmatchedMeters:unmatched,longestUnmatchedMeters:longestUnmatched} };
}
