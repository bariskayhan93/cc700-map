// Optional native-source integration test; no device connection or GPS injection.
import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {scanlineSpans} from '../js/device_draw.js';
import {placeLabels} from '../js/map_labels.js';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source=process.env.CC700_PATCH_SRC ? path.dirname(process.env.CC700_PATCH_SRC) : path.resolve(root,'../cc700-backup/patch/src');
const available=fs.existsSync(path.join(source,'map.c'));
let dir,exe;
function native(mode,input) {
 if(!exe) {
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'cc700-parity-'));exe=path.join(dir,'renderer');
  execFileSync('cc',['-std=c11','-O1','-g','-DHOST','-fsanitize=address,undefined','-fno-sanitize-recover=all','-fno-omit-frame-pointer','-I',source,path.join(root,'tools/renderer_host.c'),path.join(source,'map.c'),'-o',exe],{stdio:'pipe'});
 }
 return JSON.parse(execFileSync(exe,[mode],{input,encoding:'utf8'}));
}
after(()=>{if(dir)fs.rmSync(dir,{recursive:true,force:true});});
let seed=31;const rand=n=>{seed=seed*16807%2147483647;return seed%n;};
const skip=available?false:'Private firmware map.c is required; browser-only tests run separately';
test('v19 preview scanlines match actual C raster fill across clipping winding holes and negative slopes',{skip},()=>{
 const shapes=[[[0,0],[60,0],[60,60],[0,60],[0,0],[20,20],[20,40],[40,40],[40,20],[20,20],[0,0]],
 [[-8,-10],[90,80],[3,40]],[[1,1],[5,4],[8,1],[5,7]]];
 for(let k=0;k<50;k++) {
  const points=Array.from({length:3+rand(20)},(_,i)=>{const angle=i*2*Math.PI/23;return [Math.round(32+Math.cos(angle)*(20+rand(70))),Math.round(32+Math.sin(angle)*(20+rand(70)))];});
  shapes.push(points);
 }
 for(const polygon of shapes)for(const p of [polygon,[...polygon].reverse()]) {
  const width=64,height=64,mask=new Uint8Array(width*height);
  for(const [x,y,n] of scanlineSpans(p,width,height,true))mask.fill(1,y*width+x,y*width+x+n);
  const actual=native('fill_json',`${p.length} ${width} ${height}\n${p.map(p=>p.join(' ')).join('\n')}\n`);
  assert.equal(actual.mask,[...mask].join(''));
 }
});
test('v19 preview placement matches actual C UTF8 bounds halos HUD collisions and twelve label cap',{skip},()=>{
 for(let k=0;k<25;k++) {
  const labels=Array.from({length:100},(_,id)=>({id,label:(id%5?'Road':'Straße🛞').repeat(1+rand(3)),points:[[rand(300)-30,rand(300)-20]]}));
  const input=labels.map(l=>`${l.points[0].join(' ')} ${Buffer.from(l.label).toString('hex')}`).join('\n');
  const actual=native('labels_json',`${labels.length}\n${input}\n`),expected=placeLabels(labels);
  assert.deepEqual(actual.accepted,expected.map(l=>l.id));
  assert.deepEqual(actual.boxes,expected.map(l=>[l.box[0]-3,l.box[1]-3,l.box[2]+3,l.box[3]+3]));
 }
});
