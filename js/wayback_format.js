// CCWB version 1 file format for the way-back street tree. Little-endian, u24 is three bytes.
// Layout: 64-byte header; cells (cell_count + 1 records, last is the sentinel); nodes; extra
// pieces; chunk table (only with exception lists); exception records. See the plan, "File format".
// No graph search here: encode takes a model from wayback_tree.mjs.

const HEADER = 64;
const NONE24 = 0xFFFFFF;
const SENTINEL_KEY = 0xFFFFFFFF;
const LAT_U_Q16 = 11673;      // Q16 units per 1e-7 degree of latitude (16 units per metre)
const MAX_PIECE_UNITS = 1700;  // longest tree edge or extra piece, per axis
const MAX_LEN_DM = 0x3FFF;     // version 1 extra piece length field: 14 bits, 0.1 m
const MAX_LEN_DM_V2 = 0x1FFF;  // version 2 extra piece length field: 13 bits (bit 13 is the grey flag)
const MAX_DIST_M_V2 = 0xFFF;   // version 2 node distance: 12 bits, whole metres

const cellKeyOf = ([X, Y]) => ((Y >> 11) << 16) | (X >> 11);

// Integer frame of the file. points: list of [lat, lon]. Origin is below the smallest node by a margin.
export function makeFrame(points) {
  if (!points.length) throw new Error('frame needs at least one point');
  let minLat = Infinity, minLon = Infinity;
  for (const [la, lo] of points) {
    minLat = Math.min(minLat, Math.round(la * 1e7));
    minLon = Math.min(minLon, Math.round(lo * 1e7));
  }
  const lat0E7 = minLat - 30000, lon0E7 = minLon - 50000;
  const latU = LAT_U_Q16;
  const lonU = Math.round(LAT_U_Q16 * Math.cos(lat0E7 / 1e7 * Math.PI / 180));
  const latE = Math.round(65536 * 65536 / latU);
  const lonE = Math.round(65536 * 65536 / lonU);
  const toUnits = ([la, lo]) => {
    const dLat = Math.round(la * 1e7) - lat0E7, dLon = Math.round(lo * 1e7) - lon0E7;
    return [Math.floor(dLon * lonU / 65536), Math.floor(dLat * latU / 65536)];
  };
  const toE7 = (X, Y) => [lat0E7 + Math.floor(Y * latE / 65536), lon0E7 + Math.floor(X * lonE / 65536)];
  return {lat0E7, lon0E7, latU, lonU, latE, lonE, toUnits, toE7};
}

function putU24(b, off, v) { b[off] = v & 0xFF; b[off + 1] = (v >>> 8) & 0xFF; b[off + 2] = (v >>> 16) & 0xFF; }
function getU24(b, off) { return b[off] | (b[off + 1] << 8) | (b[off + 2] << 16); }

// Layout shared by both versions: frame, node order by cell, distance and next fields, extras and cells.
function layout(model) {
  const N = model.nodes.length;
  if (!N) throw new Error('model has no nodes');
  if (N >= NONE24) throw new Error('node count does not fit the file');
  const frame = makeFrame(model.nodes.map(n => n.point));
  const units = model.nodes.map(n => frame.toUnits(n.point));
  units.forEach(([X, Y], i) => {
    if (X < 0 || Y < 0 || X >= 0x1000000 || Y >= 0x1000000) throw new Error(`node ${i} is outside the grid`);
  });
  const order = model.nodes.map((_, i) => i)
    .sort((a, b) => (cellKeyOf(units[a]) - cellKeyOf(units[b])) || (a - b));
  const newOf = new Int32Array(N);
  order.forEach((old, pos) => { newOf[old] = pos; });
  const nUnits = order.map(i => units[i]);
  const nKey = nUnits.map(cellKeyOf);

  const dists = order.map(i => {
    const dm = Math.round(model.nodes[i].dist * 10);
    if (!(dm >= 0 && dm <= NONE24 - 1)) throw new Error(`distance ${dm} does not fit the node field`);
    return dm;
  });
  const nNext = order.map(i => {
    const nx = model.nodes[i].next;
    if (nx < 0) return NONE24;
    const [ax, ay] = nUnits[newOf[i]], [bx, by] = units[nx];
    if (Math.max(Math.abs(bx - ax), Math.abs(by - ay)) > MAX_PIECE_UNITS) throw new Error('tree edge longer than 1700 units');
    return newOf[nx];
  });

  const extras = model.extras.map(e => {
    const na = newOf[e.a], nb = newOf[e.b];
    const [ax, ay] = units[e.a], [bx, by] = units[e.b];
    if (Math.max(Math.abs(bx - ax), Math.abs(by - ay)) > MAX_PIECE_UNITS) throw new Error('extra piece longer than 1700 units');
    const lenDm = Math.round(e.meters * 10);
    return {a: na, b: nb, lenDm, toA: !!e.toA, toB: !!e.toB, key: nKey[na], ua: units[e.a], ub: units[e.b]};
  }).sort((p, q) => (p.key - q.key) || (p.a - q.a) || (p.b - q.b));

  // Cells: one record per occupied key, then the sentinel.
  const cells = [];
  for (let pos = 0; pos < N;) {
    const key = nKey[pos];
    cells.push({key, firstNode: pos});
    while (pos < N && nKey[pos] === key) pos++;
  }
  let ex = 0;
  for (const c of cells) {
    while (ex < extras.length && extras[ex].key < c.key) ex++;
    c.firstExtra = ex;
  }
  cells.push({key: SENTINEL_KEY, firstNode: N, firstExtra: extras.length});
  return {N, frame, newOf, nUnits, nKey, dists, nNext, extras, cells};
}

