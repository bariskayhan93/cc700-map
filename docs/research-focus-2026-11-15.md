# Return to navigation research

The owner's priority remains useful, consistent navigation: connected recovery
from roughly 3 km away, coverage appropriate to city/village/forest conditions,
and useful display features within this device's constraints. Repeated stationary
incident work has displaced that objective. This note records the change of
focus; it does not authorize a new production feature or larger map budgets.

## What the diagnosis bought, and what it did not

| Evidence | Useful conclusion | Conclusion it cannot support |
|---|---|---|
| An eligible cc23 worker had 2,944 B remaining; the cc24 diagnostic later sampled 3,072 B | Call depth and task identity matter; bounded lookups need measured stack admission | A universal 2,944 B limit, or proof that on-device recovery is impossible |
| Encoded and decoded layout plus projection/fill/text estimates exist | Compare candidate representations on separate cost axes | Measured frame time, global heap peaks, or hardware maxima |
| Original OSM source and several private policy experiments exist | Study sparse connected paths separately from display detail | Complete legal cycling recovery from every point within a 3 km circle |
| Route elevation and drawing hooks exist | An elevation spike can use existing data | Correct native climb screens, reliable missing-elevation handling, or free HUD space |
| Native line drawing crashed during the cc24 diagnostic | The release gate must remain closed | That a particular candidate allocation or renderer defect caused it |

The map budgets in the adaptive-budget report are conservative engineering
targets, not measured capacity limits. The feature ledger already withdraws
several optimistic hypotheses: field 4 is not a proven proximity-alert API;
download strings do not establish an independent basemap; label support does
not establish arbitrary POI glyphs. Carry those distinctions into research.

## Bound the fix track

Ordinary cc23 was restored after the failed cc24 target check. Keep cc24 as an
unreleased experiment. Preserve the map crash evidence and analyse it offline;
do not launch another flash/capture cycle without a specific causal hypothesis
and a test that distinguishes it. A demonstrated crash affecting the ordinary
baseline remains a release concern. Cosmetic stationary ambiguity and the broad
historical noisy/sparse cases do not automatically block independent research.

Avoid bundling budget admission, matcher behaviour and new features into a
single acceptance ride: that makes a failure difficult to attribute. Each change
needs a separately reviewable result and fallback.

## Next research deliverable

Treat connected recovery and distant coverage as one feasibility study. Use the
existing 23 km ride and its detours as the first case, then city, village and
forest cases. Do this on the PC before another firmware change.

1. Audit source completeness, cycling access, direction, barriers and relevant
   restrictions. Record uncertainty explicitly; display polylines are not a
   routing graph.
2. Compute reachable rejoin paths to the appropriate forward route visit. Keep
   crossings, reversed travel and nearby start/finish visits distinct. A route
   must reach the intended network connection; straight-line proximity is not
   success.
3. Compare three representations: display context only, bounded precomputed
   recovery legs, and a compact connected graph with bounded runtime lookup.
   Measure actual encoded bytes, decoded ownership and transition peaks; report
   projection work separately from timing that has not been measured.
4. Produce 1/2/3 km tables and failure examples: valid recovery availability,
   distance to reachable origins, uncovered or uncertain areas, storage, lookup
   work and visible geometry. State the spatial sampling used; sampled origins
   do not prove continuous area coverage.
5. Choose a representation only after this comparison. Then specify activation,
   distance semantics, stale/GPS-invalid handling and restoration on rejoin.
   If no validated path exists, retain the basemap and show recovery unavailable;
   never invent a road-following distance or keep stale turn guidance.

An elevation-strip spike follows as a separate small feature study, with its own
HUD/readability and absent-data checks. POI glyphs follow the existing capability
ledger. Neither should require increasing outer display coverage first.

Every capability must document its normal result, bounded resource admission,
fallback when source/resources/state are insufficient, and how it returns to
ordinary navigation. This is an engineering constraint for development, not
another open-ended prerequisite project.

References: [capability ledger](feature-capability-ledger.md),
[map evaluation](map-evaluation-report-2026-11-15.md),
[adaptive budgets](adaptive-map-budget-2026-11-14.md),
[cc24 rejected target check](loop-and-turn-fixes-2026-11-15.md#cc24-target-check-rejected-cc23-restored).

## First implementation delivered

The [PC recovery evaluator](recovery-study-2026-11-15.md) now implements original
node topology, conservative candidate direction/access filtering, bounded search,
explicit forward-visit windows, per-origin unavailable results, cumulative radius
samples and actual JSON representation comparisons. Synthetic city/village/forest
cases pass; no legal cycling or target-resource acceptance is inferred.

The saved real ride cache audit found four legacy display cells and zero original
source cells. Next collect a separate routing-source snapshot including barrier
nodes and restrictions; do not reconstruct junctions from display lines or change
stationary native matching to compensate. Persistent rules are in
[AGENTS.md](../AGENTS.md).
