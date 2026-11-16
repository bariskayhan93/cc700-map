# CC700 documentation

Start with [STATUS.md](STATUS.md). It states what is installed, what is verified and what is open.

Folders:

- `current/`: rules, limits and procedures that apply now.
- `releases/`: one note per shipped version or app update.
- `reports/`: dated analyses, ride reviews and phase plans.
- `research/`: feasibility studies, firmware extraction notes and design work.
- `mining/`: machine-readable evidence (JSON). `comparison/`: screenshots and artwork.

Each summary below comes from the file title and opening section. Read the file for the details.

## Current reference

Read these first. They describe the rules, limits and procedures that apply now.

- [research focus 2026 11 15](current/research-focus-2026-11-15.md): Owner priority and the rules for returning to navigation research.
- [map reliability contract](current/map-reliability-contract.md): Contract and evaluation matrix for map reliability.
- [implementation backlog 2026 11 15](current/implementation-backlog-2026-11-15.md): Ordered work packages: navigation first, then measurement, selection and recovery.
- [technical context](current/technical-context.md): Device limits (memory, stack, display, firmware) and development context. Parts are superseded by later reports.
- [device storage access](current/device-storage-access.md): How to read, sync and write device storage and check replay readiness.
- [repeatable validation](current/repeatable-validation.md): The offline validation command, what it covers and what it cannot prove.
- [behavior contract harness](current/behavior-contract-harness.md): Offline navigation behaviour contracts and the behaviour they exclude.
- [feature capability ledger](current/feature-capability-ledger.md): What each feature needs as input, and which hypotheses were withdrawn.
- [stationary map measurement contract](current/stationary-map-measurement-contract.md): Rules for measuring the map on a stationary device.
- [resource calibration format](current/resource-calibration-format.md): Format and method for calibrating device resources.
- [native replay contract](current/native-replay-contract.md): Configuration and activation contract for native replay.
- [map limits](current/map-limits.md): Map limits, tuning controls and calculated budgets.
- [exploration map](current/exploration-map.md): Map of what is known, unknown and still open in the project.
- [geometry boundary audit](current/geometry-boundary-audit.md): Geometry boundaries that any replay must preserve.

## Releases and firmware versions

One note per shipped version or app update. Newest first.

- [cc22 release 2026 11 15](releases/cc22-release-2026-11-15.md): cc22: installed firmware, navigation status and the rollback image.
- [loop and turn fixes 2026 11 15](releases/loop-and-turn-fixes-2026-11-15.md): cc23 loop departure, the rejected cc24 diagnostic, and turn fixes.
- [v21 caption opacity 2026 11 14](releases/v21-caption-opacity-2026-11-14.md): v21: close-turn captions, opaque route and reference UI.
- [water cycleway v20 2026 11 14](releases/water-cycleway-v20-2026-11-14.md): v20: water and cycleway distinction.
- [v19 firmware rendering 2026 11 14](releases/v19-firmware-rendering-2026-11-14.md): v19: firmware rendering candidate.
- [v18 implementation 2026 11 14](releases/v18-implementation-2026-11-14.md): v18: implementation and release state.
- [v17 review 2026 11 14](releases/v17-review-2026-11-14.md): v17: review and the next firmware boundary.
- [rendering release 2026 11 14](releases/rendering-release-2026-11-14.md): Coherent rendering release for the web app.
- [app release 2026 11 14](releases/app-release-2026-11-14.md): Web app update of 14 Nov 2026 and its limits.
- [current preview artwork 2026 11 14](releases/current-preview-artwork-2026-11-14.md): Preview artwork and browser checks, 14 Nov 2026.
- [preview display geometry 2026 11 14](releases/preview-display-geometry-2026-11-14.md): Preview display geometry checks.
- [preview guidance 2026 11 14](releases/preview-guidance-2026-11-14.md): On-route preview guidance and its limits.

## Reports and findings

Dated analyses, ride reviews and phase plans. Some parts are superseded (marked).

