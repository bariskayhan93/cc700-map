// Road pack reader (format: tools/build_pack.py). Data is cached on the phone (Cache API) after one download.
const CACHE = 'cc700-roads-v2';
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
  // browser only: download all chunks once into Cache Storage (offline afterwards)
  static async install(base, onProgress) {
    const cache = await caches.open(CACHE); const idx = await (await fetch(base + 'index.json')).json();
    await cache.put(base + 'index.json', new Response(JSON.stringify(idx)));
    for (let n = 0; n < idx.chunks; n++) {
      const u = base + `c${n}.bin`;
      if (!(await cache.match(u))) await cache.put(u, await fetch(u));
      onProgress && onProgress(n + 1, idx.chunks);
    }
  }
  static async cachedFetcher() {
    const cache = await caches.open(CACHE);
    return async u => (await cache.match(u)) || fetch(u);
  }
}
