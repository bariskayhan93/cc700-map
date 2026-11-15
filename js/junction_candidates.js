// Geometric evidence locations, not an access-valid routing graph. In particular
// an untagged barrier or an absent OSM node cannot be decoded from display ways.
const CELL=50, NEAR=12;
const key=(x,y)=>x+','+y;
function index(segments) {
  const grid=new Map();
  for(const s of segments)for(let x=Math.floor(Math.min(s.a[0],s.b[0])/CELL);x<=Math.floor(Math.max(s.a[0],s.b[0])/CELL);x++)
    for(let y=Math.floor(Math.min(s.a[1],s.b[1])/CELL);y<=Math.floor(Math.max(s.a[1],s.b[1])/CELL);y++) {
      const k=key(x,y);(grid.get(k)||grid.set(k,[]).get(k)).push(s);
    }
  return grid;
}
function nearby(grid,p) {
  const out=new Set(),x=Math.floor(p[0]/CELL),y=Math.floor(p[1]/CELL);
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const s of grid.get(key(x+dx,y+dy))||[])out.add(s);
  return out;
}
export function junctionCandidates(P,D,lines,F) {
  const roads=[], local=lines.map(L=>L.pts.map(p=>F.m(p[0],p[1]))), vertices=new Map(), locations=new Map();
  const grade=i=>(lines[i].fl||8)&31;
  const end=(way,p)=>[local[way][0],local[way].at(-1)].some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<.0001);
  const add=(p,ways)=>{
    const k=key(p[0].toFixed(4),p[1].toFixed(4));
    const v=locations.get(k)||{xy:p,ways:new Set()};for(const way of ways)v.ways.add(way);locations.set(k,v);
  };
  local.forEach((pts,way)=>{
    if((lines[way].kind&127)===8)return;
    pts.forEach((p,i)=>{
      const k=key(p[0],p[1]),v=vertices.get(k)||{p,ways:new Set(),degree:0};
      if(!v.ways.has(way)){v.ways.add(way);v.degree+=i===0||i===pts.length-1?1:2;}vertices.set(k,v);
      if(i)roads.push({id:roads.length,way,a:pts[i-1],b:p});
    });
  });
  for(const v of vertices.values())if(v.ways.size>1&&v.degree>=3){
    const ways=[...v.ways];if(ways.every(i=>grade(i)===grade(ways[0]))||ways.some(i=>end(i,v.p)))add(v.p,ways);
  }
  const track=P.slice(1).map((p,i)=>({i:i+1,a:F.m(P[i][0],P[i][1]),b:F.m(p[0],p[1])}));
  const trackGrid=index(track),roadGrid=index(roads),cells=new Set(),pairs=new Set();
  for(const k of trackGrid.keys()){
    const[x,y]=k.split(',').map(Number);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)cells.add(key(x+dx,y+dy));
  }
  for(const k of cells){const segments=roadGrid.get(k)||[];
    for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
      const a=segments[i],b=segments[j];if(a.way===b.way)continue;
      const pair=key(Math.min(a.id,b.id),Math.max(a.id,b.id));if(pairs.has(pair))continue;pairs.add(pair);
      const ax=a.b[0]-a.a[0],ay=a.b[1]-a.a[1],bx=b.b[0]-b.a[0],by=b.b[1]-b.a[1],cross=ax*by-ay*bx;
      if(Math.abs(cross)<1e-8)continue;
      const dx=b.a[0]-a.a[0],dy=b.a[1]-a.a[1],t=(dx*by-dy*bx)/cross,u=(dx*ay-dy*ax)/cross;
      if(t<0||t>1||u<0||u>1)continue;
      const p=[a.a[0]+t*ax,a.a[1]+t*ay];
      if(grade(a.way)===grade(b.way)||end(a.way,p)||end(b.way,p))add(p,[a.way,b.way]);
    }
  }
  const result=[];
  for(const node of locations.values()){
    const [x,y]=node.xy,projections=[];
    for(const {i,a,b} of nearby(trackGrid,node.xy)){
      const vx=b[0]-a[0],vy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*vx+(y-a[1])*vy)/(vx*vx+vy*vy||1)));
      const error=Math.hypot(x-a[0]-t*vx,y-a[1]-t*vy);
      if(error<=NEAR)projections.push({d:D[i-1]+t*(D[i]-D[i-1]),error});
    }
    projections.sort((a,b)=>a.d-b.d);const visits=[];
    for(const q of projections){const last=visits.at(-1);if(last&&q.d-last.end<20){last.end=q.d;if(q.error<last.best.error)last.best=q;}else visits.push({end:q.d,best:q});}
    for(const {best}of visits)result.push({...node,d:best.d});
  }
  return result.sort((a,b)=>a.d-b.d);
}
