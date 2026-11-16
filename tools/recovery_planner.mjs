// PC-only projected-segment recovery. No fabricated GPS/route lateral connectors.
import {parse,unzz,SC} from '../js/pb.js';
import {hav,brg,adiff} from '../js/geo.js';
import {readRouteElevations} from './elevation_study.mjs';
import {associateSegment} from './recovery_association.mjs';
import {findRecovery} from './recovery_study.mjs';
import {readNativeRoute} from '../js/native_route.js';
export {readNativeRoute};
function routePoint(route,progress){
 let hi=route.findIndex(p=>p.progress>=progress);if(hi<0)return null;if(hi===0)return route[0].point;
 const a=route[hi-1],b=route[hi];if(b.progress-a.progress>25000)return null;
 const t=(progress-a.progress)/(b.progress-a.progress);return a.point.map((v,i)=>v+(b.point[i]-v)*t);
}
export function buildRouteVisits(route,index,{spacing=100}={}){
 if(!Array.isArray(route)||route.length<2||route.length>100000||!Number.isFinite(spacing)||spacing<25||spacing>500)throw Error('Invalid route visit bounds');
 route.forEach((p,i)=>{if(!Number.isSafeInteger(p.progress)||p.progress<0||(i&&p.progress<=route[i-1].progress))throw Error('Route must be ordered');});
 const end=route.at(-1).progress,progresses=[];
 for(let d=route[0].progress;d<=end;d+=Math.round(spacing*100)){if(progresses.length>=4096)throw Error('Route visit limit');progresses.push(d);}
 if(progresses.at(-1)!==end)progresses.push(end);
 return progresses.map(progress=>{
  const point=routePoint(route,progress),ahead=routePoint(route,Math.min(end,progress+2000));
  if(!point||!ahead||hav(point,ahead)<3)return {progress,point,status:'unavailable',reason:'route-bearing-or-gap'};
  const bearing=brg(point,ahead),association=associateSegment(index,point,{heading:bearing});
  return {progress,point,bearing,association};
 });
}
const fail=reason=>({status:'unavailable',reason,distanceMeters:null,target:null,geometry:[],nodes:[],ways:[],cyclingValidity:'unvalidated'});
const key=(way,a,b)=>`${way}:${Math.min(a,b)}:${Math.max(a,b)}`;
export function planRecovery(graph,origin,visits,{afterVisit,throughVisit,heading=null,...limits}){
 if(!Number.isSafeInteger(afterVisit)||afterVisit<0||!Number.isSafeInteger(throughVisit)||throughVisit<afterVisit)throw Error('Invalid forward visit window');
 if(!Array.isArray(visits)||visits.length>4096)throw Error('Visit admission exceeded');
 const exactNode=origin?.status==='network-node';
 if(!exactNode&&origin?.status!=='associated')return fail('origin-'+(origin?.reason??'association-unavailable'));
 const admitted=new Map();for(const e of graph.edges){const k=key(e.way,e.from,e.to);if(!admitted.has(k))admitted.set(k,[]);admitted.get(k).push(e);}
 if(exactNode&&!graph.nodes.some(n=>n.id===origin.node))return fail('unknown-origin');
 const originKey=exactNode?null:key(origin.segment.way,origin.segment.from,origin.segment.to);
 if(!exactNode&&!admitted.has(originKey))return fail('origin-edge-not-admitted');
 const targets=visits.filter(v=>v.progress>afterVisit&&v.progress<=throughVisit&&v.association?.status==='associated'&&
  admitted.has(key(v.association.segment.way,v.association.segment.from,v.association.segment.to)));
 if(!targets.length)return fail('no-associated-admitted-forward-visit');
 const groups=new Map(),nodes=[...graph.nodes];let next=graph.nodes.reduce((n,p)=>Math.max(n,p.id),0)+1;
 const add=(association)=>{
  const s=association.segment,k=key(s.way,s.from,s.to);if(!groups.has(k))groups.set(k,{segment:s,cuts:[]});
  const group=groups.get(k),t=group.segment.from===s.from?association.t:1-association.t;
  let cut=group.cuts.find(c=>Math.abs(c.t-t)<1e-9);
  if(!cut){if(!Number.isSafeInteger(next))throw Error('Virtual node identity limit');cut={t,id:next++,point:association.point};group.cuts.push(cut);nodes.push({id:cut.id,point:cut.point});}
  return cut.id;
 };
 const originId=exactNode?origin.node:add(origin),targetSpecs=targets.map(v=>({...v,node:add(v.association)})),edges=[];
 for(const e of graph.edges){
  const group=groups.get(key(e.way,e.from,e.to));if(!group){edges.push(e);continue;}
  const s=group.segment,forward=e.from===s.from,cuts=[{t:0,id:s.from},...group.cuts.sort((a,b)=>a.t-b.t),{t:1,id:s.to}];
  for(let i=1;i<cuts.length;i++){
   const a=cuts[i-1],b=cuts[i],from=forward?a.id:b.id,to=forward?b.id:a.id;
   edges.push({...e,from,to,meters:e.meters*(b.t-a.t)});
  }
 }
 // Restrict the initial orientation only when past movement provides a heading.
 const byNode=new Map(nodes.map(n=>[n.id,n.point]));
 const directed=edges.filter(e=>e.from!==originId||heading===null||Math.abs(adiff(heading,brg(byNode.get(e.from),byNode.get(e.to))))<=60);
 const requests=targetSpecs.map(t=>({node:t.node,visit:t.progress,arrivalFrom:directed.filter(e=>e.to===t.node&&Math.abs(adiff(t.bearing,brg(byNode.get(e.from),byNode.get(e.to))))<=60).map(e=>e.from)})).filter(t=>t.arrivalFrom.length);
 if(!requests.length)return fail('no-directed-forward-visit');
 const result=findRecovery({...graph,nodes,edges:directed},{origin:originId,targets:requests,afterVisit,throughVisit,...limits});
 return {...result,associationValidity:'geometric-only-unvalidated',targetSelection:'ordered route visits in past-entry forward window; no future fix used',
  originOffsetMeters:exactNode?0:origin.distanceMeters,distanceMeaning:'projected network path only; lateral GPS and route offsets excluded'};
}
