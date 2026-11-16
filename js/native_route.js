// Reads the route points of a device route file, with bounds checks. Pure code, shared by the page and the host tools.
import {parse,unzz,SC} from './pb.js';
import {hav} from './geo.js';


// The production helper is permissive on truncated varints; validate this
// study's section/point boundaries before using it on imported bytes.
function checkedFields(bytes) {
  let offset = 0;
  const varint = () => {
    let value = 0, multiplier = 1;
    for (let n = 0; n < 8; n++) {
      if (offset >= bytes.length) throw Error('Truncated varint');
      const byte = bytes[offset++]; value += (byte & 127) * multiplier;
      if (!Number.isSafeInteger(value)) throw Error('Oversized varint');
      if (!(byte & 128)) return value;
      multiplier *= 128;
    }
    throw Error('Oversized varint');
  };
  while (offset < bytes.length) {
    const key = varint(), type = key % 8;
    if (key < 8) throw Error('Invalid field number');
    if (type === 0) varint();
    else if (type === 2) { const length = varint(); offset += length; }
    else if (type === 5) offset += 4;
    else if (type === 1) offset += 8;
    else throw Error('Invalid wire type');
    if (offset > bytes.length) throw Error('Truncated field');
  }
  return parse(bytes);
}

export function readRouteElevations(bytes) {
  if (bytes.length < 128 || bytes.length > 16 * 1024 * 1024) throw Error('Route size outside study bounds');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sections = view.getUint16(0x46, true), points = [];
  if (!sections) throw Error('No route sections');
  let offset = 128;
  for (let section = 0; section < sections; section++) {
    if (offset + 4 > bytes.length) throw Error('Truncated section header');
    const length = view.getUint32(offset, true);
    if (!length || length > 65536 || offset + 4 + length > bytes.length) throw Error('Invalid section size');
    for (const [field, type, value] of checkedFields(bytes.subarray(offset + 4, offset + 4 + length))) {
      if (field !== 3) continue;
      if (type !== 2) throw Error('Invalid point wire type');
      const fields = Object.fromEntries(checkedFields(value).map(([key, type, value]) => [key, [type, value]]));
      if (fields[5]?.[0] !== 0 || (fields[3] && fields[3][0] !== 0)) throw Error('Invalid point fields');
      points.push({ distance: fields[5][1] / 100, elevation: fields[3] ? unzz(fields[3][1]) / 100 : null });
      if (points.length > 100000) throw Error('Too many study points');
    }
    offset += 4 + length;
  }
  return points;
}

export function readNativeRoute(bytes){
 readRouteElevations(bytes); // validates varints, section/point bounds and progress wire type
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint16(0x46,true),out=[];
 let offset=128;
 for(let n=0;n<count;n++){
  const length=view.getUint32(offset,true);
  for(const [field,type,p] of parse(bytes.subarray(offset+4,offset+4+length))){
   if(field!==3)continue;
   const rows=parse(p),get=k=>{const a=rows.filter(r=>r[0]===k);if(a.length!==1||a[0][1]!==0)throw Error('Invalid native route coordinate/progress');return a[0][2];};
   const point=[unzz(get(1))*SC,unzz(get(2))*SC],progress=get(5);
   if(!point.every(Number.isFinite)||Math.abs(point[0])>85||Math.abs(point[1])>180||!Number.isSafeInteger(progress)||progress<0||progress>0xffffffff)throw Error('Invalid native route point');
   const prior=out.at(-1);if(prior&&progress<prior.progress)throw Error('Route progress not ordered');
   if(prior?.progress===progress){if(hav(prior.point,point)>.01)throw Error('Conflicting duplicate route progress');}
   else out.push({point,progress});
  }
  offset+=4+length;
 }
 const map=view.getUint32(0x5c,true);if(map&&offset>map)throw Error('Route overlaps map');
 if(out.length<2)throw Error('Insufficient native route points');return out;
}
