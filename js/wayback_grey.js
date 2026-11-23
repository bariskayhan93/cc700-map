// Grey flag of a way-back piece (cc26, D1b). The page sets it; the unit only reads it. A piece is on the map when
// 2 of its 3 points (both ends and the straight middle) are within 10 m of a written street line (classes 5, 6, 7,
// 8, 10). A piece that is on the map is not grey. A route with no map section or no street line gives grey everywhere.
// cc29: a piece on the route corridor is never grey either (2 of 3 points within 15 m of the route polyline, the
// unit's own snap distance): the router rides ways the map hides by design (driveways, parking aisles, cycle tracks
// beside streets), and a grey line on top of the route line is wrong - the corridor is known ground (21 Nov).
import {readFile} from './preview.js';
import {readNativeRoute} from './native_route.js';

const STREET = new Set([5, 6, 7, 8, 10]);
const NEAR = 160;      // 10 m in way-back units (16 units per metre)
const ROUTE_NEAR = 240;      // 15 m: the corridor of the route itself, as the unit snaps (WB_D2_LIMIT)
const CELL = 800;      // 50 m grid cell
const STEP = 400;      // sample spacing along a map line: NEAR + STEP / 2 < CELL, so a 3 x 3 cell search finds it
const key = (cx, cy) => (cx + 524288) * 1048576 + (cy + 524288);

// segs [[x0, y0, x1, y1], ...] -> (x, y) => a seg of the grid is within limit units
function gridNear(segs, limit) {
  if (!segs.length) return () => false;
  const grid = new Map();
  segs.forEach((s, id) => {
    const len = Math.hypot(s[2] - s[0], s[3] - s[1]), n = Math.max(1, Math.ceil(len / STEP));
    for (let k = 0; k <= n; k++) {
      const x = s[0] + (s[2] - s[0]) * k / n, y = s[1] + (s[3] - s[1]) * k / n;
      const cell = key(Math.floor(x / CELL), Math.floor(y / CELL));
      let list = grid.get(cell);
      if (!list) grid.set(cell, list = []);
      if (list[list.length - 1] !== id) list.push(id);
    }
  });
  return (x, y) => {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const id of grid.get(key(cx + dx, cy + dy)) || []) {
        const [x0, y0, x1, y1] = segs[id];
        const vx = x1 - x0, vy = y1 - y0, L = vx * vx + vy * vy;
        const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / L));
        const ex = x - x0 - t * vx, ey = y - y0 - t * vy;
        if (ex * ex + ey * ey <= limit * limit) return true;
      }
    }
    return false;
  };
}

// routeBytes: the route file with its map section. header: the CCWB frame (lat0E7, lon0E7, latU, lonU).
// Returns flagOf(a, b): a and b are [X, Y] way-back units of the piece ends; the result is 1 (grey) or 0.
export function greyFlags(routeBytes, header) {
  const unitsOf = (la, lo) => {
    const dLat = Math.round(la * 1e7) - header.lat0E7, dLon = Math.round(lo * 1e7) - header.lon0E7;
    return [Math.floor(dLon * header.lonU / 65536), Math.floor(dLat * header.latU / 65536)];
  };
  const segs = [];
  const blocks = routeBytes && routeBytes.length ? readFile(routeBytes).blocks : [];
  for (const block of blocks) for (const e of block) {
    if (!e.points || !e.center || !STREET.has(e.style & 15)) continue;
    const q = [e.center, ...e.points].map(([la, lo]) => unitsOf(la, lo));   // the centre is the first vertex (sentry)
    for (let i = 1; i < q.length; i++) segs.push([q[i - 1][0], q[i - 1][1], q[i][0], q[i][1]]);
  }
  let routeSegs = [];
  try {
    const rp = readNativeRoute(routeBytes).map(r => unitsOf(r.point[0], r.point[1]));
    for (let i = 1; i < rp.length; i++) routeSegs.push([rp[i - 1][0], rp[i - 1][1], rp[i][0], rp[i][1]]);
  } catch { /* no readable route: no corridor to protect */ }
  const onMap = gridNear(segs, NEAR), onRoute = gridNear(routeSegs, ROUTE_NEAR);
  const near = (x, y) => onMap(x, y) || onRoute(x, y);
  return (a, b) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(2, Math.ceil(len / ROUTE_NEAR) + 1);   // a sample at most ROUTE_NEAR apart
    for (let k = 0; k < steps; k++) {
      const t = k / (steps - 1);
      if (onRoute(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return 0;   // touches the corridor: known ground
    }
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const hits = [a, mid, b].filter(p => near(p[0], p[1])).length;
    return hits >= 2 ? 0 : 1;
  };
}
