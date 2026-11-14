# Native replay preparation

The owner asked to continue toward repeatable device tests. Use the existing
closure requirements and the concrete `docs/native-replay-capture-design.md`.
Build locally; no firmware/storage programming is part of this preparation.

- [x] Trace recovery records and fresh-activity activation alternatives.
- [x] Identify concrete record/queue/publication capture sites and lifetime risks.
- [x] Add a read-only recovery/dependency audit with invalid-input regressions.
- [x] Build a separately named, pinned-v18 activation-probe image; verify its
      exact two-byte code change, version, image checksum/hash and source preservation.
- [x] Record the remaining instrumentation proof gates and run combined tests.
- [x] Preserve original OSM navigation source before display generalization;
      verify the disputed turn from recovered original node topology.
- [x] Run a bounded real-firmware emulator feasibility audit; stop at the
      demonstrated LCD completion blocker rather than expanding board emulation.
- [x] Close the fresh review's capture-core finalization race and preserve the
      experimental allocator-only build separately from installed firmware.

Ruling: use a dedicated fresh-activity test image instead of fabricating a
recovery structure. The latter restores hundreds of bytes of state and can
truncate a real recording. Cost: test firmware must never be left installed for
ordinary rides; restore v18 after the eventual controlled operation.

Ruling: the activation probe is not the complete capture build. It has no
collector and cannot establish queue freshness or performance. Prepare it as a
small reviewable artifact; do not install it while the collector/readiness
requirements remain open.

Ruling: no further angle-threshold patch for the noisy-route failure. Original
navigation node identities/geometry are lost by the visual-map pipeline;
preserved topology and sequential path association are the sound replacement.
The historical turn vector is a change detector, not ground truth for every
ambiguous maneuver. Cost: the existing noisy/sparse failures remain open.

Owner clarification: smart local coverage should support feature development;
whole-board completeness is not a prerequisite for every change. Routine work
uses actual route/patch/renderer tests and explicit behavior contracts. Native
telemetry and physical performance checks remain separate acceptance evidence.

The activation probe is built as `CC700_V1.414-rptest01`, SHA-256
`32a37f6c7291cd39766ac386dc35c9cc5f52b0f9ebc7963c4de9311d52527a44`.
Image checksum/appended hash pass. Only the two argument bytes and visible
version differ from pinned v18. No device was opened, written or activated.

Source capture now retains original node IDs/geometry/tags. A recovered original
Overpass response establishes the short right-turn connector chain, so a
cached-geometry heuristic that removes it is rejected. The new dependency is
included in service-worker precache v4; an executed offline installation test
failed before that fix and passes after it.

Combined checks: 100 Python passes; 32 Node passes plus one executed known TODO;
seven offline probes; historical 10/12; recorded-ride loader proxy 0/576 absent.
Private observation: `.local/validation/20261114T101817898754Z/report.json`.
The runner now marks skipped prerequisites incomplete and treats changed known
failure metrics as new results requiring review.

Final private capture-core verification: five ASan/UBSan HOST binaries pass,
including two controlled finalization-race interleavings that failed before the
fix. All atomic RMW state stays in a 24-byte internal-RAM allocation; PSRAM
allocation is 512200 bytes. The target allocator-only candidate has no writable
globals/undefined symbols and leaves 5488 bytes in the code page. Parent reran
`build.py` and `verify_allocator.py`, both exit0. Image SHA-256:
`2fd18e4f62e2107c7b9978c3d6a58a4ccf44a34a38b08c11fba29df1ba771869`.
It is uninstalled and lacks live capture tracepoint integration. A proposed
record detour was rejected because five stock branches land inside its overwrite
span; no unproven record hook was incorporated.
