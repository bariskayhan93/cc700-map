// Offline: node tools/build_ride_view.mjs output.html route.bin route.route.json route.match.json [second triple]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readSections} from '../js/wayback_embed.js';
import {DEFAULT_METRES_PER_PIXEL as metresPerPixel} from '../js/preview.js';
import {brg,hav} from '../js/geo.js';
import {runCore} from './wayback_core_host.mjs';

const [output,...files] = process.argv.slice(2);
if (!output || !files.length || files.length % 3) throw Error('Expected output.html and route input triples');
const root=fileURLToPath(new URL('../',import.meta.url));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ride-view-'));
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
const greyHost=path.join(tmp,'grey');
execFileSync('cc',['-O2','-std=gnu11','-DHOST',...['common','raster','view','wayback'].map(d=>'-Ifirmware/'+d),
  'tools/grey_host.c','firmware/wayback/wb_grey.c','firmware/wayback/wb_grey_draw.c','firmware/raster/raster.c','firmware/view/view.c','-lm','-o',greyHost],{cwd:root});

const json=file=>JSON.parse(fs.readFileSync(file));
const routes=[];
let frames;
for(let i=0;i<files.length;i+=3){
  const [file,recordFile,matchFile]=files.slice(i,i+3), route=fs.readFileSync(file);
  const records=json(recordFile),{rows,summary}=json(matchFile);
  if(createHash('sha256').update(route).digest('hex')!==records.sha256 || summary.name!==records.name)throw Error('Route inputs disagree');
  if(!rows.length)throw Error('Empty ride');
  if(!frames){
    let anchor=rows[0].point, heading=0;
    frames=rows.map((r,j)=>{
      if(!Number.isFinite(r.timestamp)||(j && r.timestamp<=rows[j-1].timestamp)||r.point?.length!==2||!r.point.every(Number.isFinite))throw Error('Invalid GPS fix '+j);
      // Accumulate short movements. Hold course at stops and reacquire after a recording gap.
      if(j && r.timestamp-rows[j-1].timestamp>5)anchor=r.point;
      const previous = j ? rows[j-1].point : r.point;
      if (j && r.timestamp-rows[j-1].timestamp <= 5 && hav(previous,r.point) >= 4) {
        heading = brg(previous,r.point);
        anchor = r.point;
      } else if (hav(anchor,r.point) >= 4) {
        heading = brg(anchor,r.point);
        anchor = r.point;
      }
      return [r.timestamp,r.point,Math.round(heading)%360,r.track_m];
    });
  }
  if(rows.length!==frames.length||rows.some((r,j)=>r.timestamp!==frames[j][0]||r.point.some((v,k)=>v!==frames[j][1][k])))throw Error('Different ride timelines');
  const trailer=readSections(route)??[], w=trailer.find(s=>s.type===1),g=trailer.find(s=>s.type===2);
  const wb=w && route.subarray(w.offset,w.offset+w.size);
  const detours=rows.flatMap((r,j)=>r.provider_reason==='off-route'?[j]:[]);
  const e7=v=>Math.trunc(Math.fround(Math.fround(v)*1e7));
  const ticks=detours.map(j=>({latE7:e7(rows[j].point[0]),lonE7:e7(rows[j].point[1]),flags:3,maxPoints:33}));
  const recovery={};
  const results=wb && ticks.length?runCore(wb,wb.subarray(8,24),ticks):[];
  let visible=0;
  results.forEach((r,k)=>{
    if(r.state!==1||r.points.length<2)return;
    const j=detours[k],tick=ticks[k];
    let mask='',pixels=0;
    if(g){
      const unit=(v,o,s)=>Math.floor((v-wb.readInt32LE(o))*wb.readUInt32LE(s)/65536);
      const x=unit(tick.lonE7,28,36),y=unit(tick.latE7,24,32);
      const raster=JSON.parse(execFileSync(greyHost,['draw',file,g.offset,g.size,x,y,frames[j][2],metresPerPixel,0,0,0].map(String)));
      if(!raster.open||!raster.view)throw Error('Grey host failed at fix '+j);
      // Three bytes per horizontal span, no browser antialiasing of firmware pixels.
      const spans=[];
      for(let y=0;y<256;y++){
        const line=raster.bits.slice(y*240,(y+1)*240);
        for(const run of line.matchAll(/1+/g))spans.push(y,run.index,run[0].length);
      }
      mask=Buffer.from(spans).toString('base64');pixels=raster.px;
      if(pixels)visible++;
    }
    recovery[j]=[r.points.slice(0,32).map(p=>p.map(v=>v/1e7)),(r.distanceDm===0xffffffff?'?':Math.floor(r.distanceDm/10))+'m'+(r.points.length>32?'+':''),mask,pixels];
  });
  const end=trailer.length?Math.min(...trailer.map(s=>s.offset)):route.length;
  routes.push({binary:route.subarray(0,end).toString('base64'),sections:records.records.map(r=>({...r,dist:r.end})),total:records.total,
    matches:rows.map(r=>[r.original_progress_m,r.provider_reason]),recovery,episodes:summary.episodes.map(e=>e.start.timestamp)});
  console.log(records.name,frames.length,'fixes,',detours.length,'off route,',Object.keys(recovery).length,'paths,',visible,'with visible grey pixels');
}
const read = name => fs.readFileSync(new URL(name, import.meta.url),'utf8');
const app=read('../index.html');
const screen=app.slice(app.indexOf('<div class="device-screen">'),app.indexOf('<div class="playback">'));
const imports={};
function bundle(name){
  if(imports[name])return;
  const code=read('../js/'+name).replace(/from '([.]\/([^']+))'/g,(_,spec,dep)=>{bundle(dep);return "from '"+dep+"'";});
  imports[name]='data:text/javascript;base64,'+Buffer.from(code).toString('base64');
}
bundle('preview.js');bundle('preview_guidance.js');
const data=JSON.stringify({routes,frames,metresPerPixel}).replaceAll('<','\\u003c');
const page=read('ride_view.html').replace('<!--STYLE-->',()=>app.match(/<style>[\s\S]*?<\/style>/)[0])
  .replace('<!--SCREEN-->',()=>screen).replace('/*IMPORTS*/',()=>JSON.stringify({imports})).replace('/*RIDE*/',()=>data);
fs.writeFileSync(output,page,{mode:0o600});
