# Recovery transitions implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** replace unnecessarily broad quarantine in a separate PC recovery mode and measure it on the real ride.
**Architecture:** validate retained original snapshots, compile local barrier cuts and turn rules, search bounded incoming-edge states; preserve the old study as the comparator.
**Tech Stack:** Node built-ins, existing original-source snapshot and ride tools.
**Spec:** docs/superpowers/specs/2026-11-15-recovery-transitions-design.md

## Global constraints

PC-only; no default access widening; reference-only ways excluded; unknown and
conditional semantics remain unavailable; no live, legal cycling, device timing
or continuous 3 km claim. Keep private topology/ride IDs out of public reports.

## Review focus

- Same-way restriction and repeated junction nodes must not invent a permitted turn.
- Multiple arrival edges can require distinct search states at the same node.
- Barrier tags with denied/conditional access must survive explicit overrides.
- Incomplete or inconsistent snapshots must fail closed.
- Target arrival is not validation of continuation onto the recorded route.

### Task 1: bounded transition compiler and search

- [x] Add failing fixtures for local barriers, node access, no/only turns, same-way
  U-turn, exception precedence, unsupported restrictions, incoming-edge state,
  bounds, deterministic output and incomplete source.
- [x] Implement tools/recovery_transitions.mjs and bounded turn-state support in
  tools/recovery_study.mjs; share original snapshot validation without weakening it.
- [x] Run new and existing snapshot/recovery tests. Expected: all pass.

### Task 2: real replay and measured representation decision

- [x] Add integrated study fixture and explicit transition mode; retain default
  conservative study. Run same saved source and actual ride in a new private dir.
- [x] Measure candidate representation bytes; record what improved and what still
  blocks useful recovery. Update research focus and sanitized report.
- [x] Fresh review once, one important fix pass if needed, focused tests, commit.

## Execution

Standing owner authority selects inline execution in the existing dedicated
feature branch. No fresh worktree or workflow approval questions. Completion
stops at this measured milestone; representation/online policy is a later step.


## Completion evidence

51 focused Node checks pass. Previous conservative and new transition modes
replayed on identical real inputs in separate private directories. Restriction
handling improves topology (733 rules, 30 unsupported relations) but candidate
availability stays 1/30: every remaining graph-absent association touches access-
excluded classes. Audit also finds nearest-node candidates on steps/footways;
next evaluate segment association jointly with regional access, not blind default
widening. Actual proposed payload is 44 bytes for the one short candidate, with
lookup/association/target ownership explicitly absent. No production/device work.

Fresh review: one Important unsupported scoped-restriction finding fixed with
RED→GREEN and the 51-test suite. Reviewed replay summary exactly reproduces the
pre-review run. Deferred minor: local blocked-node reasons absent from aggregate
association-cause counts; full reasons retained in private graph audit.
