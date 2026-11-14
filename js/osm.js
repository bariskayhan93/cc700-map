// Roads and built-up areas on demand. The page asks the Overpass API for OpenStreetMap data per grid cell
// (0.05° x 0.08°, about 5.5 km; the server sees cells, not the route), generalizes it and keeps the result on
// the phone (Cache API). Rules: OSRM bicycle profile access, OpenMapTiles zoom-13 selection.
import { frame, rdp, lineLen } from './geo.js';
import { captureNavigationSource, mergeNavigationSources } from './navsource.js';
const DLAT = 0.05, DLON = 0.08, MARGIN = 0.004;     // cell size; context around a cell for generalization (~400 m)
const REACH = 0.005;                                // cells within ~550 m of the route are loaded
const CELL_V = 8;                                  // 8: optional original navigation source, independent of display lines
const CACHE = 'cc700-osm-v3', MAX_AGE = 30 * 864e5; // a cell is loaded again after 30 days
const API = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];   // fastest first
const HIGHWAY = 'motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|road|service|track|cycleway|path|footway|pedestrian|bridleway';
const BUILT = 'residential|commercial|retail|industrial|garages|railway|construction';
const GREEN_LU = 'forest|grass|meadow|recreation_ground|village_green|allotments|cemetery|orchard|vineyard|greenfield', GREEN_LEI = 'park|garden|playground|pitch|golf_course|nature_reserve', GREEN_NAT = 'wood|scrub|grassland|heath|wetland';
const isBuilt = t => new RegExp('^(' + BUILT + ')$').test(t.landuse || ''), isGreen = t => new RegExp('^(' + GREEN_LU + ')$').test(t.landuse || '') || new RegExp('^(' + GREEN_LEI + ')$').test(t.leisure || '') || new RegExp('^(' + GREEN_NAT + ')$').test(t.natural || '');
// line flags for the styled map (patched firmware): bit 0 bridge, bit 1 tunnel, bits 2-4 layer + 2, bit 5 cycleway
const lflags = t => { const L = Math.max(-2, Math.min(2, parseInt(t.layer) || 0)), br = /^(yes|viaduct|boardwalk)$/.test(t.bridge || ''), tu = /^(yes|culvert)$/.test(t.tunnel || '') || L < 0;
  const cyc = t.highway === 'cycleway' || ((t.highway === 'path' || t.highway === 'footway') && t.bicycle === 'designated');
  return (br ? 1 : 0) | (tu ? 2 : 0) | ((L + 2) << 2) | (cyc ? 32 : 0); };
const KIND = { main: 1, tertiary: 2, street: 3, service: 4, path: 5, track: 6, foot: 7, motorway: 8 };
const set = s => new Set(s.split(' '));
const NO = set('no private agricultural forestry delivery use_sidepath'), YES = set('yes permissive designated');
const HIDE = set('driveway parking_aisle parking drive-through drive-thru emergency_access alley');
const UNPAVED = set('gravel fine_gravel compacted dirt ground grass sand unpaved earth mud pebblestone woodchips grass_paver');
const ROUGH = set('grade2 grade3 grade4 grade5'), ONEWAY = set('yes -1 1'), STREETS = set('main tertiary street');
const light = w => w.kind === 'path' || w.kind === 'track' || w.kind === 'foot';

