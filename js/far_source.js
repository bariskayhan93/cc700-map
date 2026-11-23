// Far-map source (23 Nov): green and water areas and river lines from Overpass, one request per route file, with
// geometry. The routing snapshot stays as it is (its validator allows only restriction relations).
const AREA = 'landuse~"^(forest|grass|meadow|recreation_ground|village_green|allotments|cemetery|orchard|reservoir|basin)$"';
const NAT = 'natural~"^(water|wood|scrub|heath|grassland|wetland)$"', LEIS = 'leisure~"^(park|garden|golf_course|nature_reserve)$"';
const WATER = 'waterway~"^(river|stream|canal|riverbank)$"';
import {unionArea} from './routing_snapshot.js';
import {overpass} from './wayback.js';
export function farQuery(boxes) {
  if (!Array.isArray(boxes) || !boxes.length) throw new Error('Invalid box');
  for (const b of boxes) if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite) || b[0] >= b[2] || b[1] >= b[3] || b[2] - b[0] > 1 || b[3] - b[1] > 1) throw new Error('Invalid box');
  if (unionArea(boxes) > 600) throw new Error('Region exceeds bounded study area');
  const st = boxes.map(b => { const x = `(${b.join(',')})`; return `way[${AREA}]${x};way[${NAT}]${x};way[${LEIS}]${x};way[${WATER}]${x};rel[type=multipolygon][${AREA}]${x};rel[type=multipolygon][${NAT}]${x};rel[type=multipolygon][${LEIS}]${x};`; });
  return `[out:json][timeout:90][maxsize:134217728];\n(${st.join('')});\nout geom qt;\n`;
}
const ll = g => (g || []).filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)).map(p => [p.lat, p.lon]);
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
// Join open member lines into closed rings by their end points.
function rings(lines) {
  const open = lines.filter(l => l.length >= 2).map(l => l.slice()), out = [];
  while (open.length) {
    let r = open.shift(), grown = true;
    while (!same(r[0], r.at(-1)) && grown) {
      grown = false;
      for (let i = 0; i < open.length; i++) { const l = open[i];
        if (same(r.at(-1), l[0])) r = r.concat(l.slice(1)); else if (same(r.at(-1), l.at(-1))) r = r.concat(l.slice(0, -1).reverse());
        else continue; open.splice(i, 1); grown = true; break; }
    }
    if (r.length >= 4 && same(r[0], r.at(-1))) out.push(r);
  }
  return out;
}
export function captureFarSource(json) {
  const seen = new Set(), areas = [], waterLines = [];
  for (const e of json?.elements || []) {
    const id = e.type + e.id; if (seen.has(id) || !e.tags) continue;
    if (e.type === 'way') {
      const pts = ll(e.geometry); if (pts.length < 2) continue; seen.add(id);
      if (['river', 'stream', 'canal'].includes(e.tags.waterway)) waterLines.push({id: e.id, tags: e.tags, pts});
      else if (pts.length >= 4 && same(pts[0], pts.at(-1))) areas.push({id: e.id, tags: e.tags, rings: [pts]});
    } else if (e.type === 'relation') {
      const outer = rings((e.members || []).filter(m => m.type === 'way' && m.role !== 'inner').map(m => ll(m.geometry)));
      if (!outer.length) continue; seen.add(id); areas.push({id: e.id, tags: e.tags, rings: outer});
    }
  }
  return {areas, waterLines};
}

// The far source of the boxes of a way-back fetch (one request).
export async function loadFarSource(boxes, fetchImpl) { return captureFarSource((await overpass(farQuery(boxes), fetchImpl)).json); }
