import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {buildRoute} from '../js/route.js';
import {readFile} from '../js/preview.js';
import {loadOSM} from '../js/osm.js';
import {parse} from '../js/pb.js';
let requests=0;
globalThis.fetch=async()=>{requests++;throw Error('network disabled by audit')};
Object.defineProperty(globalThis.navigator,'onLine',{value:false,configurable:true});
const track=[[0.025,0.04],[0.026,0.041]];
const empty=()=>({v:7,t:Date.now(),lines:[],areas:[],water:[],rails:[]});
for(const [label,cell] of [['fresh',empty()],['stale',{...empty(),t:0,v:1}]]){
 requests=0;
 await loadOSM(track,null,{get:async k=>k.startsWith('n')?{t:Date.now(),sig:[],stop:[]}:cell,put:async()=>{throw Error('unexpected write')}});
 assert.equal(requests,0);console.log('PASS offline '+label+' cached cells retained');
}
requests=0;
await assert.rejects(loadOSM(track,null,{get:async()=>undefined,put:async()=>{throw Error('unexpected write')}}),/Kartendaten nicht geladen/);
assert(requests>0);console.log('PASS missing mandatory cell rejects when fetch fails');
requests=0;
await loadOSM(track,null,{get:async k=>k.startsWith('n')?undefined:empty(),put:async()=>{throw Error('unexpected write')}});
assert.equal(requests,0);console.log('PASS missing optional nodes stays offline');
Object.defineProperty(globalThis.navigator,'onLine',{value:true,configurable:true});
requests=0;
await loadOSM(track,null,{get:async k=>k.startsWith('n')?undefined:{...empty(),v:8},put:async()=>{throw Error('unexpected write')}});
assert(requests>0);console.log('PASS online optional nodes tolerates fetch failure');
Object.defineProperty(globalThis.navigator,'onLine',{value:false,configurable:true});
for (const styled of [false,true]) {
 const r=buildRoute({name:'Synthetic 70km',pts:[[0,0,0],[0.63,0,0]]},[],{id:'synthetic',speedKmh:18,nameImage:()=>new Uint8Array(42),map:{styled},noF9:styled});
 const model=readFile(r.file);assert.equal(model.secs.length,r.sections.length);assert.equal(model.blocks.length,r.sections.length);
 assert(model.secs.every(s=>s.length<=50));assert(r.file.length<4_000_000);
 let offset=128,geoRecords=0;
 while(offset+4<r.file.length){const n=new DataView(r.file.buffer).getUint32(offset,true);if(!n||n>16000||offset+4+n>r.file.length)break;
 const fields=parse(r.file.subarray(offset+4,offset+4+n));const info=fields.find(([f])=>f===1)?.[2];assert(info);assert(parse(info).some(([f])=>f===8));geoRecords++;offset+=4+n;}
 assert.equal(geoRecords,r.sections.length);
 console.log('PASS synthetic 70km '+(styled?'styled':'stock')+': '+r.sections.length+' records; '+r.file.length+' bytes; max '+Math.max(...model.secs.map(s=>s.length))+' points; every record geohash-indexed');
}
// cc27: the page offers patch27 as the default with way-back on and keeps patch25 (cc26, map only); it saves the choice and
// writes scheme D with the block switches (source check).
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8'), app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const cc27 = readFileSync(new URL('../js/cc27_file.js', import.meta.url), 'utf8');
  assert.match(html, /<option value="patch27" selected>Patch cc27 \(eigene Linien, graue Straßen, Höhenprofil\)<\/option>/);
  assert.match(html, /<option value="patch25">/);
  assert.match(html, /<select id="waybackReach"><option value="line1k">1 km<\/option><option value="line2k">2 km<\/option><option value="line3k" selected>3 km<\/option><\/select>/);
  for (const id of ['wayback', 'ownLines', 'testText', 'elevation']) assert.match(html, new RegExp(`<input id="${id}" type="checkbox">`));
  assert.doesNotMatch(html, /id="arrows"/);   // the turn-arrow layer is removed (18 Nov)
  assert.match(app, /\[\['wayback', 'cc700-wb2'\], \['ownLines', 'cc700-own'\], \['testText', 'cc700-text'\], \['elevation', 'cc700-elev'\]\]/);
  assert.match(app, /\$\(k\)\.checked = true;   \/\/ default on/);
  assert.match(app, /launchQueue\.setConsumer/);   // a .gpx opened with the installed app
  assert.match(app, /savedFw === 'patch25' \|\| savedFw === 'patch27'/);
  assert.match(app, /codec = fwChoice === 'patch25' \|\| fwChoice === 'patch27' \? 'd' : undefined/);
  assert.match(app, /blockFlags: cc27Flags\(sw, gpxHasElevation\(gpx\)\)/);
  assert.match(app, /localStorage\.setItem\('cc700-fw2', \$\('fw'\)\.value\)/);
  assert.match(app, /cc27Sections\(r\.file, \{ wayback: \$\('wayback'\)\.checked, elevation: sw\.elevation, reach: \$\('waybackReach'\)\.value \}\)/);
  assert.doesNotMatch(app, /addWayback/);           // only cc27 writes way-back data (cc26 formats are gone)
  assert.match(cc27, /addWayback\(routeFile, \{format: 2, reach: r, fetchImpl\}\)/);
  assert.match(app, /ohne graue Straßen: ' \+ c\.report\.greyReason/);   // review finding 4: the summary says why
  assert.match(app, /checkWayback\(file\)/);   // the identity is checked before the file is sent (owner ruling, 18 Nov)
  console.log('PASS page defaults to patch27 with way-back, grey streets and elevation, keeps patch25, saves the choice');
}
// cc27 Task 12: the cc27 file has the 3 sections and the switches in every map block (synthetic street grid at 51, 7).
{
  const {cc27Flags, cc27Sections, gpxHasElevation} = await import('../js/cc27_file.js');
  const {readSections} = await import('../js/wayback_embed.js');
  const {SC} = await import('../js/pb.js');
  const K = Math.cos(51 * Math.PI / 180), pt = (x, y) => [51 + y / 111320, 7 + x / (111320 * K)], nodeId = (i, j) => 1000 + i * 11 + j + 1;
  const els = [];
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { const [lat, lon] = pt(i * 100, j * 100); els.push({type: 'node', id: nodeId(i, j), lat, lon}); }
  for (let k = 0; k <= 10; k++) {
    els.push({type: 'way', id: 100 + k, nodes: Array.from({length: 11}, (_, i) => nodeId(i, k)), tags: {highway: 'residential'}});
    els.push({type: 'way', id: 200 + k, nodes: Array.from({length: 11}, (_, j) => nodeId(k, j)), tags: {highway: 'residential'}});
  }
  const fetchImpl = async () => ({ok: true, status: 200, json: async () => ({osm3s: {timestamp_osm_base: '2026-11-01T00:00:00Z'}, elements: els})});
  const gpx = {name: 'cc27', pts: Array.from({length: 11}, (_, i) => [...pt(i * 100, 0), 50 + i])};
  const build = flags => buildRoute(gpx, [], {id: '11120000', nameImage: () => new Uint8Array(42), speedKmh: 18, noF9: true, map: {styled: true, codec: 'd', blockFlags: flags}}).file;
  const flagsOf = file => readFile(file).blocks.map(b => { const e = b.at(-1); return e.style === 15 && !e.points.length && Math.round(e.center[0] / SC) === 0x7F434346 ? Math.round(e.center[1] / SC) : -1; });
  assert(gpxHasElevation(gpx));
  const all = cc27Flags({}, true);
  assert.equal(all, 7);
  const c = await cc27Sections(build(all), {fetchImpl, reach: 'line3k'});
  assert.deepEqual(readSections(c.file).map(s => s.type), [1, 2, 3]);
  assert.deepEqual(c.sections, [1, 2, 3]);
  assert(c.report.reach && c.report.elevationBytes > 0 && !c.report.waybackError, JSON.stringify(c.report));
  assert(flagsOf(c.file).length > 0 && flagsOf(c.file).every(f => f === 7), flagsOf(c.file).join());
  console.log('PASS patch27 with all switches gives a file with 3 sections and flags 7 in every block');
  const noOwn = cc27Flags({ownLines: false}, true);
  assert.equal(noOwn & 1, 0);
  assert(flagsOf(build(noOwn)).every(f => f === 6));
  assert.equal(cc27Flags({testText: false}, false), 1);          // no strip and no text: the unit stays off the file on the route
  assert.equal(cc27Flags({testText: false}, true), 5);
  const flat = await cc27Sections(build(7), {fetchImpl: async () => { throw Error('offline'); }, reach: 'line2k'});
  assert.deepEqual(flat.sections, [3]);                          // no way-back data: the elevation section stays
  assert.match(flat.report.waybackError, /offline/);
  console.log('PASS patch27 with "Eigene Linien" off gives flags without bit 0; a way-back failure keeps the elevation');
}
// Review finding 2: at the file guard the page drops the grey section first, then steps the reach down; the elevation
// section stays in every case. A 3 km street grid (31 x 31 crossings, 100 m) around a 1 km route along its bottom row.
{
  const {cc27Sections} = await import('../js/cc27_file.js');
  const {readSections, embedSections} = await import('../js/wayback_embed.js');
  const K = Math.cos(51 * Math.PI / 180), pt = (x, y) => [51 + y / 111320, 7 + x / (111320 * K)], N = 31, nodeId = (i, j) => 1000 + i * N + j + 1;
  const els = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const [lat, lon] = pt(i * 100 - 1000, j * 100); els.push({type: 'node', id: nodeId(i, j), lat, lon}); }
  for (let k = 0; k < N; k++) {
    els.push({type: 'way', id: 100 + k, nodes: Array.from({length: N}, (_, i) => nodeId(i, k)), tags: {highway: 'residential'}});
    els.push({type: 'way', id: 200 + k, nodes: Array.from({length: N}, (_, j) => nodeId(k, j)), tags: {highway: 'residential'}});
  }
  const fetchImpl = async () => ({ok: true, status: 200, json: async () => ({osm3s: {timestamp_osm_base: '2026-11-01T00:00:00Z'}, elements: els})});
  const gpx = {name: 'guard', pts: Array.from({length: 11}, (_, i) => [...pt(i * 100, 0), 50 + i])};
  const plain = buildRoute(gpx, [], {id: '11120000', nameImage: () => new Uint8Array(42), speedKmh: 18, noF9: true, map: {styled: true, codec: 'd', blockFlags: 7}}).file;
  const full = await cc27Sections(plain, {fetchImpl, reach: 'line3k'});
  assert.deepEqual(full.sections, [1, 2, 3]);
  const sec = t => { const s = readSections(full.file).find(x => x.type === t); return full.file.slice(s.offset, s.offset + s.size); };
  const noGreySize = embedSections(plain, [{type: 1, bytes: sec(1)}, {type: 3, bytes: sec(3)}]).length;
  const elevOnly = embedSections(plain, [{type: 3, bytes: sec(3)}]).length;
  assert(noGreySize < full.file.length && elevOnly < noGreySize, `${elevOnly} ${noGreySize} ${full.file.length}`);
  const noGrey = await cc27Sections(plain, {fetchImpl, reach: 'line3k', fileLimit: noGreySize});
  assert.deepEqual([noGrey.sections, noGrey.report.reach], [[1, 3], 'line3k']);
  assert.match(noGrey.report.greyReason, /Datei über/);
  const smaller = await cc27Sections(plain, {fetchImpl, reach: 'line3k', fileLimit: noGreySize - 1});
  assert(smaller.file.length <= noGreySize - 1 && smaller.sections.at(-1) === 3, JSON.stringify(smaller.sections));
  assert(smaller.sections[0] !== 1 || ['line2k', 'line1k'].includes(smaller.report.reach), smaller.report.reach);
  const onlyElev = await cc27Sections(plain, {fetchImpl, reach: 'line3k', fileLimit: elevOnly});
  assert.deepEqual(onlyElev.sections, [3]);
  assert.match(onlyElev.report.waybackError, /Datei über/);
  await assert.rejects(cc27Sections(plain, {fetchImpl, reach: 'line3k', fileLimit: elevOnly - 1}), /zu groß/);
  console.log('PASS at the file guard the grey goes first, then the reach steps down; the elevation stays');
}
