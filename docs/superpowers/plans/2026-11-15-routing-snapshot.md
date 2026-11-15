# Routing source snapshot implementation

Goal: capture a separate original-source snapshot for the real recovery study,
including way node identities, tagged nodes and restriction relations. Never
write production caches, route files, firmware or Pages.

Design: query highway ways in a bounded region, all their nodes and restrictions
referencing those ways, plus restriction member ways/nodes. Preserve the response
and request identity. Normalize and quarantine conflicting/malformed records;
missing referenced nodes/members are explicit issues, not invented connectivity.
An Overpass success means retrieval/integrity only, not complete OSM or legal
cycling coverage. Raw tags remain intact; node and via-way restrictions are not
silently reduced to geometry.

For the existing structural evaluator, conservatively exclude barrier nodes and
all member ways of non-exempt restrictions rather than implementing an incomplete
turn planner. Keep paths unvalidated, report exclusions, and preserve the original
snapshot. This deliberate loss of candidate connectivity is visible in reports.
The snapshot must not clear regional access, origin association or target gaps.

Query reference: https://dev.overpass-api.de/overpass-doc/en/criteria/chaining.html
and https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL .

Normal: reproducible local snapshot, explicit integrity status and structural
study input. Admission: bounded geographic area, request time, response bytes and
one request per run. Failure: retain request/error receipt, never overwrite an
existing output directory or claim a complete snapshot. Restoration: no device
state is changed. Network acquisition uses an explicit CLI flag.

- [x] Write tests for lossless node/member capture, duplicates/conflicts, dangling
  references, query closure, truncation/errors, and conservative graph filtering.
- [x] Implement PC-only snapshot module/CLI; integrate optional snapshot input
  with the structural study without changing v1 behavior.
- [ ] Capture the real ride region with 3 km padding to a new private directory;
  report source integrity, barriers/restrictions and remaining evidence gaps.
- [x] Run tests, review, record sanitized results and commit.

The owner's standing implementation authorization covers inline execution.

## Execution record

Local capture/filtering and CLI tests pass. Acquisition was attempted against
three configured public endpoints; HTTP 406/403/429 returned no usable snapshot.
The acquisition acceptance item remains open; private query/region/error receipts
and a sanitized report preserve the resumption point. No device was touched.

Review ruling: preserve all restriction member ways, but admit only highway ways
with an original node in the primary query box. Backreferences were requested
only for that primary road selection; admitting outside members could miss their
other restrictions. This conservative guard costs candidate coverage outside the
query and is exposed as reference-only exclusions. Regression observed RED→GREEN.

Verification: scoped 29/29; final main Node 214/214; Python 171/171; offline app
and ride coverage proxy pass. Historical noisy/sparse failures unchanged; overall
validation incomplete, target/recovery acceptance unvalidated. The earlier full
validation ran 213 Node tests; the final main command includes the new closure
regression after the review fix. No additional target acceptance was inferred.
