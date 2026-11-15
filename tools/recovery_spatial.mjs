// Bounded spatial sampling, not continuous coverage or live progress evidence.
import {hav} from '../js/geo.js';
import {planRecovery} from './recovery_planner.mjs';
import {SegmentIndex,projectSegment} from './recovery_association.mjs';
import {encodeGraphPacket,encodeLegLookup,encodeVisitIndex,encodeAssociationIndex} from './recovery_graph_packet.mjs';
import {encodeStudyLeg} from './recovery_leg_packet.mjs';
export function nearestRoute(route,point){
 if(!Array.isArray(route)||route.length<2||route.length>100000)throw Error('Invalid route');
 const k=Math.cos(point[0]*Math.PI/180),rows=[];let best=Infinity;
 for(let i=1;i<route.length;i++){
  const a=route[i-1],b=route[i],ax=(a.point[1]-point[1])*111320*k,ay=(a.point[0]-point[0])*111320,dx=(b.point[1]-a.point[1])*111320*k,dy=(b.point[0]-a.point[0])*111320,L=dx*dx+dy*dy;
  const t=L?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/L)):0,d=Math.hypot(ax+t*dx,ay+t*dy),progress=a.progress+(b.progress-a.progress)*t;
  if(d<best)best=d;if(d<=best+5)rows.push({distanceMeters:d,progress});
 }
 const close=rows.filter(r=>r.distanceMeters<=best+5).sort((a,b)=>a.distanceMeters-b.distanceMeters||a.progress-b.progress);
 return {...close[0],ambiguousProgress:Math.max(...close.map(r=>r.progress))-Math.min(...close.map(r=>r.progress))>20000};
}
function hash(id){let h=2166136261;for(const c of String(id))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
export function sampleSpatial(snapshot,route,index,{maxScanned=4096,perStratum=8}={}){
 if(!Number.isInteger(maxScanned)||maxScanned<1||maxScanned>10000||!Number.isInteger(perStratum)||perStratum<1||perStratum>16)throw Error('Spatial sample admission');
 const primary=new Set(snapshot.navigationSource.ways.flatMap(w=>w.nodes)),nodes=snapshot.nodes.filter(n=>primary.has(n.id)).sort((a,b)=>hash(a.id)-hash(b.id)||a.id-b.id).slice(0,maxScanned);
 const [s,w,n,e]=snapshot.provenance.bbox,candidates=[];let boundaryExcluded=0,outsideBands=0;
 for(const p of nodes){
  const [lat,lon]=p.point,boundary=Math.min((lat-s)*111320,(n-lat)*111320,(lon-w)*111320*Math.cos(lat*Math.PI/180),(e-lon)*111320*Math.cos(lat*Math.PI/180));
  if(boundary<100){boundaryExcluded++;continue;}
  const near=nearestRoute(route,p.point);if(near.distanceMeters<50||near.distanceMeters>3000){outsideBands++;continue;}
  candidates.push({node:p.id,point:p.point,hash:hash(p.id),distanceMeters:near.distanceMeters,anchorProgress:Math.round(near.progress),ambiguousProgress:near.ambiguousProgress,
   band:Math.ceil(near.distanceMeters/1000),density:index.near(p.point,100).length});
 }
 for(let band=1;band<=3;band++){const ranked=candidates.filter(c=>c.band===band).sort((a,b)=>a.density-b.density||a.hash-b.hash||a.node-b.node);
  ranked.forEach((c,i)=>c.densityTier=Math.min(2,Math.floor(i/Math.max(1,ranked.length)*3)));}
 const samples=[],strata=[];
 for(let band=1;band<=3;band++)for(let tier=0;tier<3;tier++){
  const pool=candidates.filter(c=>c.band===band&&c.densityTier===tier).sort((a,b)=>a.hash-b.hash||a.node-b.node),selected=pool.slice(0,perStratum);
  samples.push(...selected);strata.push({band,densityTier:tier,eligible:pool.length,sampled:selected.length,minSegments:pool.length?Math.min(...pool.map(p=>p.density)):null,maxSegments:pool.length?Math.max(...pool.map(p=>p.density)):null});
 }
 return {sampling:'deterministic hashed original nodes before access filtering; disjoint whole-route distance bands; within-band rank thirds of original segments within 100 m',
  scanned:nodes.length,boundaryExcluded,outsideBands,eligible:candidates.length,perStratum,strata,samples};
}
export function localGraph(graph,center,radiusMeters){
 const nodes=graph.nodes.filter(n=>hav(n.point,center)<=radiusMeters),ids=new Set(nodes.map(n=>n.id));
 return {...graph,nodes,edges:graph.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)),turnRules:graph.turnRules.filter(r=>ids.has(r.via))};
}
const counts=trials=>trials.reduce((r,t)=>{const k=t.status==='candidate'?'candidate':t.reason;r[k]=(r[k]??0)+1;return r;},{});
export function spatialStudy(graph,visits,sampling,route,{generationMaxSettled=50000,sourceIndex=null}={}){
 const trials=[];
 for(const sample of sampling.samples){
  const afterVisit=sample.anchorProgress+2500,throughVisit=Math.min(route.at(-1).progress,sample.anchorProgress+300000);
  const base={...sample,afterVisit,throughVisit};
  if(sample.ambiguousProgress){trials.push({...base,status:'unavailable',reason:'hypothetical-progress-ambiguous'});continue;}
  if(afterVisit>=throughVisit){trials.push({...base,status:'unavailable',reason:'no-forward-window'});continue;}
  const result=planRecovery(graph,{status:'network-node',node:sample.node},visits,{afterVisit,throughVisit});
  let generation=result;
  if(['work-limit','edge-limit','queue-limit'].includes(result.reason))generation=planRecovery(graph,{status:'network-node',node:sample.node},visits,{afterVisit,throughVisit,maxSettled:generationMaxSettled,maxRelaxed:800000,maxQueue:50000});
  trials.push({...base,...generation,boundedResult:{status:result.status,reason:result.reason,settledStates:result.settledNodes??0},
   generationRetried:generation!==result});
 }
 const candidates=trials.filter(t=>t.status==='candidate'),packets=candidates.map(encodeStudyLeg);let offset=0;
 const lookupRows=candidates.map((t,i)=>{const row={point:t.geometry[0],afterVisit:t.afterVisit,throughVisit:t.throughVisit,heading:null,offset,length:packets[i].length};offset+=packets[i].length;return row;});
 const lookup=encodeLegLookup(lookupRows),payload=Buffer.concat(packets),activeIds=new Set(graph.nodes.map(n=>n.id));
 const packed=encodeGraphPacket({...graph,turnRules:graph.turnRules.filter(r=>activeIds.has(r.via))});
 const visitPacket=encodeVisitIndex(visits,graph,packed),associationPacket=sourceIndex?encodeAssociationIndex(sourceIndex,graph,packed):null;
 const locals=[];
 for(const fraction of [.25,.5])for(const radius of [1000,2000,3000]){
  const target=route[0].progress+(route.at(-1).progress-route[0].progress)*fraction,center=route.reduce((a,b)=>Math.abs(a.progress-target)<Math.abs(b.progress-target)?a:b).point;
  const g=localGraph(graph,center,radius),p=encodeGraphPacket(g),visitBytes=encodeVisitIndex(visits,g,p).length;
  let associationBytes=null;if(sourceIndex){const ways=sourceIndex.segments.filter(s=>projectSegment(center,s.a,s.b).distanceMeters<=radius+25).map(s=>({id:s.way,nodes:[s.from,s.to],pts:[s.a,s.b],tags:s.tags}));associationBytes=encodeAssociationIndex(new SegmentIndex(ways),g,p).length;}
  locals.push({routeFraction:fraction,radiusMeters:radius,nodes:g.nodes.length,edges:g.edges.length,bytes:p.packet.length,visitBytes,associationBytes,combinedBytes:associationBytes===null?null:p.packet.length+visitBytes+associationBytes});
 }
 return {trials,payload,lookup,graphPacket:packed.packet,visitPacket,associationPacket,summary:{sampling:sampling.sampling,scanned:sampling.scanned,eligible:sampling.eligible,boundaryExcluded:sampling.boundaryExcluded,outsideBands:sampling.outsideBands,
  sampleCount:trials.length,strata:sampling.strata,results:counts(trials),generationRetried:trials.filter(t=>t.generationRetried).length,
  bands:[1,2,3].map(band=>{const selected=trials.filter(t=>t.band===band);return {bandMeters:[(band-1)*1000,band*1000],samples:selected.length,results:counts(selected),boundedCandidates:selected.filter(t=>t.boundedResult?.status==='candidate').length,validatedCyclingPaths:0};}),
  representations:{fullGraphPacketBytes:packed.packet.length,routeVisitIndexBytes:visitPacket.length,sourceAssociationIndexBytes:associationPacket?.length??null,combinedGraphAndIndicesBytes:associationPacket?packed.packet.length+visitPacket.length+associationPacket.length:null,graphFormat:packed.format,inertTurnsOmitted:graph.turnRules.length-graph.turnRules.filter(r=>activeIds.has(r.via)).length,
   localGraphs:locals,precomputedLegBytes:payload.length,exactOriginLookupBytes:lookup.length,combinedPrecomputedBytes:payload.length+lookup.length,
   candidateLegs:candidates.length,maxActiveLegBytes:Math.max(0,...packets.map(p=>p.length)),maxLegPoints:Math.max(0,...candidates.map(t=>t.geometry.length)),
   largestTwoLegPayloadBytes:[...packets].map(p=>p.length).sort((a,b)=>b-a).slice(0,2).reduce((a,b)=>a+b,0),
   lookupCoverage:'exact sampled network positions and hypothetical progress windows only; zero area tolerance',
   excluded:'guidance/labels, production framing, codec implementation on target, runtime allocation/transition overhead and draw timing; exact-origin legs do not cover arbitrary GPS positions'},
  maxGenerationSettledStates:Math.max(0,...trials.map(t=>t.settledNodes??0)),maxGenerationExaminedEdges:Math.max(0,...trials.map(t=>t.relaxedEdges??0)),maxQueue:Math.max(0,...trials.map(t=>t.queuePeak??0)),
  sourceScope:'one regional ride-area snapshot; density ranks are not land-cover labels',originScope:'exact original network nodes; not GPS snapping; nearest ordered visit is a hypothetical prior-progress anchor',validatedCyclingPaths:0,deviceAcceptance:'unvalidated'}};
}
