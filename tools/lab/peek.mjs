import fs from 'node:fs';
const R = new URL('../../js/', import.meta.url).pathname;
const {readFar} = await import(R+'far_map.js'); const {decodeBlockD,isBlockD}=await import(R+'map_codec.js'); const {readNativeRoute}=await import(R+'native_route.js');
const f = new Uint8Array(fs.readFileSync(process.argv[2]));
const v=new DataView(f.buffer); const tr=f.subarray(f.length-64);
console.log('trailer', Buffer.from(tr.subarray(0,4)).toString(), [...new Uint32Array(tr.slice(4,64).buffer)].slice(0,12));
const mapAt=v.getUint32(0x5c,true); console.log('mapAt',mapAt);
const route=readNativeRoute(f); console.log('route pts',route.length, route[0], route.at(-1).progress);
const map=f.subarray(mapAt, 143360); const mv=new DataView(map.buffer,map.byteOffset); const idx=mv.getUint32(0,true);
let o=4+idx, nb=0; const blocks=[];
while(o+4<=map.length){const n=mv.getUint32(o,true); if(!n||o+4+n>map.length)break; const b=map.subarray(o+4,o+4+n); if(isBlockD(b)) blocks.push(decodeBlockD(b)); o+=4+n; nb++;}
console.log('blocks',nb, blocks.map(b=>b.length));
console.log(JSON.stringify(blocks[0].slice(0,3)));
const cls={}; for(const e of blocks.flat()){const c=e.style&15; cls[c]=(cls[c]||0)+1;} console.log(cls);
const far=readFar(f.subarray(251012,251012+68502)); console.log(far.caps, far.frame, far.cells.length, JSON.stringify(far.cells[0]).slice(0,300));
