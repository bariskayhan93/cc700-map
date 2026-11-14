// Display-only road preparation. Exact source vertices may be anchors; nearby
// roads and segment crossings never imply a connection. This protects shared
// road chains, not arbitrary polygon coverage topology. Source objects and
// navigation geometry remain untouched. Quantization belongs to the final
// serializer, after all blocks have selected from this same prepared geometry.
import { hav, lineLen } from './geo.js';

const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const valid = q => Array.isArray(q) && q.length >= 2 && Number.isFinite(q[0]) && Number.isFinite(q[1]) && Math.abs(q[0]) <= 90 && Math.abs(q[1]) <= 180;
const pointKey = q => `${q[0]},${q[1]}`;
const grade = L => (L.fl || 0) & 31; // bridge, tunnel and source layer; retain all other flags verbatim

function canonicalReverse(pts) {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[pts.length - 1 - i];
    if (a[0] !== b[0]) return a[0] > b[0];
    if (a[1] !== b[1]) return a[1] > b[1];
  }
  return false;
}

function simplify(pts, locked, F, tolerance) {
  const reverse = canonicalReverse(pts);
  const P = reverse ? pts.slice().reverse() : pts;
  const anchors = reverse ? locked.slice().reverse() : locked;
  const M = P.map(q => F.m(...q)), keep = anchors.slice(), stack = [];
  let start = 0;
  for (let i = 1; i < P.length; i++) if (anchors[i]) { stack.push([start, i]); start = i; }
  while (stack.length) {
    const [a,b] = stack.pop(), [ax,ay] = M[a], dx = M[b][0]-ax, dy = M[b][1]-ay, len2 = dx*dx+dy*dy;
    let far = tolerance*tolerance, index = -1;
    for (let i = a+1; i < b; i++) {
      const t = len2 ? Math.max(0,Math.min(1,((M[i][0]-ax)*dx+(M[i][1]-ay)*dy)/len2)) : 0;
      const d2 = (M[i][0]-ax-t*dx)**2 + (M[i][1]-ay-t*dy)**2;
      if (d2 > far) { far = d2; index = i; }
    }
    if (index !== -1) { keep[index] = true; stack.push([a,index],[index,b]); }
  }
  const out = P.filter((_,i)=>keep[i]);
  return reverse ? out.reverse() : out;
}

/** Prepare valid display roads once, before any block/corridor selection.
 * Invalid whole paths are omitted, never spliced across malformed vertices.
 * Every semantic source endpoint is retained. Shared exact coordinates at the
 * same grade are conservatively locked, including shared-chain interior nodes.
 * Output preserves source order and properties, with cloned pts, recomputed box
 * and displaySamples [{q:[lat,lon], vertex:boolean}] for clipDisplayLine.
 */
export function prepareDisplayLines(lines, F, {tolerance = 1.5} = {}) {
  if (!Array.isArray(lines)) throw new TypeError('Display roads must be an array');
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new RangeError('Invalid display tolerance');
  const paths = [];
  for (const L of lines) {
    if (!L || !Array.isArray(L.pts) || L.pts.length < 2 || !L.pts.every(valid)) continue;
    const pts = L.pts.filter((q,i)=>i===0 || !same(q,L.pts[i-1])).map(q=>q.slice(0,2));
    if (pts.length < 2) continue;
    const projected = pts.map(q=>F.m(...q));
    if (!projected.every(q=>q.every(Number.isFinite))) continue;
    paths.push({L,pts});
  }
  const count = new Map();
  for (const {L,pts} of paths) for (const q of pts) {
    const k = grade(L)+':'+pointKey(q); count.set(k,(count.get(k)||0)+1);
  }
  return paths.map(({L,pts})=>{
    const locked = pts.map((q,i)=>i===0 || i===pts.length-1 || count.get(grade(L)+':'+pointKey(q)) > 1);
    const out = simplify(pts,locked,F,tolerance), samples = [], bounds = [Infinity,Infinity,-Infinity,-Infinity];
    for (let i=0;i<out.length;i++) {
      const a=out[i], m=F.m(...a);
      bounds[0]=Math.min(bounds[0],m[0]); bounds[1]=Math.min(bounds[1],m[1]);
      bounds[2]=Math.max(bounds[2],m[0]); bounds[3]=Math.max(bounds[3],m[1]);
      samples.push({q:a,vertex:true});
      if (i+1===out.length) continue;
      const b=out[i+1], rev=canonicalReverse([a,b]), from=rev?b:a, to=rev?a:b;
      // Identical arithmetic for either direction avoids rounding differences
      // when a shared source segment is serialized in reversed ways.
      const n=Math.max(1,Math.ceil(hav(from,to)/15));
      for (let k=1;k<n;k++) { const f=(rev?n-k:k)/n;
        samples.push({q:[from[0]+(to[0]-from[0])*f,from[1]+(to[1]-from[1])*f],vertex:false}); }
    }
    return {...L,pts:out,box:bounds,displaySamples:samples};
  });
}

/** Select contiguous sample segments touching the corridor, with the existing
 * <=15m range-boundary approximation and 8m minimum visible run policy. Only
 * range endpoints and prepared shape vertices are emitted; no block-local
 * simplification can change the road's shape. The predicate receives lat/lon.
 */
export function clipDisplayLine(line, inside) {
  if (!Array.isArray(line?.displaySamples)) throw new TypeError('Prepare display geometry before clipping');
  const samples = line.displaySamples, keep = samples.map(s=>Boolean(inside(s.q))), runs=[];
  let start=-1;
  const flush = end => {
    if (start < 0) return;
    const pts = [samples[start].q];
    for (let i=start+1;i<end;i++) if (samples[i].vertex) pts.push(samples[i].q);
    pts.push(samples[end].q);
    if (lineLen(pts) >= 8) runs.push(pts);
    start=-1;
  };
  for (let i=0;i<samples.length-1;i++) {
    if (keep[i] || keep[i+1]) { if (start<0) start=i; }
    else flush(i);
  }
  flush(samples.length-1);
  return runs;
}
