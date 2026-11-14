// All coordinates are synthetic; no imported ride or source cache is published.
const LAT=51.2,LON=6.8,K=111320*Math.cos(LAT*Math.PI/180);
export const toGeo=([x,y])=>[LAT+y/111320,LON+x/K];
export const toLocal=([lat,lon])=>[(lon-LON)*K,(lat-LAT)*111320];
const road=(id,kind,xy,fl=0)=>({name:id,kind,fl,pts:xy.map(toGeo)});
const ring=xy=>xy.map(toGeo);
const route=xy=>({name:'Synthetic benchmark',pts:xy.map(q=>[...toGeo(q),0])});
const probe=(id,cls,xy,atMeters=500,extra={})=>({id,cls,xy,atMeters,required:true,toleranceMeters:2,...extra});
const straight=()=>route([[0,0],[0,1800]]);
const base=(id,lines,probes,data={},gpx=straight())=>({id,gpx,lines,navigationLines:lines,probes,data});
export function benchmarkCases(){
 const village=[road('Village road',3,[[0,-100],[0,2000]]),road('Connection',2,[[-300,600],[300,600]]),road('Outer trunk',1,[[850,-100],[850,2000]])];
 const forest=[road('Trail',5,[[0,-100],[0,2000]],64),road('Cycle link',5,[[-250,600],[250,600]],32),road('Fork',5,[[0,600],[180,850]],64)];
 const bridge=[road('Approach',3,[[0,-100],[0,2000]]),road('Cycle bridge',5,[[-250,600],[250,600]],33),road('Tunnel',4,[[120,0],[120,1500]],2)];
 const urban=[];for(let x=-600;x<=600;x+=60)for(let y=-100;y<2000;y+=100)urban.push(road(`North ${x}/${y}`,3,[[x,y],[x,y+100]]));
 for(let y=-100;y<=2000;y+=60)for(let x=-600;x<600;x+=120)urban.push(road(`East ${x}/${y}`,3,[[x,y],[x+120,y]]));
 const mixed=[];for(let x=-250;x<=250;x+=50)mixed.push(road('Urban '+x,3,[[x,-100],[x,1100]]));
 for(let y=0;y<=1000;y+=50)mixed.push(road('Cross '+y,3,[[-400,y],[400,y]]));
 mixed.push(road('Village connector',1,[[700,1000],[700,4000]]),road('Forest link',5,[[0,1000],[0,4000]],32));
 const optional=road('Optional outer long road',1,[[0,-100],[0,2000]]);
 const overload=Array.from({length:2400},(_,i)=>toGeo([150*Math.cos(i*Math.PI/1200),600+150*Math.sin(i*Math.PI/1200)]));
 const built=[];for(let x=-240;x<240;x+=120)for(let y=50;y<1200;y+=240)
  built.push([ring([[x,y],[x+80,y],[x+80,y+180],[x,y+180]])]);
 return [
  base('urban',urban,[probe('near-street',6,[60,600],600),probe('junction-left',6,[-100,620],620)],{areas:built}),
  base('village',village,[probe('village-connection',6,[200,600],600),probe('outer-orientation',5,[850,600],600,{required:false})]),
  base('forest',forest,[probe('cycle-fork',10,[200,600],600),probe('rough-trail',8,[0,800],800,{styleMask:0x200,styleValue:0x200})],{green:[[ring([[-500,-100],[500,-100],[500,2000],[-500,2000]])]]}),
  base('water-crossing',bridge,[probe('cycle-bridge-layer',10,[100,600],600,{styleMask:0xff,styleValue:10|48|0x80}),probe('tunnel-layer',7,[120,600],600,{styleMask:0x17f,styleValue:7|16|0x100}),probe('shore-edge',3,[90,600],600,{styleMask:0x400,styleValue:0})],
   {water:[[ring([[90,400],[200,400],[200,800],[90,800]])]],wlines:[ring([[-300,600],[300,600]])]}),
  base('parallel-hairpin',[road('Parallel A',3,[[40,-100],[40,2000]]),road('Parallel B',3,[[48,-100],[48,2000]]),road('Hairpin',5,[[120,400],[220,400],[220,410],[120,410]])],
   [probe('parallel-a',6,[40,600],600,{toleranceMeters:1}),probe('parallel-b',6,[48,600],600,{toleranceMeters:1}),probe('hairpin-exit',8,[150,410],410)]),
  base('overlap',[road('Shared road',3,[[30,-100],[30,2000]])],[probe('outbound',6,[30,600],600),probe('return',6,[30,600],3000)],{},route([[0,0],[0,1800],[0,0]])),
  {...base('detour-context',[optional,road('Far cycle connection',5,[[850,0],[850,1800]],32)],
   [probe('outer-cycle',10,[850,600],600,{required:false})]),navigationLines:[]},
  {...base('mixed-transition',mixed,[probe('dense-near-road',6,[50,600],600),probe('rural-cycle',10,[0,2000],2000),probe('forest-cycle',10,[0,3500],3500)],{},route([[0,0],[0,4000]])),
   boundarySources:[{id:'cycle-seam',cls:10,xy:[[0,1000],[0,4000]],toleranceMeters:2}]},
  base('competing-layers',[road('Near connection',3,[[-100,600],[100,600]]),road('Outer cycle',5,[[950,0],[950,1800]],32)],
   [probe('near-connection',6,[80,600],600),probe('outer-cycle-950',10,[950,600],600,{required:false})],
   {green:[[Array.from({length:2600},(_,i)=>toGeo([1200+400*Math.cos(i*Math.PI/1300),600+400*Math.sin(i*Math.PI/1300)]))]]}),
  base('sparse',[road('Sparse source road',3,[[0,-100],[0,2000]])],[probe('sparse-middle',6,[0,900],900)],{},route([[0,0],[0,1800]])),
  base('noisy',[road('Noise reference',3,[[0,-100],[0,2000]])],[probe('near-road',6,[0,600],600)],{},route(Array.from({length:91},(_,i)=>[3*Math.sin(i*1.7),i*20]))),
  {...base('protected-overload',[],[],{green:[[overload]]}),expectedRejection:'fillVertices'},
 ];
}

export function extendedCases(){
 return benchmarkCases().map(c=>{
  if(c.expectedRejection)return c;
  const extra=[],probes=[...c.probes];
  for(const radius of [1000,2000,3000]){
   const x=radius-100,cls=c.id==='forest'?10:5,fl=cls===10?32:0,kind=cls===10?5:1;
   extra.push(road(`Distant ${radius}`,kind,[[x,0],[x,1800]],fl));
   probes.push(probe(`essential-context-${radius}`,cls,[x,600],600,{required:false}));
  }
  return {...c,lines:[...c.lines,...extra],probes};
 });
}
