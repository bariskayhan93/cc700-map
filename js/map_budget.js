// Extracted CC700 target allocation layout and iterator work, not frame timing.
// Limits are a conservative engineering profile near the inspected 23 km ride.
import {parse,fu,fb} from './pb.js';
export const MAP_BUDGET = Object.freeze({
  serializedBytes:65536, decodedBytes:57344, renderBytes:65536,
  iteratorScratchBytes:4096, projectionCalls:1400, projectedPoints:7000,
  fillVertices:2304, labelBytes:384,
});
export const TRANSITION_BUDGET = 245760;
export const CANVAS_BYTES = 240*256*2;
export const BUDGET_VERSION = 'cc700-payload-work-v1';
const descriptions = new WeakMap();
function describe(entry) {
  if(descriptions.has(entry)) return descriptions.get(entry);
  const fields=parse(Uint8Array.from(entry)),get=k=>fields.find(f=>f[0]===k)?.[2];
  const style=get(2),n=get(5),pairs=fields.filter(f=>f[0]===6);
  if(!Number.isSafeInteger(style)||style<0||!Number.isSafeInteger(n)||n<0||pairs.length!==n)
    throw new Error('Invalid encoded map entry');
  const result={style,n};descriptions.set(entry,result);return result;
}
export function estimateBlock(entries) {
  let points=0,big=0,calls=0,projected=0,projection=0,fillVertices=0,labelBytes=0,overlayEntries=0;
  let serializedBytes=entries.length ? 4+fu(1,entries.length).length : 9;
  for(let i=0;i<entries.length;i++) {
    const entry=entries[i],{style,n}=describe(entry),cls=style&15;
    serializedBytes+=entries.length ? fb(2,[...fu(1,i),...entry]).length : 0;
    points+=n;if(style)big=Math.max(big,n);
    let passes=0,length=n+1;
    if(!style){calls+=n;projected+=2*n;if(n)projection=Math.max(projection,2);continue;}
    if(cls===1||cls===4)passes=1;
    else if(cls===2||cls===3)passes=style&0x400?1:2;
    else if(cls>=5&&cls<=11&&((style>>>4)&7)<=4){
      passes=[5,6,7,11].includes(cls)?2:1;
      if(style&0x80&&[8,9,10].includes(cls))passes+=2;
    } else if(cls===12){passes=1;length=1;labelBytes+=n*8;}
    else if(cls===13||cls===14)passes=2;
    else if(cls===15){
      // Separate arrow/rough path. Charge both edge/core even when a particular
      // overlay needs one pass; never omit overlay work from admission.
      passes=2;overlayEntries++;
    }
    if(cls>=1&&cls<=3)fillVertices+=n+1;
    calls+=passes;projected+=passes*length;if(passes)projection=Math.max(projection,length);
  }
  const decodedBytes=28*entries.length+8*points;
  const iteratorScratchBytes=big?8*(big+1):0,projectionScratchBytes=4*projection;
  return {entries:entries.length,storedPairs:points,serializedBytes,decodedBytes,
    iteratorScratchBytes,projectionScratchBytes,renderBytes:decodedBytes+iteratorScratchBytes+projectionScratchBytes,
    projectionCalls:calls,projectedPoints:projected,fillVertices,fillEdgeChecksUpper:fillVertices*256,labelBytes,overlayEntries};
}
export function budgetFailures(cost,limits=MAP_BUDGET) {
  return Object.entries(limits).filter(([key,limit])=>{
    if(!Number.isFinite(limit)||limit<0||!Number.isFinite(cost[key])||cost[key]<0)throw new Error('Invalid map budget: '+key);
    return cost[key]>limit;
  }).map(([key])=>key);
}
export function transitionPeak(costs) {
  // Arbitrary jumps are possible off-route: account for every old/new pair.
  return CANVAS_BYTES+Math.max(0,...costs.map(c=>c.decodedBytes))+Math.max(0,...costs.map(c=>c.serializedBytes));
}
// Independent encoded readback for app admission. The generator's diagnostics
// are explanatory; they are not trusted in place of auditing the final bytes.
export function auditMapSection(bytes) {
  const invalid=()=>{throw new Error('Invalid encoded map section');};
  if(bytes.length<4)invalid();
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),base=4+view.getUint32(0,true);
  if(base>bytes.length)invalid();
  const index=parse(bytes.subarray(4,base)),refs=index.filter(f=>f[0]===2);
  if(index.find(f=>f[0]===1)?.[2]!==refs.length)invalid();
  const offsets=refs.map(f=>parse(f[2]).find(q=>q[0]===1)?.[2]);
  const distinct=[...new Set(offsets)].sort((a,b)=>a-b),costs=[];
  for(const offset of distinct){
    const start=base+offset;
    if(!Number.isSafeInteger(offset)||offset<0||start+4>bytes.length)invalid();
    const end=start+4+view.getUint32(start,true);
    if(end>bytes.length||end<=start+4)invalid();
    const fields=parse(bytes.subarray(start+4,end)),records=fields.filter(f=>f[0]===2);
    if(fields.find(f=>f[0]===1)?.[2]!==records.length)invalid();
    const entries=records.map((r,i)=>{
      if(parse(r[2])[0]?.[2]!==i)invalid();
      return Array.from(r[2].subarray(fu(1,i).length));
    });
    const cost=estimateBlock(entries);
    if(cost.serializedBytes!==end-start)invalid();
    costs.push(cost);
  }
  return costs;
}
