# Regional source and real detour study

Goal: unblock the existing connected-recovery study using a checksum-verified
regional PBF, then measure candidate availability on the real detours. Standing
owner authorization covers inline implementation; remain on the dedicated branch.

Design: offline selection of primary highway ways with an original node in the
saved bbox, restrictions referencing those ways, member ways and all referenced
nodes. Use independent scans, not assumptions about file object ordering. Retain
raw tags/identities. Convert to the existing capture envelope for integrity
checking, but explicitly retain regional-PBF origin and file hash: do not pretend
the saved Overpass query ran. Missing members fail closed through existing code.
No production app, firmware, cache, route or budget changes.

Normal: reproducible snapshot with reference closure and provenance. Admission:
512 MiB source, <=600 km² bbox, bounded retained objects/output. Failure: private
receipt; no candidate acceptance. Restoration: no device state touched.

- [x] Test offline selection with tiny OSM fixtures: outside primary member,
  tagged barrier, via-node/via-way restriction, dangling reference, object order,
  provenance, refusal to overwrite and source/selection bounds.
- [x] Implement offline extractor with pyosmium in an isolated local venv.
  Validate the real source with the existing snapshot pipeline; publish aggregate
  counts/hashes only, never ride coordinates.
- [x] Associate sampled real-detour origins and forward route visits using
  explicit conservative PC study rules. Report ambiguous/unassociated samples,
  not invented snapped roads. Keep crossings and shared start/finish distinct.
- [x] Run bounded candidate searches and record sampled availability, failure
  reasons and costs. No legal-cycling, continuous 3 km or device acceptance claim.
- [x] Run focused checks, review, record findings and commit independently.

Representation selection remains conditional on these results. JSON byte counts
are not target decoded RAM or codec measurements. Snapshot source time is later
than the ride and cannot prove historical mapping state. Conservative restriction
quarantine can disconnect roads that are actually rideable; report that cost.

## Execution record

Source downloaded and checksum verified. Reference integrity passes, 169,901
nodes / 45,483 ways / 799 restrictions, with no missing members. Retrospective
sampled evaluation finds 30 scenarios (25 span recording gaps), one candidate.
Geometric associations and future observed destinations remain unvalidated; a
strict no-gap episode audit is reported separately. No production/device writes.

Review fixes: differing duplicate identities fail explicitly rather than erase
evidence; extraction bbox is bound to the receipt. Both findings reproduced
RED→GREEN; final real selection regenerated with reviewed code. The initial
in-box identity-set guard was insufficient for dense urban building data and
was increased only for this PC pipeline, not device storage or display admission.

Ruling: use retrospective observed destinations as labelled structural scenarios,
not a live target selector. Cost if misread: overstated navigation capability;
reports retain geometric/continuity/online-selection gaps and zero validated paths.

Focused checks: 36 Node + five Python pass. Deferred minors: cross-language area
constant at the admission boundary, exhaustive resource-limit fixtures, integrated
replay fixture. Existing-output preservation is tested. No acceptance beyond
source integrity and bounded PC candidate execution is inferred.

Final re-extraction reproduces response SHA-256 exactly with bound bbox. Reviewed
normalization passes integrity; final replay reproduces graph and result counts.
Uncovered exhaustive limit fixtures remain explicitly deferred, not inferred.
