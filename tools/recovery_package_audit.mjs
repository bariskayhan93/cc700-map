// Host audit of experimental CCRP v2 packages: byte split and guard reuse. Read-only.
// usage: node tools/recovery_package_audit.mjs DIRECTORY   (prints one JSON row per .rcp file)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hav} from '../js/geo.js';

const e7 = (v) => v / 1e7;

export function auditPackage(input) {
  const b = Buffer.from(input);
  if (b.length < 160 || b.toString('ascii', 0, 4) !== 'CCRP' || b.readUInt16LE(4) !== 2 || b.readUInt32LE(8) !== b.length) throw Error('Package header');
  const n = b.readUInt16LE(120), guardAt = b.readUInt32LE(128), legAt = b.readUInt32LE(132), table = b.readUInt32LE(152);
  if (n > 64 || guardAt !== 160 + 64 * n || legAt > b.length || guardAt + 16 * table > legAt) throw Error('Package offsets');
  let points = 0, pieces = 0, legMetres = 0, refs = 0;
  const pieceMetres = new Map();
  const pieceKey = (a, c) => {
    const A = a.map(v => Math.round(v * 1e6)).join(','), C = c.map(v => Math.round(v * 1e6)).join(',');
    return A < C ? `${A}|${C}` : `${C}|${A}`;
  };
  for (let i = 0; i < n; i++) {
    const at = 160 + 64 * i, count = b.readUInt16LE(at + 20), pointAt = b.readUInt32LE(at + 16), tableAt = b.readUInt32LE(at + 52);
    const line = [];
    for (let k = 0; k < count; k++) line.push([e7(b.readInt32LE(pointAt + 8 * k)), e7(b.readInt32LE(pointAt + 8 * k + 4))]);
    points += count;
    for (let k = 1; k < count; k++) {
      const len = hav(line[k - 1], line[k]);
      pieces++; legMetres += len; pieceMetres.set(pieceKey(line[k - 1], line[k]), len);
    }
    for (let k = 0; k < count - 1; k++) refs += b.readUInt16LE(tableAt + 16 * k + 4);
  }
  const guardBytes = legAt - guardAt;
  if (16 * table + 2 * refs !== guardBytes) throw Error('Guard table does not match the guard area');
  const uniqueMetres = [...pieceMetres.values()].reduce((x, y) => x + y, 0);
  const size = b.length;
  return {
    bytes: size, portals: n, headerBytes: 160 + 64 * n, guardBytes, guardTableBytes: 16 * table, guardRefBytes: 2 * refs,
    guardRefs: refs, distinctGuards: table, legBytes: size - legAt, pieces, uniquePieces: pieceMetres.size, points,
    legMetres: Math.round(legMetres), uniqueMetres: Math.round(uniqueMetres),
    guardShareOfBytes: +(guardBytes / size).toFixed(3),
    bytesPerUniqueMetre: +(size / Math.max(1, uniqueMetres)).toFixed(1),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir || process.argv.length !== 3) throw Error('Usage: node tools/recovery_package_audit.mjs DIRECTORY');
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.rcp')).sort()) {
    console.log(JSON.stringify({name, ...auditPackage(fs.readFileSync(path.join(dir, name)))}));
  }
}
