// Normalize an offline selection without claiming an Overpass query executed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { captureRoutingSnapshot, routingQuery } from './routing_snapshot.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function capturePbfSelection(raw, region, receipt) {
  const query = routingQuery(region.bbox);
  if (raw.length > 64 * 1024 * 1024 || receipt?.status !== 'selected' || receipt.origin !== 'regional-osm-file' ||
      !Array.isArray(receipt.bbox) || JSON.stringify(receipt.bbox) !== JSON.stringify(region.bbox) ||
      !/^[a-f0-9]{64}$/.test(receipt.sourceSha256) || !Number.isSafeInteger(receipt.sourceBytes) || receipt.sourceBytes <= 0 ||
      receipt.responseBytes !== raw.length || receipt.responseSha256 !== hash(raw)) throw Error('Selection receipt mismatch');
  const response = JSON.parse(raw);
  if (response.osm3s?.timestamp_osm_base !== receipt.sourceTimestamp) throw Error('Selection timestamp mismatch');
  const snapshot = captureRoutingSnapshot(response, { bbox: region.bbox, querySha256: hash(query) });
  snapshot.provenance.acquisition = { ...receipt, mode: 'offline-regional-PBF-selection', queryExecuted: false,
    queryIdentityMeaning: 'reference selector only; no Overpass request executed' };
  return snapshot;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  if (a.length !== 4 || a[0] !== '--selection' || a[2] !== '--output') throw Error('Usage: --selection DIRECTORY --output NEW_DIRECTORY');
  const raw = fs.readFileSync(path.join(a[1], 'response.json'));
  const region = JSON.parse(fs.readFileSync(path.join(a[1], 'region.json'))), receipt = JSON.parse(fs.readFileSync(path.join(a[1], 'receipt.json')));
  const snapshot = capturePbfSelection(raw, region, receipt);
  fs.mkdirSync(a[3]); fs.writeFileSync(path.join(a[3], 'snapshot.json'), JSON.stringify(snapshot) + '\n');
  console.log(JSON.stringify({ integrity: snapshot.integrity, issues: snapshot.issues, nodes: snapshot.nodes.length, ways: snapshot.ways.length, restrictions: snapshot.restrictions.length }));
  if (snapshot.integrity !== 'pass') process.exitCode = 2;
}
