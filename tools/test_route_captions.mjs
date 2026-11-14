// Synthetic geometry and encoded record readback; models the stock Q(k + 1)
// caption lookup, not the complete firmware navigation state machine.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRoute } from '../js/route.js';
import { parse } from '../js/pb.js';
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
const point = ([x,y]) => [y/111320,x/111320,0];
const road = (name,xy) => ({name,kind:1,pts:xy.map(point)});
function generate(gap=22,{name='Street',waypoint=false,three=false,roundIndex=-1}={}) {
 const xy=three?[[0,0],[0,100],[gap,100],[gap,125],[120,125]]:[[0,0],[0,100],[gap,100],[gap,200]];
 const names=Array.isArray(name)?name:[name,name,name];
 const lines=[road(names[0],[[0,0],[0,170]]),road(names[1],[[-50,100],[100,100]]),road(names[2],[[gap,40],[gap,200]])];
 if(roundIndex>=0) lines[roundIndex].kind|=128;
 if(three) lines.push(road(name,[[-50,125],[120,125]]));
 return buildRoute({name:'Synthetic captions',pts:xy.map(point),wpts:waypoint?[{lat:point([0,100])[0],lon:point([0,100])[1],name:'Water'}]:[]},lines,
  {id:'test',nameImage:text=>encoder.encode(text),map:{}});
}
function records(result) {
 const f=result.file,v=new DataView(f.buffer,f.byteOffset,f.byteLength),out=[];
 for(let offset=0x80;out.length<result.sections.length;){
  const length=v.getUint32(offset,true),fields=Object.fromEntries(parse(f.subarray(offset+4,offset+4+length)).map(([k,,value])=>[k,value]));
  const info=Object.fromEntries(parse(fields[1]).map(([k,,value])=>[k,value]));
  out.push({caption:decoder.decode(info[6]),bytes:info[6],imageOffset:info[7]});offset+=4+length;
 }
 return out;
}
for(const gap of [22,27]) test(`stock next-record caption exposes the following turn across a ${gap} m pair`,()=>{
 const r=generate(gap),rows=records(r);
 assert.deepEqual(r.sections.filter(s=>s.dir).map(s=>s.dir),[3,1]);
 assert.equal(rows[0].caption,'Street');
 assert.equal(rows[1].caption,'then left · Street'); // caption while approaching the first right
 assert.equal(rows[2].caption,'Street'); // hint clears after first turn
});
test('three close maneuvers shift each caption once without accumulating old hints',()=>{
 const r=generate(22,{three:true}),rows=records(r);
 assert.deepEqual(r.sections.filter(s=>s.dir).map(s=>s.dir),[3,1,3]);
 assert.deepEqual(rows.map(row=>row.caption),['Street','then left · Street','then right · Street','Street']);
});
test('ordinary unrelated record names retain their own native caption',()=>{
 const r=generate(22,{name:['Approach','Cross','Exit']}),rows=records(r);
 assert.deepEqual(r.sections.map(s=>s.name),['Approach','Approach','Cross']);
 assert.deepEqual(rows.map(row=>row.caption),['Approach','then left · Approach','Cross']);
});
test('UTF-8 native caption stays within stock 63-byte limit on a character boundary',()=>{
 const r=generate(22,{name:'界'.repeat(48)}),rows=records(r);
 assert.equal(rows[0].caption,'界'.repeat(21));
 assert.equal(rows[1].caption,'then left · '+'界'.repeat(16));
 for(const row of rows) assert(row.bytes.length<=63);
});
test('waypoint state belongs to its own outgoing record and clears on the next',()=>{
 const r=generate(22,{waypoint:true}),rows=records(r);
 assert.deepEqual(rows.map(row=>row.caption),['Street','then left · Street','▶ Water','Street']);
});
test('serialized name bitmaps and native captions carry the same shifted hint',()=>{
 const r=generate(),rows=records(r),v=new DataView(r.file.buffer,r.file.byteOffset,r.file.byteLength),base=v.getUint32(0x60,true);
 rows.forEach((row,i)=>{
  const end=i+1<rows.length?rows[i+1].imageOffset:r.file.indexOf(255,base+row.imageOffset)-base;
  assert.equal(decoder.decode(r.file.subarray(base+row.imageOffset,base+end)),row.caption);
 });
});

function bitmapText(result, rows, index) {
 const v=new DataView(result.file.buffer,result.file.byteOffset,result.file.byteLength),base=v.getUint32(0x60,true);
 const start=base+rows[index].imageOffset,end=index+1<rows.length?base+rows[index+1].imageOffset:result.file.indexOf(255,start);
 return decoder.decode(result.file.subarray(start,end));
}
test('ordinary roundabout bitmap retains legacy exit street while native field 6 retains its own name',()=>{
 const r=buildRoute({name:'Synthetic roundabout',pts:[[0,0],[0,600],[600,600]].map(point)},
  [{name:'Ring',kind:129,pts:[[0,0],[0,600]].map(point)},road('Exit',[[0,600],[600,600]])],
  {id:'test',nameImage:text=>encoder.encode(text),map:{}});
 const rows=records(r);
 assert.equal(r.sections[1].round,true);
 assert.equal(rows[1].caption,'Ring');
 assert.equal(bitmapText(r,rows,1),'Exit');
});
test('close hint takes priority on a roundabout bitmap and retains its legacy exit name',()=>{
 const r=generate(22,{name:['Approach','Cross','Exit'],roundIndex:1}),rows=records(r);
 assert.equal(r.sections[1].round,true);
 assert.equal(rows[1].caption,'then left · Approach');
 assert.equal(bitmapText(r,rows,1),'then left · Cross');
});
