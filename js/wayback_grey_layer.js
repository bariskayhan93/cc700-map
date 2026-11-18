// Grey layer section of way-back version 2 (cc26, D3a, E15). The page writes the grey streets as polylines, one body per
// 256 m cell, after the extras of the version 2 file. The unit reads the cells that a frame needs (D3c).
// Way-back units: 1/16 m. Cells of 4,096 units. Quantum 8 units (0.5 m), local to the cell corner.
const MAGIC = [0x43, 0x43, 0x47, 0x4C];      // "CCGL"
const CELL_SHIFT = 12, QUANTUM_SHIFT = 3;
const CELL = 1 << CELL_SHIFT, QUANTUM = 1 << QUANTUM_SHIFT;
const SIMPLIFY = 20;                         // Douglas-Peucker tolerance, 1.25 m (half a pixel at 2.5 m per pixel)
const MAX_POINTS = 32;                       // WBD_POINTS of the unit
const MAX_BODY = 2048;                       // largest cell body
const HEADER = 16, TABLE_ENTRY = 8, SENTINEL = 0xFFFFFFFF;

// Grey pieces of the parts (decodeWayback form): a tree piece from node i to its next, and each extra piece.
function greyPieces({nodes, extras}) {
  const pieces = [];
  nodes.forEach((n, i) => { if (n.next >= 0 && n.grey) pieces.push([i, n.next]); });
  for (const e of extras) if (e.grey) pieces.push([e.a, e.b]);
  return pieces;
}

// Chains of grey pieces. A chain starts and ends at a vertex of degree 1 or 3+, and runs through degree-2 vertices.
// A closed loop (all degree 2) starts at its lowest node index. Each piece is used once.
function joinChains(pieces) {
  const adj = new Map();
  pieces.forEach((p, k) => {
    for (const v of p) { if (!adj.has(v)) adj.set(v, []); adj.get(v).push(k); }
  });
  const used = new Set(), chains = [];
  const other = (k, v) => (pieces[k][0] === v ? pieces[k][1] : pieces[k][0]);
  const deg = v => adj.get(v).length;
  const walk = (start, first) => {
    const chain = [start];
    let piece = first, cur = start;
    for (;;) {
      used.add(piece);
      cur = other(piece, cur);
      chain.push(cur);
      if (cur === start || deg(cur) !== 2) break;
      piece = adj.get(cur).find(k => !used.has(k));
      if (piece === undefined) break;
    }
    return chain;
  };
  const vertices = [...adj.keys()].sort((a, b) => a - b);
  for (const v of vertices) {
    if (deg(v) === 2) continue;
    for (const k of adj.get(v)) if (!used.has(k)) chains.push(walk(v, k));
  }
  for (const v of vertices) {
    const k = adj.get(v).find(p => !used.has(p));
    if (k !== undefined) chains.push(walk(v, k));
  }
  return chains;
}

