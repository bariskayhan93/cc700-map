// Overpass emulator over a local OSM JSON (from osm2json.py). Answers the four query kinds of the page.
import fs from 'node:fs';
export function emulator(file) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const N = new Map(Object.entries(d.nodes).map(([k, v]) => [+k, v]));
  const W = new Map(d.ways.map(w => [w[0], w]));
  const complete = w => w[1].every(n => N.has(n));
  const geo = w => w[1].map(n => ({lat: N.get(n)[0], lon: N.get(n)[1]}));
  const inBox = (n, b) => { const p = N.get(n); return p && p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]; };
  const hits = (w, boxes) => w[1].some(n => boxes.some(b => inBox(n, b)));
  const areaTag = t => t.landuse || t.natural || t.leisure || t.waterway;
  const counts = {cell: 0, nodes: 0, routing: 0, far: 0};
  return {counts, async fetch(url, opt) {
    const q = new URLSearchParams(opt.body.toString()).get('data');
    let boxes = [...q.matchAll(/\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/g)].map(m => m.slice(1, 5).map(Number));
    const bb = /\[bbox:([^\]]+)\]/.exec(q); if (bb) boxes = [bb[1].split(',').map(Number)];
    const els = [];
    const wayGeom = w => ({type: 'way', id: w[0], nodes: w[1], geometry: geo(w), tags: w[2]});
    const relGeom = r => ({type: 'relation', id: r[0], tags: r[2], members: r[1].filter(m => m[0] === 'way' && W.has(m[1]) && complete(W.get(m[1]))).map(m => ({type: 'way', ref: m[1], role: m[2], geometry: geo(W.get(m[1]))}))});
    const relHits = r => r[1].some(m => m[0] === 'way' && W.has(m[1]) && hits(W.get(m[1]), boxes));
    if (q.includes('out center')) { counts.nodes++;
      for (const [id, v] of N) if (v[2] && boxes.some(b => inBox(id, b))) els.push({type: 'node', id, lat: v[0], lon: v[1], tags: v[2]});
    } else if (q.includes('rel(bw.roads)')) { counts.routing++;
      const ids = new Set();
      for (const w of d.ways) if (w[2].highway && complete(w) && hits(w, boxes)) { els.push({type: 'way', id: w[0], nodes: w[1], tags: w[2]}); w[1].forEach(n => ids.add(n)); }
      const wayIds = new Set(els.map(e => e.id));
      for (const r of d.rels) if (r[2].type === 'restriction' && r[1].every(m => m[0] !== 'way' || wayIds.has(m[1])) && r[1].every(m => m[0] !== 'node' || N.has(m[1])) && r[1].some(m => m[0] === 'way'))
        { els.push({type: 'relation', id: r[0], tags: r[2], members: r[1].map(m => ({type: m[0], ref: m[1], role: m[2]}))}); r[1].forEach(m => m[0] === 'node' && ids.add(m[1])); }
      for (const n of ids) { const v = N.get(n); els.unshift({type: 'node', id: n, lat: v[0], lon: v[1], ...(v[2] ? {tags: v[2]} : {})}); }
    } else if (!bb && q.includes('landuse~"^(forest')) { counts.far++;
      for (const w of d.ways) if (areaTag(w[2]) && !w[2].highway && complete(w) && hits(w, boxes)) els.push(wayGeom(w));
      for (const r of d.rels) if (r[2].type === 'multipolygon' && areaTag(r[2]) && relHits(r)) els.push(relGeom(r));
    } else { counts.cell++;
      for (const w of d.ways) if ((w[2].highway || w[2].railway || areaTag(w[2])) && complete(w) && hits(w, boxes)) els.push(wayGeom(w));
      for (const r of d.rels) if (r[2].type === 'multipolygon' && areaTag(r[2]) && relHits(r)) els.push(relGeom(r));
    }
    return {url: 'https://overpass-api.de/api/interpreter', ok: true, status: 200, json: async () => ({osm3s: {timestamp_osm_base: '2026-11-01T00:00:00Z'}, elements: els})};
  }};
}
