// Way-back street tree model (tree A): for each street node, the next node toward the route
// and the ride distance to the route. Extra pieces join stored nodes that tree A does not link.
// Pure computation: no file IO. Distances are metres.
import {hav} from './geo.js';

const SPLIT_M = 100;        // edges longer than this get new nodes
const SAMPLE_M = 5;         // route samples for the route-node test
const ROUTE_NEAR_M = 8;     // a graph node this close to a sample is on the route
const AIR_SAMPLE_M = 25;    // route samples for the straight-line test
// Reach (cc27): the straight-line limit and the ride limit (two times the air limit). ride1500: study tools only.
export const REACH = {line1k: {air: 1000, ride: 2000}, line2k: {air: 2000, ride: 4000}, line3k: {air: 3000, ride: 6000}};
const GRID_M = 50;          // grid cell for route samples (larger than ROUTE_NEAR_M)

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(d, v) {
    const a = this.a; a.push([d, v]);
    let i = a.length - 1;
    while (i > 0) { const q = (i - 1) >> 1; if (a[q][0] <= a[i][0]) break; [a[q], a[i]] = [a[i], a[q]]; i = q; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

// Route samples every `stepM` metres. g = route distance in metres.
export function routeSamples(route, stepM) {
  const out = [];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    const L = (b.progress - a.progress) / 100;
    const n = Math.max(1, Math.ceil(L / stepM));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({point: [a.point[0] + (b.point[0] - a.point[0]) * t, a.point[1] + (b.point[1] - a.point[1]) * t],
        g: (a.progress + (b.progress - a.progress) * t) / 100});
    }
  }
  const last = route.at(-1);
  out.push({point: last.point.slice(), g: last.progress / 100});
  return out;
}

function reverseSearch(N, inAdj, starts, limit) {
  const dist = new Float64Array(N).fill(Infinity);
  const heap = new MinHeap();
  for (const s of starts) { dist[s] = 0; heap.push(0, s); }
  while (heap.size) {
    const [d, v] = heap.pop();
    if (d > dist[v]) continue;
    for (const e of inAdj[v]) {
      const nd = d + e.m;
      if (nd <= limit && nd < dist[e.u]) { dist[e.u] = nd; heap.push(nd, e.u); }
    }
  }
  return dist;
}

// Splits edges longer than SPLIT_M. Both directions of an edge pair share the same new nodes.
function splitGraph(graph, pts) {
  const index = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const edges = [], chains = new Map();
  for (const e of graph.edges) {
    const iu = index.get(e.from), iv = index.get(e.to);
    if (iu === undefined || iv === undefined) throw new Error('edge names a missing node');
    if (iu === iv) continue;
    const m = e.meters;
    if (m <= SPLIT_M) { edges.push({u: iu, v: iv, m}); continue; }
    const lo = Math.min(iu, iv), hi = Math.max(iu, iv), key = lo + '|' + hi;
    let chain = chains.get(key);
    if (!chain) {
      const k = Math.ceil(m / SPLIT_M);
      chain = [lo];
      for (let j = 1; j < k; j++) {
        const t = j / k;
        pts.push([pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t]);
        chain.push(pts.length - 1);
      }
      chain.push(hi);
      chains.set(key, chain);
    }
    const seq = iu === lo ? chain : [...chain].reverse();
    const piece = m / (chain.length - 1);
    for (let j = 0; j + 1 < seq.length; j++) edges.push({u: seq[j], v: seq[j + 1], m: piece});
  }
  return {edges, index};
}

// Removes the records that make a forward chain loop or never reach the route. A chain follows a
// record's next, else the tree A next. Rounds repeat until no chain is open. Input and output use
// original node indexes: {x, nx, dist}.
export function removeForwardCycles(records, treeNext, limit = treeNext.length) {
  let recs = records, removed = 0;
  for (;;) {
    const byNode = new Map(recs.map(r => [r.x, r]));
    const bad = new Set();
    for (const r of recs) {
      let y = r.nx, steps = 0;
      for (;;) {
        if (y === r.x) { bad.add(r.x); break; }
        const rr = byNode.get(y);
        if (!rr && treeNext[y] === -1) break;
        y = rr ? rr.nx : treeNext[y];
        if (++steps > limit) { bad.add(r.x); break; }
      }
    }
    if (!bad.size) return {records: recs, removed};
    removed += bad.size;
    recs = recs.filter(r => !bad.has(r.x));
  }
}

