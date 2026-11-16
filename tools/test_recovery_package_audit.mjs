import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeRecoveryPackage} from './recovery_package.mjs';
import {auditPackage} from './recovery_package_audit.mjs';

const meta = {routeSha256: 'a'.repeat(64), sourceSha256: 'b'.repeat(64), policySha256: 'c'.repeat(64),
  entryMin: 1000000, entryMax: 1025000, center: [51, 7]};
const g = (lon) => ({a: [51.0001, lon], b: [51.0002, lon]});
// Two legs that share the street piece between x=0.0005 and x=0.001 (its guard g(7.0007) is listed in both).
const first = {geometry: [[51, 7], [51, 7.0005], [51, 7.001]], targetVisit: 1040000, targetBearing: 90, distanceMeters: 100,
  segmentGuards: [[g(7.0001), g(7.0002)], [g(7.0007)]]};
const second = {geometry: [[51, 7.0005], [51, 7.001], [51, 7.0015]], targetVisit: 1040000, targetBearing: 90, distanceMeters: 100,
  segmentGuards: [[g(7.0007)], [g(7.0009)]]};

test('audit reads the same guard and leg sizes that the encoder wrote', () => {
  const bytes = encodeRecoveryPackage([first, second], meta);
  const a = auditPackage(bytes);
  assert.equal(a.bytes, bytes.length);
  assert.equal(a.portals, 2);
  assert.equal(a.guardRecords, 5);          // 3 + 2 records, as written
  assert.equal(a.uniqueGuards, 4);          // g(7.0001), g(7.0002), g(7.0007), g(7.0009)
  assert.equal(a.guardBytes, 5 * 16);
  assert.equal(a.legBytes, bytes.length - (160 + 64 * 2 + 5 * 16));
  assert.equal(a.pieces, 4);
  assert.equal(a.uniquePieces, 3);          // the middle piece is shared
  assert(a.uniqueMetres < a.legMetres);
});

test('the shared-pool estimates are smaller than the stored size when guards repeat', () => {
  const a = auditPackage(encodeRecoveryPackage([first, second], meta));
  assert(a.estimateSharedPoolBytes2 < a.bytes);
  assert(a.estimateSharedPoolBytes2 <= a.estimateSharedPoolBytes4);
});

test('a corrupt header is refused', () => {
  const bytes = encodeRecoveryPackage([first], meta);
  bytes.write('XXXX', 0, 'ascii');
  assert.throws(() => auditPackage(bytes), /Package header/);
});
