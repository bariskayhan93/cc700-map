// tools/wayback_precision.mjs (cc26 D2, R-PREC): compares version 2 core output with the recorded version 1 output.
// Rules: a node point is within 2 way-back units; the foot point (point 0) is within ceil(piece length / 256) + 2
// units on each axis; a state or reason can differ only when the rider is 14.5 m to 15.5 m from the nearest street.
// Synthetic grid of tools/wayback_fixture.mjs only.
import assert from 'node:assert/strict';

const K = Math.cos(51 * Math.PI / 180);
const xyOf = (la, lo) => [(lo - 7) * 111320 * K, (la - 51) * 111320];

function segDistance(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L));
  return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
}

// Distance in metres from a rider (E7 coordinates) to the nearest street of the grid graph.
export function streetDistanceM(graph, latE7, lonE7) {
  const p = xyOf(latE7 / 1e7, lonE7 / 1e7);
  let best = Infinity;
  for (const e of graph.edges) {
    const a = graph.nodes[e.from].point, b = graph.nodes[e.to].point;
    best = Math.min(best, segDistance(p, xyOf(a[0], a[1]), xyOf(b[0], b[1])));
  }
  return best;
}

// Length in way-back units of the piece with id (E10): a tree piece (node and its next) or an extra piece.
function pieceLength(dec, id) {
  const N = dec.nodes;
  let a, b;
  if (id & 0x800000) {
    const e = dec.extras[id & 0x7FFFFF];
    a = N[e.a];
    b = N[e.b];
  } else {
    a = N[id];
    b = N[a.next];
  }
  assert(a && b, `piece ${id} has no two nodes`);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// Compares one line. dec: decodeWayback of the version 2 file. r: version 2 output. v: version 1 output. Returns
// 'band' when the state or reason differs (the rider is in the band), else 'same'. Throws on any other difference.
export function compareLine(name, dec, r, v, latE7, lonE7, graph) {
  if (r.state !== v.state || r.reason !== v.reason) {
    const d = streetDistanceM(graph, latE7, lonE7);
    assert(d >= 14.5 && d <= 15.5, `${name}: state ${r.state}/${r.reason} against ${v.state}/${v.reason} at ${d.toFixed(3)} m`);
    return 'band';
  }
  if (!r.state) return 'same';
  assert.equal(r.points.length, v.points.length, `${name}: point count`);
  assert(Math.abs(r.distanceDm - v.distanceDm) <= 6, `${name}: distance ${r.distanceDm} against ${v.distanceDm}`);
  const H = dec.header;
  const du = (x, y, lat) => Math.abs(x - y) * (lat ? H.latU : H.lonU) / 65536;   // E7 difference in units
  for (let k = 1; k < r.points.length; k++) {
    assert(du(r.points[k][0], v.points[k][0], true) <= 2 && du(r.points[k][1], v.points[k][1], false) <= 2,
      `${name}: node point ${k} is more than 2 units away`);
  }
  const lim = Math.ceil(pieceLength(dec, r.piece) / 256) + 2;
  assert(du(r.points[0][0], v.points[0][0], true) <= lim && du(r.points[0][1], v.points[0][1], false) <= lim,
    `${name}: foot point is more than ${lim} units away`);
  return 'same';
}
