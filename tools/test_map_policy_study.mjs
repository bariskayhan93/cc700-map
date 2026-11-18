import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildRoute} from '../js/route.js';
import {extendedCases} from './map_benchmark_cases.mjs';
import {assessCase} from './map_benchmark.mjs';
import {studyBuilder} from './map_policy_study.mjs';
const fixture=id=>extendedCases().find(c=>c.id===id);
test('instrumented reference is byte-exact apart from timestamp and does not change source objects',async()=>{
 const build=await studyBuilder({mode:'reference',radius:1000}),c=fixture('forest'),before=structuredClone(c);
 const opts={...c.data,id:'study',nameImage:()=>new Uint8Array(42),navigationLines:c.navigationLines,map:{styled:true,names:true},noF9:true};
 const a=buildRoute(c.gpx,c.lines,opts),b=build(c.gpx,c.lines,opts);
 assert.deepEqual(b.file.subarray(4),a.file.subarray(4));assert.deepEqual(c,before);
});
test('one overloaded optional fill cannot block affordable outer cycling context',async()=>{
 const c=fixture('competing-layers'),base=assessCase(c),build=await studyBuilder({mode:'layered',radius:1000}),r=assessCase(c,{build,policy:'layered-1000'});
 assert.equal(r.status,'pass',JSON.stringify(r.failures));assert.equal(base.probes.find(p=>p.id==='outer-cycle-950').matched,false);
 assert.equal(r.probes.find(p=>p.id==='outer-cycle-950').matched,true);
 assert(r.probes.filter(p=>p.required).every(p=>p.matched));assert(r.blocks.every(b=>b.cost.iteratorScratchBytes<=4096));
});
for(const radius of [1000,2000,3000])test(`layered ${radius} m study keeps native records and required geometry under all budgets`,async()=>{
 const build=await studyBuilder({mode:'layered',radius}),r=assessCase(fixture('village'),{build,policy:'layered-'+radius});
 assert.equal(r.status,'pass',JSON.stringify(r.failures));assert.equal(r.nativeRecordsMatch,true);
 assert.equal(r.probes.find(p=>p.id==='essential-context-'+radius).matched,true);
 assert(r.costs.transitionPeakBytes<=245760);
});
test('study refuses unsupported policies or radii instead of silently changing an experiment',async()=>{
 await assert.rejects(studyBuilder({mode:'unknown',radius:1000}),/policy/);
 await assert.rejects(studyBuilder({mode:'layered',radius:4000}),/radius/);
});
