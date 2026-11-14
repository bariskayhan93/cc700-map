# Map Reliability Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Establish and execute an evidence-based evaluation loop for adaptive map context, including 1/2/3 km essential coverage.

**Architecture:** Independent synthetic oracles inspect production-encoded map files. A reproducible baseline, offline candidate comparison and evidence ledger drive the release decision; production ceilings and nearby detail remain protected.

**Tech Stack:** Existing browser JS modules, Node tools/tests, Python/host C, existing serial tooling and private firmware evidence.

**Spec:** `docs/superpowers/specs/2026-11-14-map-reliability-evaluation-design.md`

## Global Constraints

- Protected line context 300 m; area window at least 600 m; unchanged geometry resolution/styles.
- Native navigation uses mandatory cells; optional map context cannot change its records.
- All existing byte/work targets and 4 MB file guard apply separately; no unmeasured ceiling increase.
- Expected rejection and missing/unknown evidence must not become successful rendering claims.
- Compare representation capacity at 1/2/3 km; usable retour requires verified paths, lookup, off-route cues and rejoin lifecycle.
- Retain the installed v21 and existing routes after tests; no unrelated features.

## Review Focus

- Aggregate counts can conceal a missing or mislayered essential road: use independent spatial/style probes and negative controls.
- Good averages can conceal one severe case: compare cases individually.
- Optional display changes can affect native captions: compare actual serialized records.
- Passing allocation checks can conceal expensive rasterization: keep target timing unknown until observed.
- Larger radius can conceal sparse/missing data: report optional probes and source completeness separately.

### Task 1: Reliability contract and benchmark baseline

**Files:** Create `tools/map_benchmark_cases.mjs`, `tools/map_benchmark.mjs`, `tools/test_map_benchmark.mjs`; document `docs/map-reliability-contract.md` and baseline JSON under `docs/mining/`.

**Interfaces:** `benchmarkCases()` returns synthetic fixtures with required/optional style-location probes; `assessCase(fixture, options)` builds and audits a route; `runBenchmark(cases, options)` returns results, evidence gaps and fingerprints. Injectable candidate builder supports negative controls; the reference builder is fixed.

- [x] Write failing tests for protected feature/style loss, native-record contamination, overload classification, deterministic report costs and missing evidence.
- [x] Implement fixtures and production encoded readback; run baseline and inspect all failures.
- [x] Save sanitized baseline and matrix; record precise evidence boundaries.

### Task 2: Targeted research, feature capability ledger and policy experiments

**Files:** Create `docs/map-selection-research-2026-11-14.md`, `docs/feature-capability-ledger.md`, and an offline candidate/comparison tool under `tools/`.

**Interfaces:** Candidate output uses the same encoded cost/probe contract; each candidate has an explicit identity, radius and selection rationale. Reports retain per-case deltas and gate results.

- [x] Inspect device availability and existing instrumentation; obtain valid stationary measurements where the verified interfaces permit them. Record missing channels explicitly.
- [x] Research primary sources and map results to concrete CC700 constraints; classify supplied feature mechanisms as verified, partially traced or hypothetical.
- [x] Write failing candidate tests for protected content, class/layer preservation and 1/2/3 km accounting; implement simple isolated strategies and compare to the baseline.
- [x] Reject an unsafe/no-gain strategy rather than force a default change.

### Task 3: Validation, review and release decision

**Files:** Add benchmark checks to `tools/validate_local.py`; create final report and update project status.

- [x] Run Node/Python/offline/host-C/browser checks and cached-real-source comparisons appropriate to any changes.
- [x] Obtain one fresh whole-change review; reproduce and fix Important/Critical findings with failing tests.
- [x] Record release acceptance per criterion, target gaps, feature implications and the next bounded engineering action.
- [x] Commit and publish the verified outcome; only deploy a generator policy if it meets its release criteria. Verify any published files; retain a clean device state.

## Execution ledger

- Preflight: 22 focused map budget/contract tests pass; working branch `feat/map-reliability-evaluation`.
- Native execution in the existing checkout preserves private sibling firmware and fixture paths; production branch remains unchanged until reviewed integration.

- Task 1: benchmark tests observed failing for missing modules, then passing;
  report failure/empty-run controls observed RED→GREEN; dense-city pressure test
  observed RED→GREEN after replacing unrealistic long-line-only city geometry
  with segmented ways. Public baseline: 11 generated cases, one expected rejection.
- Task 2: prototype tests observed missing-module RED→GREEN. Six complete
  synthetic 1/2/3 km comparisons pass scoped gates; a cheap outer cycleway can
  fit when optional polygon expansion cannot. These are drawing-capacity tests,
  not recovery-feature acceptance. Supplied features are recorded unranked with
  mechanism/cost/evidence dependencies. Primary-source research is linked.
- Target inspection: USB serial boot captures obtained without serial writes,
  firmware/route writes or a requested reset. No verified timing/contiguous-heap
  collector exists; those measurements remain unknown. The conditional target
  measurement step records that boundary; it does not claim a completed capture.
- Whole-change review: no Critical finding. Regraded missing dependency attribution
  and incomplete exact/seam testing as Important because this tool is intended
  to support reliability decisions, then fixed both in one test-driven pass.
- Final: fixed incomplete source identity — transitive dependency manifest test
  RED→GREEN. Geometry/protobuf/readback/drawing dependencies included.
- Final: fixed exact-boundary selection and absent actual seam probes — paired
  mixed-transition and one-block cycleway-loss controls RED→GREEN.
- Final focused suite: 20/20. Full suite: 149 Node passes plus existing TODO,
  121 Python passes; seven offline probes; unchanged two historical maneuver
  failures; zero absent loader proxies over 576 actual ride samples; three browser widths.
- Six private reference/layered-1km builds preserve native bytes. Independent
  Python decoding agrees with all 70 actual map-block cost records. A separate
  full-source 3km experiment was aborted after over five minutes without a
  completed result and is not counted as passing; source/recovery coverage was unverified.
- Release decision: publish tools, evidence and contracts; withhold candidate
  default. Target-runtime margin and full useful retour behavior remain open.
- Publication receipt: `.local/pages-release/<commit>/verification.json` after
  integration; it verifies served bytes without certifying the withheld algorithm.
