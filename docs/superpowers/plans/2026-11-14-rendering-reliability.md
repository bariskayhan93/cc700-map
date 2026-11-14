# Rendering reliability implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consistent map geometry, bounded labels and less repeated firmware work, retaining readability.
**Architecture:** Existing route format and software canvas; phone geometry preparation; backward-compatible C iterator optimization and rendering corrections; preview mirrors device rules.
**Tech Stack:** ES modules, Node tests, C/Xtensa, Python ASan/UBSan harness.
**Spec:** docs/superpowers/specs/2026-11-14-rendering-reliability-design.md

## Global Constraints

- Retain road casings, green/grey palette and existing semantic flags.
- Old unsorted files must render correctly; unknown source semantics stay unknown.
- One loaded block, at most 12 labels; no additional full-frame RAM allocation.
- No live GPS injection; private fixtures and coordinates stay local.
- Report local proof separately from target timing/heap and physical navigation acceptance.

## Tasks

- [x] Firmware: failing regression tests, allocation-free bounded selection acceleration with legacy fallback, hole-fill correctness, bounded label collisions. Native C equivalence including styles, legacy order, OOM, old files, fills and text placement. Build uniquely named v19 candidate and budget report; no generic image overwrite.
- [x] Geometry: failing tests for shared junction/semantic anchors and block-independent simplification, implement reusable source-preserving preprocessing module and integrate before clipping. Retain parallel/bridge geometry; reject invalid input. Do not fabricate connectivity.
- [x] Labels/preview: deterministic global anchors, stable priorities/ties, 12-candidate budget, device/preview collision parity, conservative HUD reservation and native-size comparison fixtures.
- [x] Integration: run public suites, offline probes, C sanitizer suites, historical and real-ride validation; review diff and resolve introduced failures. Update docs and cache; publish tested web release, verify served bytes. Install only verified firmware when device is reachable; readback and reset verification if installed.

## Review Focus

Mixed/unsorted legacy entries; interleaved symbols; text payloads are not geography; hole bridges must not leave seams; labels across block/heading changes; true junctions retained without snapping grade-separated roads; scratch OOM and route replacement must remain safe.

## Execution record

Geometry and firmware implemented in parallel; fresh independent integration/firmware review found and resolved sparse-crossroad far classification and closed-way label anchor reversal. Native C/preview mask and collision parity passed. Final v19 style change promotes existing tested water/path rules only, preserving green/grey and street casings. v19 installed/readback verified and RTS boot observed. Final validation records the pre-existing guidance failures explicitly; physical timing/heap/stack budgets remain unmeasured. Publication verification completes the last task.

Published application commit `c23ad8df17b77837294ceeafcbd2bf2fae3cfb53`: Pages build succeeded, all 59 served files matched, downloaded app Node tests81 passed +1 known TODO and all seven offline probes passed. Verification `.local/pages-release/c23ad8d/verification.json`.
