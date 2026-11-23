// Screen proof of the grey work (cc27, design 8.5). The page selects the cells of each screen as the unit does
// (gl_cells in firmware/wayback/wb_grey.c), adds an upper bound of the unit pixel work (rs_work in firmware/raster) and
// the points of every line in those cells, and removes lines until every screen is inside the caps of the layer header.
// The unit draws all lines of the selected cells and stops at a cap only when the rider's map scale is not 2.5 m/px.
import {encodeGreyLayer, greyCellLines, GREY_CAPS} from './wayback_grey_layer.js';

const ONE = 4096, CELL = 4096, HALF_W = 4800, HALF_L = 4960, MID = 3360, MAX_CELLS = 20, MAX_REMOVALS = 10000;

// sin(d degrees) x 4096, Bhaskara I, integer: the same values as gb_sin of the unit.
const isin = d => { const x = d % 180, p = x * (180 - x), s = Math.trunc(4 * ONE * p / (40500 - p)); return d % 360 < 180 ? s : -s; };

// The cell keys ((cy << 16) | cx) under the heading-up screen of a rider at (x, y) units with course (integer degrees,
// clockwise from north): 600 m wide, 520 m ahead, 100 m behind. Nearest cell centre first, at most 20. Equal to gl_cells.
export function greyCells(x, y, course) {
  const ux = isin(course), uy = isin(course + 90), ax = Math.abs(ux), ay = Math.abs(uy), r = CELL / 2 * (ax + ay);
  const mx = x + Math.trunc(ux * MID / ONE), my = y + Math.trunc(uy * MID / ONE);
  const hx = Math.trunc((HALF_L * ax + HALF_W * ay) / ONE) + 1, hy = Math.trunc((HALF_L * ay + HALF_W * ax) / ONE) + 1;
  const keys = [], d = [];
  for (let cy = (my - hy) >> 12; cy <= (my + hy) >> 12; cy++) {
    for (let cx = (mx - hx) >> 12; cx <= (mx + hx) >> 12; cx++) {
      const dx = cx * CELL + CELL / 2 - x, dy = cy * CELL + CELL / 2 - y, dd = dx * dx + dy * dy;
      if (cx < 0 || cy < 0 || Math.abs(dx * ux + dy * uy - MID * ONE) >= HALF_L * ONE + r || Math.abs(dx * uy - dy * ux) >= HALF_W * ONE + r) continue;
      if (keys.length === MAX_CELLS && dd >= d[MAX_CELLS - 1]) continue;
      let j = keys.length < MAX_CELLS ? (keys.push(0), d.push(0), keys.length - 1) : MAX_CELLS - 1;
      while (j > 0 && d[j - 1] > dd) { d[j] = d[j - 1]; keys[j] = keys[j - 1]; j--; }   // stable: equal distances keep the scan order
      d[j] = dd; keys[j] = ((cy << 16) | cx) >>> 0;
    }
  }
  return keys;
}

// Upper bound of rs_work for the line pts (way-back units) at unitsPerPx (40 = 2.5 m/px), any heading, with the anchor
// rounding of the view: per segment ceil((w + 1) * 1.01 * L) + 5w + 2 (L = length in px), plus n * w^2 for w >= 3.
export function lineWorkBound(pts, w = 4, unitsPerPx = 40) {
  let s = 0;
  for (let k = 1; k < pts.length; k++) s += Math.ceil((w + 1) * 1.01 * Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]) / unitsPerPx) + 5 * w + 2;
  return s + (w >= 3 ? pts.length * w * w : 0);
}
const lengthOf = l => l.slice(1).reduce((s, p, k) => s + Math.hypot(p[0] - l[k][0], p[1] - l[k][1]), 0);