// Douglas-Peucker on integer points. Keeps both ends.
function simplify(pts, tol) {
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let worst = -1, at = -1;
    const [ax, ay] = pts[i], [bx, by] = pts[j], vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
    for (let k = i + 1; k < j; k++) {
      const [px, py] = pts[k];
      const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L));
      const d = Math.hypot(px - ax - t * vx, py - ay - t * vy);
      if (d > worst) { worst = d; at = k; }
    }
    if (worst > tol) { keep[at] = true; stack.push([i, at], [at, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

// Cell key of a point pair's midpoint: (cy << 16) | cx.
const cellKeyAt = (mx, my) => ((Math.floor(my / CELL) << 16) | Math.floor(mx / CELL)) >>> 0;

// Inserts the points where a segment crosses a cell border, then cuts the line into runs of one cell each. Neighbour
// runs share the cut point.
function cutAtCells(pts) {
  const P = [pts[0]];
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
    const ts = [];
    const lo = Math.min(ax, bx), hi = Math.max(ax, bx);
    for (let g = Math.floor(lo / CELL) + 1; g * CELL < hi; g++) ts.push((g * CELL - ax) / (bx - ax));
    const lo2 = Math.min(ay, by), hi2 = Math.max(ay, by);
    for (let g = Math.floor(lo2 / CELL) + 1; g * CELL < hi2; g++) ts.push((g * CELL - ay) / (by - ay));
    ts.sort((p, q) => p - q);
    for (const t of ts) {
      const c = [Math.round(ax + t * (bx - ax)), Math.round(ay + t * (by - ay))];
      const last = P[P.length - 1];
      if (c[0] !== last[0] || c[1] !== last[1]) P.push(c);
    }
    const last = P[P.length - 1];
    if (bx !== last[0] || by !== last[1]) P.push([bx, by]);
  }
  const runs = [];
  let run = null;
  for (let k = 0; k + 1 < P.length; k++) {
    const key = cellKeyAt((P[k][0] + P[k + 1][0]) / 2, (P[k][1] + P[k + 1][1]) / 2);
    if (!run || run.key !== key) { run = {key, pts: [P[k]]}; runs.push(run); }
    run.pts.push(P[k + 1]);
  }
  return runs;
}

// Parts of at most MAX_POINTS points; two parts share the cut point.
function splitPoints(pts) {
  const out = [];
  let s = 0;
  while (s < pts.length - 1) {
    const e = Math.min(s + MAX_POINTS - 1, pts.length - 1);
    out.push(pts.slice(s, e + 1));
    s = e;
  }
  return out;
}

function varint(out, v) {
  let x = v >>> 0;
  while (x >= 0x80) { out.push((x & 0x7F) | 0x80); x >>>= 7; }
  out.push(x);
}
const zigzag = v => (v >= 0 ? 2 * v : -2 * v - 1);
const unzigzag = z => (z % 2 === 0 ? z / 2 : -(z + 1) / 2);

// The section bytes for the grey pieces of a version 2 file (parts = decodeWayback output). Returns null when no piece
// is grey. Throws 'grey cell over 2048 B' when one cell body is larger.
export function greyLayer(parts) {
  const pieces = greyPieces(parts);
  if (!pieces.length) return null;
  const byCell = new Map();
  for (const chain of joinChains(pieces)) {
    const pts = simplify(chain.map(v => [parts.nodes[v].x, parts.nodes[v].y]), SIMPLIFY);
    for (const run of cutAtCells(pts)) {
      const cx = (run.key & 0xFFFF) * CELL, cy = (run.key >>> 16) * CELL;
      for (const part of splitPoints(run.pts)) {
        const q = part.map(([x, y]) => [Math.round((x - cx) / QUANTUM), Math.round((y - cy) / QUANTUM)]);
        if (!byCell.has(run.key)) byCell.set(run.key, []);
        byCell.get(run.key).push(q);
      }
    }
  }
  const keys = [...byCell.keys()].sort((a, b) => a - b);
  const bodies = keys.map(key => {
    const out = [];
    const lines = byCell.get(key);
    varint(out, lines.length);
    for (const q of lines) {
      varint(out, q.length);
      out.push(q[0][0] & 0xFF, (q[0][0] >> 8) & 0xFF, q[0][1] & 0xFF, (q[0][1] >> 8) & 0xFF);
      for (let k = 1; k < q.length; k++) {
        varint(out, zigzag(q[k][0] - q[k - 1][0]));
        varint(out, zigzag(q[k][1] - q[k - 1][1]));
      }
    }
    if (out.length > MAX_BODY) throw new Error('grey cell over 2048 B');
    return out;
  });
  const offsets = [];
  let total = 0;
  for (const b of bodies) { offsets.push(total); total += b.length; }
  const n = keys.length;
  const bytes = new Uint8Array(HEADER + (n + 1) * TABLE_ENTRY + total);
  const dv = new DataView(bytes.buffer);
  bytes.set(MAGIC, 0);
  bytes[4] = CELL_SHIFT; bytes[5] = QUANTUM_SHIFT;
  dv.setUint32(8, n, true); dv.setUint32(12, total, true);
  let at = HEADER;
  keys.forEach((key, i) => { dv.setUint32(at, key, true); dv.setUint32(at + 4, offsets[i], true); at += TABLE_ENTRY; });
  dv.setUint32(at, SENTINEL, true); dv.setUint32(at + 4, total, true); at += TABLE_ENTRY;
  for (const b of bodies) { bytes.set(b, at); at += b.length; }
  return bytes;
}

// Reads a section back: {cellShift, quantum, cells: [{key, lines: [[[x, y], ...], ...]}]}, points in way-back units.
export function readGreyLayer(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (b.length < HEADER || MAGIC.some((m, i) => b[i] !== m)) throw new Error('grey layer: bad magic');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = dv.getUint32(8, true), total = dv.getUint32(12, true);
  if (b.length !== HEADER + (n + 1) * TABLE_ENTRY + total) throw new Error('grey layer: lengths do not add up');
  const tableAt = HEADER, bodyAt = HEADER + (n + 1) * TABLE_ENTRY;
  if (dv.getUint32(tableAt + n * TABLE_ENTRY, true) !== SENTINEL) throw new Error('grey layer: no sentinel');
  const cells = [];
  for (let i = 0; i < n; i++) {
    const key = dv.getUint32(tableAt + i * TABLE_ENTRY, true);
    const from = dv.getUint32(tableAt + i * TABLE_ENTRY + 4, true), to = dv.getUint32(tableAt + (i + 1) * TABLE_ENTRY + 4, true);
    if (to < from || to > total) throw new Error('grey layer: cell offsets');
    const body = b.subarray(bodyAt + from, bodyAt + to);
    let p = 0;
    const read = () => {
      let v = 0, shift = 0, byte;
      do { byte = body[p++]; if (byte === undefined) throw new Error('grey layer: short cell'); v += (byte & 0x7F) * 2 ** shift; shift += 7; } while (byte & 0x80);
      return v;
    };
    const cx = (key & 0xFFFF) * CELL, cy = (key >>> 16) * CELL;
    const lines = [];
    const count = read();
    for (let l = 0; l < count; l++) {
      const m = read();
      if (m < 2 || m > MAX_POINTS) throw new Error('grey layer: point count');
      let qx = body[p] | (body[p + 1] << 8), qy = body[p + 2] | (body[p + 3] << 8);
      p += 4;
      const pts = [[cx + qx * QUANTUM, cy + qy * QUANTUM]];
      for (let k = 1; k < m; k++) {
        qx += unzigzag(read()); qy += unzigzag(read());
        pts.push([cx + qx * QUANTUM, cy + qy * QUANTUM]);
      }
      lines.push(pts);
    }
    cells.push({key, lines});
  }
  return {cellShift: CELL_SHIFT, quantum: QUANTUM, cells};
}
