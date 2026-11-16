#!/usr/bin/env node
// Draws an 800 m x 600 m part of a route with its stored way-back streets as one interactive page.
// The pointer is the rider; the line for each 4 m square comes from the real core (tools/wayback_core_host.mjs).
// Usage: node tools/wayback_draw.mjs <route.bin> <file.ccwb> <out.html> [place 0..1 along the route, default 0.5]
// The page holds real street geometry. Keep it in .local/ (git ignores it).
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {decodeWayback} from './wayback_format.mjs';
import {readNativeRoute} from './recovery_planner.mjs';
import {runCore} from './wayback_core_host.mjs';
const [routePath, file, out, place = '0.5'] = process.argv.slice(2);
if (!routePath || !file || !out) { console.error('usage: node tools/wayback_draw.mjs <route.bin> <file.ccwb> <out.html> [place]'); process.exit(2); }
const w = decodeWayback(fs.readFileSync(file)), h = w.header;
const toU = ([la, lo]) => [Math.floor((Math.round(lo * 1e7) - h.lon0E7) * h.lonU / 65536), Math.floor((Math.round(la * 1e7) - h.lat0E7) * h.latU / 65536)];
const toE7 = (X, Y) => [h.lat0E7 + Math.floor(Y * h.latE / 65536) + 1, h.lon0E7 + Math.floor(X * h.lonE / 65536) + 1];
const route = readNativeRoute(fs.readFileSync(routePath)).map(p => toU(p.point));
const mid = route[Math.min(route.length - 1, Math.floor(route.length * Number(place)))];
const W = 12800, H = 9600, G = 64;                       // 800 m x 600 m window, 4 m grid
const x0 = mid[0] - W / 2, y0 = mid[1] - H / 2;
const inWin = (X, Y, m = 1700) => X > x0 - m && X < x0 + W + m && Y > y0 - m && Y < y0 + H + m;
// Nodes near the window, with a local index. Chains can leave the window, so keep a wide margin.
const keep = new Map(); const nodes = [];
w.nodes.forEach((n, i) => { if (inWin(n.X, n.Y, 9000)) { keep.set(i, nodes.length); nodes.push([n.X - x0, n.Y - y0, n.next, Math.round(n.distDm / 10)]); } });
for (const n of nodes) n[2] = n[2] >= 0 && keep.has(n[2]) ? keep.get(n[2]) : -1;
const extras = w.extras.filter(e => keep.has(e.a) && keep.has(e.b) && inWin(w.nodes[e.a].X, w.nodes[e.a].Y)).map(e => [keep.get(e.a), keep.get(e.b)]);
const byXY = new Map(nodes.map((n, i) => [n[0] + ',' + n[1], i]));
// The real core gives the answer for each grid position.
const lines = [], cols = W / G, rows = H / G;
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const [la, lo] = toE7(x0 + c * G + G / 2, y0 + r * G + G / 2); lines.push({latE7: la, lonE7: lo, flags: 3, maxPoints: 32}); }
const res = runCore(fs.readFileSync(file), h.routeId, lines);
let miss = 0;
const grid = res.map(r => {
  if (r.state !== 1 || !r.points || r.points.length < 2) return 0;
  const pts = r.points.map(([la, lo]) => { const u = toU([la / 1e7, lo / 1e7]); return [u[0] - x0, u[1] - y0]; });
  // Second point is a stored node; the browser follows its chain. Search a small neighbourhood for rounding.
  let k = -1;
  for (let dx = -2; dx <= 2 && k < 0; dx++) for (let dy = -2; dy <= 2 && k < 0; dy++) { const v = byXY.get((pts[1][0] + dx) + ',' + (pts[1][1] + dy)); if (v !== undefined) k = v; }
  if (k < 0) { miss++; return 0; }
  return [pts[0][0], pts[0][1], k, Math.round(r.distanceDm / 10)];
});
const reasons = res.map(r => r.state === 1 ? 0 : r.reason);
console.log('grid', grid.length, 'with line', grid.filter(Boolean).length, 'unmatched', miss, 'reasons', JSON.stringify(reasons.reduce((a, v) => (a[v] = (a[v] || 0) + 1, a), {})));
const data = {W, H, G, cols, nodes, extras, route: route.map(([X, Y]) => [X - x0, Y - y0]), grid};
const html = fs.readFileSync(fileURLToPath(new URL('./wayback_draw.html', import.meta.url)), 'utf8').replace('/*DATA*/', 'const D=' + JSON.stringify(data) + ';');
fs.writeFileSync(out, html);
console.log('wrote', out, html.length, 'bytes');
