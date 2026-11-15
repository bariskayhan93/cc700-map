# Covered recovery package implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** implement covered generation and a bounded native C recovery reader/state engine, verify actual-byte replay and target compilation.
**Architecture:** deterministic directed source-edge portal generation, RCP1 sidecars with original-source conflict guards, callback-driven C runtime and shared host/native-core tests.
**Tech Stack:** Node generation, portable C, Python ctypes host tests, Xtensa compiler.
**Spec:** docs/superpowers/specs/2026-11-15-recovery-package-design.md

## Global constraints

No route mutation, production budget increase, flash or fake native acceptance.
Experimental packages default refused. Hash binding/CRC is integrity, not access
validation. Covered intervals and guards must fail closed. Native adapter absent
and cc24 draw acceptance unresolved are explicit integration gates. One final
review and one Important fix pass; avoid unrelated stationary matching changes.

## Review focus

- Edge interval trimming, junction turns and nearby denied/parallel roads.
- Window/route identity, integer sizes, corrupt offsets/counts, callbacks failing.
- GPS stale/clock gaps, pause, wrong route pass, rejoin stability and route changes.
- Memory ownership, no graph allocation, overlay admission and stale geometry.
- Selective source seeds versus actual coverage; no inflated full-route claims.

### Task 1: bounded portal generation and sidecar format

- [x] RED: directed intervals, guards, binding/checksum, determinism, byte admission,
  native-route preservation, forward windows, unsupported/overloaded fallback.
- [x] Implement tools/recovery_package.mjs and tests. Expected: tests pass;
  deterministic sidecar bytes with explicit uncovered portal/window receipts.

### Task 2: portable native reader and lifecycle

- [x] RED: actual generated package via C reader, corrupt/mismatched bytes,
  defaults, guards, moving/stopping, stale GPS/gaps, wrong pass and stable rejoin.
- [x] Implement firmware/recovery/recovery.h,c and host ctypes harness. Expected:
  no graph/malloc, no whole-leg stack buffer, bounded source checks and output.

### Task 3: real replay, target build and review

- [x] Generate labelled historical-window/segment-seed bundle, run complete real
  track through SAME C core, capture availability/state/byte/resource metrics.
- [x] Cross-compile freestanding Xtensa objects and stack usage, focused/full
  relevant tests and independent review. One Important fix pass, report native
  adapter/release gaps accurately, commit deliverable. Expected: implementation
  evidence, not a device-ready or Pages deployment claim.


## Execution result

Portable implementation completed: generator+bounded C reader/state/overlay intent
API+native-core ctypes replay+Xtensa object. Native filesystem/index/provider/UI
adapter remains unbound; this is NOT full device integration or release.

Refinement: whole-leg tracking with per-segment source guards, cumulative distance
and suffix geometry replaces initial-edge-only coverage. Source identity traced
for every leg segment. Per-package1024-segment admission; own path pieces remain
axial competitors even if wrong direction. Source guards/leg geometry can exhaust
admission: explicit unavailable, never silently remove competing roads.

One independent review found recycled-fix rejoin and reverse same-path ambiguity;
both reproducedRED→GREEN. The same fix pass covers clock-gap episode preservation
and verified alternate rejoin to avoid requiring the old target after a real
rejoin.12 native tests pass. Full registered Node suite274passes. Native core
compiles with Werror; object5598B, largest function frames384Bmount/288Btick,
excluding callback/caller and full chain. Host engine280B, native static ceiling512B.

Real4035-fix replay is provider reconstruction, not hardware simulation. Five
historical windows selected,10 prepared legs; three windows have no admitted
legs. Only12frames offer recovery in809off-routeframes. This is inadequate
coverage for release; guard/byte admission and missing trustworthy anchors are
explicit outcomes. No device, original route, production map budgets or deployed
app change. Next gates: useful selective coverage and verified native adapter/
safety acceptance, not a cosmetic stationary matching loop.

Long original edges are subdivided at50m for local guard work; no map detail or competing source geometry is removed. An explicit regression covers this admission improvement. Final bundle70752B in five windows,10legs; only12of809off-route frames activate. Native file/index/provider/UI adapter remains unimplemented and coverage is inadequate for release.
