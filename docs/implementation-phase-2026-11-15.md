# Combined navigation, measurement and calibration phase

The implementation and local checks are in place, but **this phase is not fully
validated or released**. Ordinary v21 has been restored and verified after every
successful temporary test installation. The new off-route UI image is a candidate;
the new turn policy is explicitly experimental. No resource targets were raised.

## Implemented, released and still open

| Work package | Implemented and checked | Outstanding acceptance |
|---|---|---|
| Navigation correctness | Child-only stale-cue suppression, complete cc22 candidate, native distance-sentinel guards; experimental source-junction association and labelled regressions; sparse-input warning | Live card hide/restore; general noisy/sparse maneuver correctness; stock rejoin/progress arbitration |
| Stationary measurement | Bounded per-invocation collector, startup selftest, correct scheduler-proven task getter, raw timing plus boot-relative activation, direct USB export, guarded programming/restoration | Identified active map workload and timing/heap capture; full frame/flush/load-overlap and component measurements |
| Resource calibration | Strict and scoped partial analyzers, identity/log validation, separate resource axes, held-out run analysis and refusal of missing evidence | Actual workload data covering the agreed matrix; measured operating limits and prediction validation |

The default generator retains the released decision mechanism. Three private
comparison builds (reference, noisy and sparse) are byte-identical to `0c02d27`
after excluding only the generation timestamp. Comparison fixtures use the existing blank name-image stub: they verify record/map equality, not device-ready glyph rendering. The new `.navigationEvidence`
metadata and Pages warning do not change those route files. The experimental
`navigationPolicy: 'junction-evidence-v1'` is not exposed as a Pages choice.

## Navigation work

The native card consumers skip setters for unavailable callbacks; old pixels
remain. The new [guidance patch](guidance-validity-2026-11-15.md) hides only cue
children while committed off-route is nonzero. On rejoin it restores stable cue
children and delegates caption/bitmap selection to the native consumer. It never
changes root visibility, the matcher, progress, recording, the basemap gate or
remaining-distance getter. Native timer delivery and child visibility ownership
were traced rather than assumed.

The complete cc22 image is 3,751,024 bytes, SHA256
`cc6613211b2796ae95ef19a6967759a53c6e48af4612906b22adcbddc088d50f`.
Its builder checks exact v21 identity, fragment inventory/hash/scopes/overlap,
unchanged native getter/formatter/consumer ranges, version-only DROM changes,
all permitted IROM deltas and the ESP checksum/structural roundtrip. It is **not
installed**. It adds no writable globals or heap allocation.

The experimental generator associates decisions with source junction candidates,
retains separate visits at overlaps, distinguishes grade-separated interior
crossings from connected endpoints, and associates nearby shape evidence with
its owner instead of duplicating one junction. These are geometric candidates,
not an access-valid graph: display ways cannot establish missing OSM nodes,
barriers or legal recovery paths. Supplied route geometry is preserved.

Review caught genuine noisy forks being removed by exact-point judgment and an
arm filter. Seeds 33/50/54 now supplement the original labelled fork fixture;
all retain the slight-right and its 15 m location bound. Seeded close-turn,
bridge, overlap, geometry-preservation and caption tests also pass. Broader
historical noise/sparse results still fail the aggregate comparison, so this
policy remains withheld. The production checks still report **25/3 turns versus
15 reference**, unchanged; these counts themselves are not labelled ground truth.
A coarse diagonal cannot safely recover omitted corners without additional data;
its missing evidence is now reported to the user.

## Measurement findings and corrections

The test builds use bounded caller-owned stack records, no writable capture
globals, no capture allocation, checked clock initialization, stack bounds and
margin gates. Export occurs after the final timing timestamp. The [collector
notes](../firmware/measurement/README.md) describe exact interfaces and limits.

Actual startup output was essential. Static analysis initially misidentified
`0x403829dc` as a current-task getter. The runtime guard rejected its stack:
that function returns an **idle-task handle**. Its producer creates idle tasks.
The corrected no-argument getter `0x403832e0` reads the same active-TCB array used
by the scheduler's SP save/restore instructions. The prior claim is withdrawn.
The guard prevented scanning an unrelated stack or accepting invalid samples.

The corrected startup diagnostic passed timer, conversion, USB, own-task stack
and minimum-margin gates (flags `0x1f`). The aligned GUI stack span was **8,184 B**,
consistent with the independently extracted **8,192 B** allocation. At startup,
the caller snapshot had 7,512 B remaining; the nested sampler observed **7,448 B**.
Their 64 B difference is call-frame depth. The untouched A5 prefix scan reached
its 1,024 B cap. **None is a map-time stack margin or full high-water result.**

