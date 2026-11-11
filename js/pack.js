// Road pack reader (format: tools/build_pack.py). Data is cached on the phone (Cache API) after one download.
const CACHE = 'cc700-roads-v3';
function decodeTile(b, olat, olon, scale) {
  let i = 0; const vi = () => { let r = 0, m = 1, x; do { x = b[i++]; r += (x & 127) * m; m *= 128; } while (x & 128); return r; };
  const uz = v => (v % 2) ? -(v + 1) / 2 : v / 2, dec = new TextDecoder(), names = [], lines = [];
  for (let n = vi(); n > 0; n--) { const L = vi(); names.push(dec.decode(b.subarray(i, i + L))); i += L; }
  while (i < b.length) {
    const kind = b[i++], ni = vi(), n = vi(); let la = olat, lo = olon; const pts = [];
    for (let k = 0; k < n; k++) { la += uz(vi()); lo += uz(vi()); pts.push([la / scale, lo / scale]); }
    lines.push({ kind, name: ni ? names[ni - 1] : '', pts });
  }
  return lines;
}
export class RoadPack {
  constructor(base, fetcher) { this.base = base; this.fetch = fetcher || (u => fetch(u)); this.chunks = {}; }
  async init() { this.idx = await (await this.fetch(this.base + 'index.json')).json(); return this; }
  async chunk(n) {
    if (!this.chunks[n]) this.chunks[n] = new Uint8Array(await (await this.fetch(this.base + `c${n}.bin`)).arrayBuffer());
    return this.chunks[n];
  }
  // share of points [lat, lon] that lie in a tile with road data
  coverage(pts) {
    const I = this.idx; let n = 0;
    for (const [la, lo] of pts) if (I.tiles[Math.floor((la - I.lat0) / I.dlat) + ',' + Math.floor((lo - I.lon0) / I.dlon)]) n++;
    return pts.length ? n / pts.length : 0;
  }
  // lines intersecting [lat0,lon0,lat1,lon1] (+ whole tiles)
  async lines(box) {
    const I = this.idx, out = [];
    const r0 = Math.max(0, Math.floor((box[0] - I.lat0) / I.dlat)), r1 = Math.min(I.rows - 1, Math.floor((box[2] - I.lat0) / I.dlat));
    const c0 = Math.max(0, Math.floor((box[1] - I.lon0) / I.dlon)), c1 = Math.min(I.cols - 1, Math.floor((box[3] - I.lon0) / I.dlon));
    for (let r = r0 - 1; r <= r1; r++) for (let c = c0 - 1; c <= c1; c++) {   // -1: lines are stored in the tile of their first point
      const t = I.tiles[r + ',' + c]; if (!t) continue;
      const ch = await this.chunk(t[0]);
      const ls = decodeTile(ch.subarray(t[1], t[1] + t[2]), Math.round((I.lat0 + r * I.dlat) * I.scale), Math.round((I.lon0 + c * I.dlon) * I.scale), I.scale);
      for (const L of ls) if (L.pts.some(p => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3])) out.push(L);
    }
    return out;
  }
  // built-up areas (option B ground) intersecting the box: [[outer ring, ...holes]], rings [[lat, lon]]
  async areas(box) {
    const I = this.idx, A = I.areas, out = []; if (!A) return out;
    if (!this.abin) this.abin = new Uint8Array(await (await this.fetch(this.base + A.file)).arrayBuffer());
    const r0 = Math.max(0, Math.floor((box[0] - I.lat0) / I.dlat)), r1 = Math.min(I.rows - 1, Math.floor((box[2] - I.lat0) / I.dlat));
    const c0 = Math.max(0, Math.floor((box[1] - I.lon0) / I.dlon)), c1 = Math.min(I.cols - 1, Math.floor((box[3] - I.lon0) / I.dlon));
    for (let r = r0 - 1; r <= r1; r++) for (let c = c0 - 1; c <= c1; c++) {
      const t = A.tiles[r + ',' + c]; if (!t) continue;
      const b = this.abin.subarray(t[0], t[0] + t[1]); let i = 0;
      const vi = () => { let v = 0, m = 1, x; do { x = b[i++]; v += (x & 127) * m; m *= 128; } while (x & 128); return v; }, uz = v => (v % 2) ? -(v + 1) / 2 : v / 2;
      const ola = Math.round((I.lat0 + r * I.dlat) * I.scale), olo = Math.round((I.lon0 + c * I.dlon) * I.scale);
      for (let n = vi(); n > 0; n--) { const poly = [];
        for (let k = vi(); k > 0; k--) { let la = ola, lo = olo; const ring = []; for (let m = vi(); m > 0; m--) { la += uz(vi()); lo += uz(vi()); ring.push([la / I.scale, lo / I.scale]); } poly.push(ring); }
        if (poly[0].some(p => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3])) out.push(poly); }
    }
    return out;
  }
  // files of the pack (road chunks + area file)
  static files(idx) { const f = ['index.json']; for (let n = 0; n < idx.chunks; n++) f.push(`c${n}.bin`); if (idx.areas) f.push(idx.areas.file); return f; }
  // browser only: download all chunks once into Cache Storage (offline afterwards)
  static async install(base, onProgress) {
    await caches.delete('cc700-roads-v2');                      // old pack (file names are the same, content is not)
    const cache = await caches.open(CACHE); const idx = await (await fetch(base + 'index.json')).json();
    await cache.put(base + 'index.json', new Response(JSON.stringify(idx)));
    const files = RoadPack.files(idx).slice(1);                 // only missing files are downloaded (update = new files only)
    for (let n = 0; n < files.length; n++) {
      const u = base + files[n];
      if (!(await cache.match(u))) await cache.put(u, await fetch(u));
      onProgress && onProgress(n + 1, files.length);
    }
  }
  static async cachedFetcher() {
    const cache = await caches.open(CACHE);
    return async u => (await cache.match(u)) || fetch(u);
  }
}
