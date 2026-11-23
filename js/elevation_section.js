// Elevation section, type 3 of the route file (cc27, design 8.7). The unit draws a strip of the next 1 km on the route.
// Layout (little-endian), version 2: "CCEL", u32 route length cm (field 5 of the last native record), u16 K blocks,
// u8 step dm (5, 10 or 20), u8 2 (version); the coarse table: i16 base m, u8 step dm (5, 10, 20, 50, 100 or 200), u8 0, then 576
// x {u8 min, u8 max} (cell c = [c L / 576, (c + 1) L / 576)); then from byte 1,168 K blocks of 450 B: i16 base m, 224 x
// {u8 min, u8 max} in steps above the base. 255 = no value. One block = 1,000 m = 224 columns of 4.464 m.
// firmware/elev/elev.h reads it (the lens chart, design docs/superpowers/specs/2026-11-23-elevation-bar-design.md).
import {readRouteElevations} from './native_route.js';

export const EL = {COLS: 224, BLOCK: 450, HEAD: 12, COARSE: 576, HEAD2: 1168, BLOCK_M: 1000, GAP_M: 250, NONE: 255};
const STEPS_DM = [5, 10, 20], COARSE_STEPS_DM = [5, 10, 20, 50, 100, 200];

// points: [{distance m, elevation m or null}] in route order (readRouteElevations form). Between two values more than
// 250 m apart the profile has no value. null when no point has an elevation other than 0, or no step fits a block.
export function elevationFromPoints(points, lenCm) {
  const pts = points.filter(p => p.elevation != null && Number.isFinite(p.elevation));
  if (!pts.some(p => p.elevation !== 0) || !(lenCm > 0)) return null;
  const L = lenCm / 100, K = Math.ceil(L / EL.BLOCK_M), n = K * EL.COLS, W = EL.BLOCK_M / EL.COLS;
  if (K > 0xFFFF) return null;
  const lo = new Float64Array(n).fill(NaN), hi = new Float64Array(n).fill(NaN);
  const put = (c, v) => { if (c < 0 || c >= n) return; if (!(lo[c] <= v)) lo[c] = v; if (!(hi[c] >= v)) hi[c] = v; };
  for (const p of pts) if (p.distance <= L) put(Math.min(Math.floor(p.distance / W), n - 1), p.elevation);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], d = b.distance - a.distance;
    if (!(d > 0) || d > EL.GAP_M) continue;
    const at = x => a.elevation + (b.elevation - a.elevation) * (x - a.distance) / d;
    for (let c = Math.floor(a.distance / W); c * W < Math.min(b.distance, L) && c < n; c++) {
      const x0 = Math.max(a.distance, c * W), x1 = Math.min(b.distance, (c + 1) * W);
      if (x1 >= x0) { put(c, at(x0)); put(c, at(x1)); }
    }
  }
  const blocks = [];
  for (let k = 0; k < K; k++) {
    let mn = Infinity, mx = -Infinity;
    for (let c = k * EL.COLS; c < (k + 1) * EL.COLS; c++) if (!Number.isNaN(lo[c])) { mn = Math.min(mn, lo[c]); mx = Math.max(mx, hi[c]); }
    blocks.push(mn <= mx ? {base: Math.floor(mn), top: mx} : null);
  }
  const step = STEPS_DM.find(s => blocks.every(b => !b || Math.ceil((b.top - b.base) * 10 / s) <= 254));
  if (!step) return null;
  // The coarse table: each cell takes the min and max of the columns that overlap it.
  const cl = new Float64Array(EL.COARSE).fill(NaN), ch = new Float64Array(EL.COARSE).fill(NaN);
  for (let c = 0; c < n; c++) {
    if (Number.isNaN(lo[c])) continue;
    const a = Math.floor(c * W * EL.COARSE / L), z = Math.min(EL.COARSE - 1, Math.floor(((c + 1) * W - 1e-9) * EL.COARSE / L));
    for (let i = a; i <= z && i < EL.COARSE; i++) { if (!(cl[i] <= lo[c])) cl[i] = lo[c]; if (!(ch[i] >= hi[c])) ch[i] = hi[c]; }
  }
  let cmn = Infinity, cmx = -Infinity;
  for (let i = 0; i < EL.COARSE; i++) if (!Number.isNaN(cl[i])) { cmn = Math.min(cmn, cl[i]); cmx = Math.max(cmx, ch[i]); }
  const cbase = Math.floor(cmn), cstep = COARSE_STEPS_DM.find(s => Math.ceil((cmx - cbase) * 10 / s) <= 254);
  if (!cstep) return null;
  const out = new Uint8Array(EL.HEAD2 + K * EL.BLOCK), v = new DataView(out.buffer);
  out.set([0x43, 0x43, 0x45, 0x4C], 0);
  v.setUint32(4, lenCm, true); v.setUint16(8, K, true); out[10] = step; out[11] = 2;
  v.setInt16(12, cbase, true); out[14] = cstep; out[15] = 0;
  for (let i = 0; i < EL.COARSE; i++) {
    const none = Number.isNaN(cl[i]);
    out[16 + 2 * i] = none ? EL.NONE : Math.max(0, Math.floor((cl[i] - cbase) * 10 / cstep + 1e-9));
    out[17 + 2 * i] = none ? EL.NONE : Math.min(254, Math.ceil((ch[i] - cbase) * 10 / cstep - 1e-9));
  }
  blocks.forEach((b, k) => {
    const o = EL.HEAD2 + k * EL.BLOCK;
    v.setInt16(o, b ? b.base : 0, true);
    for (let i = 0; i < EL.COLS; i++) {
      const c = k * EL.COLS + i, none = !b || Number.isNaN(lo[c]);
      out[o + 2 + 2 * i] = none ? EL.NONE : Math.max(0, Math.floor((lo[c] - b.base) * 10 / step + 1e-9));
      out[o + 3 + 2 * i] = none ? EL.NONE : Math.min(254, Math.ceil((hi[c] - b.base) * 10 / step - 1e-9));
    }
  });
  return out;
}

// The elevation section of a route file (the plain route bytes), or null: no elevation field, or all values 0.
export function elevationSection(routeBytes) {
  const pts = readRouteElevations(routeBytes);
  return pts.length ? elevationFromPoints(pts, Math.round(pts.at(-1).distance * 100)) : null;
}
