// Geometry helpers (metres in a local equirectangular frame).
const R = 6371000, D2R = Math.PI / 180;
export function hav(a, b) {
  const p1 = a[0] * D2R, p2 = b[0] * D2R, dp = p2 - p1, dl = (b[1] - a[1]) * D2R;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export function brg(a, b) {
  const p1 = a[0] * D2R, p2 = b[0] * D2R, dl = (b[1] - a[1]) * D2R;
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}
export const adiff = (a, b) => ((a - b + 540) % 360) - 180;        // signed, + = right turn
export function frame(lat0) {                                     // local metres <-> lat/lon
  const k = Math.cos(lat0 * D2R);
  return { m: (la, lo) => [lo * 111320 * k, la * 111320], g: (x, y) => [y / 111320, x / (111320 * k)] };
}
export function lineLen(p) { let s = 0; for (let i = 1; i < p.length; i++) s += hav(p[i - 1], p[i]); return s; }
export function rdp(p, eps, M) {                                  // Douglas-Peucker on lat/lon with metre tolerance
  if (p.length < 3) return p;
  const P = p.map(q => M(q[0], q[1])), keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
  const st = [[0, p.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); const [ax, ay] = P[a], [bx, by] = P[b]; const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    let dm = -1, im = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((P[i][0] - ax) * dy - (P[i][1] - ay) * dx) / L; if (d > dm) { dm = d; im = i; } }
    if (dm > eps) { keep[im] = 1; st.push([a, im], [im, b]); }
  }
  return p.filter((_, i) => keep[i]);
}
export function sub(p, s, e) {                                    // part of a polyline between distances s..e (m)
  const out = []; let acc = 0;
  const at = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], d = hav(a, b) || 1e-9;
    if (acc + d >= s && acc <= e) {
      if (!out.length) out.push(at(a, b, Math.max(0, (s - acc) / d)));
      if (acc + d <= e) out.push(b); else { out.push(at(a, b, (e - acc) / d)); break; }
    }
    acc += d;
  }
  return out;
}
export function offset(p, m, M, G) {                              // parallel polyline, m metres to the right
  const P = p.map(q => M(q[0], q[1]));
  return P.map(([x, y], i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
    return G(x + dy / L * m, y - dx / L * m);
  });
}
