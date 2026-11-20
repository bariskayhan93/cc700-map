// Separate PC research source. Never mutates app caches, routes or firmware.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
import {routingQuery,captureRoutingSnapshot,validateRoutingSnapshot} from '../js/routing_snapshot.js';
export {routingQuery,captureRoutingSnapshot,validateRoutingSnapshot};
export function snapshotCandidateSource(snapshot){
 validateRoutingSnapshot(snapshot);
 const blocked=new Set(snapshot.nodes.filter(n=>n.tags?.barrier&&n.tags.barrier!=='no').map(n=>n.id)),blockedWays=new Set(),excludedRestrictions=[];
 for(const r of snapshot.restrictions){
  // An unconditional bicycle exemption alone is handled. Conditional tags remain
  // an explicit conservative exclusion; no partial turn semantics are invented.
  if((r.tags.except??'').split(';').map(x=>x.trim()).includes('bicycle')&&!Object.keys(r.tags).some(k=>k.includes('conditional')||k.startsWith('restriction:bicycle')))continue;
  excludedRestrictions.push(r.id);
  for(const m of r.members){if(m.type==='way')blockedWays.add(m.ref);if(m.type==='node')blocked.add(m.ref);}
 }
 const sourceIds=new Set(snapshot.navigationSource.ways.map(w=>w.id));
 const excludedWays=snapshot.ways.filter(w=>!sourceIds.has(w.id)).map(w=>({way:w.id,reason:'reference-only-way'})),ways=[];
 for(const w of snapshot.navigationSource.ways){
  const reason=snapshot.integrity!=='pass'?'snapshot-integrity-incomplete':blockedWays.has(w.id)?'restriction-member-way-quarantined':w.nodes.some(n=>blocked.has(n))?'barrier-or-restriction-node-quarantined':null;
  if(reason)excludedWays.push({way:w.id,reason});else ways.push(w);
 }
 return {source:{...snapshot.navigationSource,ways},excludedWays,excludedRestrictions,
  evidence:{integrity:snapshot.integrity,nodes:snapshot.nodes.length,restrictions:snapshot.restrictions.length,
   barrierNodes:snapshot.nodes.filter(n=>n.tags?.barrier&&n.tags.barrier!=='no').length,
   restrictionHandling:'entire member ways and via nodes quarantined; not a turn-aware planner'}};
}
export async function boundedResponse(response,maxBytes=64*1024*1024){
 if(!response.ok)throw Error('Overpass HTTP '+response.status);
 const chunks=[];let length=0;
 for await(const chunk of response.body){length+=chunk.length;if(length>maxBytes)throw Error('Response exceeds byte limit');chunks.push(Buffer.from(chunk));}
 return Buffer.concat(chunks);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const a=process.argv.slice(2);
 if(a[0]!=='--region'||a[2]!=='--output'||!((a.length===5&&a[4]==='--fetch')||(a.length===6&&a[4]==='--response')))throw Error('Usage: node tools/routing_snapshot.mjs --region REGION.json --output NEW_DIRECTORY (--fetch | --response RESPONSE.json)');
 const region=JSON.parse(fs.readFileSync(a[1],'utf8')),query=routingQuery(region.bbox),querySha256=hash(query),endpoint=region.endpoint??'https://overpass-api.de/api/interpreter';
 if(new URL(endpoint).protocol!=='https:')throw Error('HTTPS endpoint required');
 fs.mkdirSync(a[3],{recursive:false});fs.writeFileSync(path.join(a[3],'query.overpass'),query);fs.writeFileSync(path.join(a[3],'region.json'),JSON.stringify(region,null,2)+'\n');
 const receipt={status:'pending',network:a[4]==='--fetch',endpoint,querySha256,startedUtc:new Date().toISOString(),maxResponseBytes:64*1024*1024};
 const save=()=>fs.writeFileSync(path.join(a[3],'receipt.json'),JSON.stringify(receipt,null,2)+'\n');save();
 try{
  if(a[4]==='--response'&&fs.statSync(a[5]).size>receipt.maxResponseBytes)throw Error('Response exceeds byte limit');
  const raw=a[4]==='--fetch'?await boundedResponse(await fetch(endpoint,{method:'POST',body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(105000)})):fs.readFileSync(a[5]);
  if(raw.length>receipt.maxResponseBytes)throw Error('Response exceeds byte limit');
  // The saved answer holds its covered box (key coverBbox, js/wayback.js COVER_KEY) in front of the server bytes; no other data is added.
  const text=raw.toString('utf8'),open=text.search(/\S/);if(text[open]!=='{')throw Error('Overpass answer is not a JSON object');
  const stored=Buffer.from(text.slice(0,open+1)+'"coverBbox":'+JSON.stringify(region.bbox)+','+text.slice(open+1),'utf8');
  fs.writeFileSync(path.join(a[3],'response.json'),stored);receipt.responseSha256=hash(raw);receipt.responseBytes=raw.length;receipt.storedSha256=hash(stored);receipt.coverBbox=region.bbox;
  const snapshot=captureRoutingSnapshot(JSON.parse(raw),{bbox:region.bbox,querySha256});
  fs.writeFileSync(path.join(a[3],'snapshot.json'),JSON.stringify(snapshot)+'\n');
  const adapted=snapshotCandidateSource(snapshot);
  receipt.status=snapshot.integrity;receipt.nodes=snapshot.nodes.length;receipt.ways=snapshot.ways.length;receipt.restrictions=snapshot.restrictions.length;
  receipt.issues=snapshot.issues;receipt.filtering=adapted.evidence;receipt.candidateWays=adapted.source.ways.length;receipt.excludedWays=adapted.excludedWays.length;
  if(snapshot.integrity!=='pass')process.exitCode=2;
 }catch(e){receipt.status='failed';receipt.error=String(e.message);process.exitCode=1;}
 receipt.finishedUtc=new Date().toISOString();save();console.log(JSON.stringify(receipt,null,2));
}
