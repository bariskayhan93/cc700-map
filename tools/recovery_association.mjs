// PC source association only. Selection is geometric evidence, not a legal connector.
import {hav,brg,adiff} from '../js/geo.js';
const pointOK=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=85&&Math.abs(p[1])<=180;
export function projectSegment(point,a,b){
 if(![point,a,b].every(pointOK))throw Error('Invalid projection point');
 const k=Math.cos(point[0]*Math.PI/180),xy=p=>[(p[1]-point[1])*111320*k,(p[0]-point[0])*111320];
 const [ax,ay]=xy(a),[bx,by]=xy(b),dx=bx-ax,dy=by-ay,len=dx*dx+dy*dy;
 const t=len?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/len)):0;
 return {t,point:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],distanceMeters:Math.hypot(ax+dx*t,ay+dy*t)};
}
export class SegmentIndex{
 constructor(ways,{maxSegments=500000,maxEntries=3000000}={}){
  this.segments=[];this.cells=new Map();this.cellMeters=200;this.lat0=ways[0]?.pts[0]?.[0]??51;
  // Fixed frame must not depend on input order.
  this.lat0=51;if(ways.length){this.lat0=Infinity;for(const w of ways)this.lat0=Math.min(this.lat0,w.pts[0][0]);}this.k=Math.cos(this.lat0*Math.PI/180);
  let entries=0;
  for(const w of [...ways].sort((a,b)=>a.id-b.id))for(let i=1;i<w.nodes.length;i++){
   const a=w.pts[i-1],b=w.pts[i];if(!pointOK(a)||!pointOK(b))throw Error('Invalid source point');
   if(w.nodes[i-1]===w.nodes[i]||hav(a,b)<.01)continue;
   if(this.segments.length>=maxSegments)throw Error('Segment limit');
   const s={key:`${w.id}:${i-1}`,way:w.id,index:i-1,from:w.nodes[i-1],to:w.nodes[i],a,b,tags:w.tags,meters:hav(a,b),bearing:brg(a,b)};
   const id=this.segments.push(s)-1,[x1,y1]=this.cell(a),[x2,y2]=this.cell(b);
   const count=(Math.abs(x1-x2)+1)*(Math.abs(y1-y2)+1);if(count>10000||entries+count>maxEntries)throw Error('Spatial index entry limit');
   for(let x=Math.min(x1,x2);x<=Math.max(x1,x2);x++)for(let y=Math.min(y1,y2);y<=Math.max(y1,y2);y++){
    const key=x+','+y;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(id);entries++;
   }
  }
  this.entries=entries;
 }
 cell(p){return [Math.floor(p[1]*111320*this.k/this.cellMeters),Math.floor(p[0]*111320/this.cellMeters)];}
 near(point,radius=25){
  if(!pointOK(point))throw Error('Invalid association point');if(!Number.isFinite(radius)||radius<=0||radius>100)throw Error('Invalid association radius');
  const [x,y]=this.cell(point),span=Math.ceil(radius/this.cellMeters)+1,ids=new Set();
  for(let dx=-span;dx<=span;dx++)for(let dy=-span;dy<=span;dy++)for(const id of this.cells.get((x+dx)+','+(y+dy))??[]){ids.add(id);if(ids.size>20000)throw Error('Association work limit');}
  return [...ids].map(i=>this.segments[i]).map(segment=>({segment,...projectSegment(point,segment.a,segment.b)})).filter(s=>s.distanceMeters<=radius)
   .sort((a,b)=>a.distanceMeters-b.distanceMeters||a.segment.way-b.segment.way||a.segment.index-b.segment.index);
 }
}
export function associateSegment(index,point,{heading=null,maxMeters=25,ambiguityMeters=5,endpointMeters=2}={}){
 if(heading!==null&&(!Number.isFinite(heading)||heading<0||heading>=360))throw Error('Invalid heading');
 if(!Number.isFinite(ambiguityMeters)||ambiguityMeters<0||!Number.isFinite(endpointMeters)||endpointMeters<0)throw Error('Invalid association bounds');
 const all=index.near(point,maxMeters),unavailable=reason=>({status:'unavailable',reason});
 if(!all.length)return unavailable('outside-association-radius');
 const close=all.filter(c=>c.distanceMeters<=all[0].distanceMeters+ambiguityMeters);
 const candidates=heading===null?close:close.filter(c=>Math.abs(adiff(heading,c.segment.bearing))<=45||Math.abs(adiff(heading,(c.segment.bearing+180)%360))<=45);
 if(!candidates.length)return unavailable('source-heading-conflict');
 // Equal original node pair can be duplicated in ways; do not pick access arbitrarily.
 if(candidates.length>1)return {status:'ambiguous',reason:'competing-source-segments',candidates:candidates.length};
 const best=candidates[0];if(Math.min(best.t,1-best.t)*best.segment.meters<endpointMeters)return {status:'ambiguous',reason:'near-source-endpoint'};
 return {status:'associated',reason:null,...best,heading,validity:'geometric-only-unvalidated'};
}
