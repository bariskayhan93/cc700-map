// Original OSM highway observations, before display generalization. This is
// source data, not a navigable graph: no connectivity or permissions are inferred.
export const NAV_SOURCE_VERSION = 1;
const idOK = id => Number.isSafeInteger(id) && id > 0;
const pointOK = p => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
function validWay(w) {
  return w && idOK(w.id) && Array.isArray(w.nodes) && w.nodes.length >= 2 && w.nodes.every(idOK) &&
    Array.isArray(w.pts) && w.pts.length === w.nodes.length && w.pts.every(pointOK) &&
    w.tags && typeof w.tags === 'object' && !Array.isArray(w.tags) && typeof w.tags.highway === 'string' && w.tags.highway.length > 0 && Object.values(w.tags).every(v => typeof v === 'string');
}
const copyWay = w => ({ id: w.id, nodes: [...w.nodes], pts: w.pts.map(p => [...p]), tags: Object.fromEntries(Object.entries(w.tags).sort(([a], [b]) => a.localeCompare(b))) });

// Cells may overlap. Conflicting observations of one way are quarantined rather
// than allowing cell load order to pick an arbitrary version.
export function mergeNavigationSources(cells) {
  const ways = new Map(), conflicts = new Set(), issues = [];
  for (const { key, source } of cells) {
    if (!source) { issues.push({ code: 'missing-cell-source', cell: key }); continue; }
    if (source.version !== NAV_SOURCE_VERSION || !Array.isArray(source.ways) || !Array.isArray(source.issues) || typeof source.complete !== 'boolean') {
      issues.push({ code: 'invalid-cell-source', cell: key }); continue;
    }
    for (const issue of source.issues) issues.push({ ...issue, cell: key });
    if (!source.complete && !source.issues.length) issues.push({ code: 'incomplete-cell-source', cell: key });
    for (const raw of source.ways) {
      if (!validWay(raw)) { issues.push({ code: 'invalid-way', cell: key, ...(idOK(raw?.id) ? { way: raw.id } : {}) }); continue; }
      const w = copyWay(raw);
      if (conflicts.has(w.id)) continue;
      const previous = ways.get(w.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(w)) {
        ways.delete(w.id); conflicts.add(w.id); issues.push({ code: 'conflicting-way', cell: key, way: w.id });
      } else if (!previous) ways.set(w.id, w);
    }
  }
  const nodes = new Map(), conflictingNodes = new Set();
  for (const w of ways.values()) w.nodes.forEach((id, i) => {
    const p = w.pts[i], previous = nodes.get(id);
    if (previous && (previous[0] !== p[0] || previous[1] !== p[1]) && !conflictingNodes.has(id)) {
      conflictingNodes.add(id); issues.push({ code: 'conflicting-node', node: id });
    } else if (!previous) nodes.set(id, p);
  });
  return { version: NAV_SOURCE_VERSION, complete: issues.length === 0, ways: [...ways.values()], issues };
}

// Retain every returned highway way, including access-restricted and short ways
// absent from the display. Raw tags retain conditional/directional facts without
// pretending that an access or routing profile has already interpreted them.
export function captureNavigationSource(elements) {
  const ways = [], issues = [];
  for (const e of elements) {
    if (e.type !== 'way' || !e.tags?.highway) continue;
    const w = { id: e.id, nodes: e.nodes, pts: Array.isArray(e.geometry) ? e.geometry.map(p => [p?.lat, p?.lon]) : null, tags: e.tags };
    if (!validWay(w)) { issues.push({ code: 'invalid-way', ...(idOK(e.id) ? { way: e.id } : {}) }); continue; }
    ways.push(copyWay(w));
  }
  return mergeNavigationSources([{ source: { version: NAV_SOURCE_VERSION, complete: issues.length === 0, ways, issues } }]);
}
