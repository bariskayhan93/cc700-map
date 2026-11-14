// Stable grouping changes storage order, never the renderer's semantic pass order.
// Signals/stops share one bucket; labels and class-15 overlays retain their order.
import {parse} from './pb.js';
function styleOf(entry) {
  if(entry[0]!==16)return parse(new Uint8Array(entry)).find(([field])=>field===2)?.[2] ?? 0;
  let value=0,m=1;for(let i=1;i<entry.length;i++) {const b=entry[i];value+=(b&127)*m;if(!(b&128))return value;m*=128;}
  throw Error('Unterminated map style');
}
function bucket(style) {
  if(!style)return 0;
  const cls=style&15;
  if(cls>=1 && cls<=4)return cls;
  if(cls>=5 && cls<=11)return 5+(cls-5)*8+((style>>>4)&7);
  if(cls===12)return 61;
  if(cls===13 || cls===14)return 62;
  if(cls===15)return 63;
  return 64;
}
export function canonicalEntries(entries) {
  return entries.map((entry,index)=>({entry,index,key:bucket(styleOf(entry))}))
    .sort((a,b)=>a.key-b.key || a.index-b.index).map(x=>x.entry);
}
