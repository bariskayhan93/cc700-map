// PC feasibility orchestration. Raw graphs/trials stay private.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {hav,brg} from '../js/geo.js';
import {SegmentIndex,associateSegment} from './recovery_association.mjs';
import {nrwFirmPathPolicy,NRW_PROFILE} from './recovery_access.mjs';
import {buildTransitionGraph} from './recovery_transitions.mjs';
import {buildRouteVisits,readNativeRoute,planRecovery} from './recovery_planner.mjs';
import {retrospectiveCases} from './recovery_ride_study.mjs';
import {encodeStudyLeg} from './recovery_leg_packet.mjs';
import {sampleSpatial,spatialStudy} from './recovery_spatial.mjs';
const counts=rows=>rows.reduce((r,t)=>{const k=t.status==='candidate'?'candidate':t.reason;r[k]=(r[k]??0)+1;return r;},{});
export function replaySegments(snapshot,route,track,timeline){
 if(!Array.isArray(track)||!Array.isArray(timeline)||track.length!==timeline.length||track.length>100000)throw Error('Track/timeline mismatch');
 track.forEach((p,i)=>{if(!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)||p[0]!==timeline[i].timestamp||Math.abs(p[1])>85||Math.abs(p[2])>180)throw Error('Track/timeline mismatch');});
 const index=new SegmentIndex(snapshot.navigationSource.ways),visits=buildRouteVisits(route,index),cases=retrospectiveCases(timeline),byTime=new Map(track.map((p,i)=>[p[0],i]));
 const policies={conservative:undefined,nrwFirm:nrwFirmPathPolicy},profiles={};
 for(const [name,wayPolicy] of Object.entries(policies)){
  const graph=buildTransitionGraph(snapshot,{wayPolicy}),trials=[];
  const inferredWays=new Set(snapshot.navigationSource.ways.filter(w=>wayPolicy?.(w.tags).inferredAccess).map(w=>w.id));
  for(const c of cases){
   const at=byTime.get(c.sample.timestamp),point=track[at].slice(1),prev=at?track[at-1]:null;
   const heading=prev&&track[at][0]-prev[0]<=10&&hav(prev.slice(1),point)>=5?brg(prev.slice(1),point):null;
   const association=associateSegment(index,point,{heading}),base={timestamp:c.sample.timestamp,offRouteMeters:c.sample.off_original_route_m,
    recordingGap:c.recordingGap,originAssociation:{status:association.status,reason:association.reason,offsetMeters:association.distanceMeters??null},headingAvailable:heading!==null};
   if(!c.entry){trials.push({...base,status:'unavailable',reason:'past-entry-unavailable'});continue;}
   if(c.sample.timestamp-c.entry.timestamp>1800){trials.push({...base,status:'unavailable',reason:'past-entry-stale'});continue;}
   const anchor=Math.round(c.entry.original_progress_m*100),afterVisit=anchor+2500,throughVisit=Math.min(route.at(-1).progress,anchor+300000);
   if(afterVisit>=throughVisit){trials.push({...base,status:'unavailable',reason:'no-forward-window'});continue;}
   const result=planRecovery(graph,association,visits,{afterVisit,throughVisit,heading});
   trials.push({...base,...result,usesInferredAccess:result.ways?.some(w=>inferredWays.has(w))??false});
  }
  const candidate=trials.filter(t=>t.status==='candidate');
  profiles[name]={graph,visits,trials,summary:{profile:name,results:counts(trials),sampledTrials:trials.length,candidateTrials:candidate.length,
   inferredAccessCandidates:candidate.filter(t=>t.usesInferredAccess).length,candidatesWithoutRecordingGap:candidate.filter(t=>!t.recordingGap).length,
   visits:visits.length,associatedVisits:visits.filter(v=>v.association?.status==='associated').length,
   graphNodes:graph.nodes.length,graphEdges:graph.edges.length,inferredWays:inferredWays.size,
   candidatePacketBytes:candidate.reduce((n,t)=>n+encodeStudyLeg(t).length,0),maxPacketBytes:Math.max(0,...candidate.map(t=>encodeStudyLeg(t).length)),
   work:{unit:'incoming-edge states',maxSettled:Math.max(0,...trials.map(t=>t.settledNodes??0)),maxExaminedEdges:Math.max(0,...trials.map(t=>t.relaxedEdges??0)),maxQueue:Math.max(0,...trials.map(t=>t.queuePeak??0))}}};
 }
 return {scope:'PC-only segment/ordered-visit feasibility',validatedCyclingPaths:0,deviceAcceptance:'unvalidated',accessProfile:NRW_PROFILE,index,route,profiles,
  gaps:['geometric associations and connectors unvalidated','historical progress anchors and recording gaps not live-state acceptance',
   'regional default inference is not legal/physical validation','target memory/stack/draw time unmeasured','source timestamp after ride']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const a=process.argv.slice(2);if(a.length!==4||a[0]!=='--input'||a[2]!=='--output')throw Error('Usage: --input STUDY.json --output NEW_DIRECTORY');
 if(fs.existsSync(a[3]))throw Error('Output exists');
 const config=JSON.parse(fs.readFileSync(a[1])),inputSha256={},data={};
 for(const key of ['snapshot','track','timeline','route']){const b=fs.readFileSync(config[key]);inputSha256[key]=createHash('sha256').update(b).digest('hex');data[key]=key==='route'?readNativeRoute(b):JSON.parse(b);}
 console.error('Starting original-segment ride replay');
 const r=replaySegments(data.snapshot,data.route,data.track,data.timeline);
 const sampling=config.spatial===false?null:sampleSpatial(data.snapshot,data.route,r.index);
 if(sampling)console.error('Spatial source sampling complete: '+sampling.samples.length+' exact network origins');
 fs.mkdirSync(a[3]);const summary={scope:r.scope,inputSha256,validatedCyclingPaths:r.validatedCyclingPaths,deviceAcceptance:r.deviceAcceptance,accessProfile:r.accessProfile,gaps:r.gaps,profiles:{}};
 for(const [name,p] of Object.entries(r.profiles)){
  summary.profiles[name]=p.summary;
  if(sampling){console.error('Starting bounded/generation spatial study: '+name);const spatial=spatialStudy(p.graph,p.visits,sampling,data.route,{sourceIndex:r.index});summary.profiles[name].spatial=spatial.summary;
   fs.writeFileSync(path.join(a[3],name+'-spatial-trials.json'),JSON.stringify(spatial.trials)+'\n');
   fs.writeFileSync(path.join(a[3],name+'-spatial-legs.bin'),spatial.payload);fs.writeFileSync(path.join(a[3],name+'-spatial-lookup.bin'),spatial.lookup);fs.writeFileSync(path.join(a[3],name+'-graph.bin'),spatial.graphPacket);
   fs.writeFileSync(path.join(a[3],name+'-visits.bin'),spatial.visitPacket);if(spatial.associationPacket)fs.writeFileSync(path.join(a[3],name+'-association.bin'),spatial.associationPacket);
  }
  fs.writeFileSync(path.join(a[3],name+'-trials.json'),JSON.stringify(p.trials)+'\n');
  fs.writeFileSync(path.join(a[3],name+'-graph.json'),JSON.stringify(p.graph)+'\n');
  fs.writeFileSync(path.join(a[3],name+'-legs.bin'),Buffer.concat(p.trials.filter(t=>t.status==='candidate').map(encodeStudyLeg)));
 }
 fs.writeFileSync(path.join(a[3],'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
}
