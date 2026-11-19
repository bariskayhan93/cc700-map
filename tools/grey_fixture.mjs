// Synthetic grey street parts (decodeWayback form) for the grey tests. Way-back units: 1/16 m.
const node = (x, y, next = -1) => ({x, y, next, grey: 1, distM: 0});

// A square street grid: count x count crossings, spacingM apart, lower-left corner at (x0, y0) units. Rows are node
// chains (next), columns are extra pieces. Every piece is grey.
export function gridParts({spacingM = 60, count = 13, x0 = 40000, y0 = 40000} = {}) {
  const s = spacingM * 16, nodes = [], extras = [];
  for (let j = 0; j < count; j++) for (let i = 0; i < count; i++) nodes.push(node(x0 + i * s, y0 + j * s, i + 1 < count ? j * count + i + 1 : -1));
  for (let j = 0; j + 1 < count; j++) for (let i = 0; i < count; i++) extras.push({a: j * count + i, b: (j + 1) * count + i, grey: 1});
  return {header: {version: 3}, nodes, extras};
}

// Four dead-end arms of 30, 50, 70 and 90 m (east, north, west, south) from one centre (cx, cy) in units.
export function plusParts(cx, cy) {
  const nodes = [node(cx, cy)], extras = [];
  [[1, 0, 30], [0, 1, 50], [-1, 0, 70], [0, -1, 90]].forEach(([dx, dy, m]) => {
    nodes.push(node(cx + dx * m * 16, cy + dy * m * 16));
    extras.push({a: 0, b: nodes.length - 1, grey: 1});
  });
  return {header: {version: 3}, nodes, extras};
}
