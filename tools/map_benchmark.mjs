// Production encoded readback and independent synthetic geometry/style oracles.
// No network, serial access, firmware writes or automatic baseline promotion.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildRoute} from '../js/route.js';
import {readFile} from '../js/preview.js';
import {auditMapSection,budgetFailures,transitionPeak,TRANSITION_BUDGET} from '../js/map_budget.js';
import {benchmarkCases,toLocal,toGeo} from './map_benchmark_cases.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const digest=x=>createHash('sha256').update(x).digest('hex');
const round=x=>Number(x.toFixed(3));
const evidence=()=>({allocations:'calculated-payload',drawingWork:'calculated-callbacks-and-vertices',
 nativeRecords:'encoded-comparison',featureRetention:'synthetic-spatial-style-probes',targetFrameTime:'unmeasured',
 targetContiguousHeap:'unmeasured',pixelLegibility:'unvalidated',networkConnectivity:'unvalidated'});
function distance(q,a,b){
 const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((q[0]-a[0])*dx+(q[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
 return Math.hypot(q[0]-a[0]-t*dx,q[1]-a[1]-t*dy);
}
function probeFeature(p,model){
 let k=0;model.secs.forEach((points,i)=>{if(points[0]?.[2]<=p.atMeters*100)k=i;});
 let best=Infinity;
 for(const e of model.blocks[k]||[]){
  if((e.style&15)!==p.cls || p.styleMask!==undefined&&(e.style&p.styleMask)!==p.styleValue)continue;
  const points=[e.center,...e.points||[]].map(toLocal);
  for(let i=1;i<points.length;i++)best=Math.min(best,distance(p.xy,points[i-1],points[i]));
 }
 return {id:p.id,required:p.required,cls:p.cls,section:k,matched:best<=p.toleranceMeters,
  nearestMeters:Number.isFinite(best)?round(best):null};
}
const mapOffset=r=>new DataView(r.file.buffer,r.file.byteOffset,r.file.byteLength).getUint32(0x5c,true);
export function assessCase(fixture,{build=buildRoute,policy='reference'}={}){
 const result={id:fixture.id,fixtureFingerprint:digest(JSON.stringify(fixture)),policy,status:'fail',failures:[],probes:[],boundaryProbes:[],blocks:[],costs:{},evidence:evidence()};
 result.evidence.featureRetention=fixture.probes.some(p=>p.required)?'synthetic-spatial-style-probes':'no-required-feature-oracle';
 const options={...fixture.data,id:'benchmark',nameImage:()=>new Uint8Array(42),noF9:true,
  navigationLines:fixture.navigationLines,map:{styled:true,names:true,arrows:true}};
 let r;
 try{r=build(fixture.gpx,fixture.lines,options);}catch(error){
  if(fixture.expectedRejection && error.message.includes('protected') && error.message.includes(fixture.expectedRejection)){
   result.status='expected_rejection';result.rejection=fixture.expectedRejection;return result;
  }
  result.failures.push({code:'generation-error',message:error.message});return result;
 }
 if(fixture.expectedRejection)result.failures.push({code:'expected-rejection-missing'});
 try{
  const model=readFile(r.file),costs=auditMapSection(r.file.subarray(mapOffset(r)));
  if(model.secs.length!==r.sections.length || model.blocks.length!==r.sections.length)result.failures.push({code:'section-index-mismatch'});
  if(r.file.length>4_000_000)result.failures.push({code:'file-size-limit'});
  const unique=[...new Set(model.blocks)];
  result.blocks=costs.map((cost,i)=>{
   const classes={};for(const e of unique[i]){
    const cls=e.style&15,n=e.points?.length||0,c=classes[cls]??={entries:0,coordinatePairs:0};c.entries++;if(cls!==12)c.coordinatePairs+=n;
   }
   const failures=budgetFailures(cost);if(failures.length)result.failures.push({code:'block-budget',block:i,metrics:failures});
   return {cost,classes,...(r.mapStat?.blocks[i]?{contextRadiusCap:r.mapStat.blocks[i].contextRadiusCap,coverageFloor:r.mapStat.blocks[i].coverageFloor,...(r.mapStat.blocks[i].study?{study:r.mapStat.blocks[i].study}:{})}:{} )};
  });
  result.costs={fileBytes:r.file.length,sections:model.secs.length,blocks:costs.length,
   transitionPeakBytes:transitionPeak(costs),projectionCallsMax:Math.max(0,...costs.map(c=>c.projectionCalls)),
   projectedPointsMax:Math.max(0,...costs.map(c=>c.projectedPoints)),fillVerticesMax:Math.max(0,...costs.map(c=>c.fillVertices)),
   decodedBytesMax:Math.max(0,...costs.map(c=>c.decodedBytes)),serializedBytesMax:Math.max(0,...costs.map(c=>c.serializedBytes))};
  if(result.costs.transitionPeakBytes>TRANSITION_BUDGET)result.failures.push({code:'transition-budget'});
  const reference=buildRoute(fixture.gpx,fixture.navigationLines,{...options,navigationLines:fixture.navigationLines});
  result.nativeRecordsMatch=Buffer.from(r.file.subarray(128,mapOffset(r))).equals(Buffer.from(reference.file.subarray(128,mapOffset(reference))));
  if(!result.nativeRecordsMatch)result.failures.push({code:'native-records-changed'});
  result.mapFingerprint=digest(r.file.subarray(mapOffset(r)));
  result.probes=fixture.probes.map(p=>probeFeature(p,model));
  for(const p of result.probes)if(p.required&&!p.matched)result.failures.push({code:'protected-feature-missing',probe:p.id});
  for(let k=1;k<model.blocks.length;k++)if(model.blocks[k]!==model.blocks[k-1]){
   const start=model.secs[k][0],q=toLocal(start),at=start[2]/100;
   for(const source of fixture.boundarySources||[]){
    let best=Infinity,xy;
    for(let n=1;n<source.xy.length;n++){
     const a=source.xy[n-1],b=source.xy[n],dx=b[0]-a[0],dy=b[1]-a[1];
     const t=Math.max(0,Math.min(1,((q[0]-a[0])*dx+(q[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
     const p=[a[0]+t*dx,a[1]+t*dy],d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<best){best=d;xy=p;}
    }
    if(best>290)continue;
    for(const side of [-1,1]){
     const p=probeFeature({...source,id:`${source.id}-${k}-${side}`,xy,atMeters:at+side*.01,required:true},model);
     result.boundaryProbes.push(p);if(!p.matched)result.failures.push({code:'block-boundary-feature-missing',probe:p.id});
    }
   }
  }
  if(fixture.boundarySources?.length&&!result.boundaryProbes.length)result.failures.push({code:'boundary-probe-not-exercised'});
  result.status=result.failures.length?'fail':'pass';
 }catch(error){result.failures.push({code:'readback-error',message:error.message});}
 return result;
}
export function runBenchmark(cases=benchmarkCases(),options={}){
 if(!Array.isArray(cases)||!cases.length)throw Error('Empty benchmark case set');
 if(new Set(cases.map(c=>c.id)).size!==cases.length)throw Error('Duplicate benchmark identity');
 const pending=['tools/map_benchmark.mjs','tools/map_benchmark_cases.mjs','tools/map_policy_study.mjs'],seen=new Set();
 while(pending.length){
  const file=pending.pop();if(seen.has(file))continue;seen.add(file);
  const source=fs.readFileSync(path.join(root,file),'utf8');
  for(const match of source.matchAll(/\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s+)?['"](\.[^'"]+)['"]/g))
   pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1])));
 }
 const sources=Object.fromEntries([...seen].sort().map(p=>[p,digest(fs.readFileSync(path.join(root,p)))]));
 const results=cases.map(c=>assessCase(c,options));
 return {schema:'cc700-map-benchmark-v1',policy:options.policy||'reference',sourceFingerprint:digest(JSON.stringify(sources)),sources,
  status:results.some(c=>c.status==='fail')?'fail':'pass',targetAcceptance:'unvalidated',
  counts:{generated:results.filter(c=>c.status==='pass').length,expectedRejections:results.filter(c=>c.status==='expected_rejection').length,failed:results.filter(c=>c.status==='fail').length},cases:results};
}
export function compareReports(before,after){
 if(before.schema!==after.schema||before.cases.length!==after.cases.length)throw Error('Incompatible fixture reports');
 return {schema:'cc700-map-comparison-v1',beforePolicy:before.policy,afterPolicy:after.policy,
  cases:before.cases.map((a,i)=>{
   const b=after.cases[i];if(a.id!==b.id||a.fixtureFingerprint!==b.fixtureFingerprint)throw Error('Different fixture inputs: '+a.id);
   return {id:a.id,beforeStatus:a.status,afterStatus:b.status,
    delta:Object.fromEntries(Object.keys(a.costs).map(k=>[k,Number.isFinite(b.costs[k])?b.costs[k]-a.costs[k]:null])),
    lostRequiredProbes:a.probes.filter(p=>p.required&&!b.probes.some(q=>q.id===p.id&&q.matched)).map(p=>p.id),
    optionalProbesBefore:a.probes.filter(p=>!p.required&&p.matched).map(p=>p.id),optionalProbesAfter:b.probes.filter(p=>!p.required&&p.matched).map(p=>p.id)};
  })};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--output')throw Error('Usage: node tools/map_benchmark.mjs --output NEW_DIRECTORY');
 const out=path.resolve(args[1]);fs.mkdirSync(out,{recursive:false});const start=performance.now(),report=runBenchmark();
 fs.writeFileSync(path.join(out,'baseline.json'),JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync(path.join(out,'run.json'),JSON.stringify({hostGenerationMs:performance.now()-start,limits:'Host duration only; not device timing'},null,2)+'\n');
 console.log(JSON.stringify({status:report.status,counts:report.counts,targetAcceptance:report.targetAcceptance,report:path.join(out,'baseline.json')}));
 process.exitCode=report.status==='pass'?0:1;
}
