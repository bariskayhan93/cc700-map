# CC700 project status after mining, ride review and v21

This ledger separates shipped code, evidence and proposed work. It consolidates
[the ride review](ride-review-2026-11-14.md),
[the v21 release](v21-caption-opacity-2026-11-14.md) and
[the cycling-navigation research](cycling-turn-practices-2026-11-14.md).
Raw firmware, device files, positions and recovery artifacts remain private.

## Current deployment

- **Device:** v21 on ota_1, flash-verified and automatically booted through RTS.
  A fresh full v20 rollback is retained; stock ota_0 was not programmed.
- **App:** updated generator, current two-row reference UI and matching v21 preview.
- **README:** regenerated static/animated examples from the current page; supplied
  OnelapFit reference is preserved separately. Earlier Tour D3 artwork is historical.
- **Existing route files:** preserved. The opaque route applies immediately;
  new close-turn captions require regenerating/transferring a route with the app.
- **Scope:** v21 does not change GPS speed/heading, pause, route association,
  off-route detection, remaining-distance validity or arrival logic.

## Confirmed findings

| Area | What mining/debugging established |
|---|---|
| Original map loss | v16 confused point and section indices, selecting the wrong block. The stock draw gate also suppressed the map while off-route. Those were separate causes. |
| Rendering versus guidance | Map selection/drawing and stock maneuver/progress state are separate paths. Keeping the map visible does not make a retained instruction valid during a detour. |
| New ride | FIT records 23.046 km over a 22.561 km planned route, with 4,035 position records. All eleven recording gaps of at least ten seconds coincide with pause/continue events. |
| Rejoin holds | At two on-line positions, matched roads 33/68 differed from accepted outputs 31/61. Another off-route sample had only about a 3 m point distance. These cases need different explanations. |
| Large detour | The ride reached about 911 m from the original line. An instruction countdown remained around 210 m for part of the detour. Several generated map layers have narrower coverage than this excursion. |
| Remaining “-- km” | Stock code returns an unavailable sentinel while off-route in normal navigation, then formats it as `--`. This getter/formatter is unchanged in v20/v21. The trip counter continued through the detour. |
| Photo correlation | The 666 m / 7.37 km scene matches 17:32:38. The next maneuver is about 666 m away across straight subdivisions; the old preview incorrectly used an approximately 89 m record remainder. |
| Missing close-turn hint | Bitmaps contained `then …`, but the native caption path reads field 6 of the outgoing record k+1. That text field lacked the hint. The stock parser accepts at most 63 UTF-8 bytes. |
| Actual UI | Full display is 240×320; map buffer is separately 240×256. References show two card rows—distance and one caption—not an extra following-turn widget. |
| Noisy/sparse tracks | Short noisy headings can borrow an unrelated junction to approve a false maneuver. Simple smoothing did not fix this. Sparse tracks can remove the geometry of real route choices. |
| Simulation boundary | Host C rendering/loader tests are valuable, but do not emulate the complete stock matcher, changing live route windows, scheduler, physical GPS/heading or display response. |
| Recovered logs | Rotated text survives in raw storage until overwritten. Complete-fragment recovery found 43,300 distinct dated lines, with byte-offset provenance and explicit ordering/completeness limits. |

No crash/allocation-failure message was found in the recovered ride text; that
is not proof that none ever occurred. Four encoded U-turns are not automatically
four bugs: maneuver correctness needs independently labelled intended paths.

## Implemented and tested

1. **Correct section-domain map selection and off-route drawing.** v17/v18 fixes
   preserve the loaded basemap while the stock guidance state is off-route.
   Navigation/arrow access uses bounded lifetime/locking safeguards.
2. **More efficient iterator selection.** v19 retains draw ordering and legacy
   unsorted-file compatibility. The dense fixture drops selection inspections
   from 248,000 to 12,000 with identical projection/draw trace. This is a work
   count, not measured device FPS.
3. **Fill and label corrections.** Consistent polygon crossing handling removes
   false doubled-hole seams. Bounded native/preview label placement handles
   collisions, edges and the HUD. The photographed block's 97 area masks agree
   between actual C and JS under the same desktop projection.
