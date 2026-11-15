# CC700 implementation rules

The owner's priority is useful, reliable cycling navigation and feature progress.
Use `docs/research-focus-2026-11-15.md` and
`docs/map-reliability-contract.md` as implementation constraints.

- Keep firmware safety/release fixes separate from independent PC research and
  feature work. A rejected experimental image does not block offline work.
- Do not extend stationary start/finish matching merely to improve its display.
  Require evidence of a riding failure before changing matching again. Never
  infer arrival from proximity to the shared start/finish alone.
- Before another device experiment, name the causal hypothesis, distinguishing
  observation, bounded duration, and exact restoration. Normal boot is not map
  acceptance. Preserve crash evidence; do not claim a cause from a backtrace alone.
- Source topology, route semantics, encoded storage, decoded/transition memory,
  stack, projection/raster time, and UI space are separate constraints. Estimates
  are not hardware maxima. A successful host test is not whole-device simulation.
- Every new capability must define normal behaviour, admission, unavailable-state
  fallback, and restoration. Optional context must preserve native route records,
  nearby detail, and ordinary guidance. Never invent a recovery distance or turn.
- Study connected recovery and 1/2/3 km reach together. Shared OSM node identity
  establishes topology; display intersections and geohashes do not. Access,
  restrictions, barriers, source completeness, and ordered route visits require
  explicit evidence. Missing evidence must survive in reports as a gap.
- Prefer generation-time computation and bounded device lookup where measured
  costs support it. Do not reserve arbitrary feature percentages or increase
  production budgets from offline capacity experiments.
- Keep each deliverable independently reviewable and tested. Finish the bounded
  deliverable, record remaining gaps, and move forward; do not silently expand a
  cosmetic issue into another firmware project.
