// Map-space candidates are chosen once for a route, before block clipping.
// Screen-space placement mirrors map.c v19; v18 retains its original eligibility.
const ASCII = { ä:'ae', ö:'oe', ü:'ue', Ä:'Ae', Ö:'Oe', Ü:'Ue', ß:'ss', é:'e', è:'e', á:'a', à:'a' };
export function labelName(name) {
  return String(name ?? '').replace(/[^\x20-\x7e]/gu, ch => ASCII[ch] ?? '')
    .replace(/([Ss])trasse\b/g, '$1tr.').trim().slice(0,23);
}
export function labelBox(label, x, y, width=240, height=256) {
  const n=[...label].length;
  if (!n || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  const w=n*7+4, left=x-Math.trunc(w/2), top=y-8;
  if (left<1 || left+w>width-1 || top<1 || top+16>height-1) return null;
  if (left<90 && top+16>height-100) return null;
  return [left,top,left+w,top+16];
}
export function placeLabels(labels, collision=true) {
  const accepted=[], rectangles=[];
  for (const label of labels) {
    if (!label.label || !label.points?.length) continue;
    const box=labelBox(label.label,...label.points[0]);
    if (!box) continue;
    const rect=[box[0]-3,box[1]-3,box[2]+3,box[3]+3];
    if (collision && (accepted.length>=12 || rectangles.some(r=>rect[0]<r[2] && rect[2]>r[0] && rect[1]<r[3] && rect[3]>r[1]))) continue;
    accepted.push({...label,box}); rectangles.push(rect);
  }
  return accepted;
}
const compare=(a,b)=>a<b?-1:a>b?1:0;
export function prepareLabelCandidates(lines,F,near,routeNames=new Set()) {
  const candidates=[];
  for (const L of lines) {
    const name=labelName(L.name);
    if (!name || L.cls<5 || L.cls>7 || L.pts?.length<2 || !L.pts?.every(p=>p.length>=2 && p.slice(0,2).every(Number.isFinite))) continue;
    // Canonical endpoint makes anchors independent of way direction.
    let P=0;
    for(let i=0;i<L.pts.length && !P;i++) {
      const a=L.pts[i],b=L.pts[L.pts.length-1-i];
      P=compare(a[0],b[0]) || compare(a[1],b[1]);
    }
    const pts=P>0?[...L.pts].reverse():L.pts, M=pts.map(p=>F.m(...p));
    const lengths=[0];for(let i=1;i<M.length;i++)lengths.push(lengths.at(-1)+Math.hypot(M[i][0]-M[i-1][0],M[i][1]-M[i-1][1]));
    const length=lengths.at(-1);if(length<8)continue;
    const positions=[];for(let d=60;d<length;d+=120)positions.push(d);
    if(!positions.length)positions.push(length/2);
    let i=1;
    for(const d of positions) {
      while(i<pts.length-1 && lengths[i]<d)i++;
      const t=(d-lengths[i-1])/(lengths[i]-lengths[i-1] || 1);
      const q=[pts[i-1][0]+t*(pts[i][0]-pts[i-1][0]),pts[i-1][1]+t*(pts[i][1]-pts[i-1][1])],m=F.m(...q),distance=near(...m,300)[0];
      if(distance<30 || distance>300)continue;
      const id=`${name}:${L.cls}:${Math.round(q[0]*1e7)},${Math.round(q[1]*1e7)}`;
      candidates.push({name,cls:L.cls,d:distance,q,m,id,priority:routeNames.has(L.name)?0:1});
    }
  }
  candidates.sort((a,b)=>a.priority-b.priority || a.cls-b.cls || a.d-b.d || compare(a.id,b.id));
  const accepted=[],grid=new Map(),cell=450;
  for(const c of candidates) {
    const gx=Math.floor(c.m[0]/cell),gy=Math.floor(c.m[1]/cell);let conflict=false;
    for(let x=gx-1;x<=gx+1&&!conflict;x++)for(let y=gy-1;y<=gy+1&&!conflict;y++)
      conflict=(grid.get(`${x},${y}`)||[]).some(g=>Math.hypot(g.m[0]-c.m[0],g.m[1]-c.m[1])<(g.name===c.name?450:230));
    if(conflict)continue;
    accepted.push(c);const key=`${gx},${gy}`,bucket=grid.get(key)||[];bucket.push(c);grid.set(key,bucket);
  }
  return accepted;
}
export function labelsForBlock(candidates,near) {
  return candidates.filter(l=>near(...l.m,300)[0]<=300).slice(0,12);
}
