// Routing source snapshot from an Overpass response: OSM node ids, way tags and restriction relations.
// Pure code, shared by the page and the host tools (tools/routing_snapshot.mjs).
const idOK=x=>Number.isSafeInteger(x)&&x>0;
const tagsOK=t=>t&&typeof t==='object'&&!Array.isArray(t)&&Object.values(t).every(v=>typeof v==='string');
const tags=t=>Object.fromEntries(Object.entries(t??{}).sort(([a],[b])=>a.localeCompare(b)));
const sorted=a=>a.sort((a,b)=>a.id-b.id);
const issueSort=a=>[...new Map(a.map(i=>[JSON.stringify(i),i])).values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const boxArea=([s,w,n,e])=>(n-s)*111.32*(e-w)*111.32*Math.cos((s+n)/2*Math.PI/180);
// Area of the union of boxes (km²), counted on a 0.01 degree grid (cells whose centre is inside a box).
export function unionArea(boxes){
 const G=0.01,cells=new Set();let a=0;
 for(const[s,w,n,e]of boxes)for(let i=Math.floor(s/G);i*G<n;i++)for(let j=Math.floor(w/G);j*G<e;j++){
  const la=(i+.5)*G,lo=(j+.5)*G,k=i+','+j;if(la<s||la>n||lo<w||lo>e||cells.has(k))continue;cells.add(k);a+=boxArea([i*G,j*G,(i+1)*G,(j+1)*G]);}
 return a;
}
function checkBox(b,msg){
 if(!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite))throw Error(msg);
 const [s,w,n,e]=b;
 if(s< -90||n>90||w< -180||e>180||s>=n||w>=e)throw Error(msg);
 if(n-s>1||e-w>1)throw Error('Region exceeds bounded study area');
}
// bbox: the region of the snapshot (provenance). boxes (far map, 23 Nov): a corridor of smaller boxes inside it; then the
// 600 km² bound applies to their summed area, and the query takes the union of the boxes.
export function routingQuery(bbox,boxes){
 checkBox(bbox,'Invalid bbox');
 const parts=boxes===undefined?[bbox]:boxes;
 if(!Array.isArray(parts)||!parts.length)throw Error('Invalid box');
 for(const b of parts)checkBox(b,'Invalid box');
 if((parts.length===1?boxArea(parts[0]):unionArea(parts))>600)throw Error('Region exceeds bounded study area');
 const roads=parts.length===1?`way[highway](${parts[0].join(',')})->.roads;`:`(${parts.map(b=>`way[highway](${b.join(',')});`).join('')})->.roads;`;
 return `[out:json][timeout:90][maxsize:134217728];\n${roads}\nrel(bw.roads)[type=restriction]->.restrictions;\nway(r.restrictions)->.members;\n(.roads;.members;)->.allways;\n(node(w.allways);node(r.restrictions);)->.nodes;\n(.allways;.nodes;.restrictions;);out body qt;\n`;
}
export function captureRoutingSnapshot(response,metadata){
 routingQuery(metadata?.bbox,metadata?.boxes);
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
 // coverBbox [S,W,N,E] (20 Nov): the box the street data covers. A replayed answer brings its saved box; a live one covers
 // the query box. js/wayback.js waybackFromSnapshot checks it against the box of the reach.
 const cb=response.coverBbox,coverBbox=Array.isArray(cb)&&cb.length===4&&cb.every(Number.isFinite)?[...cb]:[...metadata.bbox];
 return {version:1,kind:'routing-source-snapshot',coverBbox,integrity:complete?'pass':'incomplete',
  provenance:{bbox:[...metadata.bbox],...(metadata.boxes?{boxes:metadata.boxes.map(b=>[...b])}:{}),querySha256:metadata.querySha256,osmBaseTimestamp:typeof base==='string'?base:null},
  nodes,ways,restrictions,issues:all,navigationSource:{version:1,complete,ways:selected,issues:all.map(i=>({...i}))},
  coverage:'requested region and referenced members only; not map completeness or cycling validation'};
}
export function validateRoutingSnapshot(snapshot){
 if(snapshot?.kind!=='routing-source-snapshot'||snapshot.version!==1||!Array.isArray(snapshot.nodes)||!Array.isArray(snapshot.ways)||!Array.isArray(snapshot.restrictions)||!Array.isArray(snapshot.navigationSource?.ways)||!Array.isArray(snapshot.issues))throw Error('Invalid routing snapshot');
 if(!['pass','incomplete'].includes(snapshot.integrity))throw Error('Invalid routing snapshot integrity');
 if(snapshot.integrity==='pass'){
  if(!Array.isArray(snapshot.ways)||snapshot.issues.length)throw Error('Snapshot consistency mismatch');
  const elements=[...snapshot.nodes.map(n=>({type:'node',id:n.id,lat:n.point?.[0],lon:n.point?.[1],tags:n.tags})),
   ...snapshot.ways.map(w=>({...w,type:'way'})),...snapshot.restrictions.map(r=>({...r,type:'relation'}))];
  const checked=captureRoutingSnapshot({elements,osm3s:{timestamp_osm_base:snapshot.provenance?.osmBaseTimestamp}},snapshot.provenance);
  if(checked.integrity!=='pass'||JSON.stringify(checked.navigationSource)!==JSON.stringify(snapshot.navigationSource))throw Error('Snapshot consistency mismatch');
 }
}