Raw hardware-counter time and boot-relative time differed in the actual sample.
Native initialization does not establish raw-counter zero; activation therefore
uses the verified boot-relative clock while timed intervals use the raw clock.
The old ROM-export route was replaced with a verified allocation-free native
USB byte callback and flush. Concurrent logging can interleave: checksums reject
damaged lines, but complete invocation loss remains unknown.

No iterator timing records arrived in the completed windows. Startup output now
proves the corrected bindings, but does not prove that navigation invoked the map
iterator during the capture window. An active navigation workload has not been
confirmed. The next ready build includes the **initial map draw in boot seconds
0–120**: a stationary/paused device might not redraw in a delayed window.

A review also corrected a timing label: the post-draw timestamp precedes mutex
release. The parser now reports `draw_locked_us`, lock-acquisition duration, and
conservative mutex-hold bounds instead of claiming an exact hold/wait duration.

## What the 23 km ride establishes

Replay used the already acquired 23,046.39 m ride, its original 22,561.29 m route
and logs. Actual loader/selector/gate C processed **4,035** position samples with
**0 absent-map coverage proxies**, 201 block switches and no indexed linked-list
lookups. This does not prove rendering visibility, task scheduling, native
matching correctness or live rejoin behavior. Exact-second log evidence is sparse:
road values were held for 3,377 samples and off-route state was unknown for 3,378.

The original ridden file's static audit gives useful policy comparisons:

| Resource | Largest observed encoded-block calculation | Existing policy target |
|---|---:|---:|
| Entries | 871 | Not a universal resource limit |
| Serialized block | 62,338 B | 65,536 B |
| Decoded payload | 51,884 B | 57,344 B |
| Iterator scratch | 1,664 B | 4,096 B |
| Projection callbacks | 1,353 | 1,400 |
| Projected points | 6,630 | 7,000 |
| Arbitrary transition plus canvas upper calculation | 237,102 B | 245,760 B |

These are representation/work calculations from the older ridden file, not
allocator peaks, FPS measurements or hardware maxima. They justify keeping each
resource axis separate and do not authorize spending hypothetical spare capacity.

## Validation and release gates

- Standard local checks: 165 Node tests and 165 Python tests pass; seven offline
  application probes pass. The historical aggregate remains a visible known
  failure, so the combined local status is **incomplete**.
- Native portrait/card layout passes at three browser widths.
- Production byte parity passes for all three comparison inputs.
- Fresh review found the fork suppression and mutex-label defects. Both received
  observed failing regressions and fixes; the default-policy gate additionally
  prevents experimental maneuver changes reaching production.
- Temporary sessions verified a full ordinary-v21 backup, programmed only ota_1,
  verified test images, restored the exact full backup, verified OTA selection,
  and automatically observed one stable ordinary ota_1 boot. No tool wrote stock
  ota_0, OTA selection or route/ride/storage partitions; no GPS injection or native
  replay configuration was installed. Normal application activity is not a claim
  that storage bytes stayed unchanged.

The next required bench action is to open the saved route **after the test-image
reboot** and confirm navigation is visible. Capture the initial map draw, restore
ordinary firmware, then verify the cc22 card across on-route/off-route/rejoin.
No new test ride is needed to begin. Full calibration, maneuver-policy promotion
and increased map budgets remain gated on their missing evidence.

## Decisions and tradeoffs

- Work stayed on a feature branch in the established checkout to retain private
  evidence/sibling firmware paths; implementation changes are visible locally.
- Sparse geometry is preserved rather than reconstructed from an unvalidated
  graph; some turn guidance remains unsupported and must be reported as such.
- Production turns are preserved while the new policy remains experimental;
  broader turn fixes wait for independent junction/path evidence.
- Startup observations are not promoted to workload limits; map expansion waits
  for real captures. The analysis tools never authorize budget increases.

Private logs, route coordinates, binaries and raw receipts remain under ignored
`.local/navigation-phase/`. No firmware binary or private ride data is published.

Checkpoint deployment status: source and report are on `feat/navigation-measurement-calibration`; Pages has not been updated by this phase. The device runs ordinary v21, not a measurement build or cc22. [Sanitized checkpoint evidence](mining/combined-phase-2026-11-15.json).
