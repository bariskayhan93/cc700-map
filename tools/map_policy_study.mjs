// OFFLINE ONLY. Loads an instrumented in-memory copy; never edits production JS.
// Radius measures drawable candidate capacity, NOT a usable return/rejoin route.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from '../js/pb.js';
import {canonicalEntries} from '../js/map_order.js';
import {estimateBlock,budgetFailures,transitionPeak,MAP_BUDGET,TRANSITION_BUDGET} from '../js/map_budget.js';
import {extendedCases} from './map_benchmark_cases.mjs';
import {runBenchmark,compareReports} from './map_benchmark.mjs';
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
function replaceOnce(source,needle,replacement){
 if(source.split(needle).length!==2)throw Error('Production study seam changed; inspect before rerunning: '+needle);
 return source.replace(needle,replacement);
}
function absoluteImports(source,file,overrides={}){
 return source.replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${overrides[relative]||new URL(relative,file).href}'`);
}
const description=new WeakMap();
function cls(entry){
 if(!description.has(entry))description.set(entry,parse(Uint8Array.from(entry)).find(f=>f[0]===2)[2]&15);
 return description.get(entry);
}
function orderOf(entries){
 const counts=Array(16).fill(0);for(const e of entries)counts[cls(e)]++;
 const roads=counts.slice(5,12).reduce((a,b)=>a+b,0),paths=counts[8]+counts[10];
 if(paths>roads/2)return {context:'path-dominant',order:[10,8,5,4,6,7,9,11,3,2,1]};
 if(roads>400)return {context:'road-dense',order:[10,6,7,5,8,4,9,11,3,2,1]};
 return {context:'mixed-sparse',order:[5,10,8,6,7,4,9,11,3,2,1]};
}
function select(groups,makeFull,{mode,radius}){
 if(mode==='reference')return;
 for(let i=0;i<groups.length;i++){
  const base=groups[i],full=makeFull(base,radius),classification=orderOf(base.entries);
  const trials=mode==='uniform'?[null]:classification.order,accepted=[],rejected=[];
  for(const category of trials){
   const g=groups[i],entries=category===null?full.entries:canonicalEntries([
    ...g.entries.filter(e=>cls(e)!==category),...full.entries.filter(e=>cls(e)===category)]);
   const cost=estimateBlock(entries),failures=budgetFailures(cost,MAP_BUDGET);
   const costs=groups.map((q,j)=>i===j?cost:q.cost);
   if(transitionPeak(costs)>TRANSITION_BUDGET)failures.push('transitionBytes');
   if(failures.length){rejected.push({category,metrics:failures});continue;}
   groups[i]={...g,entries,cost};accepted.push(category);
  }
  groups[i].study={mode,candidateRadiusMeters:radius,context:classification.context,accepted,rejected,
   navigationUtility:'unproven',networkConnectivity:'unvalidated',returnRouting:'not-implemented'};
 }
}
let instrumented;
async function loadInstrumented(){
 if(instrumented)return instrumented;
 const mapURL=new URL('../js/mapsec.js',import.meta.url),routeURL=new URL('../js/route.js',import.meta.url);
 let map=fs.readFileSync(mapURL,'utf8');
 map=replaceOnce(map,'const cor = new Corridor(win(i,j),F,1000);','const cor = new Corridor(win(i,j),F,Math.max(1000,floor,cap));');
 map=replaceOnce(map,'  const stat={styled:true,budgetVersion:BUDGET_VERSION,limits,transitionLimitBytes:TRANSITION_BUDGET,',
  `  data.opt?.__studyCapture?.(groups,(g,radius)=>make(g.i,g.j,radius,radius));\n  const stat={styled:true,budgetVersion:BUDGET_VERSION,limits,transitionLimitBytes:TRANSITION_BUDGET,`);
 const mapModule=moduleURL(absoluteImports(map,mapURL));
 const route=absoluteImports(fs.readFileSync(routeURL,'utf8'),routeURL,{'./mapsec.js':mapModule});
 instrumented=(await import(moduleURL(route))).buildRoute;return instrumented;
}
export async function studyBuilder({mode='layered',radius=1000}={}){
 if(!['reference','uniform','layered'].includes(mode))throw Error('Unsupported study policy');
 if(![1000,2000,3000].includes(radius))throw Error('Unsupported study radius');
 const build=await loadInstrumented();
 return (gpx,lines,opt)=>build(gpx,lines,{...opt,map:{...opt.map,__studyCapture:(groups,make)=>select(groups,make,{mode,radius})}});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--output')throw Error('Usage: node tools/map_policy_study.mjs --output NEW_DIRECTORY');
 const out=path.resolve(args[1]);fs.mkdirSync(out,{recursive:false});const cases=extendedCases(),reference=runBenchmark(cases);
 fs.writeFileSync(path.join(out,'reference.json'),JSON.stringify(reference,null,2)+'\n');
 const summary=[];
 for(const radius of [1000,2000,3000])for(const mode of ['uniform','layered']){
  const build=await studyBuilder({mode,radius}),policy=`${mode}-${radius}`,result=runBenchmark(cases,{build,policy}),comparison=compareReports(reference,result);
  fs.writeFileSync(path.join(out,policy+'.json'),JSON.stringify({result,comparison},null,2)+'\n');
  const matched=result.cases.reduce((n,c)=>n+c.probes.filter(p=>!p.required&&p.matched).length,0);
  summary.push({policy,status:result.status,generated:result.counts.generated,expectedRejections:result.counts.expectedRejections,optionalDrawableProbes:matched,returnRouting:'not-implemented',targetAcceptance:'unvalidated'});
 }
 fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
 process.exitCode=reference.status==='pass'&&summary.every(r=>r.status==='pass')?0:1;
}
