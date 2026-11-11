// Preview of the CC700 navigation map, read back from the built file (so it shows what the device will load).
import { parse, unzz, SC } from './pb.js';
import { hav, brg } from './geo.js';
const W = 240, H = 250, MPP = 2.5, POSY = 0.85;
export function readFile(f) {
  const dv = new DataView(f.buffer, f.byteOffset), secs = []; let i = 0x80;
  for (;;) {
    const L = dv.getUint32(i, true); if (!L || L > 16000) break;
    const pts = [];
    for (const [fl, , v] of parse(f.subarray(i + 4, i + 4 + L))) if (fl === 3) { const o = {}; for (const [a, , b] of parse(v)) if (!(a in o)) o[a] = b; pts.push([unzz(o[1]) * SC, unzz(o[2]) * SC, o[5]]); }
    secs.push(pts); i += 4 + L;
  }
  const ioa = dv.getUint32(0x5c, true), blocks = [];
  if (ioa) {
    const L = dv.getUint32(ioa, true), idx = parse(f.subarray(ioa + 4, ioa + 4 + L));
    for (const [fl, , v] of idx) if (fl === 2) {
      const off = parse(v)[0][2], p = ioa + 4 + L + off, bl = dv.getUint32(p, true), js = [];
      for (const [f2, , jv] of parse(f.subarray(p + 4, p + 4 + bl))) if (f2 === 2) {
        const jf = parse(jv), c = {}; const pts = [];
        for (const [a, , b] of jf) { if (a === 6) { const q = {}; for (const [x, , y] of parse(b)) q[x] = y; pts.push([unzz(q[1]) * SC, unzz(q[2]) * SC]); } else if (!(a in c)) c[a] = b; }
        js.push([[unzz(c[3]) * SC, unzz(c[4]) * SC], pts]);
      }
      blocks.push(js);
    }
  }
  return { secs, blocks };
}
export function draw(canvas, model, distM) {
  const { secs, blocks } = model, all = secs.flat(), g = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;
  let n = 0; secs.forEach((s, k) => { if (s[0][2] / 100 <= distM) n = k; });
  const near = d => all.reduce((b, p) => Math.abs(p[2] / 100 - d) < Math.abs(b[2] / 100 - d) ? p : b);
  const me = near(distM), hd = brg(near(distM - 30), near(distM + 30)) * Math.PI / 180, k = Math.cos(me[0] * Math.PI / 180);
  const X = p => { const e = (p[1] - me[1]) * 111320 * k / MPP, nn = (p[0] - me[0]) * 111320 / MPP;
    return [W / 2 + e * Math.cos(hd) - nn * Math.sin(hd), H * POSY - (e * Math.sin(hd) + nn * Math.cos(hd))]; };
  g.fillStyle = '#eef0f2'; g.fillRect(0, 0, W, H); g.lineCap = 'butt';
  const js = blocks[n] || [];
  for (const [c, pts] of js) for (const p of pts) {          // like the firmware: each line grey 8 px, then white 4 px, in file order
    const a = X(c), b = X(p);
    for (const [w, col] of [[8, '#c8d0de'], [4, '#ffffff']]) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); }
  }
  g.strokeStyle = '#1f6fe0'; g.lineWidth = 6; g.lineJoin = 'round'; g.beginPath(); all.forEach((p, i) => i ? g.lineTo(...X(p)) : g.moveTo(...X(p))); g.stroke();
  const x = W / 2, y = H * POSY; g.fillStyle = '#1f6fe0'; g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x - 7, y + 7); g.lineTo(x + 7, y + 7); g.fill();
  return { section: n, entries: js.length };
}
