# Connected recovery study

Implement the next PC-side deliverable from the approved research focus, without
changing firmware, route matching, Pages or imported route files. This is a
structural candidate evaluator, not a legal cycling planner or navigation feature.

## Approach

Compare display-only context (no recovery), explicit precomputed node/way legs,
and the same unsimplified directed graph. Prefer generation-time analysis first;
on-device search would add unmeasured stack/heap/latency, and display expansion
alone supplies no usable recovery. Keep target visits explicit, supplied by the
caller: no new stationary start/finish inference or speculative map matching.

Build topology only from preserved original OSM ways. Quarantine conflicting
coordinates; never join geometric crossings. Apply a deliberately conservative
candidate tag filter: exclude denied/unknown access, conditional/directional
access not implemented, and unsupported highway classes; respect basic bicycle
oneway overrides and roundabout direction. This filter is an engineering policy,
not a country-specific access interpretation. Barrier node tags and restriction
relations are absent in navigation-source v1, so every result remains unvalidated.

A bounded shortest-path search uses explicit graph-node origins and future target
visits within an explicit visit window. Failure reports carry no geometry or
remaining-distance value. A work cap is an unavailable result, never a partially
optimal path. Sources and graph objects must remain unmodified.

The report includes individually sampled origins in cumulative 1/2/3 km bands
(distance to supplied route target coordinates), excluded ways, source gaps,
search work, and actual UTF-8 serialized sizes of the graph and successful legs.
These are exact JSON representation sizes, not a proposed device ABI, decoded
memory estimate, raster timing, continuous spatial coverage, or measured capacity.

## Admission / fallback / restoration

Offline only. No network, serial, route writes or production imports. Invalid
inputs fail explicitly. Incomplete evidence stays visible even if a structural
path is found. Excluded/unreachable/budget-exhausted origins produce unavailable
results. No device state is changed, so no restoration is required.

Existing real ride caches must be audited before claiming real recovery results;
legacy display caches cannot supply missing original junction/access evidence.