// Rider positions of the proof: a step grid (1,024 units = 64 m) over the layer cells and their 8 neighbours, each at
// `headings` courses. Fixed order: cells by key, then rows, columns, headings.
export function forEachScreen(cells, step, headings, visit) {
  const keys = new Set();
  for (const {key} of cells) {
    const cx = key & 0xFFFF, cy = key >>> 16;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (cx + i >= 0 && cy + j >= 0) keys.add((((cy + j) << 16) | (cx + i)) >>> 0);
  }
  // Interior cells repeat the same headings and offsets. Four cells of margin
  // cover the furthest screen corner. At a frame edge use the clipped selection.
  const interior = [];
  for (const key of [...keys].sort((a, b) => a - b)) {
    const cx = key & 0xFFFF, cy = key >>> 16;
    const reuse = cx >= 4 && cy >= 4 && cx < 65532 && cy < 65532;
    let i = 0;
    for (let y = 0; y < CELL; y += step) for (let x = 0; x < CELL; x += step) for (let h = 0; h < headings; h++, i++) {
      const course = Math.round(h * 360 / headings) % 360, px = cx * CELL + x, py = cy * CELL + y;
      if (!reuse) visit(px, py, course, 0, greyCells(px, py, course));
      else {
        interior[i] ??= greyCells(px, py, course).map(k => k - key);
        visit(px, py, course, key, interior[i]);
      }
    }
  }
}
const costOf = lines => ({work: lines.reduce((s, l) => s + lineWorkBound(l), 0), points: lines.reduce((s, l) => s + l.length, 0)});

// cells: [{key, lines}] (greyCellLines or readGreyLayer form). {screens, over: [{x, y, course}], worstWork, worstPoints}.
export function proveGreyLayer(cells, {pixCap = GREY_CAPS.pixCap, ptCap = GREY_CAPS.ptCap, step = 1024, headings = 16} = {}) {
  const cost = new Map(cells.map(c => [c.key, costOf(c.lines)])), over = [];
  let screens = 0, worstWork = 0, worstPoints = 0;
  forEachScreen(cells, step, headings, (x, y, course, key, offsets) => {
    let work = 0, points = 0;
    for (const offset of offsets) { const c = cost.get(key + offset); if (c) { work += c.work; points += c.points; } }
    screens++;
    worstWork = Math.max(worstWork, work); worstPoints = Math.max(worstPoints, points);
    if (work > pixCap || points > ptCap) over.push({x, y, course});
  });
  return {screens, over, worstWork, worstPoints};
}

// The layer of the grey pieces of parts, fitted to the caps. While a screen is over a cap: in the cells of that screen,
// remove the shortest line with an end point that no other line has; if none, the shortest line; ties by cell key, then
// line index. Removals only lower the sums, so one pass over the screens is enough. {bytes (null: no line left),
// removedKm, removedLines, proof}. Throws after maxRemovals (10,000) removals.
export function fitGreyLayer(parts, {pixCap = GREY_CAPS.pixCap, ptCap = GREY_CAPS.ptCap, maxRemovals = MAX_REMOVALS} = {}) {
  const cells = greyCellLines(parts), byKey = new Map(cells.map(c => [c.key, c]));
  const cost = new Map(cells.map(c => [c.key, costOf(c.lines)])), ends = new Map();
  const pk = p => p[0] + ',' + p[1];
  const count = (l, d) => { for (const p of [l[0], l[l.length - 1]]) ends.set(pk(p), (ends.get(pk(p)) || 0) + d); };
  const own = (l, p) => (pk(l[0]) === pk(p)) + (pk(l[l.length - 1]) === pk(p));
  const dead = l => [l[0], l[l.length - 1]].some(p => ends.get(pk(p)) === own(l, p));
  for (const c of cells) for (const l of c.lines) count(l, 1);
  let removedLines = 0, removedUnits = 0;
  forEachScreen(cells, 1024, 16, (_x, _y, _course, key, offsets) => {
    for (;;) {
      let work = 0, points = 0;
      for (const offset of offsets) {
        const c = cost.get(key + offset);
        if (c) { work += c.work; points += c.points; }
      }
      if (work <= pixCap && points <= ptCap) break;
      const sel = offsets.map(offset => key + offset).filter(k => byKey.has(k));
      if (++removedLines > maxRemovals) throw new Error(`grey fit: more than ${maxRemovals} removals`);
      let best = null;
      for (const k of sel.sort((a, b) => a - b)) byKey.get(k).lines.forEach((l, i) => {
        const cand = {k, i, dead: dead(l), len: lengthOf(l)};
        if (!best || (cand.dead && !best.dead) || (cand.dead === best.dead && cand.len < best.len)) best = cand;
      });
      const c = byKey.get(best.k), [line] = c.lines.splice(best.i, 1);
      count(line, -1);
      removedUnits += best.len;
      cost.set(best.k, costOf(c.lines));
    }
  });
  const left = cells.filter(c => c.lines.length);
  return {bytes: encodeGreyLayer(left, {pixCap, ptCap}), removedKm: removedUnits / 16000, removedLines, proof: proveGreyLayer(left, {pixCap, ptCap})};
}
