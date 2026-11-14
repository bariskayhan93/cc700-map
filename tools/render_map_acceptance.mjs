import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {createCanvas}=require(path.resolve(process.argv[2] || '.local/render-check/node_modules/@napi-rs/canvas'));
const output=path.resolve(process.argv[3] || '.local/render-acceptance');
fs.mkdirSync(output,{recursive:true});
import {draw} from '../js/preview.js';
const at=(e,n)=>[51+n/111320,7+e/(111320*Math.cos(51*Math.PI/180))];
const entry=(kind,ps,flags=0,level=2)=>({style:kind|(level<<4)|flags,center:at(...ps[0]),points:ps.slice(1).map(p=>at(...p))});
const polygon=(k,x0,y0,x1,y1,flags=0)=>entry(k,[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]],flags);
const label=(name,x,y)=>({style:12,center:at(x,y),label:name});
const roads=[entry(5,[[-130,-100],[-130,450]]),entry(6,[[-250,60],[250,60]]),entry(6,[[-250,210],[250,210]]),entry(7,[[130,0],[130,230]],0x800)];
const land=[polygon(1,-400,-100,400,500),polygon(2,-220,120,260,400)];
const river=[polygon(3,-300,250,300,320),entry(4,[[-300,284],[300,284]])];
const paths=[entry(10,[[50,-30],[50,250],[180,360]]),entry(8,[[-45,80],[-45,220],[0,240]]),entry(8,[[170,80],[170,210]],0x200)];
const sec=[[0,0],[0,100],[90,170],[90,400]].map((p,i)=>[...at(...p),i*12000]);
const hole=entry(2,[[-260,0],[260,0],[260,440],[-260,440],[-260,0],[-60,150],[90,150],[90,300],[-60,300],[-60,150],[-260,0]],0x400);
const arrow={style:15|(2<<4)|(1<<16),center:at(0,100),points:[[0,78],[0,100],[20,115],[45,140]].map(p=>at(...p))};
const scenes=[
 ['Forest forks and rough evidence',[polygon(2,-400,-100,400,500),entry(8,[[0,-50],[0,120],[-90,200],[-120,400]]),entry(10,[[0,120],[90,200],[140,400]]),entry(8,[[0,120],[10,300]],0x200),label('FOREST',100,280)]],
 ['Rural parallel roads / hairpin',[entry(6,[[-10,-30],[-10,250],[30,270],[70,250],[70,-30]]),entry(10,[[15,-30],[15,450]]),entry(8,[[-200,100],[0,100],[220,200]]),label('RURAL WAY',110,240)]],
 ['Urban river / cycleway',[...land,...river,...roads,...paths,...[-130,0,130].map(x=>entry(13,[[x,60]])),label('SYNTHETIC',120,180)]],
 ['Park, hole and clipped area',[hole,polygon(3,-45,180,70,270,0x400),...paths,entry(6,[[-250,70],[250,70]],0x800),label('PARK',120,360)]],
 ['Bridge / tunnel / far roads',[...land,...river,entry(6,[[0,-80],[0,450]],0x80,3),entry(6,[[-230,210],[230,210]],0x900,1),entry(7,[[180,0],[180,450]],0x800),entry(10,[[-90,0],[-90,450]],0x80,3)]],
 ['Junction, arrow and labels',[...land,...roads,...paths,arrow,label('JUNCTION',30,100),label('EDGE LABEL',280,300),label('PARK WAY',100,280),label('SIDE ROAD',-100,200)]],
];
const counts=[];
for(const metresPerPixel of [1.25,2.5,5])for(const headingDegrees of [0,45,90]) {
const sheet=createCanvas(480,scenes.length*282),ctx=sheet.getContext('2d');
for(const [row,[title,entries]] of scenes.entries()){
 for(const [column,profile] of (process.argv[4] || 'v18,v19').split(',').entries()){
  const canvas=createCanvas(240,256),g=canvas.getContext('2d'),stroke=g.stroke.bind(g);let strokes=0;
  g.stroke=(...args)=>{strokes++;return stroke(...args)};
  draw(canvas,{secs:[sec],blocks:[entries],styled:true},40,true,{profile,metresPerPixel,headingDegrees});
  counts.push({scene:title,profile,metresPerPixel,headingDegrees,canvas_strokes:strokes});
  ctx.fillStyle='#fff';ctx.fillRect(column*240,row*282,240,282);
  ctx.fillStyle='#111';ctx.font='12px sans-serif';ctx.fillText(`${profile}: ${title}`,column*240+3,row*282+16);
  ctx.drawImage(canvas,column*240,row*282+26);
 }
}
fs.writeFileSync(path.join(output,`mpp-${metresPerPixel}-heading-${headingDegrees}.png`),sheet.toBuffer('image/png'));
}
fs.writeFileSync(path.join(output,'counts.json'),JSON.stringify({limits:'Synthetic map-canvas acceptance views. Browser raster/font/projection approximations; Canvas strokes are not target frame timing.',frames:counts.length,counts},null,2));
console.log(`Rendered ${counts.length} frames to ${output}`);