// Counts the stored nodes whose forward chain, in some chunk, does not end at a route node.
// Returns {open, maxSteps}: open chains, and the longest chain that ends.
export function forwardChainsOpen(model) {
  const N = model.nodes.length;
  const lists = model.chunks.length ? model.chunks : [[]];
  let open = 0, maxSteps = 0;
  for (const list of lists) {
    const rec = new Map(list.map(r => [r.node, r.next]));
    for (let n = 0; n < N; n++) {
      let y = n, steps = 0, ok = false;
      for (; steps <= N; steps++) {
        const hasRec = rec.has(y);
        if (!hasRec && model.nodes[y].next === -1) { ok = true; break; }
        y = hasRec ? rec.get(y) : model.nodes[y].next;
      }
      if (ok) maxSteps = Math.max(maxSteps, steps); else open++;
    }
  }
  return {open, maxSteps};
}

// Forward exception lists, one per route km (see the plan, Task 6, rules 1 to 8).
// Records are made only for stored nodes; a record whose next node is not stored is dropped.
function forwardLists({N, outAdj, inAdj, onRoute, keep, next, newIndex, totalM, R, stats}) {
  const chunks = [];
  const inRange = (list, lo, hi) => !!list && list.some(g => g >= lo && g <= hi);
  for (let c = 0; c * 1000 < totalM; c++) {
    const lo = c * 1000 - 50 - R, hi = c * 1000 + 4000;
    const goals = [];
    for (let i = 0; i < N; i++) if (inRange(onRoute[i], lo, hi)) goals.push(i);
    const F = reverseSearch(N, inAdj, goals, 2 * R + 4000);
    const ownStarts = [];
    for (let i = 0; i < N; i++) if (inRange(onRoute[i], c * 1000 - 50, c * 1000 + 1000)) ownStarts.push(i);
    const own = reverseSearch(N, inAdj, ownStarts, R);
    const opt = x => {
      const out = [];
      for (const e of outAdj[x]) if (F[e.v] + e.m <= F[x] + 0.01) out.push(e.v);
      return out;
    };
    const seen = new Uint8Array(N);
    const records = [];
    for (let n0 = 0; n0 < N; n0++) {
      if (!keep[n0] || own[n0] === Infinity || F[n0] === Infinity) continue;
      let x = n0;
      while (F[x] > 0 && F[x] < Infinity && !seen[x]) {
        seen[x] = 1;
        const o = opt(x);
        if (!o.length) break;
        const an = next[x];
        const ok = an >= 0 && o.includes(an);
        const nx = ok ? an : o[0];
        if (!ok) {
          if (!keep[x]) stats.skippedNotStored++;
          else if (!keep[nx]) stats.droppedExceptions++;
          else records.push({x, nx, dist: F[x]});
        }
        x = nx;
      }
    }
    const cleaned = removeForwardCycles(records, next);
    stats.cycleRecordsRemoved += cleaned.removed;
    chunks.push(cleaned.records
      .map(r => ({node: newIndex[r.x], next: newIndex[r.nx], dist: Math.round(r.dist)}))
      .sort((p, q) => p.node - q.node));
  }
  return chunks;
}

