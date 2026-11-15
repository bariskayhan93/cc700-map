# Connected Recovery Study Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. The owner has authorized implementation and opted out of further process questions.

**Goal:** A tested, repeatable PC evaluator of connected candidate recovery and its representation costs.
**Architecture:** Original-source directed graph, bounded Dijkstra to explicit future route visits, per-origin and cumulative radius reports. Tooling only.
**Tech Stack:** Existing Node ES modules and node:test, no dependency.
**Spec:** docs/superpowers/specs/2026-11-15-recovery-study-design.md

## Global Constraints

No firmware, matcher, Pages, source fetching, or device/route writes. Structural
paths remain unvalidated for cycling. Bytes mean actual UTF-8 JSON, not device
RAM. Keep original IDs, source gaps and each unavailable result.

## Review Focus

Crossings without shared IDs; contradictory coordinates; reversed bicycle
oneway; repeated target node at different visits; work exhaustion before a target
is settled; legacy source missing original data. Tests must exercise all six.

## Task 1: rules and evaluator

- [x] Record persistent implementation rules and scoped design.
- [x] Add failing behavioral tests in tools/test_recovery_study.mjs for topology,
  access/direction, visit window, bounds, deterministic reports, missing source.
- [x] Implement tools/recovery_study.mjs exporting buildCandidateGraph(source),
  findRecovery(graph, request), and evaluateRecovery(input); add read-only CLI
  `node tools/recovery_study.mjs --input INPUT --output NEW_DIRECTORY`.
- [x] Verify tests and register them in tools/validate_local.py.

## Task 2: evidence and closure

- [x] Run repeatable urban/village/forest synthetic cases and audit private ride
  cache availability; publish only sanitized aggregate evidence.
- [x] Run local validation; distinguish known failures and target gaps.
- [x] Review scope/correctness; document results and next integration gate.
- [x] Commit the bounded deliverable. Do not flash or deploy research tooling.

## Execution record

Worked in place on the existing dedicated feature branch, as authorized for this
session. No source, firmware, matcher or device mutation was needed. Behavioral
RED evidence: candidate-path assertion failed against the empty implementation;
edge-limit assertion failed before edge/queue guards. Final recovery tests: 15/15.
Independent review found no correctness blockers; two optional tests remain:
direct reverse bicycle override and cap exhaustion with a target already queued.
They extend existing direction/work-boundary coverage rather than block this tool.

Full local validation: 171 Python and 199 Node tests passed, offline app passed,
ride map coverage proxy passed. After adding the synthetic workload test, the
same complete Node command was rerun: 200/200 passed. Historical validation retains
two known failures: GPS recording with 3 m noise (25 vs 15 turns), and every eighth
planner point (3 vs 15 turns). Overall validator exits 2 / incomplete; target
acceptance is unvalidated. No new firmware or production-map acceptance is claimed.
