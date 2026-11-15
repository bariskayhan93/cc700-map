# Grey-route diagnostic implementation plan

**Goal:** Distinguish native matching, paused display retention and actual arrival
on the shared-start/finish route without changing navigation decisions.

**Design:** Extend the existing temporary iterator collector with an opt-in
`navigation` mode. Read fixed scalar globals only, bracket the reads with raw
timestamps and repeat selected values to expose some concurrent updates. Export
a separate checksummed `CC7N1` record after the iterator interval. No widget
pointer dereference, allocation, writable capture globals or production changes.
An ordinary image and performance-only captures remain unchanged in behavior.

This implements the owner's existing authorization to complete diagnosis and
stationary measurement. Build and test locally; installation and reproduction
are a separate step because opening serial/reset destroys the current state.

**Alternatives:** Recolouring grey or forcing section zero conceals the fault and
breaks legitimate arrival. More iterator timings cannot identify native progress.
Fixed scalar diagnostics supply the missing evidence with the existing rollback
workflow. Samples are non-atomic observations, never a coherent RAM snapshot.

**Files:** collector/header, measurement parser/builder/ABI evidence, host test and
Python tests, collector README and grey-route findings.

- [x] Add failing host/parser tests for actual emitted values, checksum/truncation,
  gating and concurrent-state indicators.
- [x] Implement opt-in state export and parser; expose build mode with native ABI
  comparison against the pinned stock image.
- [x] Run focused/full Python checks, build actual Xtensa candidate, inspect stack
  use/sections and confirm ordinary v21 has not changed.
- [x] Update findings with pause retention, closed-loop arrival guard, actual
  installation/restoration status and exact remaining evidence. Do not claim the
  grey-route bug fixed from static analysis or a successful diagnostic build.
