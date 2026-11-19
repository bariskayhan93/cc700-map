// Elevation section, type 3 of the route file (cc27, design 8.7). The unit draws a strip of the next 1 km on the route.
// Layout (little-endian): "CCEL", u32 route length cm (field 5 of the last native record), u16 K blocks, u8 step dm
// (5, 10 or 20), u8 1 (version); then K blocks of 450 B: i16 base m, 224 x {u8 min, u8 max} in steps above the base,
// 255 = no value. One block = 1,000 m = 224 columns of 4.464 m. firmware/elev/elev.h reads it.
import {readRouteElevations} from './native_route.js';

export const EL = {COLS: 224, BLOCK: 450, HEAD: 12, BLOCK_M: 1000, GAP_M: 250, NONE: 255};
const STEPS_DM = [5, 10, 20];

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
  const out = new Uint8Array(EL.HEAD + K * EL.BLOCK), v = new DataView(out.buffer);
  out.set([0x43, 0x43, 0x45, 0x4C], 0);
  v.setUint32(4, lenCm, true); v.setUint16(8, K, true); out[10] = step; out[11] = 1;
  blocks.forEach((b, k) => {
    const o = EL.HEAD + k * EL.BLOCK;
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
