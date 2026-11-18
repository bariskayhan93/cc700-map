import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildRoute} from '../js/route.js';
import {benchmarkCases} from './map_benchmark_cases.mjs';
import {assessCase,runBenchmark,compareReports} from './map_benchmark.mjs';
const fixture=id=>benchmarkCases().find(c=>c.id===id);
test('baseline matrix includes terrain, transitions, overlap, sparse/noisy data and overload',()=>{
 const cases=benchmarkCases();assert.equal(new Set(cases.map(c=>c.id)).size,cases.length);
 for(const id of ['urban','village','forest','water-crossing','parallel-hairpin','overlap','detour-context','mixed-transition','sparse','noisy','protected-overload'])assert(fixture(id),id);
});
test('encoded baseline checks essential geometry, resource costs and actual native records',()=>{
 const r=assessCase(fixture('water-crossing'));
 assert.equal(r.status,'pass',JSON.stringify(r.failures));assert(r.probes.filter(p=>p.required).every(p=>p.matched));
 assert.equal(r.nativeRecordsMatch,true);assert(r.blocks.length);assert(r.costs.transitionPeakBytes>122880);
 assert.equal(r.evidence.targetFrameTime,'unmeasured');assert.equal(r.evidence.pixelLegibility,'unvalidated');
});
test('removing a protected path is detected even if bytes and work improve',()=>{
 const build=(gpx,lines,opt)=>buildRoute(gpx,lines.filter(l=>!(l.fl&32)),opt);
 const r=assessCase(fixture('forest'),{build,policy:'negative-drop-cycleway'});
 assert.equal(r.status,'fail');assert(r.failures.some(f=>f.code==='protected-feature-missing'));
});
test('changing a bridge layer cannot pass through unchanged entry counts',()=>{
 const build=(gpx,lines,opt)=>buildRoute(gpx,lines.map(l=>({...l,fl:(l.fl||0)&~1})),opt);
 const r=assessCase(fixture('water-crossing'),{build,policy:'negative-bridge'});
 assert.equal(r.status,'fail');assert(r.failures.some(f=>f.code==='protected-feature-missing'));
});
test('optional source pollution fails actual native-record equality',()=>{
 const build=(gpx,lines,{navigationLines,...opt})=>buildRoute(gpx,lines,opt);
 const r=assessCase(fixture('detour-context'),{build,policy:'negative-native-pollution'});
 assert.equal(r.status,'fail');assert.equal(r.nativeRecordsMatch,false);
});
test('expected overload is separate from generated success and cannot be silently pruned',()=>{
 const c=fixture('protected-overload'),good=assessCase(c);
 assert.equal(good.status,'expected_rejection');assert.equal(good.blocks.length,0);
 const build=(gpx,lines,opt)=>buildRoute(gpx,lines,{...opt,green:[]});
 const bad=assessCase(c,{build,policy:'negative-prune-overload'});
 assert.equal(bad.status,'fail');assert(bad.failures.some(f=>f.code==='expected-rejection-missing'));
});
test('costs and fixture fingerprints repeat; wall time never becomes target evidence',()=>{
 const cases=[fixture('village')],a=runBenchmark(cases),b=runBenchmark(structuredClone(cases));
 assert.deepEqual(a,b);assert.equal(a.status,'pass');assert(a.sourceFingerprint);assert(a.cases[0].fixtureFingerprint);
 assert.equal(a.targetAcceptance,'unvalidated');assert(!JSON.stringify(a).includes('generationMs'));
});
test('comparisons reject different fixtures and retain per-case losses',()=>{
 const a=runBenchmark([fixture('forest')]),b=structuredClone(a);
 b.cases[0].costs.fileBytes+=4096;
 const d=compareReports(a,b);assert.equal(d.cases[0].delta.fileBytes,4096);
 b.cases[0].fixtureFingerprint='different';assert.throws(()=>compareReports(a,b),/fixture/i);
});
test('empty or duplicate benchmark inputs cannot masquerade as a complete passing run',()=>{
 assert.throws(()=>runBenchmark([]),/empty/i);
 assert.throws(()=>runBenchmark([fixture('forest'),fixture('forest')]),/duplicate/i);
});
test('comparison reports a failed generation without inventing numeric deltas or hiding lost probes',()=>{
 const a=runBenchmark([fixture('forest')]),b=structuredClone(a);
 b.cases[0].status='fail';b.cases[0].costs={};b.cases[0].probes=[];
 const d=compareReports(a,b);assert.equal(d.cases[0].afterStatus,'fail');
 assert.equal(d.cases[0].delta.fileBytes,null);assert(d.cases[0].lostRequiredProbes.includes('cycle-fork'));
});
test('dense-city benchmark actually exercises resource pressure rather than just many long lines',()=>{
 const r=assessCase(fixture('urban'));assert.equal(r.status,'pass',JSON.stringify(r.failures));
 assert(r.costs.projectionCallsMax>900,`urban work too light: ${r.costs.projectionCallsMax}`);
});
test('source fingerprint covers geometry, protobuf, readback and rendering dependencies',()=>{
 const r=runBenchmark([fixture('village')]);
 for(const file of ['js/geo.js','js/pb.js','js/preview.js','js/device_draw.js','js/map_style.js'])assert(r.sources[file],file);
});
test('actual block transitions are probed on both sides and use preview boundary selection',async()=>{
 const {readFile}=await import('../js/preview.js');
 const c=fixture('mixed-transition'),r=assessCase(c);assert.equal(r.status,'pass');
 assert(r.boundaryProbes.length>=2);assert(r.boundaryProbes.every(p=>p.matched));
 for(let i=0;i<r.boundaryProbes.length;i+=2){assert.equal(r.boundaryProbes[i+1].section,r.boundaryProbes[i].section+1);}
 const opts={...c.data,id:'benchmark',nameImage:()=>new Uint8Array(42),navigationLines:c.navigationLines,noF9:true,map:{styled:true,names:true}};
 const model=readFile(buildRoute(c.gpx,c.lines,opts).file),k=model.blocks.findIndex((b,i)=>i&&b!==model.blocks[i-1]);
 const atMeters=model.secs[k][0][2]/100;
 const withExact={...c,probes:[...c.probes,{id:'exact-boundary',cls:10,xy:[0,1200],atMeters,required:true,toleranceMeters:3}]};
 assert.equal(assessCase(withExact).probes.find(p=>p.id==='exact-boundary').section,k);
});
test('a missing cycle link in just one block fails the seam check despite equal block entry counts',async()=>{
 const {readFile}=await import('../js/preview.js'),{parse,fu}=await import('../js/pb.js');
 const c=fixture('mixed-transition'),build=(gpx,lines,opt)=>{
  const r=buildRoute(gpx,lines,opt),m=readFile(r.file),k=m.blocks.findIndex((b,i)=>i&&b!==m.blocks[i-1]);
  const v=new DataView(r.file.buffer),mo=v.getUint32(0x5c,true),n=v.getUint32(mo,true),ib=mo+4+n;
  const indices=parse(r.file.subarray(mo+4,ib)).filter(f=>f[0]===2).map(f=>parse(f[2])[0][2]);
  const bo=ib+indices[k],len=v.getUint32(bo,true);
  for(const f of parse(r.file.subarray(bo+4,bo+4+len)))if(f[0]===2){
   const e=f[2],fields=parse(e),style=fields.find(q=>q[0]===2)[2];
   if((style&15)===10){const id=fields.find(q=>q[0]===1)[2],at=e.byteOffset+fu(1,id).length+1;assert.equal(r.file[at],42);r.file[at]=40;}
  }
  return r;
 };
 const r=assessCase(c,{build,policy:'negative-one-block-link-loss'});
 assert.equal(r.status,'fail');assert(r.failures.some(f=>f.code==='block-boundary-feature-missing'));
 assert(r.boundaryProbes.some(p=>!p.matched));
});
