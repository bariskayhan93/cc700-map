// Synthetic topology workloads, not regional access or real ride acceptance.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {evaluateRecovery} from './recovery_study.mjs';
const point=(x,y)=>[51+y/111320,7+x/(111320*Math.cos(51*Math.PI/180))];
function fixture(name,half,step,forest=false){
 const ways=[],origins=[];let wid=1;
 const id=(x,y)=>(y+half)*(2*half+1)+x+half+1;
 const add=(x,y,u,v)=>ways.push({id:wid++,nodes:[id(x,y),id(u,v)],pts:[point(x*step,y*step),point(u*step,v*step)],
  tags:{highway:forest?'path':'residential',...(forest?{bicycle:'yes'}:{})}});
 if(forest){for(let n=-half;n<half;n++){add(n,0,n+1,0);add(0,n,0,n+1);}}
 else for(let y=-half;y<=half;y++)for(let x=-half;x<=half;x++){
  if(x<half)add(x,y,x+1,y);if(y<half)add(x,y,x,y+1);
 }
 for(const distance of [600,1600,2600]){
  const n=Math.round(distance/step);origins.push(id(n,0),id(-n,0),id(0,n),id(0,-n));
 }
 // A nearby disconnected component is a required negative control in every case.
 ways.push({id:wid,nodes:[900000,900001],pts:[point(10,10),point(20,10)],tags:{highway:'cycleway'}});origins.push(900000);
 return {id:name,input:{source:{version:1,complete:true,ways,issues:[]},origins,
  targets:[{node:id(0,0),visit:10}],afterVisit:9,throughVisit:10}};
}
export function recoveryCases(){return [fixture('urban-grid',15,200),fixture('village-grid',6,500),fixture('forest-spokes',30,100,true)];}
export function recoverySummary(c){
 const r=evaluateRecovery(c.input);
 return {case:c.id,inputSha256:createHash('sha256').update(JSON.stringify(c.input)).digest('hex'),
  nodes:r.graph.nodes.length,directedEdges:r.graph.edges.length,rings:r.rings,
  candidatePaths:r.origins.filter(o=>o.status==='candidate').length,
  unavailable:r.origins.filter(o=>o.status==='unavailable').map(o=>({origin:o.origin,reason:o.reason})),
  graphJsonBytes:r.representations.graph.jsonBytes,legsJsonBytes:r.representations.legs.jsonBytes,
  maxSettledNodes:Math.max(...r.origins.map(o=>o.settledNodes)),
  maxRelaxedEdges:Math.max(...r.origins.map(o=>o.relaxedEdges)),maxQueueEntries:Math.max(...r.origins.map(o=>o.queuePeak)),
  cyclingValidity:'unvalidated',targetMemoryAndTiming:'unmeasured',sampling:'13 explicit graph nodes per synthetic case; not continuous coverage'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--output')throw Error('Usage: node tools/recovery_study_cases.mjs --output NEW_DIRECTORY');
 fs.mkdirSync(args[1],{recursive:false});const rows=[];
 for(const c of recoveryCases()){
  fs.writeFileSync(path.join(args[1],c.id+'-input.json'),JSON.stringify(c.input)+'\n');
  fs.writeFileSync(path.join(args[1],c.id+'-report.json'),JSON.stringify(evaluateRecovery(c.input),null,2)+'\n');rows.push(recoverySummary(c));
 }
 fs.writeFileSync(path.join(args[1],'summary.json'),JSON.stringify(rows,null,2)+'\n');console.log(JSON.stringify(rows,null,2));
}
