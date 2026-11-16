// PC research only. Structural candidate paths are NOT validated cycling routes.
// No production module imports this file; no device, network or cache writes.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {mergeNavigationSources} from '../js/navsource.js';
import {hav} from '../js/geo.js';
import {snapshotCandidateSource} from './routing_snapshot.mjs';

const idOK=n=>Number.isSafeInteger(n)&&n>0;
const allowed=new Set(['yes','designated','official','permissive']);
const roads=new Set(['residential','living_street','service','unclassified','tertiary','secondary','primary','cycleway']);
const gaps=['barrier-node-tags-not-preserved','turn-restrictions-not-preserved',
 'regional-cycling-profile-not-validated','source-region-completeness-unverified',
 'origin-and-route-visit-association-not-implemented','target-resource-costs-unmeasured'];
const canonical=rows=>rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
export function conservativeWayPolicy(t){
 if(Object.keys(t).some(k=>/^(access|vehicle|bicycle|oneway)(:|$)/.test(k)&&k.includes(':')&&k!=='oneway:bicycle'))return {reason:'unsupported-conditional-or-directional-access'};
 if(t.bicycle&&!allowed.has(t.bicycle))return {reason:'bicycle-access-not-admitted'};
 if(!allowed.has(t.bicycle)){
  if([t.access,t.vehicle].some(v=>v&&!allowed.has(v)))return {reason:'access-not-admitted'};
  if(!roads.has(t.highway))return {reason:'highway-needs-explicit-bicycle-access'};
 }
 if(['motorway','motorway_link','trunk','trunk_link','steps','construction','proposed'].includes(t.highway))return {reason:'unsupported-highway'};
 const direction=t['oneway:bicycle']??t.oneway??(['roundabout','circular'].includes(t.junction)?'yes':'no');
 if(!['yes','1','true','-1','no','0','false'].includes(direction))return {reason:'unknown-direction'};
 return {forward:direction!=='-1',backward:['no','0','false','-1'].includes(direction)};
}
export function buildCandidateGraph(source,{wayPolicy=conservativeWayPolicy}={}){
 const s=mergeNavigationSources([{key:'input',source}]),badNodes=new Set(s.issues.filter(i=>i.code==='conflicting-node').map(i=>i.node));
 const nodes=new Map(),edges=[],excluded=[];
 for(const w of [...s.ways].sort((a,b)=>a.id-b.id)){
  const p=wayPolicy(w.tags),reason=w.nodes.some(n=>badNodes.has(n))?'conflicting-node':p.reason;
  if(reason){excluded.push({way:w.id,reason});continue;}
  w.nodes.forEach((id,i)=>nodes.set(id,{id,point:[...w.pts[i]]}));
  for(let i=1;i<w.nodes.length;i++){
   const a=w.nodes[i-1],b=w.nodes[i];if(a===b)continue;
   const meters=hav(w.pts[i-1],w.pts[i]);
   if(p.forward)edges.push({from:a,to:b,way:w.id,meters});
   if(p.backward)edges.push({from:b,to:a,way:w.id,meters});
  }
 }
 edges.sort((a,b)=>a.from-b.from||a.to-b.to||a.way-b.way);
 return {nodes:[...nodes.values()].sort((a,b)=>a.id-b.id),edges,excluded,issues:canonical([...s.issues]),
  sourceComplete:s.complete,cyclingValidity:'unvalidated'};
}
// Incoming directed edge is essential for same-way U-turns and alternative arrivals.
export function transitionAllowed(rules,incoming,outgoing){
 if(!incoming)return true;
 const applies=rules.filter(r=>r.fromWay===incoming.way&&r.via===outgoing.from);
 const reversal=outgoing.to===incoming.from&&outgoing.way===incoming.way;
 if(reversal&&!applies.some(r=>r.kind==='only_u_turn'&&r.toWay===outgoing.way))return false;
 for(const r of applies){
  const matches=r.toWay===outgoing.way&&(r.fromWay!==r.toWay||reversal);
  if(r.kind.startsWith('no_')&&matches)return false;
  if(r.kind.startsWith('only_')&&!matches)return false;
 }
 return true;
}

