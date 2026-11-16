# Recovery input: trusted on-route position

Status: host reference rule with tests. No firmware or device change. The replay uses the
recorded track as its GPS source.

## Why 512 off-route moments had no trusted position

The recovery core accepts a trusted on-route position only from an ordered on-route sample
(`firmware/recovery/recovery.c`, line 86). A gap of more than 5 s clears it (line 65). A
mirror of these rules over the accepted replay events reproduces all 512 `RC_ENTRY` moments:

| Cause | Moments |
|---|---:|
| Last on-route sample lay on a street the loop uses twice | 456 |
| A gap of more than 5 s cleared the position | 50 |
| Ride start, before any ordered sample | 6 |

The research timeline flags 1,091 of 4,035 rows as `ambiguous_with_other_pass`. On those rows
its progress is the nearest pass, not a resolved one: it makes 232 physically impossible
progress jumps (more than the distance ridden plus 60 m between two on-route rows).

## Provider rule (`tools/recovery_provider.mjs`)

Past fixes only. One candidate per route pass within 20 m.

1. One candidate: ordered.
2. Several: keep the passes whose direction lies within 60° of the rider's heading. A heading
   that fits no pass means the rider is turning; it is then ignored for that fix.
3. With an anchor (the last ordered position), drop every pass more than 20 m behind it.
4. Exactly one left: ordered. Otherwise unordered, so the core reports "no trusted position".

A gap of more than 5 s keeps the anchor only if the rider moved at most 30 m across it. The
heading never spans a gap. A clock running backward drops the anchor.

**How the rule was found.** The first version used continuity with a "not farther ahead than
the distance ridden" limit and dropped the anchor at every gap. This ride then showed three
faults, and each rule above was added or removed for one of them:

| Fault seen on this ride | Change |
|---|---|
| Every gap was a stop (3.6 to 23.3 m moved, 13 gaps); 379 rows lost their anchor | Stop rule: keep the anchor up to 30 m (twice the core's 15 m accuracy limit) |
| The "ahead" limit locked onto a wrong pass for 3 s at a hairpin and for 12 rows after a skipped loop | Limit removed; heading added; same-direction repeats now stay unordered |
| The last sample before leaving the route was a turn and erased the anchor | A heading that fits no pass is ignored |

The arguments are general, but the thresholds are confirmed on one ride only. A second ride
must check them. 15 host tests cover an out-and-back street, a same-direction lap, gaps with
and without movement, a clock fault, a turn off the route, a pass behind the anchor and a
hairpin cut.

## Result on the 22.56 km ride

| Check | Value |
|---|---:|
| On-route/off-route split equal to the research timeline | 4,035 of 4,035 fixes |
| Shared-street rows resolved | 972 of 981 (9 stay unordered: several passes ahead) |
| Impossible progress jumps, provider ordered rows | 4 in 3,208 pairs, all shortcuts confirmed on both sides |
| Impossible progress jumps, research rows on shared streets | 232 |

Replay through the unchanged C core and the same five packages:

| Reason | Research input | Provider input | Provider, 13 stops closed |
|---|---:|---:|---:|
| No trusted position (`RC_ENTRY`) | 512 | 432 | 6 |
| No package for that window (`RC_BYTES`) | 0 | 80 | 456 |
| Outside every stored leg (`RC_OUTSIDE`) | 196 | 196 | 236 |
| Recovery available | 12 | 12 | 12 |

The input now finds the trusted position. On this ride that does not add recoveries yet.
The failures move to their real causes:

- **No package:** the 19.9 km detour (911 m off route) has no package. That needs portals.
- **Outside the legs:** 236 moments, including the 10.1 km detour, which a package seeded from
  this ride still missed. That needs analysis in the portal step.
- **The core's gap rule (line 65)** decides the 426 provider-input moments only while no package
  covers them. Once portals cover the 19.9 km detour, it becomes a real decision.
- 6 ride-start moments stay unavailable by design.

## Gaps

- The replay GPS source is the recording, which stops during auto-pause. Whether the device's
  live GPS also stops is not established.
- No device provider exists. This rule needs the route points; code space is tight.
- A pass ridden twice in the same direction stays unordered.
- A single-pass fix is not checked against the anchor or heading.
- No leg is validated as legal and rideable by a person.

Reproduce: `node tools/recovery_provider_timeline.mjs --input STUDY.json --output NEW_DIR`,
then `python3 tools/recovery_package_replay.py --input NEW_DIR/config.json --bundle BUNDLE --output OUT`.
Private inputs stay in `.local/`.
