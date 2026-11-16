// Route-bound experimental recovery sidecars. Native route bytes are never changed.
import {hav,brg} from '../js/geo.js';
import {planRecovery} from './recovery_planner.mjs';
import {projectSegment} from './recovery_association.mjs';
export const RCP={header:160,row:64,maxBytes:65536,maxPortals:64,maxPoints:512,maxGuards:64};
export function crc32(bytes){let c=0xffffffff;for(let i=0;i<bytes.length;i++){c^=i>=12&&i<16?0:bytes[i];for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
const pointOK=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=85&&Math.abs(p[1])<=180;
const e7=p=>p.map(v=>Math.round(v*1e7));
const u32=v=>Number.isSafeInteger(v)&&v>=0&&v<=0xffffffff;
export function encodeRecoveryPackage(portals,meta){
 if(!Array.isArray(portals)||portals.length>RCP.maxPortals||!pointOK(meta.center)||!u32(meta.entryMin)||!u32(meta.entryMax)||meta.entryMax<=meta.entryMin)throw Error('Package bounds');
 for(const field of ['routeSha256','sourceSha256','policySha256'])if(!/^[a-f0-9]{64}$/.test(meta[field]??''))throw Error('Package identity');
 let guards=0,points=0;
 for(const p of portals){if(!Array.isArray(p.geometry)||p.geometry.length<2||p.geometry.length>RCP.maxPoints||!p.geometry.every(pointOK)||(p.segmentGuards??p.geometry.slice(1).map(()=>p.guards??[])).some(gs=>gs.length>64||!gs.every(g=>pointOK(g.a)&&pointOK(g.b)))||!Number.isFinite(p.distanceMeters)||p.distanceMeters<=0||p.distanceMeters>15000||!u32(p.targetVisit)||p.targetVisit<=meta.entryMax+2500||p.targetVisit>meta.entryMin+300000||!Number.isFinite(p.targetBearing)||p.targetBearing<0||p.targetBearing>=360||hav(p.geometry[0],p.geometry[1])<5)throw Error('Portal limit or semantics');guards+=(p.segmentGuards??p.geometry.slice(1).map(()=>p.guards??[])).reduce((n,gs)=>n+gs.length,0);points+=p.geometry.length;}
 if(points-portals.length>1024)throw Error('Package segment-work limit');
 const guardAt=160+64*portals.length,legAt=guardAt+16*guards,size=legAt+8*points+16*(points-portals.length);if(size>RCP.maxBytes)throw Error('Package byte limit');
 const b=Buffer.alloc(size);b.write('CCRP',0,'ascii');b.writeUInt16LE(1,4);b.writeUInt16LE(1,6);b.writeUInt32LE(size,8);
 ['routeSha256','sourceSha256','policySha256'].forEach((k,i)=>Buffer.from(meta[k],'hex').copy(b,16+32*i));
 b.writeUInt32LE(meta.entryMin,112);b.writeUInt32LE(meta.entryMax,116);b.writeUInt16LE(portals.length,120);b.writeUInt16LE(512,122);b.writeUInt32LE(160,124);b.writeUInt32LE(guardAt,128);b.writeUInt32LE(legAt,132);
 e7(meta.center).forEach((v,i)=>b.writeInt32LE(v,136+4*i));b.writeFloatLE(1.1132*Math.cos(meta.center[0]*Math.PI/180),144);b.writeFloatLE(1.1132,148);
 let g=guardAt,l=legAt;
 portals.forEach((p,i)=>{const at=160+64*i;[...e7(p.geometry[0]),...e7(p.geometry[1])].forEach((v,j)=>b.writeInt32LE(v,at+4*j));
  const gs=p.segmentGuards??p.geometry.slice(1).map(()=>p.guards??[]),segAt=l,pointAt=l+16*(p.geometry.length-1),lengths=p.geometry.slice(1).map((q,j)=>Math.round(hav(p.geometry[j],q)*100));
  b.writeUInt32LE(pointAt,at+16);b.writeUInt16LE(p.geometry.length,at+20);b.writeUInt16LE(gs.reduce((n,a)=>n+a.length,0),at+22);b.writeUInt32LE(g,at+24);b.writeUInt32LE(p.targetVisit,at+28);b.writeUInt32LE(lengths.reduce((n,v)=>n+v,0),at+32);b.writeUInt32LE(segAt,at+52);
  e7(p.geometry.at(-1)).forEach((v,j)=>b.writeInt32LE(v,at+36+4*j));b.writeUInt16LE(Math.round(p.targetBearing*100)%36000,at+44);b.writeUInt16LE(1,at+46);b.writeUInt32LE(i+1,at+48);
  let cumulative=0;gs.forEach((guards,j)=>{const sat=segAt+16*j;b.writeUInt32LE(g,sat);b.writeUInt16LE(guards.length,sat+4);b.writeUInt32LE(cumulative,sat+8);b.writeUInt32LE(lengths[j],sat+12);cumulative+=lengths[j];for(const guard of guards){[...e7(guard.a),...e7(guard.b)].forEach((v,k)=>b.writeInt32LE(v,g+4*k));g+=16;}});l=pointAt;
  for(const point of p.geometry){e7(point).forEach((v,j)=>b.writeInt32LE(v,l+4*j));l+=8;}
 });b.writeUInt32LE(crc32(b),12);return b;
}
export function decodeRecoveryPackage(input,expected={}){
 const b=Buffer.from(input);if(b.length<160||b.length>65536||b.toString('ascii',0,4)!=='CCRP'||b.readUInt16LE(4)!==1||b.readUInt16LE(6)!==1||b.readUInt32LE(8)!==b.length)throw Error('Package header');
 if(crc32(b)!==b.readUInt32LE(12))throw Error('Package CRC');
 for(const [i,k] of ['routeSha256','sourceSha256','policySha256'].entries())if(expected[k]&&b.subarray(16+32*i,48+32*i).toString('hex')!==expected[k])throw Error('Package identity');
 const entryMin=b.readUInt32LE(112),entryMax=b.readUInt32LE(116),n=b.readUInt16LE(120),guardAt=b.readUInt32LE(128),legAt=b.readUInt32LE(132),portals=[];
 if(entryMax<=entryMin||n>64||b.readUInt16LE(122)!==512||b.readUInt32LE(124)!==160||guardAt!==160+64*n||legAt<guardAt||legAt>b.length)throw Error('Package offsets');
 let g=guardAt,l=legAt;
 for(let i=0;i<n;i++){const at=160+64*i,points=b.readUInt16LE(at+20),guardCount=b.readUInt16LE(at+22);
  if(points<2||points>512||guardCount>32704||b.readUInt32LE(at+52)!==l||b.readUInt32LE(at+16)!==l+16*(points-1)||b.readUInt32LE(at+24)!==g||l+points*8+16*(points-1)>b.length||g+guardCount*16>legAt)throw Error('Portal bounds');
  portals.push({points,guardCount,targetVisit:b.readUInt32LE(at+28),distanceCm:b.readUInt32LE(at+32),legOffset:l+16*(points-1),guardOffset:g});g+=guardCount*16;l+=points*8+16*(points-1);
 }if(g!==legAt||l!==b.length)throw Error('Package layout');return {entryMin,entryMax,portals,experimental:true};
}
function intersects(a,b,c,d){const cross=(a,b,c)=>(b[1]-a[1])*(c[0]-a[0])-(b[0]-a[0])*(c[1]-a[1]);return cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0&&Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))&&Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1]));}
export function portalGuards(index,segment){
 const [x1,y1]=index.cell(segment.a),[x2,y2]=index.cell(segment.b),ids=new Set();
 for(let x=Math.min(x1,x2)-1;x<=Math.max(x1,x2)+1;x++)for(let y=Math.min(y1,y2)-1;y<=Math.max(y1,y2)+1;y++)for(const id of index.cells.get(x+','+y)??[]){ids.add(id);if(ids.size>20000)throw Error('Guard source work limit');}
 return [...ids].map(id=>index.segments[id]).filter(s=>s.key!==segment.key).filter(s=>intersects(segment.a,segment.b,s.a,s.b)||Math.min(projectSegment(s.a,segment.a,segment.b).distanceMeters,projectSegment(s.b,segment.a,segment.b).distanceMeters,projectSegment(segment.a,s.a,s.b).distanceMeters,projectSegment(segment.b,s.a,s.b).distanceMeters)<=35).sort((a,b)=>a.way-b.way||a.index-b.index);
}
export function buildPortal(graph,index,segment,direction,visits,meta){
 const s=direction===1?segment:{...segment,a:segment.b,b:segment.a,from:segment.to,to:segment.from,bearing:(segment.bearing+180)%360};
 const unavailable=reason=>({status:'unavailable',reason});
 if(!graph.edges.some(e=>e.from===s.from&&e.to===s.to&&e.way===s.way))return unavailable('direction-not-admitted');
 if(s.meters<8)return unavailable('source-edge-too-short');
 const afterVisit=meta.entryMax+2500,throughVisit=Math.min(meta.entryMin+300000,visits.at(-1)?.progress??0);if(afterVisit>=throughVisit)return unavailable('no-forward-window');
 const t=2.5/s.meters,point=s.a.map((v,i)=>v+(s.b[i]-v)*t),origin={status:'associated',segment:s,t,point,distanceMeters:0};
 const r=planRecovery(graph,origin,visits,{afterVisit,throughVisit,heading:s.bearing,maxSettled:50000,maxRelaxed:800000,maxQueue:50000});
 if(r.status!=='candidate')return unavailable(r.reason);if(r.geometry.length>512||hav(r.geometry[0],r.geometry[1])<5)return unavailable('leg-points-or-first-edge-limit');
 if(!index.byWay){index.byWay=new Map();for(const s of index.segments){if(!index.byWay.has(s.way))index.byWay.set(s.way,[]);index.byWay.get(s.way).push(s);}}
 const sourceSegments=[];for(let i=1;i<r.geometry.length;i++){const a=r.geometry[i-1],b=r.geometry[i],way=r.ways[i-1],matches=(index.byWay.get(way)??[]).filter(s=>projectSegment(a,s.a,s.b).distanceMeters<.2&&projectSegment(b,s.a,s.b).distanceMeters<.2);if(matches.length!==1)return unavailable('leg-source-identity-ambiguous');sourceSegments.push(matches[0]);}
 const own=new Set(sourceSegments.map(s=>s.key)),geometry=[r.geometry[0]],expandedSources=[];
 for(let i=1;i<r.geometry.length;i++){const a=r.geometry[i-1],b=r.geometry[i],pieces=Math.ceil(hav(a,b)/50);for(let j=1;j<=pieces;j++){geometry.push(a.map((v,k)=>v+(b[k]-v)*j/pieces));expandedSources.push(sourceSegments[i-1]);}}
 if(geometry.length>512)return unavailable('subdivided-leg-point-limit');
 const segmentGuards=expandedSources.map((original,i)=>portalGuards(index,{...original,a:geometry[i],b:geometry[i+1]}).filter(g=>!own.has(g.key)));if(segmentGuards.some(gs=>gs.length>64))return unavailable('guard-count-limit');
 const target=visits.find(v=>v.progress===r.target.visit);
 return {status:'candidate',portal:{geometry,distanceMeters:r.distanceMeters,targetVisit:r.target.visit,targetBearing:target.bearing,segmentGuards},source:{way:segment.way,index:segment.index,direction}};
}
export function generateWindow(graph,index,visits,meta,segments){
 const portals=[],rejected={},details=[];const reject=(reason,source)=>{rejected[reason]=(rejected[reason]??0)+1;details.push({source,reason});};
 const unique=[...new Map(segments.map(s=>[s.key,s])).values()].sort((a,b)=>a.way-b.way||a.index-b.index);
 for(const s of unique)for(const direction of [1,-1]){
  const r=buildPortal(graph,index,s,direction,visits,meta);if(r.status!=='candidate'){reject(r.reason,{way:s.way,index:s.index,direction});continue;}
  try{if(portals.reduce((n,p)=>n+p.geometry.length-1,0)+r.portal.geometry.length-1>1024)throw Error('Package segment-work admission');encodeRecoveryPackage([...portals,r.portal],meta);}catch(e){reject('package-admission',{...r.source,message:e.message});continue;}
  portals.push(r.portal);
 }
 const bytes=encodeRecoveryPackage(portals,meta);return {bytes,receipt:{entryMin:meta.entryMin,entryMax:meta.entryMax,sourceEdges:unique.length,portals:portals.length,rejected,bytes:bytes.length,experimental:true,coverage:'directed prepared leg segments; original-source guards; selective seeds; ambiguity unavailable',nativeRouteModified:false},details};
}
