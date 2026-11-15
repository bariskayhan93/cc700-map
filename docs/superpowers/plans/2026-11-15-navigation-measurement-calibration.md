# Navigation correctness, measurement and calibration implementation plan

> **For agentic workers:** Use superpowers:executing-plans task by task; one final independent review.

**Goal:** Repair reproduced navigation defects and implement a bounded measurement/calibration pipeline without claiming unobserved device behavior.

**Architecture:** Preserve input route geometry while separating decision evidence from point spacing. Add explicitly test-only target instrumentation with owned storage and verified native interfaces; calibrate only from identified observed channels. Keep ordinary firmware and test instrumentation distinct.

**Tech Stack:** JavaScript/Node, Python, freestanding Xtensa C, host-C harnesses.

**Spec:** ../../implementation-backlog-2026-11-15.md (packages 1–3), ../../stationary-map-measurement-contract.md.

## Global constraints

- Preserve stock ota_0 and route/ride storage; exact backup and automatic boot/restoration around test firmware.
- Preserve supplied route geometry, opaque route style and native record limits.
- Do not manufacture recovery paths or valid distances from unavailable state.
- Device timing needs verified clock/ABI and identified workload; host timing is not target timing.

## Review focus

- Sparse inputs that omit an actual junction: do not invent topology or silently claim full reconstruction.
- Noisy tracks passing side streets: own forward arm is not another exit.
- Close double turns and overlapping route passes must retain distinct maneuvers.
- Collector allocation failure, overflow and teardown must preserve ordinary navigation.
- Missing or disturbed target samples must prevent a falsely calibrated limit.

### Task 1: Reproduce and repair maneuver decisions

- [ ] Run existing historical and labelled tests; preserve baseline evidence privately.
- [ ] Add labelled noisy junction, sparse junction, grade-separated and close-turn regressions; observe failures before changes.
- [ ] Fix confirmed decision-generation causes with separate geometry/decision logic where needed.
- [ ] Run all route tests and historical comparison; record residual ambiguities explicitly.

### Task 2: Trace and repair guidance validity

- [ ] Trace native card, caption and distance consumers and state ownership.
- [ ] Add host tests for actual hook/state behavior before changes, including off-route/rejoin, sentinels and descriptor restoration.
- [ ] Implement only proven interfaces; compile and independently inspect changed binary ranges.

### Task 3: Implement bounded target collection

- [ ] Verify native clock, heap and export interfaces against exact image ranges.
- [ ] Write failing host tests for journal bounds/lifetime, failure/overflow and sample identity.
- [ ] Implement test-only instrumentation; compile, inspect code/stack and test failure paths.
- [ ] Capture identified stationary workloads if all installation/ABI prerequisites hold; restore ordinary firmware and verify boot.

### Task 4: Calibration and closure

- [ ] Add failing tests for sample validation, held-out evaluation and refusal on missing target evidence.
- [ ] Implement resource calibration/reporting with separate measured versus unmeasured channels.
- [ ] Run full validation and one independent review; repair important findings through failing regressions.
- [ ] Publish implementation/evidence report and explicitly list any incomplete target gates.
