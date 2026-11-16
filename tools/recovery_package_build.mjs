// Experimental sidecar builder. Never mutates/flashes a native route.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {SegmentIndex,associateSegment} from './recovery_association.mjs';import {readNativeRoute,buildRouteVisits} from './recovery_planner.mjs';
import {buildTransitionGraph} from './recovery_transitions.mjs';import {conservativeWayPolicy} from './recovery_study.mjs';import {generateWindow} from './recovery_package.mjs';
import {retrospectiveCases} from './recovery_ride_study.mjs';import {hav,brg} from '../js/geo.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function buildBundle(config){
 const rawRoute=fs.readFileSync(config.route),rawSource=fs.readFileSync(config.snapshot),snapshot=JSON.parse(rawSource),route=readNativeRoute(rawRoute),index=new SegmentIndex(snapshot.navigationSource.ways),visits=buildRouteVisits(route,index);
 const reachCm=config.reachM===undefined?300000:Math.round(config.reachM*100);if(!Number.isInteger(reachCm)||reachCm<100||reachCm>300000)throw Error('Reach admission: 100 m to 3000 m');
 const policy={version:1,kind:'experimental-conservative-no-motorroad',windowCm:25000,maxSegments:1024,maxLegPoints:512,maxGuardsPerSegment:64,maxPackageBytes:65536,...(config.reachM===undefined?{}:{reachCm})};
 const graph=buildTransitionGraph(snapshot,{wayPolicy:t=>t.motorroad&&t.motorroad!=='no'?{reason:'motorroad-not-admitted'}:conservativeWayPolicy(t)});
 const identity={routeSha256:sha(rawRoute),sourceSha256:sha(rawSource),policySha256:sha(JSON.stringify(policy))},seeds=new Map();let sampling='deterministic source edges near window route anchor';
 if(config.track&&config.timeline){
  sampling='retrospective historical entry windows and geometric source-segment seeds; not general area coverage';
  const track=JSON.parse(fs.readFileSync(config.track)),timeline=JSON.parse(fs.readFileSync(config.timeline));if(track.length!==timeline.length||track.some((p,i)=>p[0]!==timeline[i].timestamp))throw Error('Track/timeline mismatch');const byTime=new Map(track.map((p,i)=>[p[0],i]));
  for(const c of retrospectiveCases(timeline)){if(!c.entry)continue;const window=Math.floor(c.entry.original_progress_m/250);if(!seeds.has(window))seeds.set(window,new Map());const i=byTime.get(c.sample.timestamp),p=track[i].slice(1),prev=i?track[i-1]:null,heading=prev&&track[i][0]-prev[0]<=10&&hav(prev.slice(1),p)>=5?brg(prev.slice(1),p):null,a=associateSegment(index,p,{heading});if(a.status==='associated')seeds.get(window).set(a.segment.key,a.segment);}
 }else{
  const windows=config.windows??Array.from({length:Math.ceil(route.at(-1).progress/25000)},(_,i)=>i);
  if(windows.length>512||windows.some(w=>!Number.isInteger(w)||w<0||w*25000>=route.at(-1).progress))throw Error('Window admission');
  for(const window of windows){const anchor=route.reduce((a,b)=>Math.abs(a.progress-window*25000)<Math.abs(b.progress-window*25000)?a:b).point;
   const selected=index.segments.filter(s=>['cycleway','residential','tertiary','secondary','service','unclassified'].includes(s.tags.highway)&&hav(s.a,anchor)<=3000).sort((a,b)=>hav(a.a,anchor)-hav(b.a,anchor)||a.way-b.way||a.index-b.index).slice(0,8);seeds.set(window,new Map(selected.map(s=>[s.key,s])));}
 }
 const packages=[],receipts=[];
 for(const [window,selected] of [...seeds].sort(([a],[b])=>a-b)){
  const entryMin=window*25000,entryMax=Math.min(entryMin+25000,route.at(-1).progress+1),center=route.reduce((a,b)=>Math.abs(a.progress-entryMin)<Math.abs(b.progress-entryMin)?a:b).point;
  const r=generateWindow(graph,index,visits,{...identity,entryMin,entryMax,center,reachCm},[...selected.values()]),name=`r${String(window).padStart(4,'0')}.rcp`;
  packages.push({name,bytes:r.bytes,entryMin,entryMax});receipts.push({...r.receipt,name,sha256:sha(r.bytes)});
 }
 if(sha(fs.readFileSync(config.route))!==identity.routeSha256)throw Error('Route changed during generation');
 return {packages,manifest:{version:1,experimental:true,...identity,policy,sampling,packages:receipts,nativeRouteModified:false,deviceAdapter:'not-bound',releaseAccepted:false}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const a=process.argv.slice(2);if(a.length!==4||a[0]!=='--input'||a[2]!=='--output')throw Error('Usage --input STUDY.json --output NEW_DIRECTORY');if(fs.existsSync(a[3]))throw Error('Output exists');
 const bundle=buildBundle(JSON.parse(fs.readFileSync(a[1])));fs.mkdirSync(a[3]);for(const p of bundle.packages)fs.writeFileSync(path.join(a[3],p.name),p.bytes);fs.writeFileSync(path.join(a[3],'manifest.json'),JSON.stringify(bundle.manifest,null,2)+'\n');console.log(JSON.stringify(bundle.manifest,null,2));
}
