# Repeatable-validation continuation

The owner requested completion of mining, research and preparation with fewer
physical rides. Continue the finite work order in `docs/mining-closure.md`.
Prior design pauses are waived by the owner's repeated full-implementation
instruction; no device write or forced replay activation is needed for this pass.

- [x] Add executable, explicitly transcribed state contracts from checked evidence.
- [x] Exercise actual styled renderer with sanitizers and allocation/projection/load boundaries.
- [x] Correct labelled generator defects conservatively and retain unresolved assertions.
- [x] Provide one offline validation command with durable private fixtures and honest status propagation.
- [x] Prepare an observation checker for native record identity, pointer-buffer reuse, final publication, timing, EOF and stop.
- [x] Mine recovery/resume prerequisites and side effects; verify reached branches against GNU and installed v18.
- [x] Obtain a fresh review; fix material findings with observed failing regressions.
- [x] Run final combined validation and write observed results.

Ruling: the contract module is a manually transcribed model, not differential
instruction execution; it makes the extracted decisions repeatable without
inventing geometry or scheduler behavior. Cost if wrong: transcription errors
could mask firmware differences; provenance and excluded inputs remain explicit.

Ruling: retain only bounded generator corrections supported by independent
junction labels and exact preservation of the reference turn vector; do not force
the historical sparse count. Cost if wrong: other unlabelled inputs can still
gain/lose prompts; the historical failures remain visible and acceptance open.

Ruling: keep target replay unactivated because a disposable recoverable session
and record-delivery collector have not been established; the recovered resume
path can truncate recording/lap files. Cost: native timing/visibility cannot be
closed by this host pass. No ride is requested for routine source changes.

Final review found five important false-success/reporting paths. Failing tests
reproduced each before fixes: unexpected historical point exceptions, new
readback errors hidden in known cases, stale final replay snapshot, EOF outside
the decoded run, and huge numeric timestamps aborting report creation. Fixes
reject those paths; coalesced calculation snapshots remain supported.

Final observed run: Python 88/88; public Node 18 pass plus one executed failing
TODO; offline app six probes pass; historical 10/12, noisy25 and sparse3 against
reference15 remain failures; real-ride loader vertex proxy 0/576 absent. Runner
exit2 reports incomplete honestly. Private report/logs are under
`.local/validation/20261114T054830993680Z/`. No firmware/device write or route
transfer occurred. Full-plan target and generator acceptance remain open as
listed in `docs/repeatable-validation.md`.
