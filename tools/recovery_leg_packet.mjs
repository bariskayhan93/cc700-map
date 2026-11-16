// Proposed PC study payload only. Not a firmware/native-route extension.
// 20-byte header + absolute signed E7 lat/lon (8 bytes per point).
// Association index, activation policy, transport framing and renderer are absent.
export function encodeStudyLeg(leg){
 const points=leg?.geometry,visit=leg?.target?.visit,cm=Math.round(leg?.distanceMeters*100);
 if(leg?.status!=='candidate'||!Array.isArray(points)||points.length<1||points.length>2048||
  !Number.isInteger(visit)||visit<0||visit>0xffffffff||!Number.isFinite(leg.distanceMeters)||leg.distanceMeters<0||!Number.isSafeInteger(cm)||cm>0xffffffff||
  points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>90||Math.abs(p[1])>180))throw Error('Invalid or over-limit study leg');
 const out=Buffer.alloc(20+8*points.length);out.write('CCRL',0,'ascii');out.writeUInt16LE(1,4);out.writeUInt16LE(points.length,6);
 out.writeUInt32LE(visit,8);out.writeUInt32LE(cm,12);out.writeUInt32LE(1,16); // unvalidated-candidate bit, always set
 points.forEach((p,i)=>{out.writeInt32LE(Math.round(p[0]*1e7),20+i*8);out.writeInt32LE(Math.round(p[1]*1e7),24+i*8);});
 return out;
}
