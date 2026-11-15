// Separate PC-only candidate compiler. No production access-profile changes.
import { validateRoutingSnapshot } from './routing_snapshot.mjs';
import { buildCandidateGraph } from './recovery_study.mjs';
const allowed=new Set(['yes','designated','official','permissive']);
const knownBarriers=new Set(['bollard','cycle_barrier','gate','lift_gate','swing_gate','entrance']);
const kinds=new Set(['no_left_turn','no_right_turn','no_straight_on','no_u_turn','no_entry','no_exit',
 'only_left_turn','only_right_turn','only_straight_on','only_u_turn']);
const conditional=t=>Object.keys(t).some(k=>k.includes('conditional')||/^(day|hour|date)_(on|off)$/.test(k));
function nodeBlock(t){
 if(conditional(t)||Object.keys(t).some(k=>/^(access|vehicle|bicycle):/.test(k)))return 'unsupported-node-access';
 if(t.bicycle&&!allowed.has(t.bicycle))return 'node-bicycle-access-not-admitted';
 if(!allowed.has(t.bicycle)&&[t.access,t.vehicle].some(v=>v&&!allowed.has(v)))return 'node-access-not-admitted';
 if(t.barrier&&t.barrier!=='no'&&(!knownBarriers.has(t.barrier)||!allowed.has(t.bicycle)))return 'barrier-access-unverified';
 return null;
}
export function buildTransitionGraph(snapshot){
 validateRoutingSnapshot(snapshot);
 const excluded=[],blockedNodes=new Map(),turnRules=[],quarantined=new Set(),restrictionAudit=[];
 const original=new Map(snapshot.ways.map(w=>[w.id,w]));
 for(const n of snapshot.nodes){const reason=nodeBlock(n.tags);if(reason)blockedNodes.set(n.id,reason);}
 for(const r of snapshot.restrictions){
  const t=r.tags,from=r.members.filter(m=>m.role==='from'),via=r.members.filter(m=>m.role==='via'),to=r.members.filter(m=>m.role==='to');
  const value=t['restriction:bicycle']??t.restriction;
  const modeKeys=Object.keys(t).filter(k=>k.startsWith('restriction:'));
  const unsupportedScope=modeKeys.some(k=>k!=='restriction:bicycle'&&!/^restriction:(hgv|bus|motorcar|motorcycle|agricultural|hazmat|caravan)$/.test(k));
  const exempt=!unsupportedScope&&!conditional(t)&&!t['restriction:bicycle']&&(t.except??'').split(';').map(v=>v.trim()).includes('bicycle');
  const otherModeOnly=!value&&!conditional(t)&&modeKeys.length>0&&modeKeys.every(k=>/^restriction:(hgv|bus|motorcar|motorcycle|agricultural|hazmat|caravan)$/.test(k));
  if(exempt||otherModeOnly){restrictionAudit.push({id:r.id,status:'not-applicable-to-bicycle'});continue;}
  let supported=!unsupportedScope&&!conditional(t)&&kinds.has(value)&&r.members.length===3&&from.length===1&&from[0].type==='way'&&via.length===1&&via[0].type==='node'&&to.length===1&&to[0].type==='way';
  if(supported){
   const a=original.get(from[0].ref),b=original.get(to[0].ref),node=via[0].ref;
   // Repeated via nodes and non-U-turn same-way relations need more semantics.
   supported=a&&b&&a.nodes.filter(n=>n===node).length===1&&b.nodes.filter(n=>n===node).length===1&&
    (a.id===b.id?value.endsWith('u_turn'):[a,b].every(w=>w.nodes[0]===node||w.nodes.at(-1)===node));
  }
  if(supported){
   turnRules.push({id:r.id,fromWay:from[0].ref,via:via[0].ref,toWay:to[0].ref,kind:value});
   restrictionAudit.push({id:r.id,status:'via-node-transition'});
  }else{
   restrictionAudit.push({id:r.id,status:'unsupported-quarantined'});
   for(const m of r.members){if(m.type==='way')quarantined.add(m.ref);if(m.type==='node')blockedNodes.set(m.ref,'unsupported-restriction-via');}
  }
 }
 const primary=new Set(snapshot.navigationSource.ways.map(w=>w.id));
 for(const w of snapshot.ways)if(!primary.has(w.id))excluded.push({way:w.id,reason:'reference-only-way'});
 const ways=[];
 for(const w of snapshot.navigationSource.ways){
  const reason=snapshot.integrity!=='pass'?'snapshot-integrity-incomplete':quarantined.has(w.id)?'unsupported-restriction-member':null;
  if(reason)excluded.push({way:w.id,reason});else ways.push(w);
 }
 const base=buildCandidateGraph({...snapshot.navigationSource,ways});
 const edges=base.edges.filter(e=>!blockedNodes.has(e.from)&&!blockedNodes.has(e.to));
 return {...base,nodes:base.nodes.filter(n=>!blockedNodes.has(n.id)),edges,
  excluded:[...excluded,...base.excluded].sort((a,b)=>a.way-b.way||a.reason.localeCompare(b.reason)),
  turnRules:turnRules.sort((a,b)=>a.id-b.id),
  blockedNodes:[...blockedNodes].sort(([a],[b])=>a-b).map(([node,reason])=>({node,reason})),
  restrictionAudit:restrictionAudit.sort((a,b)=>a.id-b.id),
  transitionEvidence:{integrity:snapshot.integrity,barrierHandling:'local incident-edge cuts; explicit bicycle access required for known barriers',
   restrictionHandling:'single-via-node incoming-edge rules; unsupported forms quarantined',
   immediateReversal:'conservatively unavailable except explicit only_u_turn',
   physicalBarrierPassability:'unvalidated',regionalCyclingProfile:'unchanged-unvalidated'}};
}