// road class of a way from its tags (null: not shown)
function kind(t) {
  const h = t.highway.replace(/_link$/, ''), a = t.bicycle ?? t.vehicle ?? t.access, tun = t.tunnel === 'yes';
  const priv = t.access === 'no' || t.access === 'private', foot = h === 'footway' || h === 'pedestrian';
  // motorways and motor roads: shown for orientation only; tunnels closed to bicycles are not shown
  if (h === 'motorway' || (h === 'trunk' && t.motorroad === 'yes')) return tun ? null : 'motorway';
  if (h === 'primary' || h === 'secondary' || h === 'trunk') return tun && (t.bicycle === 'no' || t.motorroad === 'yes' || h === 'trunk') ? null : 'main';
  if (h === 'tertiary') return 'tertiary';
  if (h === 'residential' || h === 'unclassified' || h === 'living_street' || h === 'road') return priv ? null : 'street';
  // footways and pedestrian areas without bicycle permission: shown, but not sidewalks or private ways
  if (foot && !YES.has(t.bicycle)) return t.footway === 'sidewalk' || t.footway === 'crossing' || priv ? null : 'foot';
  if (NO.has(a)) return null;
  if (h === 'service') return HIDE.has(t.service) || /^(private|customers|destination)$/.test(t.access) ? null : t.name || 'service' in t ? 'service' : 'short';
  const unpaved = UNPAVED.has(t.surface) || ROUGH.has(t.tracktype);
  if (h === 'track') return (t.tracktype ?? 'grade3') !== 'grade1' || unpaved ? 'track' : 'path';
  if (h === 'cycleway' || h === 'path' || ((foot || h === 'bridleway') && YES.has(t.bicycle))) return unpaved ? 'track' : 'path';
  return null;
}
const chaikin = p => {
  for (let it = 0; it < 2 && p.length >= 3; it++) {
    const o = [p[0]];
    for (let i = 1; i < p.length; i++) { const [ax, ay] = p[i - 1], [bx, by] = p[i]; o.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]); }
    o.push(p.at(-1)); p = o;
  }
  return p;
};
// Generalization (like a road map at zoom 15). ways: { t tags, kind, refs node ids, pts [[lat, lon]], len m }
function generalize(ways, F) {
  const add = (m, k, v = 1) => m.set(k, (m.get(k) || 0) + v), deg = r => r * 180 / Math.PI, mod = (a, n) => ((a % n) + n) % n;
  // footway pieces that join two drawn roads, and pedestrian streets open to bicycles, become paths
  const used = new Map(); for (const w of ways) if (w.kind !== 'foot') for (const r of w.refs) add(used, r);
  for (const w of ways) if (w.kind === 'foot' && w.t.bicycle !== 'no' && (w.t.highway === 'pedestrian' || (used.get(w.refs[0]) && used.get(w.refs.at(-1)) && w.len < 80))) w.kind = 'path';
  // other footways: only pedestrian streets and named footways; link roads: only named or >= 60 m
  // other footways: detail (coloured map only), except pedestrian streets and named footways; link roads: only named or >= 60 m
  for (const w of ways) if (w.kind === 'foot' && w.t.highway !== 'pedestrian' && !w.t.name) w.detail = true;
  let W = ways.filter(w => !w.t.highway.endsWith('_link') || w.t.name || w.len >= 60);
  // paths: only named ones, or connected path networks >= 150 m
  const par = W.map((_, i) => i), find = a => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; }, at = new Map(), net = new Map();
  W.forEach((w, i) => { if (light(w)) for (const r of w.refs) at.has(r) ? par[find(i)] = find(at.get(r)) : at.set(r, i); });
  W.forEach((w, i) => { if (light(w)) add(net, find(i), w.len); });
  W.forEach((w, i) => { if (light(w) && !w.t.name && net.get(find(i)) < 150) w.detail = true; });   // short networks: detail
  // segment grid (50 m cells, each segment also in the cells around it): nearest segment of another way
  const P = W.map(w => w.pts.map(p => F.m(p[0], p[1]))), grid = new Map(), C = 50, cell = v => Math.floor(v / C);
  P.forEach((p, i) => { for (let n = 1; n < p.length; n++) { const [ax, ay] = p[n - 1], [bx, by] = p[n];
    for (let cx = cell(Math.min(ax, bx)) - 1; cx <= cell(Math.max(ax, bx)) + 1; cx++) for (let cy = cell(Math.min(ay, by)) - 1; cy <= cell(Math.max(ay, by)) + 1; cy++) {
      const k = cx * 1e7 + cy; (grid.get(k) || grid.set(k, []).get(k)).push([i, ax, ay, bx, by]); } } });
  const nearest = (x, y, ok) => { let best = null;
    for (const [i, ax, ay, bx, by] of grid.get(cell(x) * 1e7 + cell(y)) || []) { if (!ok(i)) continue;
      const dx = bx - ax, dy = by - ay, f = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1e-9)));
      const px = ax + f * dx, py = ay + f * dy, d = Math.hypot(x - px, y - py); if (!best || d < best[0]) best = [d, px, py, Math.atan2(dy, dx)]; }
    return best; };
  const out = [];
  W.forEach((w0, i) => { let w = w0, p = P[i]; const t = w.t;
    if (light(w) || t.footway === 'sidewalk' || t.cycleway === 'sidepath') {     // paths along a street (< 22 m, parallel): the street stands for them
      let along = 0;
      p.forEach(([x, y], n) => { const [x2, y2] = p[Math.min(n + 1, p.length - 1)], h = x2 !== x || y2 !== y ? Math.atan2(y2 - y, x2 - x) : null;
        const r = nearest(x, y, j => j !== i && STREETS.has(W[j].kind));
        if (r && r[0] < 22 && (h === null || Math.abs(mod(deg(h - r[3]) + 90, 180) - 90) < 25)) along++; });
      if (along >= 0.6 * p.length) {
        if (!(t.highway === 'cycleway' || t.bicycle === 'designated')) return;   // sidewalk-like path: the street stands for it
        w.detail = true;                                                          // cycle track next to a street: coloured map only
      }
    }
    if (ONEWAY.has(t.oneway) && (STREETS.has(w.kind) || w.kind === 'motorway')) { // dual carriageway (same name and class, opposite direction, < 45 m): one centreline
      const twin = j => j !== i && W[j].kind === w.kind && ONEWAY.has(W[j].t.oneway) && W[j].t.name === t.name; let paired = 0;
      const mid = p.map(([x, y], n) => { const a = p[Math.max(0, n - 1)], b = p[Math.min(p.length - 1, n + 1)], r = nearest(x, y, twin);
        if (!(r && r[0] > 3 && r[0] < 45 && Math.abs(mod(deg(Math.atan2(b[1] - a[1], b[0] - a[0]) - r[3]) + 180, 360) - 180) > 135)) return [x, y];
        paired++; return [(x + r[1]) / 2, (y + r[2]) / 2]; });
      const h = deg(Math.atan2(p.at(-1)[1] - p[0][1], p.at(-1)[0] - p[0][0]));
      const real = { ...w, id: -w.id, detail: true, real: true, navOnly: false, pts: chaikin(p).map(([x, y]) => F.g(x, y)) };   // the real carriageway: coloured map only
      if (paired === p.length && !(h >= -90 && h < 90)) { out.push(real); return; }   // fully paired: one centreline for the turns
      if (paired) { out.push(real); p = mid; w = { ...w, navOnly: true, detail: false }; }
    }
    out.push({ ...w, pts: chaikin(p).map(([x, y]) => F.g(x, y)) });
  });
  return out;
}
const flat = pts => { const f = []; for (const [la, lo] of pts) { const a = Math.round(la * 1e5), o = Math.round(lo * 1e5); if (a !== f.at(-2) || o !== f.at(-1)) f.push(a, o); } return f; };
const unflat = f => { const p = []; for (let i = 0; i < f.length; i += 2) p.push([f[i] / 1e5, f[i + 1] / 1e5]); return p; };
// way pieces of a multipolygon -> closed rings
function stitch(parts) {
  const same = (a, b) => a[0] === b[0] && a[1] === b[1], rings = [];
  while (parts.length) {
    let r = parts.pop();
    while (!same(r[0], r.at(-1))) {
      const i = parts.findIndex(p => same(p[0], r.at(-1)) || same(p.at(-1), r.at(-1))); if (i < 0) break;
      const p = parts.splice(i, 1)[0]; r = r.concat((same(p[0], r.at(-1)) ? p : p.reverse()).slice(1));
    }
    if (same(r[0], r.at(-1))) rings.push(r);
  }
  return rings;
}
// railways: main tracks only; of tracks that run side by side (< 15-30 m) the longest stays
function mainTracks(ways, F, C = 15) {                 // C: cell size (m); parallel tracks within about C are one line
  const seen = new Set(), out = [];
  for (const w of ways.sort((a, b) => b.len - a.len)) {
    const ks = [];
    for (let i = 1; i < w.pts.length; i++) { const [ax, ay] = F.m(...w.pts[i - 1]), [bx, by] = F.m(...w.pts[i]), n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 10));
      for (let k = 0; k <= n; k++) ks.push([Math.floor((ax + (bx - ax) * k / n) / C), Math.floor((ay + (by - ay) * k / n) / C)]); }
    if (ks.filter(([x, y]) => seen.has(x + ',' + y)).length >= 0.6 * ks.length) continue;
    for (const [x, y] of ks) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) seen.add((x + dx) + ',' + (y + dy));
    out.push(w);
  }
  return out;
}
// ring for the grey ground: simplified to 8 m, >= 1500 m², outer rings counter-clockwise and holes clockwise (non-zero fill)
function ring(r, F, outer) {
  r = unflat(flat(r)); if (r.length < 4) return;
  const m = r.map(p => F.m(p[0], p[1])); let far = 0, dm = 0;
  m.forEach(([x, y], i) => { const d = Math.hypot(x - m[0][0], y - m[0][1]); if (d > dm) { dm = d; far = i; } });
  if (dm <= 8) return;
  r = [...rdp(r.slice(0, far + 1), 8, F.m).slice(0, -1), ...rdp(r.slice(far), 8, F.m)]; if (r.length < 4) return;
  let a = 0; r.forEach((p, i) => { if (i) { const [x0, y0] = F.m(...r[i - 1]), [x1, y1] = F.m(...p); a += x0 * y1 - x1 * y0; } });
  if (Math.abs(a) / 2 >= 1500) return (a > 0) !== outer ? r.reverse() : r;
}
const inside = ([y, x], r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][0] > y) !== (r[j][0] > y) && x < (r[j][1] - r[i][1]) * (y - r[i][0]) / (r[j][0] - r[i][0]) + r[i][1]) c = !c; return c; };
// Overpass elements of one cell (+ margin) -> { lines: [[id, kind, name, flat points]], areas and water: [[id, [flat ring, ...]]], rails: [[id, flat points]] }
export function buildCell(els, r, c) {
  const navigationSource = captureNavigationSource(els);
  const F = frame((r + 0.5) * DLAT), here = p => Math.floor(p[0] / DLAT) === r && Math.floor(p[1] / DLON) === c;
  const ll = g => g.map(q => [q.lat, q.lon]), ways = [], lines = [], areas = [], water = [], tracks = [], green = [], trams = [], wlines = [], tramWays = [];
  for (const e of els) {
    const t = e.tags || {};
    if (e.type === 'way' && t.highway && (!Array.isArray(e.nodes) || !Array.isArray(e.geometry) || e.geometry.length < 2 || e.geometry.some(p => !p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180))) continue;
    if (e.type === 'way' && t.highway && e.geometry.length > 1) {
      const k = kind(t), pts = ll(e.geometry); if (k) ways.push({ id: e.id, t, kind: k, refs: e.nodes, pts, len: lineLen(pts), here: pts.some(here) });
    } else if (e.type === 'way' && /^(tram|light_rail)$/.test(t.railway || '')) {
      const pts = ll(e.geometry); if (t.tunnel !== 'yes' && pts.length > 1) tramWays.push({ id: e.id, pts, len: lineLen(pts), here: pts.some(here), fl: lflags(t) });
    } else if (e.type === 'way' && t.railway) {
      const pts = ll(e.geometry); if (!t.service && t.tunnel !== 'yes' && pts.length > 1) tracks.push({ id: e.id, pts, len: lineLen(pts), here: pts.some(here), fl: lflags(t) });
    } else if (e.type === 'way' && /^(river|canal|stream)$/.test(t.waterway || '') && t.tunnel !== 'culvert' && t.tunnel !== 'yes') {
      const pts = ll(e.geometry); if (pts.length > 1 && pts.some(here)) wlines.push([e.id, flat(rdp(pts, 3, F.m))]);
    } else if (t.landuse || t.natural || t.waterway || t.leisure) {
      const part = inner => stitch(e.type === 'way' ? (inner ? [] : [ll(e.geometry)]) : e.members.filter(m => m.type === 'way' && m.geometry && (m.role === 'inner') === inner).map(m => ll(m.geometry)));
      const holes = part(true).map(h => ring(h, F, false)).filter(Boolean);
      const to = isBuilt(t) ? areas : isGreen(t) ? green : (t.natural === 'water' || t.waterway) ? water : null;
      if (to) part(false).forEach((raw, n) => { const o = ring(raw, F, true); if (o) to.push([e.type[0] + e.id + '.' + n, [o, ...holes.filter(h => inside(h[0], raw))].map(flat)]); });
    }
  }
  for (const g of generalize(ways, F)) {
    if (!g.here || !KIND[g.kind] || (g.kind === 'service' && lineLen(g.pts) < 50)) continue;
    const f = flat(g.pts); if (f.length >= 4) lines.push([g.id, KIND[g.kind] | (/^(roundabout|circular)$/.test(g.t.junction) ? 0x80 : 0), g.t.name || '', f, lflags(g.t) | (g.detail ? 256 : 0) | (g.navOnly ? 512 : 0) | (g.real ? 1024 : 0)]);   // 1024: real carriageway of a dual carriageway   // 512: centreline of a dual carriageway (turns only)
  }
  const rails = mainTracks(tracks, F).filter(w => w.here).map(w => [w.id, flat(rdp(w.pts, 3, F.m)), w.fl || 0]);
  for (const w of mainTracks(tramWays, F, 6).filter(w => w.here)) trams.push([w.id, flat(rdp(w.pts, 2, F.m)), w.fl || 0]);   // double track: one line
  return { lines, areas, water, rails, green, trams, wlines, navigationSource };
}
async function overpass(r, c) {
  const box = [r * DLAT - MARGIN, c * DLON - MARGIN, (r + 1) * DLAT + MARGIN, (c + 1) * DLON + MARGIN].map(v => v.toFixed(4)).join(',');
  const q = `[out:json][timeout:90][bbox:${box}];(way[highway~"^(${HIGHWAY})(_link)?$"];way[landuse~"^(${BUILT})$"];rel[landuse~"^(${BUILT})$"];way[natural=water];rel[natural=water];way[waterway~"^(dock|riverbank|river|canal|stream)$"];way[railway~"^(rail|tram|light_rail)$"];way[landuse~"^(${GREEN_LU})$"];rel[landuse~"^(${GREEN_LU})$"];way[leisure~"^(${GREEN_LEI})$"];rel[leisure~"^(${GREEN_LEI})$"];way[natural~"^(${GREEN_NAT})$"];rel[natural~"^(${GREEN_NAT})$"];);out geom;`;
  let err;
  for (let n = 0; n < 2 * API.length; n++) {         // server busy or down: the next server; after all of them one more round
    try {
      const res = await fetch(API[n % API.length], { method: 'POST', body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(100000) });
      const j = res.ok ? await res.json() : {}; if (res.ok && !j.remark) return j.elements;
      err = new Error('Overpass ' + (j.remark || res.status));
    } catch (e) { err = e; }
    if (n === API.length - 1) await new Promise(ok => setTimeout(ok, 5000));
  }
  throw err;
}
async function overpassNodes(r, c) {                  // traffic signals and tram stops of a cell
  const box = [r * DLAT, c * DLON, (r + 1) * DLAT, (c + 1) * DLON].map(v => v.toFixed(4)).join(',');
  const q = `[out:json][timeout:60][bbox:${box}];(node[highway=traffic_signals];node[railway=tram_stop];node[public_transport=stop_position][tram=yes];);out;`;
  let err;
  for (let n = 0; n < 2 * API.length; n++) {
    try {
      const res = await fetch(API[n % API.length], { method: 'POST', body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(70000) });
      const j = res.ok ? await res.json() : {}; if (res.ok && !j.remark) return j.elements;
      err = new Error('Overpass ' + (j.remark || res.status));
    } catch (e) { err = e; }
    if (n === API.length - 1) await new Promise(ok => setTimeout(ok, 5000));
  }
  throw err;
}
const phone = {                                       // processed cells on the phone
  get: async k => (await (await caches.open(CACHE)).match('osm/' + k))?.json(),
  put: async (k, v) => (await caches.open(CACHE)).put('osm/' + k, new Response(JSON.stringify(v))),
};
// roads { kind, name, pts }, built-up areas and water [outer ring, ...holes], railways [points] around a track [[lat, lon]]
export async function loadOSM(track, onProgress, store = phone) {
  const cells = new Set(), lines = new Map(), areas = new Map(), water = new Map(), rails = new Map(), green = new Map(), trams = new Map(), wlines = new Map(); let n = 0;
  const signals = new Map(), stops = new Map(), navigationCells = [];
  for (const [la, lo] of track) for (const a of [la - REACH, la + REACH]) for (const o of [lo - REACH * 1.6, lo + REACH * 1.6]) cells.add(Math.floor(a / DLAT) + ',' + Math.floor(o / DLON));
  for (const key of cells) {
    onProgress?.(n++, cells.size);
    let cell = await store.get(key);
    if (!cell || cell.v !== CELL_V && navigator.onLine !== false || (Date.now() - cell.t > MAX_AGE && navigator.onLine !== false)) try {
      const [r, c] = key.split(',').map(Number); cell = { t: Date.now(), v: CELL_V, ...buildCell(await overpass(r, c), r, c) }; await store.put(key, cell);
    } catch (e) { if (!cell) throw new Error('Kartendaten nicht geladen (' + e.message + '). Für eine neue Region ist Internet nötig.'); }   // old cell: still good
    navigationCells.push({ key, source: cell.navigationSource });
    for (const [id, kind, name, f, fl] of cell.lines) if (!lines.has(id)) lines.set(id, { kind, name, pts: unflat(f), fl: fl || 0 });   // a road that crosses cells is in each of them
    for (const [id, rings] of cell.areas) if (!areas.has(id)) areas.set(id, rings.map(unflat));
    for (const [id, rings] of cell.water) if (!water.has(id)) water.set(id, rings.map(unflat));
    for (const [id, f, fl] of cell.rails) if (!rails.has(id)) rails.set(id, Object.assign(unflat(f), { fl: fl || 0 }));   // fl: bridge, tunnel, layer (new cells)
    for (const [id, rings] of cell.green || []) if (!green.has(id)) green.set(id, rings.map(unflat));
    for (const [id, f, fl] of cell.trams || []) if (!trams.has(id)) trams.set(id, Object.assign(unflat(f), { fl: fl || 0 }));
    for (const [id, f] of cell.wlines || []) if (!wlines.has(id)) wlines.set(id, unflat(f));
    let nc = await store.get('n' + key);                // nodes: optional, a failed load only drops the dots
    if (navigator.onLine !== false && (!nc || Date.now() - nc.t > MAX_AGE)) try {
      const [r, c] = key.split(',').map(Number), els = await overpassNodes(r, c);
      nc = { t: Date.now(), sig: els.filter(e => e.tags?.highway === 'traffic_signals').map(e => [e.id, e.lat, e.lon]),
        stop: els.filter(e => e.tags?.railway === 'tram_stop' || e.tags?.tram === 'yes').map(e => [e.id, e.lat, e.lon]) };
      await store.put('n' + key, nc);
    } catch {}
    for (const [id, la, lo] of nc?.sig || []) signals.set(id, [la, lo]);
    for (const [id, la, lo] of nc?.stop || []) stops.set(id, [la, lo]);
  }
  return { navigationSource: mergeNavigationSources(navigationCells), lines: [...lines.values()], areas: [...areas.values()], water: [...water.values()], rails: [...rails.values()],
    green: [...green.values()], trams: [...trams.values()], wlines: [...wlines.values()], signals: [...signals.values()], stops: [...stops.values()] };
}
