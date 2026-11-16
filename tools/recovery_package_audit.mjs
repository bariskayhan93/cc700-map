// Host audit of experimental CCRP packages: byte split and guard duplication. Read-only.
// The shared-guard figures are estimates of a format that does not exist yet.
// usage: node tools/recovery_package_audit.mjs DIRECTORY   (prints one JSON row per .rcp file)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hav} from '../js/geo.js';

const e7 = (v) => v / 1e7;
const pieceKey = (a, b) => {
  const A = a.map(v => Math.round(v * 1e6)).join(','), B = b.map(v => Math.round(v * 1e6)).join(',');
  return A < B ? `${A}|${B}` : `${B}|${A}`;
};

export function auditPackage(input) {
  const b = Buffer.from(input);
  if (b.length < 160 || b.toString('ascii', 0, 4) !== 'CCRP' || b.readUInt32LE(8) !== b.length) throw Error('Package header');
  const n = b.readUInt16LE(120), guardAt = b.readUInt32LE(128), legAt = b.readUInt32LE(132);
  if (n > 64 || guardAt !== 160 + 64 * n || legAt < guardAt || legAt > b.length) throw Error('Package offsets');
  const pieceMetres = new Map(), guardKeys = new Set();
  let points = 0, pieces = 0, legMetres = 0, guardRecords = 0;
  for (let i = 0; i < n; i++) {
    const at = 160 + 64 * i, count = b.readUInt16LE(at + 20), pointAt = b.readUInt32LE(at + 16), tableAt = b.readUInt32LE(at + 52);
    const line = [];
    for (let k = 0; k < count; k++) line.push([e7(b.readInt32LE(pointAt + 8 * k)), e7(b.readInt32LE(pointAt + 8 * k + 4))]);
    points += count;
    for (let k = 1; k < count; k++) {
      const len = hav(line[k - 1], line[k]);
      pieces++; legMetres += len; pieceMetres.set(pieceKey(line[k - 1], line[k]), len);
    }
    for (let k = 0; k < count - 1; k++) {
      const s = tableAt + 16 * k, first = b.readUInt32LE(s), cnt = b.readUInt16LE(s + 4);
      for (let j = 0; j < cnt; j++) {
        const g = first + 16 * j;
        guardRecords++;
        guardKeys.add(pieceKey([e7(b.readInt32LE(g)), e7(b.readInt32LE(g + 4))], [e7(b.readInt32LE(g + 8)), e7(b.readInt32LE(g + 12))]));
      }
    }
  }
  const guardBytes = legAt - guardAt;
  if (guardRecords * 16 !== guardBytes) throw Error('Guard table does not match guard area');
  const uniqueMetres = [...pieceMetres.values()].reduce((x, y) => x + y, 0);
  const size = b.length, unique = guardKeys.size;
  return {
    bytes: size, portals: n, headerBytes: 160 + 64 * n, guardBytes, legBytes: size - legAt,
    guardRecords, uniqueGuards: unique, pieces, uniquePieces: pieceMetres.size, points,
    legMetres: Math.round(legMetres), uniqueMetres: Math.round(uniqueMetres),
    guardShareOfBytes: +(guardBytes / size).toFixed(3),
    bytesPerUniqueMetre: +(size / Math.max(1, uniqueMetres)).toFixed(1),
    // Estimate only: one 16-byte pool entry per distinct guard, plus a 2-byte or 4-byte index per guard record.
    estimateSharedPoolBytes2: size - guardBytes + 16 * unique + 2 * guardRecords,
    estimateSharedPoolBytes4: size - guardBytes + 16 * unique + 4 * guardRecords,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir || process.argv.length !== 3) throw Error('Usage: node tools/recovery_package_audit.mjs DIRECTORY');
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.rcp')).sort()) {
    console.log(JSON.stringify({name, ...auditPackage(fs.readFileSync(path.join(dir, name)))}));
  }
}
