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
// Bike rule (24 Nov, owner; NRW: LFoG § 2 Abs. 2 roads and firm paths in the forest, LNatSchG § 57 Abs. 2 private roads and
// paths in open land). 'ride' = a way to draw and route; 'exit' = allowed by law but no evidence that it is firm (the
// way-back tree uses it only to lead out); null = cut (not allowed, or a way a rider does not take: driveways, private,
// motorways, trails, steps). Protected areas (LNatSchG § 59) are not modelled: a gap.
const BYES=new Set(['yes','designated','permissive']),ACC_NO=new Set(['no','private','customers','delivery','agricultural','forestry','emergency','military','permit']);
const FIRM=new Set(['asphalt','paved','concrete','paving_stones','sett','compacted','fine_gravel','gravel','pebblestone','chipseal']);
const BROAD=new Set(['residential','unclassified','living_street','road','tertiary','tertiary_link','secondary','secondary_link','primary','primary_link','service','cycleway','trunk','trunk_link']);
const NOT_STREET=new Set(['construction','proposed','abandoned','disused','razed','platform','corridor','elevator','bus_guideway','busway','raceway','escape','motorway','motorway_link']);
export function bikeWay(t={}){
 const h=t.highway;
 if(!h||NOT_STREET.has(h)||t.area==='yes'||t.indoor==='yes'||t.motorroad==='yes')return null;
 if(['no','use_sidepath','dismount'].includes(t.bicycle))return null;
 if(!BYES.has(t.bicycle)&&(ACC_NO.has(t.access)||ACC_NO.has(t.vehicle)))return null;
 if(['driveway','parking_aisle','drive-through','emergency_access'].includes(t.service))return null;
 if(['very_bad','horrible','very_horrible','impassable'].includes(t.smoothness))return null;
 if(+(t['mtb:scale']||0)>=2||(t.sac_scale&&t.sac_scale!=='hiking'))return null;
 if(t.informal==='yes'||['bad','horrible','no'].includes(t.trail_visibility)||t.golf==='cartpath')return null;
 if(h==='steps')return BYES.has(t['ramp:bicycle'])?'ride':null;
 if(BYES.has(t.bicycle)||BROAD.has(h))return 'ride';
 if(h==='track')return ['grade1','grade2','grade3'].includes(t.tracktype)||FIRM.has(t.surface)?'ride':['grade4','grade5'].includes(t.tracktype)?'exit':'exit';
 if(h==='path'||h==='bridleway')return 'exit';
 return null;
}
export function bikeWayPolicy(t={}){
 const b=bikeWay(t);
 if(!b)return {reason:'not-for-riding'};
 if(b==='exit')return {forward:true,backward:true,exit:true};
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
   const x=p.exit?{exit:true}:{};
   if(p.forward)edges.push({from:a,to:b,way:w.id,meters,...x});
   if(p.backward)edges.push({from:b,to:a,way:w.id,meters,...x});
  }
 }
 edges.sort((a,b)=>a.from-b.from||a.to-b.to||a.way-b.way);
 return {nodes:[...nodes.values()].sort((a,b)=>a.id-b.id),edges,excluded,issues:canonical([...s.issues]),
  sourceComplete:s.complete,cyclingValidity:'unvalidated'};
}