4. **Stable app geometry and serialization.** Shared prepared display lines,
   reversal-stable simplification, global label anchors/priorities, canonical
   serialization, and sparse-segment range classification improve consistency.
   Full coverage-wide polygon topology and dash continuity are still open.
5. **Water/cycleway distinction.** v20 uses light water for areas and river/creek
   strokes, preserves darker shorelines, and draws cycleways 2 px violet.
6. **Opaque route.** v21 keeps the same red and width, changing only opacity to
   255. Only one compiled patch-code byte differs from v20; no new allocation.
7. **Native caption encoding.** New route files place close-turn hints in the
   outgoing native field, preserve waypoint ownership and roundabout bitmap
   compatibility, and truncate UTF-8 safely to 63 bytes.
8. **Honest preview UI.** Full portrait scaling, two-row card, next-maneuver
   countdown across straight records, inclusive 300 m icon threshold, outgoing
   caption, circular marker, progress and lower metrics follow the references.
   Fonts, line rasterization, chevron spacing and some widget dimensions remain
   approximations. Playback is on-route, not a native detour simulator.
9. **Reproducible evidence/artwork tools.** Offline log recovery, route/block
   audits, actual C probes, browser layout checks and regenerated README assets
   make future changes reviewable without repeating a full ride each time.

## Measured room and verification

| Item | Evidence and boundary |
|---|---|
| Patch | 6,480 B text, 296 B rodata, 8,120 B remaining mapped code-page room. Flash room is not RAM headroom. |
| Canvas | 122,880 B RGB565 map buffer. |
| New ride map | 17 blocks; largest 871 entries, largest serialized block 62,338 B, largest decoded map payload 51,884 B. |
| Heap observations | Minimum sampled current default-capability free heap 1,263,328 B; internal/DMA/byte-capable 47,792 B; reported default low-water statistic 991,892 B. These are not additive and do not measure largest free block or task-stack headroom. |
| Final Python | 121 passed, including actual C segment/fill/label checks under sanitizers. |
| Final Node | 102 passed, zero non-TODO failures; one known executed noisy-GPX TODO remains. |
| Browser/offline | Layout checks at three widths with short/long/then captions; all seven offline probes, including synthetic 70 km generation/readback, pass. |
| Still incomplete | Historical noise/sparse aggregate checks remain 25/3 turns versus 15 reference; full native target acceptance remains open. Generation/readback is not a 70 km device endurance test. |

## Improvement order

| Priority | Work | Acceptance requirement |
|---|---|---|
| 1 | Reproduce the captured rejoin holds with the missing native inputs: accepted/candidate road, point identity, position freshness, heading validity, counters and live route-window changes. | Explain both stale-road cases and the separate near-point/off-route case; do not infer missing angles from broken `%f` logs. |
| 2 | Persistent, state-aware detour presentation: retain map/course but replace stale normal cues with off-route status; distinguish reacquisition. | No stale turn presented as current, no fictitious numeric remaining distance, and normal recording continues. This is proposed, not shipped. |
| 3 | Progress- and direction-aware rejoining. | Handle shortcuts, crossings, shared outbound/return sections, start/finish overlap, reverse travel and the recorded excursion without nearest-pass jumps or indefinite holds. |
| 4 | Connected-path association in the phone-side generator with explicit uncertainty. | Multiple noise seeds, shallow forks, bends, genuine U-turns, 22/27 m pairs, grade separation, sparse inputs and missing legacy topology. Preserve supplied geometry. |
| 5 | Measure target frame time, lock waits, largest free allocations and stack high-water marks before expanding detail/corridors/block size. | Gains must be demonstrated on representative blocks; no resolution reduction or blanket road removal. |
| 6 | Native visual acceptance for new captions and fidelity checks. | Observe a real close pair using a newly generated route; compare the actual caption/scrolling and current UI. It need not be another full 70 km ride. |
| 7 | Verified routed return, when justified by available data. | A connected cycling-accessible graph or validated phone/native planner path, correct temporary-route lifecycle, and safe transition back. A geometric bearing is not a route across barriers. |

The design direction is to retain the bounded renderer and improve the missing
path/rejoin decisions. Additional smoothing or a higher angle threshold is not
a substitute for knowing which junction exit the route actually traverses.
