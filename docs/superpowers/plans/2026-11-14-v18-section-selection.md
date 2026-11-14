# v18 section selection implementation plan

> Execute inline using executing-plans and test-driven-development. The owner
> authorized full implementation and asked to finish, without another design gate.

Goal: fix the two loader counterexamples, keep position-based map loading and
the off-route map pass, and build a preserved candidate with executable evidence.

Spec: [v17 review](../../v17-review-2026-11-14.md).

Architecture: walk the real linked list once; each segment uses the starting
point's global section ID. Resolve each distinct ID through stock `0x42050ccc`
into file type/local section, filter to the requested file, then apply the 25 m
preference to the minimum distance over the current local section's segments.
No allocation, writable globals, firmware matcher changes or new file format.

Isolation: candidate sources and build outputs under `.local/patch-v18/`.
The sibling patch directory has no Git repository; preserve v17 sources before
promoting the validated candidate there. Keep existing uncommitted app work.

## Task 1: selector and full loader

- [x] Add failing full-loader tests for stale adjacent section and parallel return.
- [x] Cover shared endpoints, exact crossing/current-section preference,
  invalid/empty data, absent map index, block-load ordering and file-slot isolation.
- [x] Add production host seam exposing complete loader and selector C bodies.
- [x] Replace indexed point scanning with sequential node traversal and stock
  global-to-file-local section resolution. Assert point road offset 40 and target
  node next-pointer offset 4. Keep the existing helper for historical probes only.
- [x] Bound scan by the supplied point count; use no allocation or mutable globals.
- [x] Run regression tests and verify visit/resolve counts on a dense fixture.

## Task 2: real-ride and route lifecycle evidence

- [x] Execute full candidate loader against the acquired ride with the actual
  section-start convention; disclose held progress and missing stage evidence.
- [x] Cover combined slots, connectors and reverse file type with independent
  resolver fixtures. Check empty/replaced lists and map index changes.
- [x] Preserve instruction evidence for list layout, segment ownership and the
  stock resolver/loader call chain; distinguish extracted from executed behavior.

## Task 3: candidate and release boundary

- [x] Rebuild cc18, verify image checksum/SHA, page budget and changed regions;
  preserve byte-exact v16/v17 rollback artifacts.
- [x] Run Python/preview and existing applicable host suites. Report the two
  known generator failures separately; their fixes need labelled junction cases.
- [x] Obtain a fresh code review and resolve material findings.
- [x] Promote validated source, update the entry report and artifact manifest.
- [x] Prepare exact ota_1 update/rollback and RTS boot workflow. A device write
  requires the owner's concrete firmware-write approval under the existing
  device workflow; do all local work before requesting it.

## Review focus

Wrong file IDs at reroute boundaries; endpoint off-by-one; malformed/null nodes;
nearest-section changes at crossings; target cost hidden by host array callbacks.
Target frame timing, physical heading and ride acceptance remain runtime evidence.

## Progress and rulings

Ruling: use a preserved source copy for isolation, because the patch is outside
Git and the app checkout contains substantial existing uncommitted work.
Ruling: do not change turn generation as part of firmware correction; preserve
its two reproduced failures and avoid inventing unlabelled prompt expectations.

Task 1: complete — 20 full loader/arrow C regressions pass after red/green fixes.
Task 2: complete — full ride replay and instruction evidence preserved; target equivalence limits disclosed.
Task 3: complete — owner approved programming; fresh v16 backup and OTA selection validated, v18 programmed and readback verified, RTS app boot confirmed. Installation receipt and rollback partition retained. Target navigation/performance acceptance is separately disclosed.
Ruling: scope expanded to arrow selection after finding the same index-domain error there; a zero-tick navigation take protects lifetime without blocking lock inversion.
Ruling: separate generator exploration was preserved unshipped because it did not fix the real regressions reliably.
