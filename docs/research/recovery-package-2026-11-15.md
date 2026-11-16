# Recovery package and portable native core

The generator and portable native recovery core are implemented. **Full device
integration is not complete, and this is not release-ready.** No route, firmware,
Pages deployment or production map budget was changed.

Implemented:

- Identity-bound, CRC-checked experimental sidecars with selective directed recovery
  legs, original-source guards and prior-entry windows. Native route bytes remain
  byte-exact. Unknown/denied neighbouring geometry is retained as conflict evidence.
- Whole-leg tracking, cumulative network distance and untravelled suffix geometry.
  Long original edges subdivide at50m to bound local guard work; this adds points
  without reducing map detail or removing competing roads.
- Portable C streaming reader and state engine, used directly by Python replay.
  No graph or heap allocation in the core. Experimental files are refused by default.
- Unavailable/paused states, stale stock-cue suppression intents, per-frame overlay
  admission, route-epoch/identity rejection and stable restoration. Rejoin requires
  five strictly advancing fresh fixes with independent near-route/ordered-visit
  proof. Verified alternate rejoin can restore ordinary guidance without visiting
  the old prepared target. No arrival is inferred from endpoint proximity.
- Compiler-checked package/work limits:64KiB,64legs,512points/leg,1024total segments,
 64source guards per selected segment. Callback/read failure removes actionable
  recovery. The caller must buffer/validate the suffix before submitting a frame.

## Verification and actual result

**274 registered Node tests and12 native-core tests pass.** Independent review
found two Important bugs: recycled fixes counting toward rejoin, and reverse
same-path pieces escaping source ambiguity checks. Both were reproduced and fixed
in one pass. Regression coverage also includes stale GPS, clock gaps, wrong pass,
stop state, verified alternate rejoin, corrupted/rebound bytes and read failures.

The freestanding Xtensa object compiles with warnings treated as errors:
**5,598 bytes code, zero data/BSS**. Compiler reports384B own frame for mount and
288B for tick. These exclude caller/callback frames and do not prove native task
admission. Caller-owned engine state has a compile-time512B ceiling (280B on host).
No native filesystem, allocator, projection or canvas code is executed in replay.

The historical seed bundle has five entry windows, **10 prepared legs /70,752 B**.
Three windows admit no legs because of absent/unadmitted seeds or guard limits;
one other candidate hits package admission. Files are selective, not general
3km coverage. Full4035-fix replay through the same C core yields:

| Reconstructed off-route state | Frames |
|---|---:|
| Recovery available |12|
| Paused |87|
| Unavailable |710|
| Total |809|

This availability is **insufficient for release**. Missing trustworthy entry
anchors dominate512unavailable frames; outside coverage accounts for196, ambiguity
for2. This is an actual result, not hidden by passing unit tests. At most12overlay
points,108callback reads and10guard checks occur in a recorded tick. These are
host work counts, not native performance measurements.

Replay assumes5m GPS accuracy because the ride lacks that field. Near-route and
ordered progress come from the previous research timeline; speed and course are
reconstructed from past fixes. This provider is not the firmware's live adapter.
Earlier failed/fix-pass runs remain private; the final evidence is in the
[sanitized report](mining/recovery-package-20261115.json).

## What is still required

1. Improve selective coverage/admission enough to be useful; retain all source
   ambiguity protection. Current sparse/guard-limited windows cannot justify a
   general recovery claim.
2. Implement and verify native file/index/provider/task/UI hooks. In particular,
   `RC_ORDERED_MATCH` must independently validate near-route position and ordered
   visit: a raw stock flag is insufficient. Mounts/reads need pinned immutable
   ownership, full callback stack admission and atomic overlay submission.
3. Resolve the existing cc24 native drawing release gate and run a causal bounded
   target check with exact restoration. No firmware candidate was flashed here.

The C API and ownership contract are in
[firmware/recovery/README.md](../firmware/recovery/README.md). The implementation
is useful, testable groundwork; it must not be presented as a completed live
recovery feature or enabled in the production app.

## Reproduce

Use existing study config keys `snapshot`, `route`, `track`, `timeline` for labelled
historical source/window seeds. Omitting track/timeline builds requested `windows`
(or all route windows) with bounded deterministic source selection. New output
directories only; private packages contain location data and must not be published.

```sh
node tools/recovery_package_build.mjs --input STUDY.json --output NEW_BUNDLE
python3 tools/recovery_package_replay.py --input STUDY.json --bundle NEW_BUNDLE --output NEW_REPLAY
node --test tools/test_recovery_package.mjs
python3 -m unittest discover -s tools -p test_recovery_native.py
```

Only replay explicitly opts into experimental packets. The real device remains
unchanged. No independent review minors were reported; source legality, physical
passability, provider correctness and target acceptance remain unvalidated.
