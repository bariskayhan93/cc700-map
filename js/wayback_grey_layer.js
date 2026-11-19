// Grey layer, section type 2 of the route file (cc27, layer version 2; cc26 had version 1 after the way-back extras).
// The page writes the grey streets as polylines, one body per 256 m cell; the unit reads the cells that a frame needs.
// Way-back units: 1/16 m. Cells of 4,096 units. Quantum 8 units (0.5 m), local to the cell corner.
// Layout (little-endian): header 28 B = "CCGL", u8 12 (cell shift), u8 3 (quantum shift), u8 2 (version), u8 log2 stride
// (4, 5 or 6), u32 n cells, u32 body bytes, u32 pixel cap, u32 point cap, u32 m = ceil(n / stride) directory keys;
// then m x u32 (the key of cell stride * j); then (n + 1) x {u32 key, u32 body offset} (sentinel key 0xFFFFFFFF, offset =
// body bytes); then the bodies. Body: varint lines; per line varint m (2..32), u16 qx, u16 qy, then (m - 1) zigzag deltas.
const MAGIC = [0x43, 0x43, 0x47, 0x4C];      // "CCGL"
const CELL_SHIFT = 12, QUANTUM_SHIFT = 3, VERSION = 2;
const CELL = 1 << CELL_SHIFT, QUANTUM = 1 << QUANTUM_SHIFT;
const SIMPLIFY = 40;                         // Douglas-Peucker tolerance, 2.5 m (one pixel at 2.5 m per pixel)
const MAX_POINTS = 32;                       // GL_POINTS of the unit
const MAX_BODY = 2048;                       // GL_BODY of the unit: the largest cell body
const MAX_KEYS = 256, MAX_CELLS = 16384;     // directory keys; cells at stride 64
const HEADER = 28, TABLE_ENTRY = 8, SENTINEL = 0xFFFFFFFF;
export const GREY_CAPS = {pixCap: 60000, ptCap: 2048};   // design 8.5 start values

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

// The grey lines of the parts (decodeWayback form), by cell: [{key, lines: [[[x, y], ...], ...]}], keys ascending, points in
// way-back units on the 0.5 m grid of the cell. A line has 2 to 32 points; two parts of one chain share the cut point.
export function greyCellLines(parts) {
  const byCell = new Map();
  for (const chain of joinChains(greyPieces(parts))) {
    const pts = simplify(chain.map(v => [parts.nodes[v].x, parts.nodes[v].y]), SIMPLIFY);
    for (const run of cutAtCells(pts)) {
      const cx = (run.key & 0xFFFF) * CELL, cy = (run.key >>> 16) * CELL;
      for (const part of splitPoints(run.pts)) {
        if (!byCell.has(run.key)) byCell.set(run.key, []);
        byCell.get(run.key).push(part.map(([x, y]) => [cx + QUANTUM * Math.round((x - cx) / QUANTUM), cy + QUANTUM * Math.round((y - cy) / QUANTUM)]));
      }
    }
  }
  return [...byCell.keys()].sort((a, b) => a - b).map(key => ({key, lines: byCell.get(key)}));
}

// Layer bytes of cells (greyCellLines form, keys ascending) with the caps in the header. null when there is no cell.
// Throws 'grey cell over 2048 B' (one body) and 'grey layer over 16,384 cells': the page then writes no layer.
export function encodeGreyLayer(cells, {pixCap = GREY_CAPS.pixCap, ptCap = GREY_CAPS.ptCap} = {}) {
  const n = cells.length;
  if (!n) return null;
  if (n > MAX_CELLS) throw new Error('grey layer over 16,384 cells');
  const bodies = cells.map(({key, lines}) => {
    const out = [], cx = (key & 0xFFFF) * CELL, cy = (key >>> 16) * CELL;
    varint(out, lines.length);
    for (const line of lines) {
      const q = line.map(([x, y]) => [(x - cx) / QUANTUM, (y - cy) / QUANTUM]);
      if (q.length < 2 || q.length > MAX_POINTS) throw new Error('grey layer: point count');
      if (q.some(([a, b]) => !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > 512 || b > 512)) throw new Error('grey layer: point outside its cell');
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
  let shift = 4;
  while (Math.ceil(n / (1 << shift)) > MAX_KEYS) shift++;
  const stride = 1 << shift, m = Math.ceil(n / stride);
  const total = bodies.reduce((t, b) => t + b.length, 0);
  const bytes = new Uint8Array(HEADER + 4 * m + (n + 1) * TABLE_ENTRY + total), dv = new DataView(bytes.buffer);
  bytes.set(MAGIC, 0);
  bytes[4] = CELL_SHIFT; bytes[5] = QUANTUM_SHIFT; bytes[6] = VERSION; bytes[7] = shift;
  [n, total, pixCap, ptCap, m].forEach((v, i) => dv.setUint32(8 + 4 * i, v, true));
  for (let j = 0; j < m; j++) dv.setUint32(HEADER + 4 * j, cells[stride * j].key, true);
  let at = HEADER + 4 * m, off = 0;
  cells.forEach((c, i) => { dv.setUint32(at, c.key, true); dv.setUint32(at + 4, off, true); at += TABLE_ENTRY; off += bodies[i].length; });
  dv.setUint32(at, SENTINEL, true); dv.setUint32(at + 4, total, true); at += TABLE_ENTRY;
  for (const b of bodies) { bytes.set(b, at); at += b.length; }
  return bytes;
}

// The layer bytes for the grey pieces of the parts, with the caps in the header and no proof (fitGreyLayer in
// js/screen_proof.js proves and fits). null when no piece is grey.
export function greyLayer(parts, caps = {}) { return encodeGreyLayer(greyCellLines(parts), caps); }

// Reads a layer back (version 2 only): {version, stride, pixCap, ptCap, cells: [{key, lines}]}, points in way-back units.
export function readGreyLayer(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (b.length < HEADER || MAGIC.some((m, i) => b[i] !== m)) throw new Error('grey layer: bad magic');
  if (b[4] !== CELL_SHIFT || b[5] !== QUANTUM_SHIFT) throw new Error('grey layer: bad cell or quantum shift');
  if (b[6] !== VERSION) throw new Error('grey layer: version ' + b[6] + ' (cc27 reads version 2)');
  if (b[7] < 4 || b[7] > 6) throw new Error('grey layer: bad stride');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), stride = 1 << b[7];
  const [n, total, pixCap, ptCap, m] = [0, 1, 2, 3, 4].map(i => dv.getUint32(8 + 4 * i, true));
  if (!n || m !== Math.ceil(n / stride) || m > MAX_KEYS) throw new Error('grey layer: bad directory count');
  if (b.length !== HEADER + 4 * m + (n + 1) * TABLE_ENTRY + total) throw new Error('grey layer: lengths do not add up');
  const tableAt = HEADER + 4 * m, bodyAt = tableAt + (n + 1) * TABLE_ENTRY;
  if (dv.getUint32(tableAt + n * TABLE_ENTRY, true) !== SENTINEL) throw new Error('grey layer: no sentinel');
  for (let j = 0; j < m; j++) if (dv.getUint32(HEADER + 4 * j, true) !== dv.getUint32(tableAt + stride * j * TABLE_ENTRY, true)) throw new Error('grey layer: directory key');
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
  return {version: VERSION, stride, pixCap, ptCap, cells};
}