// Min heap: host lookup work is reported separately from unknown target timing.
class Queue{
 data=[];
 push(item){const a=this.data;a.push(item);let i=a.length-1;while(i){const p=(i-1)>>1;if(compare(a[p],item)<=0)break;a[i]=a[p];i=p;}a[i]=item;}
 pop(){const a=this.data,out=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&compare(a[c+1],a[c])<0)c++;if(compare(last,a[c])<=0)break;a[i]=a[c];i=c;}a[i]=last;}return out;}
}
const compare=(a,b)=>a.distance-b.distance||a.node-b.node||(a.key??'').localeCompare(b.key??'');
function validateRequest(r){
 if(!idOK(r.origin))throw Error('Invalid origin');
 if(!Number.isSafeInteger(r.afterVisit)||r.afterVisit<0||!Number.isSafeInteger(r.throughVisit)||r.throughVisit<r.afterVisit)throw Error('Invalid visit window');
 if(!Array.isArray(r.targets)||r.targets.some(t=>!idOK(t.node)||!Number.isSafeInteger(t.visit)||t.visit<0||(t.arrivalFrom!==undefined&&(!Array.isArray(t.arrivalFrom)||!t.arrivalFrom.length||!t.arrivalFrom.every(idOK)))))throw Error('Invalid target visits');
 const limits={maxSettled:r.maxSettled??4096,maxRelaxed:r.maxRelaxed??32768,maxQueue:r.maxQueue??8192,maxPathNodes:r.maxPathNodes??2048,maxDistanceMeters:r.maxDistanceMeters??15000};
 for(const [key,value] of Object.entries(limits))if(!Number.isFinite(value)||value<=0||(key!=='maxDistanceMeters'&&!Number.isSafeInteger(value)))throw Error('Invalid '+key);
 return limits;
}
export function findRecovery(graph,request){
 const {maxSettled,maxRelaxed,maxQueue,maxPathNodes,maxDistanceMeters}=validateRequest(request);
 const nodes=new Map(graph.nodes.map(n=>[n.id,n])),adj=new Map(),targets=new Map();
 for(const t of [...request.targets].sort((a,b)=>a.visit-b.visit||a.node-b.node))
  if(t.visit>request.afterVisit&&t.visit<=request.throughVisit&&nodes.has(t.node)){if(!targets.has(t.node))targets.set(t.node,[]);targets.get(t.node).push(t);}
 for(const e of graph.edges){if(!adj.has(e.from))adj.set(e.from,[]);adj.get(e.from).push(e);}
 let settledNodes=0,relaxedEdges=0,queuePeak=1,distanceClipped=false;
 const unavailable=reason=>({origin:request.origin,status:'unavailable',reason,cyclingValidity:'unvalidated',
  distanceMeters:null,target:null,nodes:[],ways:[],geometry:[],settledNodes,relaxedEdges,queuePeak});
 if(!nodes.has(request.origin))return unavailable('unknown-origin');
 if(!targets.size)return unavailable('no-forward-target');
 const turnAware=Array.isArray(graph.turnRules)||request.targets.some(t=>t.arrivalFrom),rulesByNode=new Map();
 if(turnAware)for(const r of graph.turnRules??[]){if(!rulesByNode.has(r.via))rulesByNode.set(r.via,[]);rulesByNode.get(r.via).push(r);}
 if(turnAware&&rulesByNode.has(request.origin))return unavailable('origin-incoming-edge-required');
 const start=String(request.origin),queue=new Queue(),dist=new Map([[start,0]]),parent=new Map(),settled=new Set();
 queue.push({node:request.origin,key:start,distance:0,incoming:null});
 while(queue.data.length){
  const q=queue.pop();if(settled.has(q.key)||q.distance!==dist.get(q.key))continue;
  if(settledNodes>=maxSettled)return unavailable('work-limit');
  settled.add(q.key);settledNodes++;
  const matched=(targets.get(q.node)??[]).find(t=>!t.arrivalFrom||t.arrivalFrom.includes(q.incoming?.from));
  if(matched){
   const ids=[q.node],ways=[];let at=q.key;
   while(at!==start){if(ids.length>=maxPathNodes)return unavailable('path-limit');const p=parent.get(at);ways.push(p.edge.way);ids.push(p.edge.from);at=p.key;}
   ids.reverse();ways.reverse();
   return {origin:request.origin,status:'candidate',reason:null,cyclingValidity:'unvalidated',distanceMeters:q.distance,
    target:{...matched},nodes:ids,ways,geometry:ids.map(n=>[...nodes.get(n).point]),settledNodes,relaxedEdges,queuePeak};
  }
  for(const e of adj.get(q.node)??[]){
   if(relaxedEdges>=maxRelaxed)return unavailable('edge-limit');
   relaxedEdges++;if(turnAware&&!transitionAllowed(rulesByNode.get(q.node)??[],q.incoming,e))continue;
   const key=turnAware?`${e.to}:${e.from}:${e.way}`:String(e.to),d=q.distance+e.meters;if(d>maxDistanceMeters){distanceClipped=true;continue;}
   if(d<(dist.get(key)??Infinity)){if(queue.data.length>=maxQueue)return unavailable('queue-limit');dist.set(key,d);parent.set(key,{key:q.key,edge:e});queue.push({node:e.to,key,distance:d,incoming:e});queuePeak=Math.max(queuePeak,queue.data.length);}
  }
 }
 return unavailable(distanceClipped?'distance-limit':'unreachable');
}
export function evaluateRecovery(input){
 if(!Array.isArray(input.origins)||input.origins.some(n=>!idOK(n)))throw Error('Invalid origins');
 if(new Set(input.origins).size!==input.origins.length)throw Error('Duplicate origins');
 // Validate even an empty study; silently accepting an invalid policy hides gaps.
 validateRequest({...input,origin:input.origins[0]??1});
 if(input.snapshot&&input.source)throw Error('Choose source or snapshot, not both');
 const snapshot=input.snapshot?snapshotCandidateSource(input.snapshot):null;
 const graph=buildCandidateGraph(snapshot?snapshot.source:input.source),nodes=new Map(graph.nodes.map(n=>[n.id,n.point]));
 const reference=input.targets.filter(t=>t.visit>input.afterVisit&&t.visit<=input.throughVisit&&nodes.has(t.node));
 const origins=input.origins.map(origin=>{
  const r=findRecovery(graph,{...input,origin}),point=nodes.get(origin);
  const ds=point?reference.map(t=>hav(point,nodes.get(t.node))):[];
  return {...r,referenceDistanceMeters:ds.length?Math.min(...ds):null};
 });
 const candidates=origins.filter(r=>r.status==='candidate'),jsonBytes=o=>Buffer.byteLength(JSON.stringify(o));
 return {version:1,scope:'offline-structural-candidates-only',targetAcceptance:'unvalidated',
  gaps:[...new Set([...(snapshot?.evidence.integrity==='pass'?gaps.filter(g=>!['barrier-node-tags-not-preserved','turn-restrictions-not-preserved'].includes(g)):gaps),...(snapshot?['turn-restrictions-conservatively-quarantined']:[]),...graph.issues.map(i=>i.code)])].sort(),graph,origins,
  ...(snapshot?{sourceEvidence:snapshot.evidence,sourceExclusions:{ways:snapshot.excludedWays,restrictions:snapshot.excludedRestrictions}}:{}),
  sampling:'explicit graph nodes; cumulative distance to nearest eligible target node, not route-polyline distance or continuous coverage',
  unlocatedOrigins:origins.filter(r=>r.referenceDistanceMeters===null).length,
  rings:[1000,2000,3000].map(radiusMeters=>{
   const selected=origins.filter(r=>r.referenceDistanceMeters!==null&&r.referenceDistanceMeters<=radiusMeters);
   return {radiusMeters,sampledOrigins:selected.length,candidatePaths:selected.filter(r=>r.status==='candidate').length,
    unavailable:selected.filter(r=>r.status==='unavailable').map(r=>({origin:r.origin,reason:r.reason})),validatedCyclingPaths:0};
  }),
  representations:{displayOnly:{recoveryPaths:0},graph:{format:'UTF-8 JSON of reported graph',jsonBytes:jsonBytes(graph)},
   legs:{format:'UTF-8 JSON of candidate results including geometry',jsonBytes:jsonBytes(candidates),paths:candidates.length}},
  decodedTargetMemoryBytes:null,targetTransitionPeakBytes:null,targetLookupTimeMs:null};
}
export function auditNavigationCache(directory){
 const files=fs.readdirSync(directory).filter(n=>/^-?\d+,-?\d+\.json$/.test(n)).sort();
 let withOriginalSource=0,legacyDisplayOnly=0,invalid=0,sourceWays=0;const identity=createHash('sha256');
 for(const name of files){
  const bytes=fs.readFileSync(path.join(directory,name));identity.update(name+'\0').update(bytes).update('\0');
  try{const cell=JSON.parse(bytes),s=cell.navigationSource;if(!s){legacyDisplayOnly++;continue;}
   const merged=mergeNavigationSources([{key:name,source:s}]);
   if(merged.issues.length){invalid++;continue;}withOriginalSource++;sourceWays+=merged.ways.length;
  }catch{invalid++;}
 }
 return {files:files.length,withOriginalSource,legacyDisplayOnly,invalid,sourceWays,
  sourceSha256:identity.digest('hex'),recoveryAcceptance:'unvalidated',
  note:'Source presence is not region completeness, barrier/restriction coverage or legal cycling validation.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.length!==4||!['--input','--cache'].includes(args[0])||args[2]!=='--output')throw Error('Usage: node tools/recovery_study.mjs (--input STUDY.json | --cache DIRECTORY) --output NEW_DIRECTORY');
 const report=args[0]==='--input'?evaluateRecovery(JSON.parse(fs.readFileSync(args[1],'utf8'))):auditNavigationCache(args[1]);
 fs.mkdirSync(args[3],{recursive:false});fs.writeFileSync(path.join(args[3],'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(args[0]==='--input'?{rings:report.rings,representations:report.representations,gaps:report.gaps}:report,null,2));
}