export function encodeWayback(model, routeId) {
  if (!(routeId instanceof Uint8Array) || routeId.length !== 16) throw new Error('route id must be 16 bytes');
  const {N, frame, newOf, nUnits, dists, nNext, extras, cells} = layout(model);

  // Exception lists (chunks), each sorted by the new node index.
  const hasChunks = model.chunks.length > 0;
  const chunkStart = [];
  const exc = [];
  for (const list of model.chunks) {
    chunkStart.push(exc.length);
    const recs = list.map(r => {
      if (r.next < 0 || r.node < 0) throw new Error('exception record without a node');
      if (!(r.dist >= 0 && r.dist <= 0xFFFF)) throw new Error(`exception distance ${r.dist} does not fit`);
      return {node: newOf[r.node], next: newOf[r.next], dist: Math.round(r.dist)};
    }).sort((p, q) => p.node - q.node);
    for (const r of recs) exc.push(r);
  }
  if (hasChunks) chunkStart.push(exc.length);

  const cellCount = cells.length - 1;
  const size = HEADER + cells.length * 12 + N * 12 + extras.length * 8
    + (hasChunks ? chunkStart.length * 4 : 0) + exc.length * 8;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set([0x43, 0x43, 0x57, 0x42], 0);
  dv.setUint16(4, 1, true);
  dv.setUint16(6, hasChunks ? 1 : 0, true);
  out.set(routeId, 8);
  dv.setInt32(24, frame.lat0E7, true);
  dv.setInt32(28, frame.lon0E7, true);
  dv.setUint32(32, frame.latU, true);
  dv.setUint32(36, frame.lonU, true);
  dv.setUint32(40, frame.latE, true);
  dv.setUint32(44, frame.lonE, true);
  dv.setUint32(48, N, true);
  dv.setUint32(52, cellCount, true);
  dv.setUint32(56, extras.length, true);
  dv.setUint32(60, hasChunks ? chunkStart.length - 1 : 0, true);

  let off = HEADER;
  for (const c of cells) { dv.setUint32(off, c.key, true); dv.setUint32(off + 4, c.firstNode, true); dv.setUint32(off + 8, c.firstExtra, true); off += 12; }
  for (let i = 0; i < N; i++) {
    putU24(out, off, nUnits[i][0]); putU24(out, off + 3, nUnits[i][1]);
    putU24(out, off + 6, nNext[i]); putU24(out, off + 9, dists[i]);
    off += 12;
  }
  for (const e of extras) {
    if (!(e.lenDm >= 0 && e.lenDm <= MAX_LEN_DM)) throw new Error(`extra piece length ${e.lenDm} does not fit`);
    putU24(out, off, e.a); putU24(out, off + 3, e.b);
    dv.setUint16(off + 6, e.lenDm | (e.toA ? 0x4000 : 0) | (e.toB ? 0x8000 : 0), true); off += 8;
  }
  if (hasChunks) { for (const s of chunkStart) { dv.setUint32(off, s, true); off += 4; } }
  for (const r of exc) { putU24(out, off, r.node); putU24(out, off + 3, r.next); dv.setUint16(off + 6, r.dist, true); off += 8; }
  return out;
}

