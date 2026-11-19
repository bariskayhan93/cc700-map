// Puts the cc27 sections at the end of a route file. The device adapter finds each one by its type (trailer v2).
// Layout: route bytes (padded to 4,096) | sections | zero fill | trailer (last 64 bytes); total padded to 4,096.
// Trailer, little-endian: u32 "CCWS", u32 count (1..4), 4 x {u32 type, u32 offset, u32 size} (unused: 0),
// u32 file length, u32 0. Each section is inside [0, file length - 64), no two overlap, a type occurs once.
// An unknown type is kept in the table and ignored by the unit.
const PAGE = 4096, TRAILER = 64, MAGIC = 0x53574343, MAX = 4;   // "CCWS"
export const SECTION = {WAYBACK: 1, GREY: 2, ELEV: 3};

export function readSections(bytes) {
  if (!bytes || bytes.length < TRAILER) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), at = bytes.length - TRAILER;
  if (v.getUint32(at, true) !== MAGIC) return null;
  const count = v.getUint32(at + 4, true);
  if (count < 1 || count > MAX || v.getUint32(at + 56, true) !== bytes.length) return null;
  const out = [];
  for (let i = 0; i < count; i++) {
    const type = v.getUint32(at + 8 + 12 * i, true), offset = v.getUint32(at + 12 + 12 * i, true), size = v.getUint32(at + 16 + 12 * i, true);
    if (!size || offset + size > at || out.some(s => s.type === type)) return null;
    if (out.some(s => offset < s.offset + s.size && s.offset < offset + size)) return null;
    out.push({type, offset, size});
  }
  return out;
}

// sections: [{type, bytes}], at most 4, each type once. The way-back section must start with "CCWB".
export function embedSections(route, sections) {
  if (route.length % PAGE) throw new Error('the route file is not padded to 4,096 bytes');
  if (readSections(route)) throw new Error('the route file already has sections');
  if (!sections.length || sections.length > MAX) throw new Error('1 to 4 sections');
  if (new Set(sections.map(s => s.type)).size !== sections.length) throw new Error('a section type occurs two times');
  for (const s of sections) {
    if (!s.bytes || !s.bytes.length) throw new Error('an empty section');
    if (s.type === SECTION.WAYBACK && String.fromCharCode(...s.bytes.subarray(0, 4)) !== 'CCWB') throw new Error('not a way-back file');
  }
  const used = route.length + sections.reduce((n, s) => n + s.bytes.length, 0);
  const total = Math.ceil((used + TRAILER) / PAGE) * PAGE;
  const out = new Uint8Array(total), v = new DataView(out.buffer), at = total - TRAILER;
  out.set(route);
  let off = route.length;
  v.setUint32(at, MAGIC, true); v.setUint32(at + 4, sections.length, true); v.setUint32(at + 56, total, true);
  sections.forEach((s, i) => {
    out.set(s.bytes, off);
    v.setUint32(at + 8 + 12 * i, s.type, true); v.setUint32(at + 12 + 12 * i, off, true); v.setUint32(at + 16 + 12 * i, s.bytes.length, true);
    off += s.bytes.length;
  });
  return out;
}

// The route bytes in front of the first section (the plain route file), or the file when it has no table.
export function routePart(file) {
  const s = readSections(file);
  return s ? file.subarray(0, Math.min(...s.map(x => x.offset))) : file;
}
