// Production decision mechanism, with a bounded map-supported straight-passage veto.
import {adiff,hav,brg} from './geo.js';
import {junctionCandidates} from './junction_candidates.js';
// Centimetre-level coordinate retracing is explicit geometry evidence; nearby
// GPS fixes within a metre are not proof of a deliberate reversal.
export function retracedReversals(P,D) {
  const out=[];
  for(let i=1;i<P.length-1;i++)if(hav(P[i-1],P[i+1])<.01 && Math.min(D[i]-D[i-1],D[i+1]-D[i])>=5)out.push(D[i]);
  return out;
}
// A rounded reversal has several same-direction changes in heading, bounded
// by sustained opposite legs along the same mapped road. Unlike exact
// retracing, this permits separated outbound and return lanes.
export function roundedReversals(raw,P,D,lines,F,grid) {
  const out=[], vertices=new Map(P.map((p,i)=>[p,i])), H=raw.slice(1).map((p,i)=>brg(raw[i],p)), R=[0];
  for(let i=1;i<raw.length;i++)R.push(R[i-1]+hav(raw[i-1],raw[i]));
  let run=[];
  const sustained=(i,step,heading)=>{
    let length=0;
    for(let k=step<0?i-1:i;k>=0&&k<H.length;k+=step){
      if(Math.abs(adiff(H[k],heading))>15)break;
      length+=R[k+1]-R[k];if(length>=5)return true;
    }
    return false;
  };
  const support=(start,end)=>{
    if(run.length<3 || R[end]-R[start]>15 || !sustained(start,-1,H[start-1]) || !sustained(end,1,H[end]))return;
    if(Math.abs(adiff(H[end],H[start-1]))<150)return;
    const mid=run.reduce((best,q)=>Math.abs(q.sum-90)<Math.abs(best.sum-90)?q:best,run[0]).i;
    const p=F.m(raw[mid][0],raw[mid][1]),first=F.m(raw[start][0],raw[start][1]),last=F.m(raw[end][0],raw[end][1]);
    const foot=(p,a,b)=>{const vx=b[0]-a[0],vy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*vx+(p[1]-a[1])*vy)/(vx*vx+vy*vy||1)));return Math.hypot(p[0]-a[0]-t*vx,p[1]-a[1]-t*vy);};
    let supported=false;
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const [li,a,b]of grid.get((Math.floor(p[0]/50)+dx)+','+(Math.floor(p[1]/50)+dy))||[]){
      if((lines[li].kind&127)===8)continue;
      const h=Math.atan2(b[0]-a[0],b[1]-a[1])*180/Math.PI,axis=q=>Math.min(Math.abs(adiff(q,h)),Math.abs(adiff(q,h+180)));
      if(axis(H[start-1])<=15&&axis(H[end])<=15&&[p,first,last].every(p=>foot(p,a,b)<=5))supported=true;
    }
    if(!supported)return;
    const best=vertices.get(raw[mid]);
    if(best>0&&best<P.length-1&&!out.some(d=>Math.abs(d-D[best])<5))out.push(D[best]);
  };
  for(let i=1;i<raw.length-1;i++){
    const a=adiff(H[i],H[i-1]), last=run.at(-1);
    if(Math.abs(a)<5||Math.abs(a)>75||(last&&a*last.a<0)){
      if(run.length)support(run[0].i,run.at(-1).i);run=[];
    }
    if(Math.abs(a)>=5&&Math.abs(a)<=75)run.push({i,a,sum:(run.at(-1)?.sum||0)+Math.abs(a)});
  }
  if(run.length)support(run[0].i,run.at(-1).i);
  return out;
}
export function legacyDecisionPoints(P, D, lines, F, grid, supportedReversals = retracedReversals(P,D)) {
  const STEP = 2, total = D.at(-1), cell = 50, at = d => { let lo = 1, hi = D.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (D[m] < d) lo = m + 1; else hi = m; } const i = lo;
    const f = Math.max(0, Math.min(1, (d - D[i - 1]) / ((D[i] - D[i - 1]) || 1)));
    return F.m(P[i - 1][0] + (P[i][0] - P[i - 1][0]) * f, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * f); };
  const hdg = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI;      // compass heading in the local frame
  const segs = (x, y) => { const out = []; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const s of grid.get((Math.floor(x / cell) + dx) + ',' + (Math.floor(y / cell) + dy)) || []) out.push(s); return out; };
  const foot = (x, y, a, b) => { const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1e-9, t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / L2));
    return Math.hypot(x - a[0] - t * vx, y - a[1] - t * vy); };
  const ridable = li => (lines[li].kind & 0x7f) !== 8;
  const LM = new Map(), local = li => { let v = LM.get(li); if (!v) { const q = lines[li].pts.map(x => F.m(x[0], x[1])), s = [0];
    for (let i = 1; i < q.length; i++) s.push(s[i - 1] + Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1])); LM.set(li, v = [q, s]); } return v; };
  const along = (q, s, d) => { let i = 1; while (i < q.length - 1 && s[i] < d) i++; const f = Math.max(0, Math.min(1, (d - s[i - 1]) / ((s[i] - s[i - 1]) || 1)));
    return [q[i - 1][0] + (q[i][0] - q[i - 1][0]) * f, q[i - 1][1] + (q[i][1] - q[i - 1][1]) * f]; };
  const branches = (li, p) => {                                                     // headings of a road away from its point nearest to p
    const [q, s] = local(li); let best = [1e9, 0];
    for (let i = 1; i < q.length; i++) { const a = q[i - 1], b = q[i], vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1e-9, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2));
      const dd = Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy); if (dd < best[0]) best = [dd, s[i - 1] + t * (s[i] - s[i - 1])]; }
    const f = best[1], o = along(q, s, f), out = [];
    if (s.at(-1) - f > 6) out.push(hdg(o, along(q, s, Math.min(s.at(-1), f + 12))));
    if (f > 6) out.push(hdg(o, along(q, s, Math.max(0, f - 12))));
    return out; };
  // 1. map matching every 2 m: nearest ridable road along the direction of travel
  const M = [], runs = [];
  for (let d = 0; d + STEP <= total; d += STEP) {
    const [x, y] = at(d), h = hdg([x, y], at(d + STEP)); let best = null;
    for (const [li, a, b] of segs(x, y)) { if (!ridable(li)) continue;
      const dd = foot(x, y, a, b); if (dd >= 14) continue; const sh = hdg(a, b), da = Math.abs(((h - sh) % 180 + 270) % 180 - 90);
      const sc = dd + da * 0.25; if (!best || sc < best[0]) best = [sc, li]; }
    M.push(best ? best[1] : -1); if (!best) continue; const r = runs.at(-1);
    if (r && r.li === best[1]) r.d1 = d; else runs.push({ li: best[1], d0: d, d1: d });
  }
  const matched = d => { const k = Math.round(d / STEP); for (let j = k - 5; j <= k + 5; j++) if (M[j] === -1) return false; return k >= 0 && k < M.length; };
  // Source geometry anchors the longer probes: accumulated noisy distance can
  // place a shape peak beside a junction rather than at its centre. Do not use
  // this evidence across separate junctions (short departures and re-entries).
  const junctions=junctionCandidates(P,D,lines,F), reversals=supportedReversals;
  const straightPassage=d=>{
    const p=at(d), nodes=[];
    let lo=0,hi=junctions.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(junctions[mid].d<=d-45)lo=mid+1;else hi=mid;}
    for(let i=lo;i<junctions.length&&junctions[i].d<d+45;i++){
      const n=junctions[i];if(Math.hypot(n.xy[0]-p[0],n.xy[1]-p[1])<45)nodes.push(n);
    }
    const unique=new Map(nodes.map(n=>[n.xy[0].toFixed(4)+','+n.xy[1].toFixed(4),n]));
    if(unique.size>1)return false;
    const node=nodes[0], before=nodes.length?Math.min(...nodes.map(n=>n.d)):d, after=nodes.length?Math.max(...nodes.map(n=>n.d)):d;
    if(before<35 || after>total-35 || reversals.some(r=>r>=before-35&&r<=after+35))return false;
    const anchor=node?.xy??p, arms=[];
    const near=new Set(node?.ways||[]);
    if(!node)for(const [li,a,b]of segs(p[0],p[1]))if(ridable(li)&&foot(p[0],p[1],a,b)<8)near.add(li);
    // A short mapped way can carry a real excursion entirely inside the
    // long probes. Roundabouts also need their complete traversal. Neither
    // justifies erasing the intervening trip from distant endpoint headings.
    if([...near].some(li=>(lines[li].kind&128)||local(li)[1].at(-1)<70))return false;
    for(const li of near)for(const q of branches(li,anchor))if(!arms.some(a=>Math.abs(adiff(a,q))<20))arms.push(q);
    if(arms.length<2)return false;
    const average=(centre,offsets)=>{const ps=offsets.map(o=>at(centre+o));return [ps.reduce((v,p)=>v+p[0],0)/ps.length,ps.reduce((v,p)=>v+p[1],0)/ps.length];};
    // Arm selection depends on separation from the next alternative. An
    // absolute 15-degree cap rejects even a clearly selected through arm when
    // noisy accumulated distance makes a 30 m probe physically much shorter.
    const select=heading=>{const a=arms.map(q=>({q,e:Math.abs(adiff(q,heading))})).sort((a,b)=>a.e-b.e);return a[0].e<45&&a[1].e-a[0].e>=10?a[0].q:null;};
    const incoming=select(hdg(anchor,average(before,[-25,-30,-35]))),outgoing=select(hdg(anchor,average(after,[25,30,35])));
    if(incoming===null||outgoing===null||Math.abs(adiff(outgoing,adiff(incoming,180)))>=5)return false;
    const angle=outgoing*Math.PI/180;
    // A real excursion away from the through corridor must keep its maneuver,
    // even if the rider returns to the same junction within the probe window.
    for(let t=before-35;t<=after+35;t+=2){const q=at(t);if(Math.abs((q[0]-anchor[0])*Math.cos(angle)-(q[1]-anchor[1])*Math.sin(angle))>12)return false;}
    return true;
  };
  // 2. the choice at a point: branches of all roads that pass within 8 m, relative to the arriving direction
  const judge = d => {
    if (d < 15 || d > total - 15) return null;
    if(straightPassage(d))return null;
    const p = at(d), hin = hdg(at(d - 15), p), tk = adiff(hdg(p, at(d + 15)), hin), alts = [];
    const near = new Set(); for (const [li, a, b] of segs(p[0], p[1])) if (ridable(li) && foot(p[0], p[1], a, b) < 8) near.add(li);
    for (const li of near) for (const q of branches(li, p)) alts.push(adiff(q, hin));   // per road: onwards and back, 12 m along it
    // A single road's forward and backward arms cannot form a junction.
    // Recording heading error must not turn its own forward arm into an exit.
    const arms = []; for (const q of alts) if (!arms.some(a => Math.abs(adiff(a, q)) < 20)) arms.push(q);
    if (arms.length < 3) return null;
    const other = alts.filter(q => Math.abs(q) < 150 && Math.abs(adiff(q, tk)) > 20);
    if (!other.length) return null;                                                    // no choice: the road only bends
    if (other.some(q => Math.abs(q) < Math.abs(tk) + 10)) return Math.abs(tk) >= 20 ? tk : (tk >= 0 ? 25 : -25);   // another way is as straight or straighter: at least "slight"
    return Math.abs(tk) >= 45 ? tk : null;                                             // the straightest way: only a real turn needs a prompt
  };
  const R = runs.filter(r => r.d1 - r.d0 >= 6), points = [];
  for (let k = 1; k < R.length; k++) { if (R[k].li === R[k - 1].li) continue; const d = R[k - 1].d1, a = judge(d); if (a !== null) points.push({ d, a }); }
  let unmatched=0,run=0,longestUnmatched=0;
  for(const li of M){run=li<0?run+STEP:0;if(li<0)unmatched+=STEP;longestUnmatched=Math.max(longestUnmatched,run);}
  return { points, judge, matched, straightPassage, evidence:{unmatchedMeters:unmatched,longestUnmatchedMeters:longestUnmatched} };
}
