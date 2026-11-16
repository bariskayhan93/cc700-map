// Puts one way-back file at the end of a route file. The device adapter reads it from there.
// Layout: route bytes (already padded to 4,096) | way-back bytes | zero fill | trailer (last 12 bytes).
// Trailer: "CCWT", u32 offset of the way-back bytes, u32 size of the way-back bytes. Little-endian.
const PAGE = 4096, TRAILER = 12, MAGIC = 0x54574343;   // "CCWT"

export function readTrailer(bytes) {
  if (bytes.length < TRAILER) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), at = bytes.length - TRAILER;
  if (v.getUint32(at, true) !== MAGIC) return null;
  const offset = v.getUint32(at + 4, true), size = v.getUint32(at + 8, true);
  if (offset + size > at) return null;
  return {offset, size};
}

export function embedWayback(route, wayback) {
  if (route.length % PAGE) throw new Error('the route file is not padded to 4,096 bytes');
  if (readTrailer(route)) throw new Error('the route file already has way-back data');
  if (String.fromCharCode(...wayback.subarray(0, 4)) !== 'CCWB') throw new Error('not a way-back file');
  const total = Math.ceil((route.length + wayback.length + TRAILER) / PAGE) * PAGE;
  const out = new Uint8Array(total);
  out.set(route); out.set(wayback, route.length);
  const v = new DataView(out.buffer), at = total - TRAILER;
  v.setUint32(at, MAGIC, true); v.setUint32(at + 4, route.length, true); v.setUint32(at + 8, wayback.length, true);
  return out;
}
