// Candidate street graph with a conservative bicycle access policy. Structural only: not validated cycling routes.
// Pure code, shared by the page and the host tools (tools/recovery_study.mjs).
import {mergeNavigationSources} from './navsource.js';
import {hav} from './geo.js';
const allowed=new Set(['yes','designated','official','permissive']);
const roads=new Set(['residential','living_street','service','unclassified','tertiary','secondary','primary','cycleway']);
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
// Way-back data (far map design, 23 Nov): a track, path or bridleway whose only failure is the missing explicit bicycle
// access is an exit edge. The tree uses it only to lead a rider out of such a way, never into it.
export function exitWayPolicy(t){
 const p=conservativeWayPolicy(t);
 return p.reason==='highway-needs-explicit-bicycle-access'&&['track','path','bridleway'].includes(t.highway)?{forward:true,backward:true,exit:true}:p;
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
   const x=p.exit?{exit:true}:{};
   if(p.forward)edges.push({from:a,to:b,way:w.id,meters,...x});
   if(p.backward)edges.push({from:b,to:a,way:w.id,meters,...x});
  }
 }
 edges.sort((a,b)=>a.from-b.from||a.to-b.to||a.way-b.way);
 return {nodes:[...nodes.values()].sort((a,b)=>a.id-b.id),edges,excluded,issues:canonical([...s.issues]),
  sourceComplete:s.complete,cyclingValidity:'unvalidated'};
}
