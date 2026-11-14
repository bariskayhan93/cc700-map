import assert from 'node:assert/strict';
import {test} from 'node:test';
import {canonicalEntries} from '../js/map_order.js';
import {fu,parse} from '../js/pb.js';
const entry=(style,id)=>new Uint8Array([...fu(2,style),...fu(3,id)]);
const s=e=>parse(e).find(([f])=>f===2)[2];
const ids=a=>a.map(e=>parse(e).find(([f])=>f===3)[2]);
function trace(entries) {
 const out=[];
 const take=(filter)=>out.push(ids(entries.filter(filter)));
 take(e=>!s(e));
 for(let cls=1;cls<=4;cls++)take(e=>(s(e)&15)===cls);
 for(let lv=0;lv<5;lv++)for(const cls of [9,8,10,7,6,5,7,6,5,11,11])take(e=>(s(e)&15)===cls && ((s(e)>>4)&7)===lv);
 take(e=>[13,14].includes(s(e)&15));take(e=>(s(e)&15)===12);take(e=>(s(e)&15)===15);
 return out;
}
test('canonical serialization preserves semantic dispatch order for all classes levels flags',()=>{
 const a=[];let id=0;
 for(let cls=0;cls<16;cls++)for(let lv=0;lv<8;lv++)for(let flags=0;flags<32;flags++)a.push(entry(cls|(lv<<4)|(flags<<7),id++));
 let seed=17;for(let i=a.length-1;i;i--){seed=seed*16807%2147483647;const j=seed%(i+1);[a[i],a[j]]=[a[j],a[i]];}
 const before=a.slice(),sorted=canonicalEntries(a);
 assert.deepEqual(trace(sorted),trace(a));assert.deepEqual(a,before);
 // New-file ranges must actually be compact, not merely reordered accidentally.
 const class6level2=sorted.map((e,i)=>[s(e),i]).filter(([style])=>(style&15)===6&&((style>>4)&7)===2).map(([,i])=>i);
 assert.equal(class6level2.at(-1)-class6level2[0]+1,class6level2.length);
 assert.notDeepEqual(ids(sorted),ids(a));
});
test('interleaved symbols, label priority and overlay order are stable',()=>{
 const a=[entry(14,1),entry(12,2),entry(13,3),entry(15|65536,4),entry(12,5),entry(14,6),entry(15|32768,7)];
 const b=canonicalEntries(a);assert.deepEqual(trace(b),trace(a));
});