// Version 2 (cc26, E7, D1b): 8-byte node, one little-endian u64. Bits 0-18: x/2, bits 19-37: y/2 (1/16 m units,
// halved), bits 38-50: next - index as a signed 13-bit delta (0 = no next), bits 51-62: distance in whole metres
// (at most 4,095), bit 63: grey flag of the piece to next. An extra record: lenflags bits 0-12 length in 0.1 m
// (at most 8,191), bit 13 grey flag, bits 14-15 toA and toB. No exception lists. A value that does not fit gives an
// error that names the field. flagOf(a, b) gives the flag of a piece from its unit ends (default: every flag 1).
export function encodeWaybackV2(model, routeId, flagOf = () => 1) {
  if (!(routeId instanceof Uint8Array) || routeId.length !== 16) throw new Error('route id must be 16 bytes');
  const {N, frame, nUnits, dists, nNext, extras, cells} = layout(model);
  const nodeBytes = new Uint8Array(8 * N), nv = new DataView(nodeBytes.buffer);
  for (let i = 0; i < N; i++) {
    const [X, Y] = nUnits[i];
    if (X >= 0x100000) throw new Error('node does not fit version 2: x');
    if (Y >= 0x100000) throw new Error('node does not fit version 2: y');
    let delta = 0, grey = 0n;
    if (nNext[i] !== NONE24) {
      delta = nNext[i] - i;
      if (delta === 0 || delta < -4096 || delta > 4095) throw new Error('node does not fit version 2: next');
      grey = flagOf(nUnits[i], nUnits[nNext[i]]) ? 1n : 0n;
    }
    const metres = Math.round(dists[i] / 10);
    if (!(metres >= 0 && metres <= MAX_DIST_M_V2)) throw new Error('node does not fit version 2: dist');
    const v = BigInt(X >>> 1) | (BigInt(Y >>> 1) << 19n) | (BigInt(delta & 0x1fff) << 38n)
      | (BigInt(metres) << 51n) | (grey << 63n);
    nv.setBigUint64(8 * i, v, true);
  }
  const cellCount = cells.length - 1;
  const out = new Uint8Array(HEADER + cells.length * 12 + 8 * N + extras.length * 8), dv = new DataView(out.buffer);
  out.set([0x43, 0x43, 0x57, 0x42], 0);
  dv.setUint16(4, 2, true);
  dv.setUint16(6, 0, true);                       // no exception lists
  out.set(routeId, 8);
  dv.setInt32(24, frame.lat0E7, true);
  dv.setInt32(28, frame.lon0E7, true);
  dv.setUint32(32, frame.latU, true);
  dv.setUint32(36, frame.lonU, true);
  dv.setUint32(40, frame.latE, true);
  dv.setUint32(44, frame.lonE, true);
  dv.setUint32(48, N, true);
  dv.setUint32(52, cellCount, true);
  dv.setUint32(56, extras.length, true);
  dv.setUint32(60, 0, true);
  let off = HEADER;
  for (const c of cells) { dv.setUint32(off, c.key, true); dv.setUint32(off + 4, c.firstNode, true); dv.setUint32(off + 8, c.firstExtra, true); off += 12; }
  out.set(nodeBytes, off);
  off += 8 * N;
  for (const e of extras) {
    if (!(e.lenDm >= 0 && e.lenDm <= MAX_LEN_DM_V2)) throw new Error('extra piece does not fit version 2: length');
    const grey = flagOf(e.ua, e.ub) ? 0x2000 : 0;
    putU24(out, off, e.a); putU24(out, off + 3, e.b);
    dv.setUint16(off + 6, e.lenDm | grey | (e.toA ? 0x4000 : 0) | (e.toB ? 0x8000 : 0), true); off += 8;
  }
  return out;
}

