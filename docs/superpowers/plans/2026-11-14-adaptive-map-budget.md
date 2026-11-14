# Adaptive Map Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace styled-map count/approximate-size admission with independently bounded costs and spend spare capacity on wider context.

**Architecture:** A pure JS estimator consumes encoded entries and predicts the extracted target payload/work. The styled generator partitions protected content and then admits nested coverage expansions. App verification, source loading and offline caching use the same contract.

**Tech Stack:** Browser ES modules, Node tests, Python audit, existing Pages hosting.

**Spec:** `docs/superpowers/specs/2026-11-14-adaptive-map-budget-design.md`

## Global Constraints

- Preserve existing enabled baseline geometry, styling and native navigation records.
- Do not claim measured FPS or hardware capacity from work estimates.
- Generator-only release; no device writes.
- Initial budgets and overlap are specified in the design.

## Review Focus

- A single dense section must fail explicitly rather than silently lose essential content.
- Nonadjacent block changes must satisfy the same loading peak as adjacent ones.
- Overlays appended after partitioning must not bypass the budgets.
- Expanded source requests must preserve offline usability of existing base cells.
- Sparse long lines/polygon interiors must not be discarded by endpoint filtering.

### Task 1: Cost model

**Files:** Create `js/map_budget.js`, `tools/test_map_budget.mjs`.
**Interface:** `estimateBlock(entries)`, `budgetFailures(cost, limits)`, `transitionPeak(costs)`; encoded arrays in, named byte/work metrics out.

- [ ] Write and run failing tests for exact serialization, target layout, styled passes/labels/overlays and transition limits.
- [ ] Implement estimator and engineering limits, then run Node tests and Python audit cross-checks.

### Task 2: Adaptive generator

**Files:** Modify `js/mapsec.js`; create `tools/test_adaptive_map.mjs`.
**Interface:** Preserve `buildStyledSection`; return resource/coverage records through existing `stat`.

- [ ] Write and run failing tests for >1,200 cheap entries, retained baseline content, expansion, dense splitting, single-section errors, overlays and deterministic encoded readback.
- [ ] Include overlays during candidate evaluation; partition by actual costs, expand nested profiles, check global transition peaks and emit diagnostics.
- [ ] Run focused generator and existing map-contract tests.

### Task 3: Source/app integration and release

**Files:** Modify `js/osm.js`, `js/route.js`, `js/app.js`, `sw.js`; add source-coverage tests and public release report.

- [ ] Write and run failing source tests for sparse crossings and optional outer-cell fallback.
- [ ] Preserve complete styled source candidates; load optional expanded cells; replace styled app count rejection with budget validation and user-facing coverage information; precache new module.
- [ ] Run Node/Python/offline/browser suites and independent generated-file audit; compare navigation records before/after.
- [ ] Review the complete change, resolve material findings, commit, deploy Pages and verify published bytes.
