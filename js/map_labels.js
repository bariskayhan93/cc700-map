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
// cc27 (design 8.6): landmark labels. OSM amenity=drinking_water, amenity=place_of_worship + religion=christian,
// shop=supermarket; the text is the OSM name, else the type word; labelName keeps 23 ASCII characters.
export const LANDMARK_TEXT={water:'Trinkwasser',church:'Kirche',supermarket:'Supermarkt'};
export function landmarkName(type,name) { return labelName(name || LANDMARK_TEXT[type] || ''); }
const STEP=10, CLEAR=20, REACH=300, TOUCH=5, TURN=Math.cos(30*Math.PI/180);
// The name position of one street line: the middle of its longest straight stretch (turns below 30 degrees) whose
// points are 20 to 300 m from the route and 20 m or more from each junction (a vertex that another line shares).
// Also whether the line touches the route (5 m or less): a street that the route uses or crosses.
function namePosition(pts,M,junction,near) {
  const J=M.filter((m,i)=>junction(pts[i])), lengths=[0], run=[0];
  for(let i=1;i<M.length;i++) lengths.push(lengths.at(-1)+Math.hypot(M[i][0]-M[i-1][0],M[i][1]-M[i-1][1]));
  for(let i=1;i+1<M.length;i++) {
    const a=[M[i][0]-M[i-1][0],M[i][1]-M[i-1][1]],b=[M[i+1][0]-M[i][0],M[i+1][1]-M[i][1]],la=Math.hypot(...a),lb=Math.hypot(...b);
    run.push(run.at(-1)+(la && lb && (a[0]*b[0]+a[1]*b[1])/(la*lb)<TURN ? 1 : 0));
  }
  const at=d=>{let i=1;while(i<M.length-1 && lengths[i]<d)i++;const t=(d-lengths[i-1])/(lengths[i]-lengths[i-1] || 1);
    return {i,q:[pts[i-1][0]+t*(pts[i][0]-pts[i-1][0]),pts[i-1][1]+t*(pts[i][1]-pts[i-1][1])],m:[M[i-1][0]+t*(M[i][0]-M[i-1][0]),M[i-1][1]+t*(M[i][1]-M[i-1][1])]};};
  let best=null,start=null,prev=null,touch=false;
  const length=lengths.at(-1);
  for(let d=0;d<=length+1e-9;d+=STEP) {
    const s=at(Math.min(d,length)),r=near(...s.m,REACH)[0],j=J.length?Math.min(...J.map(p=>Math.hypot(p[0]-s.m[0],p[1]-s.m[1]))):Infinity;
    if(r<=TOUCH)touch=true;
    const ok=r>=CLEAR && r<=REACH && j>=CLEAR, k=run[s.i-1];
    if(ok && start && prev===k) start.b=d; else start=ok?{a:d,b:d}:null;
    prev=ok?k:null;
    if(start && (!best || start.b-start.a>best.b-best.a)) best={...start};
  }
  return {touch,length,pos:best?at((best.a+best.b)/2):null};
}
// Candidates of a route, chosen once before block clipping. Order: streets that the route uses or crosses (route names
// or touching lines), then landmarks, then other streets by class and length; one candidate for each line.
export function prepareLabelCandidates(lines,F,near,routeNames=new Set(),landmarks=[]) {
  const owner=new Map();
  lines.forEach((L,k)=>{for(const p of L.pts||[]){const key=p[0]+','+p[1],o=owner.get(key);if(o===undefined)owner.set(key,k);else if(o!==k)owner.set(key,-1);}});
  const junction=p=>owner.get(p[0]+','+p[1])===-1;
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
    const {touch,length,pos}=namePosition(pts,M,junction,near);
    if(length<8 || !pos)continue;
    const id=`${name}:${L.cls}:${Math.round(pos.q[0]*1e7)},${Math.round(pos.q[1]*1e7)}`;
    candidates.push({name,cls:L.cls,d:near(...pos.m,REACH)[0],q:pos.q,m:pos.m,id,len:length,priority:routeNames.has(L.name) || touch?0:2});
  }
  for (const k of landmarks) {
    const name=landmarkName(k.type,k.name), m=F.m(...k.q), d=near(...m,REACH)[0];
    if(!name || !(d<=REACH))continue;
    candidates.push({name,cls:12,d,q:k.q,m,id:`${name}:12:${Math.round(k.q[0]*1e7)},${Math.round(k.q[1]*1e7)}`,len:0,priority:1});
  }
  candidates.sort((a,b)=>a.priority-b.priority || a.cls-b.cls || (a.priority===2 ? b.len-a.len : a.d-b.d) || compare(a.id,b.id));
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