export function buildWaybackModel(graph, route, {reach = 'line2k', exceptions = false} = {}) {
  if (!REACH[reach] && reach !== 'ride1500') throw new Error(`unknown reach ${reach}`);
  if (!Array.isArray(route) || route.length < 2) throw new Error('route needs two points');
  const R = REACH[reach] ? REACH[reach].ride : 1500, AIR = REACH[reach] ? REACH[reach].air : REACH.line2k.air;
  const pts = graph.nodes.map(n => n.point.slice());
  const graphNodes = graph.nodes.length;
  const {edges, index} = splitGraph(graph, pts);
  const N = pts.length;
  const K = Math.cos(route[0].point[0] * Math.PI / 180);
  const xy = q => [q[1] * 111320 * K, q[0] * 111320];

  // Route samples, grid and route nodes.
  const samples = routeSamples(route, SAMPLE_M);
  const cellKey = (cx, cy) => cx + ',' + cy;
  const grid = new Map();
  for (const s of samples) {
    const [x, y] = xy(s.point), k = cellKey(Math.floor(x / GRID_M), Math.floor(y / GRID_M));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(s);
  }
  const onRoute = new Array(N).fill(null);
  let routeNodes = 0;
  for (let i = 0; i < N; i++) {
    const [x, y] = xy(pts[i]), cx = Math.floor(x / GRID_M), cy = Math.floor(y / GRID_M);
    const g = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const s of grid.get(cellKey(cx + dx, cy + dy)) ?? []) if (hav(pts[i], s.point) <= ROUTE_NEAR_M) g.push(s.g);
    }
    if (g.length) { onRoute[i] = g.sort((a, b) => a - b); routeNodes++; }
  }

  // Tree A: reversed shortest search from all route nodes.
  const outAdj = Array.from({length: N}, () => []), inAdj = Array.from({length: N}, () => []);
  for (const e of edges) { outAdj[e.u].push(e); inAdj[e.v].push(e); }
  const dist = new Float64Array(N).fill(Infinity), next = new Int32Array(N).fill(-1);
  const heap = new MinHeap();
  for (let i = 0; i < N; i++) if (onRoute[i]) { dist[i] = 0; heap.push(0, i); }
  while (heap.size) {
    const [d, v] = heap.pop();
    if (d > dist[v]) continue;
    for (const e of inAdj[v]) {
      const nd = d + e.m;
      if (nd < dist[e.u]) { dist[e.u] = nd; next[e.u] = v; heap.push(nd, e.u); }
    }
  }

  // Straight-line distance to the route (route samples every 25 m), computed on demand.
  const airSamples = routeSamples(route, AIR_SAMPLE_M);
  const airX = airSamples.map(s => xy(s.point)[0]), airY = airSamples.map(s => xy(s.point)[1]);
  const airCache = new Float64Array(N).fill(-1);
  const airOf = i => {
    if (airCache[i] >= 0) return airCache[i];
    const [x, y] = xy(pts[i]);
    let best = Infinity;
    for (let j = 0; j < airX.length; j++) {
      const dx = airX[j] - x, dy = airY[j] - y, d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
    airCache[i] = Math.sqrt(best);
    return airCache[i];
  };

  // Stored set, then the next chain of each stored node.
  const keep = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (dist[i] === Infinity) continue;
    if (reach === 'ride1500') { if (dist[i] <= R) keep[i] = 1; }
    else if (dist[i] <= R && airOf(i) <= AIR) keep[i] = 1;
  }
  const seeds = Array.from(keep);
  const chainDone = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!seeds[i]) continue;
    let x = i;
    while (x !== -1 && !chainDone[x]) { chainDone[x] = 1; keep[x] = 1; x = next[x]; }
  }
  const kept = [], newIndex = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) if (keep[i]) { newIndex[i] = kept.length; kept.push(i); }
  const nodes = kept.map(i => ({
    point: pts[i],
    next: next[i] >= 0 ? newIndex[next[i]] : -1,
    dist: dist[i],
    progress: onRoute[i] ?? [],
  }));

  // Extra pieces: stored pairs with an edge, that tree A does not link.
  const meterOf = new Map();
  for (const e of edges) {
    const k = e.u + '>' + e.v, m0 = meterOf.get(k);
    if (m0 === undefined || e.m < m0) meterOf.set(k, e.m);
  }
  const extras = [], pairSeen = new Set();
  for (const e of edges) {
    const u = e.u, v = e.v;
    if (!keep[u] || !keep[v]) continue;
    const a = Math.min(u, v), b = Math.max(u, v), pk = a + '|' + b;
    if (pairSeen.has(pk)) continue;
    pairSeen.add(pk);
    if (next[u] === v || next[v] === u) continue;
    const ab = meterOf.get(a + '>' + b), ba = meterOf.get(b + '>' + a);
    extras.push({a: newIndex[a], b: newIndex[b], meters: Math.min(ab ?? Infinity, ba ?? Infinity),
      toA: ba !== undefined, toB: ab !== undefined});
  }
  extras.sort((p, q) => p.a - q.a || p.b - q.b);

  const stats = {graphNodes, splitNodes: N - graphNodes, routeNodes, stored: kept.length, extras: extras.length, noWay: 0, noWayInside2km: 0};
  for (let i = 0; i < graphNodes; i++) if (dist[i] === Infinity) { stats.noWay++; if (airOf(i) <= AIR) stats.noWayInside2km++; }

  const model = {nodes, extras, chunks: [], stats};
  if (exceptions) {
    const fstats = {skippedNotStored: 0, droppedExceptions: 0, cycleRecordsRemoved: 0};
    model.chunks = forwardLists({N, outAdj, inAdj, onRoute, keep, next, newIndex, totalM: route.at(-1).progress / 100, R, stats: fstats});
    stats.exceptionRecords = model.chunks.reduce((s, c) => s + c.length, 0);
    stats.skippedNotStored = fstats.skippedNotStored;
    stats.droppedExceptions = fstats.droppedExceptions;
    stats.cycleRecordsRemoved = fstats.cycleRecordsRemoved;
  }
  return model;
}
