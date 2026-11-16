// Actual PC study formats only: no native route-file or device codec claim.
const KINDS=['no_left_turn','no_right_turn','no_straight_on','no_u_turn','no_entry','no_exit','only_left_turn','only_right_turn','only_straight_on','only_u_turn'];
const MAX=16*1024*1024,u32=n=>Number.isSafeInteger(n)&&n>=0&&n<=0xffffffff;
const pointOK=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=85&&Math.abs(p[1])<=180;
export function encodeGraphPacket(graph){
 const nodes=[...graph.nodes].sort((a,b)=>a.id-b.id),edges=[...graph.edges].sort((a,b)=>a.from-b.from||a.to-b.to||a.way-b.way),rules=graph.turnRules;
 if(!Array.isArray(rules)||nodes.length>250000||edges.length>600000||rules.length>20000)throw Error('Graph study bounds');
 const nodeIndex=new Map(nodes.map((n,i)=>[n.id,i])),wayIds=[...new Set([...edges.map(e=>e.way),...rules.flatMap(r=>[r.fromWay,r.toWay])])].sort((a,b)=>a-b),wayIndex=new Map(wayIds.map((id,i)=>[id,i]));
 if(nodeIndex.size!==nodes.length||nodes.some(n=>!Number.isSafeInteger(n.id)||n.id<=0||!pointOK(n.point)))throw Error('Invalid graph node');
 const size=32+12*nodes.length+4+12*edges.length+16*rules.length;if(size>MAX)throw Error('Graph packet byte limit');
 const packet=Buffer.alloc(size);packet.write('CCRG',0,'ascii');packet.writeUInt16LE(1,4);packet.writeUInt16LE(1,6);
 [nodes.length,edges.length,wayIds.length,rules.length,size].forEach((n,i)=>packet.writeUInt32LE(n,8+i*4));
 let e=0;
 nodes.forEach((n,i)=>{const at=32+12*i;packet.writeInt32LE(Math.round(n.point[0]*1e7),at);packet.writeInt32LE(Math.round(n.point[1]*1e7),at+4);packet.writeUInt32LE(e,at+8);while(e<edges.length&&edges[e].from===n.id)e++;});
 if(e!==edges.length)throw Error('Unknown edge origin');packet.writeUInt32LE(e,32+12*nodes.length);
 const edgeAt=36+12*nodes.length;
 edges.forEach((edge,i)=>{const to=nodeIndex.get(edge.to),cm=Math.round(edge.meters*100);if(to===undefined||!Number.isFinite(edge.meters)||edge.meters<0||!u32(cm)||!Number.isSafeInteger(edge.way)||edge.way<=0)throw Error('Invalid graph edge');
  packet.writeUInt32LE(to,edgeAt+12*i);packet.writeUInt32LE(wayIndex.get(edge.way),edgeAt+12*i+4);packet.writeUInt32LE(cm,edgeAt+12*i+8);});
 const turnAt=edgeAt+12*edges.length;
 rules.forEach((r,i)=>{const via=nodeIndex.get(r.via),kind=KINDS.indexOf(r.kind);if(via===undefined||kind<0)throw Error('Invalid graph turn');
  packet.writeUInt32LE(via,turnAt+16*i);packet.writeUInt32LE(wayIndex.get(r.fromWay),turnAt+16*i+4);packet.writeUInt32LE(wayIndex.get(r.toWay),turnAt+16*i+8);packet.writeUInt8(kind,turnAt+16*i+12);});
 return {packet,nodeIndex,wayIndex,format:'CCRG v1: 32 header + 12/node + 4 terminal offset + 12/edge + 16/turn; dense identities; no audit/labels/visit index'};
}
export function decodeGraphPacket(input){
 const b=Buffer.from(input);if(b.length<36||b.length>MAX||b.toString('ascii',0,4)!=='CCRG'||b.readUInt16LE(4)!==1||b.readUInt16LE(6)!==1||b.readUInt32LE(28)!==0)throw Error('Invalid graph header');
 const n=b.readUInt32LE(8),e=b.readUInt32LE(12),w=b.readUInt32LE(16),r=b.readUInt32LE(20),size=36+12*n+12*e+16*r;
 if(n>250000||e>600000||r>20000||w>e+2*r||b.length!==size||b.readUInt32LE(24)!==size)throw Error('Invalid graph counts');
 const nodes=[],edges=[],turnRules=[],offsets=[];
 for(let i=0;i<n;i++){const at=32+12*i,point=[b.readInt32LE(at)/1e7,b.readInt32LE(at+4)/1e7],offset=b.readUInt32LE(at+8);if(!pointOK(point)||offset>e||(i===0&&offset!==0)||(i&&offset<offsets.at(-1)))throw Error('Invalid graph offset/coordinate');nodes.push({id:i+1,point});offsets.push(offset);}
 const end=b.readUInt32LE(32+12*n);if(end!==e)throw Error('Invalid terminal offset');offsets.push(end);
 const edgeAt=36+12*n;
 for(let i=0;i<n;i++)for(let j=offsets[i];j<offsets[i+1];j++){const at=edgeAt+12*j,to=b.readUInt32LE(at),way=b.readUInt32LE(at+4);if(to>=n||way>=w)throw Error('Invalid graph edge index');edges.push({from:i+1,to:to+1,way:way+1,meters:b.readUInt32LE(at+8)/100});}
 const turnAt=edgeAt+12*e;
 for(let i=0;i<r;i++){const at=turnAt+16*i,via=b.readUInt32LE(at),from=b.readUInt32LE(at+4),to=b.readUInt32LE(at+8),kind=b.readUInt8(at+12);if(via>=n||from>=w||to>=w||kind>=KINDS.length||b.readUIntBE(at+13,3)!==0)throw Error('Invalid graph turn index');turnRules.push({id:i+1,via:via+1,fromWay:from+1,toWay:to+1,kind:KINDS[kind]});}
 return {nodes,edges,turnRules,cyclingValidity:'unvalidated'};
}
export function encodeLegLookup(rows){
 if(!Array.isArray(rows)||rows.length>4096)throw Error('Lookup row limit');
 const b=Buffer.alloc(16+32*rows.length);b.write('CCRX',0,'ascii');b.writeUInt16LE(1,4);b.writeUInt16LE(1,6);b.writeUInt32LE(rows.length,8);
 rows.forEach((r,i)=>{if(!pointOK(r.point)||![r.afterVisit,r.throughVisit,r.offset,r.length].every(u32)||r.throughVisit<r.afterVisit||(r.heading!==null&&(!Number.isFinite(r.heading)||r.heading<0||r.heading>=360)))throw Error('Invalid lookup row');const at=16+32*i;
  b.writeInt32LE(Math.round(r.point[0]*1e7),at);b.writeInt32LE(Math.round(r.point[1]*1e7),at+4);
  [r.afterVisit,r.throughVisit,r.offset,r.length].forEach((v,k)=>b.writeUInt32LE(v,at+8+k*4));b.writeUInt16LE(r.heading===null?65535:Math.round(r.heading*100)%36000,at+24);b.writeUInt16LE(0,at+26);b.writeUInt32LE(1,at+28);});
 return b;
}
export function encodeVisitIndex(visits,graph,packed){
 const directions=new Set(graph.edges.map(e=>`${e.way}:${e.from}:${e.to}`)),rows=[];
 for(const v of visits){const a=v.association;if(a?.status!=='associated')continue;const s=a.segment,from=packed.nodeIndex.get(s.from),to=packed.nodeIndex.get(s.to),way=packed.wayIndex.get(s.way);
  if(from===undefined||to===undefined||way===undefined)continue;
  const delta=((v.bearing-s.bearing+540)%360)-180,forward=Math.abs(delta)<=60&&directions.has(`${s.way}:${s.from}:${s.to}`),backward=Math.abs(delta)>=120&&directions.has(`${s.way}:${s.to}:${s.from}`);
  if(!forward&&!backward)continue;if(!u32(v.progress)||!Number.isFinite(a.t)||a.t<0||a.t>1||!Number.isFinite(v.bearing)||v.bearing<0||v.bearing>=360)throw Error('Invalid visit index row');
  rows.push({progress:v.progress,from,to,way,t:Math.round(a.t*0xffffffff),bearing:Math.round(v.bearing*100)%36000,flags:4|(forward?1:0)|(backward?2:0)});
 }
 if(rows.length>4096)throw Error('Visit index limit');const b=Buffer.alloc(16+24*rows.length);b.write('CCRV',0,'ascii');b.writeUInt16LE(1,4);b.writeUInt16LE(1,6);b.writeUInt32LE(rows.length,8);
 rows.forEach((r,i)=>{const at=16+24*i;[r.progress,r.way,r.from,r.to,r.t].forEach((n,j)=>b.writeUInt32LE(n,at+4*j));b.writeUInt16LE(r.bearing,at+20);b.writeUInt16LE(r.flags,at+22);});return b;
}
export function encodeAssociationIndex(index,graph,packed){
 const points=new Map();for(const s of index.segments){points.set(s.from,s.a);points.set(s.to,s.b);}
 const ids=[...points.keys()].sort((a,b)=>a-b),nodeIds=new Map(ids.map((id,i)=>[id,i]));
 const cells=[...index.cells].map(([key,refs])=>({point:key.split(',').map(Number),refs})).sort((a,b)=>a.point[0]-b.point[0]||a.point[1]-b.point[1]);
 const refCount=cells.reduce((n,c)=>n+c.refs.length,0),size=32+8*ids.length+20*index.segments.length+16*cells.length+4*refCount;
 if(size>32*1024*1024||index.segments.length>500000||refCount>3000000)throw Error('Association packet limit');
 const edgeIndex=new Map([...graph.edges].sort((a,b)=>a.from-b.from||a.to-b.to||a.way-b.way).map((e,i)=>[`${e.way}:${e.from}:${e.to}`,i]));
 const b=Buffer.alloc(size);b.write('CCRA',0,'ascii');b.writeUInt16LE(1,4);b.writeUInt16LE(1,6);
 [ids.length,index.segments.length,cells.length,refCount].forEach((n,i)=>b.writeUInt32LE(n,8+4*i));b.writeInt32LE(Math.round(index.lat0*1e7),24);b.writeUInt32LE(index.cellMeters,28);
 ids.forEach((id,i)=>points.get(id).forEach((v,k)=>b.writeInt32LE(Math.round(v*1e7),32+8*i+4*k)));
 const segAt=32+8*ids.length;
 index.segments.forEach((s,i)=>{const at=segAt+20*i;[nodeIds.get(s.from),nodeIds.get(s.to),edgeIndex.get(`${s.way}:${s.from}:${s.to}`)??0xffffffff,edgeIndex.get(`${s.way}:${s.to}:${s.from}`)??0xffffffff,1].forEach((v,k)=>b.writeUInt32LE(v,at+4*k));});
 const cellAt=segAt+20*index.segments.length,refAt=cellAt+16*cells.length;let offset=0;
 cells.forEach((c,i)=>{const at=cellAt+16*i;b.writeInt32LE(c.point[0],at);b.writeInt32LE(c.point[1],at+4);b.writeUInt32LE(offset,at+8);b.writeUInt32LE(c.refs.length,at+12);for(const ref of c.refs)b.writeUInt32LE(ref,refAt+4*offset++);});
 return b;
}
