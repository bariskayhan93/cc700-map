// Separate PC research source. Never mutates app caches, routes or firmware.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const idOK=x=>Number.isSafeInteger(x)&&x>0;
const tagsOK=t=>t&&typeof t==='object'&&!Array.isArray(t)&&Object.values(t).every(v=>typeof v==='string');
const tags=t=>Object.fromEntries(Object.entries(t??{}).sort(([a],[b])=>a.localeCompare(b)));
const sorted=a=>a.sort((a,b)=>a.id-b.id);
const issueSort=a=>[...new Map(a.map(i=>[JSON.stringify(i),i])).values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
export function routingQuery(bbox){
 if(!Array.isArray(bbox)||bbox.length!==4||!bbox.every(Number.isFinite))throw Error('Invalid bbox');
 const [s,w,n,e]=bbox;
 if(s< -90||n>90||w< -180||e>180||s>=n||w>=e)throw Error('Invalid bbox');
 const area=(n-s)*111.32*(e-w)*111.32*Math.cos((s+n)/2*Math.PI/180);
 if(n-s>1||e-w>1||area>600)throw Error('Region exceeds bounded study area');
 return `[out:json][timeout:90][maxsize:134217728];\nway[highway](${bbox.join(',')})->.roads;\nrel(bw.roads)[type=restriction]->.restrictions;\nway(r.restrictions)->.members;\n(.roads;.members;)->.allways;\n(node(w.allways);node(r.restrictions);)->.nodes;\n(.allways;.nodes;.restrictions;);out body qt;\n`;
}
export function captureRoutingSnapshot(response,metadata){
 routingQuery(metadata?.bbox);
 if(!/^[a-f0-9]{64}$/.test(metadata.querySha256??''))throw Error('Invalid query identity');
 const issues=[],maps={node:new Map(),way:new Map(),relation:new Map()},bad={node:new Set(),way:new Set(),relation:new Set()};
 if(!response||typeof response!=='object'||!Array.isArray(response.elements))throw Error('Invalid Overpass response');
 if(response.remark)issues.push({code:'server-remark'});
 const base=response.osm3s?.timestamp_osm_base;
 if(typeof base!=='string'||!Number.isFinite(Date.parse(base)))issues.push({code:'missing-source-timestamp'});
 if(!response.elements.length)issues.push({code:'empty-response'});
 for(const e of response.elements){
  if(!e||!['node','way','relation'].includes(e.type)){issues.push({code:'invalid-element'});continue;}
  const type=e.type;
  if(!idOK(e.id)||!tagsOK(e.tags??{})){issues.push({code:'invalid-'+type});if(idOK(e.id)){bad[type].add(e.id);maps[type].delete(e.id);}continue;}
  let value;
  if(type==='node'){
   if(!Number.isFinite(e.lat)||!Number.isFinite(e.lon)||Math.abs(e.lat)>90||Math.abs(e.lon)>180){issues.push({code:'invalid-node',id:e.id});bad.node.add(e.id);maps.node.delete(e.id);continue;}
   value={id:e.id,point:[e.lat,e.lon],tags:tags(e.tags)};
  }else if(type==='way'){
   if(!Array.isArray(e.nodes)||e.nodes.length<2||!e.nodes.every(idOK)){issues.push({code:'invalid-way',id:e.id});bad.way.add(e.id);maps.way.delete(e.id);continue;}
   value={id:e.id,nodes:[...e.nodes],tags:tags(e.tags)};
  }else{
   if(e.tags?.type!=='restriction'){issues.push({code:'unexpected-relation',id:e.id});continue;}
   if(!Array.isArray(e.members)||!e.members.length||e.members.some(m=>!m||!['node','way','relation'].includes(m.type)||!idOK(m.ref)||typeof m.role!=='string')){
    issues.push({code:'invalid-relation',id:e.id});bad.relation.add(e.id);maps.relation.delete(e.id);continue;
   }
   value={id:e.id,members:e.members.map(m=>({type:m.type,ref:m.ref,role:m.role})),tags:tags(e.tags)};
  }
  if(bad[type].has(e.id))continue;
  const previous=maps[type].get(e.id);
  if(previous&&JSON.stringify(previous)!==JSON.stringify(value)){maps[type].delete(e.id);bad[type].add(e.id);issues.push({code:'conflicting-'+type,id:e.id});}
  else maps[type].set(e.id,value);
 }
 const ways=sorted([...maps.way.values()]),nodes=sorted([...maps.node.values()]),restrictions=sorted([...maps.relation.values()]),validWays=[];
 for(const w of ways){
  const missing=w.nodes.filter(id=>!maps.node.has(id));
  for(const node of new Set(missing))issues.push({code:'missing-way-node',way:w.id,node});
  if(!missing.length&&typeof w.tags.highway==='string'&&w.tags.highway.length)validWays.push({...w,nodes:[...w.nodes],pts:w.nodes.map(id=>[...maps.node.get(id).point]),tags:{...w.tags}});
 }
 for(const r of restrictions)for(const m of r.members){
  if(!maps[m.type].has(m.ref))issues.push({code:'missing-restriction-member',restriction:r.id,type:m.type,ref:m.ref});
  if(m.type==='relation')issues.push({code:'unsupported-nested-restriction',restriction:r.id});
 }
 const all=issueSort(issues),complete=all.length===0;
 // Only roads with an original node inside the primary query region enter the
 // candidate source. Outside restriction members have no restriction closure.
 const [south,west,north,east]=metadata.bbox;
 const selected=validWays.filter(w=>w.pts.some(([lat,lon])=>lat>=south&&lat<=north&&lon>=west&&lon<=east));
 return {version:1,kind:'routing-source-snapshot',integrity:complete?'pass':'incomplete',
  provenance:{bbox:[...metadata.bbox],querySha256:metadata.querySha256,osmBaseTimestamp:typeof base==='string'?base:null},
  nodes,ways,restrictions,issues:all,navigationSource:{version:1,complete,ways:selected,issues:all.map(i=>({...i}))},
  coverage:'requested region and referenced members only; not map completeness or cycling validation'};
}
export function snapshotCandidateSource(snapshot){
 if(snapshot?.kind!=='routing-source-snapshot'||snapshot.version!==1||!Array.isArray(snapshot.nodes)||!Array.isArray(snapshot.ways)||!Array.isArray(snapshot.restrictions)||!Array.isArray(snapshot.navigationSource?.ways)||!Array.isArray(snapshot.issues))throw Error('Invalid routing snapshot');
 if(!['pass','incomplete'].includes(snapshot.integrity))throw Error('Invalid routing snapshot integrity');
 if(snapshot.integrity==='pass'){
  if(!Array.isArray(snapshot.ways)||snapshot.issues.length)throw Error('Snapshot consistency mismatch');
  const elements=[...snapshot.nodes.map(n=>({type:'node',id:n.id,lat:n.point?.[0],lon:n.point?.[1],tags:n.tags})),
   ...snapshot.ways.map(w=>({...w,type:'way'})),...snapshot.restrictions.map(r=>({...r,type:'relation'}))];
  const checked=captureRoutingSnapshot({elements,osm3s:{timestamp_osm_base:snapshot.provenance?.osmBaseTimestamp}},snapshot.provenance);
  if(checked.integrity!=='pass'||JSON.stringify(checked.navigationSource)!==JSON.stringify(snapshot.navigationSource))throw Error('Snapshot consistency mismatch');
 }
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
  fs.writeFileSync(path.join(a[3],'response.json'),raw);receipt.responseSha256=hash(raw);receipt.responseBytes=raw.length;
  const snapshot=captureRoutingSnapshot(JSON.parse(raw),{bbox:region.bbox,querySha256});
  fs.writeFileSync(path.join(a[3],'snapshot.json'),JSON.stringify(snapshot)+'\n');
  const adapted=snapshotCandidateSource(snapshot);
  receipt.status=snapshot.integrity;receipt.nodes=snapshot.nodes.length;receipt.ways=snapshot.ways.length;receipt.restrictions=snapshot.restrictions.length;
  receipt.issues=snapshot.issues;receipt.filtering=adapted.evidence;receipt.candidateWays=adapted.source.ways.length;receipt.excludedWays=adapted.excludedWays.length;
  if(snapshot.integrity!=='pass')process.exitCode=2;
 }catch(e){receipt.status='failed';receipt.error=String(e.message);process.exitCode=1;}
 receipt.finishedUtc=new Date().toISOString();save();console.log(JSON.stringify(receipt,null,2));
}
