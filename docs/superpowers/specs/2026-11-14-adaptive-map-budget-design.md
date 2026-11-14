# Adaptive styled-map budgets

Approved direction: protect the existing enabled map layers and geometry, then
use separate resource budgets to partition and expand coverage. Reliability and
visual continuity precede generation speed. Legacy stock maps are unchanged.

## Approach

Entry caps cannot distinguish a tiny line from a polygon. A single weighted
score also allows spare RAM to conceal excessive drawing work. Use independent
allocation, serialized-byte, projection and fill-edge work constraints instead.
Keep a route-span guard for locality; it is not a substitute for resource checks.

Calculate decoded payload from the extracted target layout (28 bytes/entry,
8 bytes/stored pair), exact serialized record length, projection scratch and
iterator passes. Labels are packed text, not geometry. Report class-15 overlays
separately and include their allocation and conservative work allowance.
Projection counts and fill-edge counts are work proxies, never milliseconds.

Initial engineering envelope, based on the inspected 23 km ride rather than a
target timing certification: serialized 65,536 B, decoded 57,344 B, render payload
65,536 B, iterator scratch 4,096 B, projection callbacks 1,400, projected points
7,000, polygon vertices 2,304, packed label bytes 384. Any-block transition plus
canvas must remain at most 245,760 B. Keep explicit estimator/version provenance.
Do not infer these ceilings from total free heap or claim them hardware maxima.

All enabled baseline content is protected. Try smaller groups of whole navigation
sections before rejecting an overloaded single section with a useful error.
Include optional arrow/rough overlays before accepting a group, not afterwards.
Retain the existing 400 m behind/300 m ahead overlap and global source preparation.
Do not change route points, turn generation, street widths or simplification.

After partitioning, try nested coverage profiles: existing per-layer radii, then
600 m, 800 m and 1,000 m floors for line layers and areas (never reduce an existing
larger radius). Accept only profiles satisfying every budget and the route-wide
any-block transition bound. Wider outer context can vary by block; baseline
coverage cannot be traded away. Report selected profiles, exact costs, binding
constraints and zero omitted baseline entries. These are selection distances,
not a guarantee of complete OSM coverage or coverage of every possible detour.

Styled generation must not discard a long feature merely because its endpoints
are outside the route grid. Request optional outer OSM cells to support extended
coverage; unavailable outer cells must not break an otherwise cached base route.
Warn clearly when requested source cells are unavailable.

## Validation

Cross-check JS allocation/projection estimates with the existing independent
Python audit on encoded readback. Test cheap >1,200-entry blocks, equal entry
counts with different complexity, split/reject behaviour, overlays, asymmetric
transitions, stable output, retained baseline layers, actual expansion and
source coverage. Run the existing Node/Python/offline/browser suites. Publish
generator-only changes after verification; do not flash firmware or alter
device route files.