export function decodeWayback(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (b.length < HEADER) throw new Error('file is shorter than the header');
  if (b[0] !== 0x43 || b[1] !== 0x43 || b[2] !== 0x57 || b[3] !== 0x42) throw new Error('bad magic');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const version = dv.getUint16(4, true);
  if (version !== 1 && version !== 2) throw new Error(`unsupported version ${version}`);
  const flags = dv.getUint16(6, true);
  const nodeCount = dv.getUint32(48, true), cellCount = dv.getUint32(52, true);
  const extraCount = dv.getUint32(56, true), chunkCount = dv.getUint32(60, true);
  if ((flags & 1) !== (chunkCount > 0 ? 1 : 0)) throw new Error('flags and chunk count disagree');
  const header = {
    version, flags, routeId: b.slice(8, 24), lat0E7: dv.getInt32(24, true), lon0E7: dv.getInt32(28, true),
    latU: dv.getUint32(32, true), lonU: dv.getUint32(36, true), latE: dv.getUint32(40, true), lonE: dv.getUint32(44, true),
    nodeCount, cellCount, extraCount, chunkCount,
  };
  const cellsOff = HEADER, nodesOff = cellsOff + (cellCount + 1) * 12;
  const extrasOff = nodesOff + nodeCount * (version === 2 ? 8 : 12), chunksOff = extrasOff + extraCount * 8;
  const chunkBytes = chunkCount ? (chunkCount + 1) * 4 : 0, excOff = chunksOff + chunkBytes;
  if (b.length < excOff) throw new Error('file is shorter than its sections');
  let excCount = 0;
  const table = [];
  if (chunkCount) {
    for (let c = 0; c <= chunkCount; c++) table.push(dv.getUint32(chunksOff + c * 4, true));
    if (table[0] !== 0) throw new Error('chunk table does not start at 0');
    for (let c = 1; c <= chunkCount; c++) if (table[c] < table[c - 1]) throw new Error('chunk table is not ordered');
    excCount = table[chunkCount];
  }
  if (b.length !== excOff + excCount * 8) throw new Error('file size does not match the sections');

  const cells = [];
  for (let i = 0; i <= cellCount; i++) {
    const o = cellsOff + i * 12;
    cells.push({key: dv.getUint32(o, true), firstNode: dv.getUint32(o + 4, true), firstExtra: dv.getUint32(o + 8, true)});
  }
  const nodes = [];
  if (version === 2 && chunkCount) throw new Error('version 2 has no exception lists');
  for (let i = 0; i < nodeCount; i++) {
    if (version === 2) {
      const v = dv.getBigUint64(nodesOff + i * 8, true), d = Number((v >> 38n) & 0x1fffn);
      const next = d === 0 ? -1 : i + (d >= 4096 ? d - 8192 : d);
      if (d !== 0 && (next < 0 || next >= nodeCount)) throw new Error('node next index out of range');
      nodes.push({x: 2 * Number(v & 0x7ffffn), y: 2 * Number((v >> 19n) & 0x7ffffn), next,
        distM: Number((v >> 51n) & 0xfffn), grey: Number(v >> 63n)});
      continue;
    }
    const o = nodesOff + i * 12, nx = getU24(b, o + 6);
    if (nx !== NONE24 && nx >= nodeCount) throw new Error('node next index out of range');
    nodes.push({X: getU24(b, o), Y: getU24(b, o + 3), next: nx === NONE24 ? -1 : nx, distDm: getU24(b, o + 9)});
  }
  const extras = [];
  for (let i = 0; i < extraCount; i++) {
    const o = extrasOff + i * 8, lf = dv.getUint16(o + 6, true);
    const a = getU24(b, o), bb = getU24(b, o + 3);
    if (a >= nodeCount || bb >= nodeCount) throw new Error('extra piece node out of range');
    if (version === 2) extras.push({a, b: bb, lenDm: lf & MAX_LEN_DM_V2, grey: (lf >> 13) & 1, toA: !!(lf & 0x4000), toB: !!(lf & 0x8000)});
    else extras.push({a, b: bb, lenDm: lf & MAX_LEN_DM, toA: !!(lf & 0x4000), toB: !!(lf & 0x8000)});
  }
  const chunks = [];
  for (let c = 0; c < chunkCount; c++) {
    const list = [];
    for (let i = table[c]; i < table[c + 1]; i++) {
      const o = excOff + i * 8, nx = getU24(b, o + 3);
      list.push({node: getU24(b, o), next: nx === NONE24 ? -1 : nx, distM: dv.getUint16(o + 6, true)});
    }
    chunks.push(list);
  }
  return {header, cells, nodes, extras, chunks};
}
