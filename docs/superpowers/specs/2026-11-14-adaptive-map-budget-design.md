# Adaptive styled-map budgets

Approved direction: protect the enabled map layers and nearby geometry, then
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

All enabled geometry within 300 m is protected at the existing resolution.
Start with the existing per-layer radii and try smaller whole-section groups.
For an indivisible section that still exceeds the envelope, cap distant line context
at 800, 600, 450, 350, then 300 m. Reject explicitly if the protected minimum
cannot fit. Report every such reduction; never silently reduce resolution.

Implementation ruling from real-route integration: the original proposal to
protect every baseline radius rejected a previously generated ordinary section
(69,389 serialized bytes, 1,408 projection calls). These budgets are working
targets rather than demonstrated hardware maxima. Retaining a 300 m minimum
and adapting distant context meets the requested minimum-first policy without
raising ceilings or changing native section records.
Area windows retain their existing 600 m minimum even in dense sections:
tighter polygon clipping suppresses real outlines as well as artificial clip
edges. Keeping the area window preserves source boundary styling. A complex
area may therefore still cause explicit rejection; no area resolution is cut.
Include optional arrow/rough overlays before accepting a group, not afterwards.
Retain the existing 400 m behind/300 m ahead overlap and global source preparation.
Do not change route points, turn generation, street widths or simplification.

After partitioning, try nested coverage profiles: existing per-layer radii, then
600 m, 800 m and 1,000 m floors for line layers and areas (never reduce an existing
larger radius). Accept only profiles satisfying every budget and the route-wide
any-block transition bound. Wider outer context can vary by block; protected
coverage cannot be traded away. Expansions remain within a dense section's
selected context cap. Report profiles, caps, exact costs, binding constraints
and zero omitted protected entries. These are selection distances,
not a guarantee of complete OSM coverage or coverage of every possible detour.

Styled generation must not discard a long feature merely because its endpoints
are outside the route grid. Request optional outer OSM cells to support extended
coverage; unavailable outer cells must not break an otherwise cached base route.
Warn clearly when requested source cells are unavailable. Optional outer cells
are display data only: retain mandatory-cell navigation lines independently,
including their surface evidence. Wider maps must not change native names,
turns, captions or route roughness through extra matching candidates.

## Validation

Cross-check JS allocation/projection estimates with the existing independent
Python audit on encoded readback. Test cheap >1,200-entry blocks, equal entry
counts with different complexity, split/reject behaviour, overlays, asymmetric
transitions, stable output, retained baseline layers, actual expansion and
source coverage. Run the existing Node/Python/offline/browser suites. Publish
generator-only changes after verification; do not flash firmware or alter
device route files.