- [project status 2026 11 14](reports/project-status-2026-11-14.md): Snapshot of 14 Nov: findings, shipped changes and priorities. **Superseded by [STATUS.md](STATUS.md) for current facts.**
- [ride review 2026 11 14](reports/ride-review-2026-11-14.md): Review of the 23 km ride on 14 Nov.
- [ride map loss 2026 11 13](reports/ride-map-loss-2026-11-13.md): Cause of the map loss on 13 Nov and the v17 fix. **Acceptance claims are superseded** by the 14 Nov review.
- [firmware mining 2026 11 13](reports/firmware-mining-2026-11-13.md): First firmware mining report, 13 Nov.
- [mining closure](reports/mining-closure.md): Closure of the mining phase and the validation order.
- [map evaluation report 2026 11 15](reports/map-evaluation-report-2026-11-15.md): Map evaluation results and the release decision.
- [local validation audit](reports/local-validation-audit.md): Audit of the local app and simulation. **Partly superseded** by the v17 review.
- [popup and sensor followup](reports/popup-and-sensor-followup.md): Startup warning and stationary sensor observations.
- [grey route state notes 2026 11 15](reports/grey-route-state-notes-2026-11-15.md): Grey route symptom and the native selection notes.
- [implementation phase 2026 11 15](reports/implementation-phase-2026-11-15.md): Combined navigation, measurement and calibration phase.
- [remaining extraction and device](reports/remaining-extraction-and-device.md): Remaining firmware extraction work and the connected-device baseline.

## Research and studies

Feasibility studies, firmware extraction notes and design work.

- [recovery feasibility 2026 11 15](research/recovery-feasibility-2026-11-15.md): Complete PC feasibility pass for route recovery, and the decision.
- [recovery package 2026 11 15](research/recovery-package-2026-11-15.md): Recovery package format and the portable native core (host only).
- [recovery study 2026 11 15](research/recovery-study-2026-11-15.md): First connected-recovery study and its gaps.
- [recovery transitions 2026 11 15](research/recovery-transitions-2026-11-15.md): Turn-aware recovery: measured result and next decision.
- [regional recovery replay 2026 11 15](research/regional-recovery-replay-2026-11-15.md): Regional source data and the first real-detour replay.
- [routing snapshot 2026 11 15](research/routing-snapshot-2026-11-15.md): Original routing-source snapshot and its limits.
- [route association investigation](research/route-association-investigation.md): How route points are matched to map roads.
- [adaptive map budget 2026 11 14](research/adaptive-map-budget-2026-11-14.md): Adaptive map budgets: detail where it matters.
- [map representation study 2026 11 14](research/map-representation-study-2026-11-14.md): Map representations compared: reliability before drawing count.
- [map selection research 2026 11 14](research/map-selection-research-2026-11-14.md): Research on map context selection and the decisions taken.
- [cycling turn practices 2026 11 14](research/cycling-turn-practices-2026-11-14.md): How cycling navigation handles turns, compared with CC700.
- [navigation rendering practices 2026 11 14](research/navigation-rendering-practices-2026-11-14.md): Rendering practices applied to CC700.
- [guidance validity 2026 11 15](research/guidance-validity-2026-11-15.md): Native guidance validity candidate.
- [generator closure 2026 11 14](research/generator-closure-2026-11-14.md): Bounded closure in the route generator.
- [elevation study 2026 11 15](research/elevation-study-2026-11-15.md): Elevation strip prototype on the PC.
- [native fit fixture](research/native-fit-fixture.md): Readiness of the native FIT replay fixture.
- [native replay capture design](research/native-replay-capture-design.md): Design of the native replay collector test build.
- [native replay current storage](research/native-replay-current-storage.md): Native replay installation, incident and cleanup record.
- [native replay next operation](research/native-replay-next-operation.md): Prepared next native replay operation.
- [local firmware emulation](research/local-firmware-emulation.md): Firmware emulation: boots, but stops before the GUI.
- [navigation behavior extraction](research/navigation-behavior-extraction.md): Extracted navigation behaviour. **Some branches are superseded** (see the file).
- [navigation runtime extraction](research/navigation-runtime-extraction.md): Firmware position publication, queued completion and route replacement.
- [route state extraction](research/route-state-extraction.md): Firmware route matching and off-route state.
- [rejoin planning extraction](research/rejoin-planning-extraction.md): Firmware off-route notices and rejoin planning.
- [progress arrival extraction](research/progress-arrival-extraction.md): Firmware progress and arrival logic.
- [lifecycle audit](research/lifecycle-audit.md): Audit of popup, timer and navigation reset.
- [sensor boundary audit](research/sensor-boundary-audit.md): Audit of sensor and peer boundaries.

## Evidence folders

- [mining/](mining/): JSON records from device and PC checks. Hashes and summaries only where the data is private.
- [comparison/](comparison/): screenshots and artwork used by the web app and the README.

## Not in this repository

Device images, storage dumps, ride logs and route files stay local. They are in `.local/` (ignored by git) and in a private backup. Use the notes above to find what they contain.
