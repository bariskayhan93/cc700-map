# Turn-aware recovery: measured result and next decision

This PC implementation replaces unnecessarily broad exclusions with local
barrier cuts and incoming-edge turn rules. It does **not** yet produce useful
recovery on the saved ride: the same **one of 30** retrospective scenarios has a
candidate. This result narrows the next task to road association and regional
cycling access; spending another firmware cycle on stationary display would
not address this measured bottleneck. Device, route files, app and production
budgets were untouched.

```mermaid
flowchart LR
    S[Original snapshot: integrity passes] --> B[Cut uncertain barrier connections locally]
    B --> T[Apply supported turns using arrival direction]
    T --> A[Existing conservative cycling access]
    A --> Q[Bounded candidate search]
    Q --> R[1 candidate in 30 retrospective scenarios]
    R --> N[Next: road association and access evidence]
```

## Implemented behaviour

The [compiler](../../tools/recovery_transitions.mjs) retains primary original roads.
An uncertain barrier cuts its incident edges, preserving usable segments farther
along the same road. A small set of conventional barriers can pass only with
explicit bicycle admission. Denied and conditional node access also blocks
connections even when there is no barrier tag. Explicit access tags do not prove
physical width, usability with a particular bicycle, or current conditions.

Supported restrictions have one from-way, one via-node and one to-way. The search
remembers the incoming directed edge, so a forbidden arrival does not erase a
longer permitted arrival at the same junction. Same-way U-turns distinguish
reversal from continuation. Explicit bicycle restrictions take priority over a
general bicycle exception. This follows the structural model described in the
[OSM restriction documentation](https://wiki.openstreetmap.org/wiki/Relation:restriction).

Conditional/time-dependent, via-way, malformed, repeated-via and otherwise
unsupported relations retain conservative member-way/node quarantine. A
restricted origin with unknown incoming direction is unavailable. Immediate
same-edge reversal is conservatively unavailable except an explicit supported
`only_u_turn`; this can exclude usable recoveries and is not a legal prohibition.
Target arrival still does not validate continuing onto the recorded route.

Search limits remain 4,096 settled **states**, 32,768 examined outgoing edges,
8,192 queued entries, 2,048 path points and 15 km path distance. In transition
mode a state is an arrival edge, not just a physical node. Every limit failure
returns unavailable without a partial path. These are bounded PC study policies,
not measured device capacity.

## Same inputs, separate policy comparison

| Measurement | Previous quarantine | Transition-aware |
|---|---:|---:|
| Original-node graph vertices | 74,019 | 86,502 |
| Directed edges | 137,531 | 162,026 |
| Actual graph JSON bytes | 15,704,430 | 18,949,398 |
| Candidate trials / sampled trials | 1 / 30 | 1 / 30 |
| Origin association absent from graph | 8 | 8 |
| No original origin node within 25 m | 1 | 1 |
| Target association absent from graph | 15 | 15 |
| No observed forward rejoin | 5 | 5 |

Of 799 restrictions, 733 compile to via-node rules, 36 are not applicable to
bicycles, and 30 remain quarantined. Only 72 primary/member ways are excluded by
unsupported restrictions; unknown barriers and node access are cut locally.
No merge issues occur. Graph JSON includes audit information and is a PC evidence
format, not the proposed device graph codec.

The surviving candidate is about 110.29 m with three geometry points. Its new
search settles 13 arrival states, examines 26 outgoing edges, and peaks at four
queue entries. This tiny case is not representative of city/forest recovery or
3 km search cost. Validated cycling paths remain **zero**.

The old whole-way policy had overlapping barrier/restriction and access reasons.
After local handling, every graph-absent association is incident to classes
requiring explicit bicycle admission under the unchanged policy: eight unique
origin associations and two unique target associations. An incident-way audit
finds `path`, `track`, `footway`, and even `steps` among these associations.
Some paths have compacted/gravel surfaces, but a surface alone is not bicycle
permission. A nearest **node** may also belong to the wrong nearby feature;
choosing an admitted nearby node instead would conceal that uncertainty.

This changes the next priority: jointly evaluate road-segment association and a
source-backed regional access profile. Audit ordered route connections and
ambiguous parallel paths rather than first widening defaults. Excluded footways
or steps must not become cycling directions merely because the rider passed
near them. Conditional or unsupported cases remain unavailable.

## Representation measurement, without a device claim

A [proposed study packet](../../tools/recovery_leg_packet.mjs) actually serializes
candidate geometry: 20-byte header plus eight bytes per absolute E7 lat/lon pair.
The header identifies version, point count, target visit, path distance in cm,
and an always-set unvalidated-candidate bit. This is **not** a native route-file
extension and no firmware reads it.

The surviving leg serializes to **44 bytes**, compared with **733 bytes** for
its full trial JSON. At the 2,048-point study cap a single packet is 16,404 bytes.
Neither figure includes origin/route association indices, spatial coverage
lookup, activation policy, transport framing, decoded device ownership, map
transition overlap, projection or raster work. These must be measured before
choosing a deployment representation. The larger 18.95 MB audit graph and this
one short packet cannot settle that choice.

## Evidence boundaries and fallback

The study reuses the same snapshot and 4,035-fix ride. All 30 deviations are below
1 km; the unchanged cumulative 1/2/3 km tables do not validate 2–3 km recovery.
Twenty-five scenarios span recording gaps, and destinations use later observed
rejoins. This is a retrospective reference, not a live target selector. Geometric
GPS-to-road and road-to-route connectors remain unvalidated. The source timestamp
postdates the ride. See the [previous source report](regional-recovery-replay-2026-11-15.md).

Normal result: labelled PC candidate or explicit unavailable. Admission: intact
source, supported transitions and bounded search. Uncertain source/access/state
or resource exhaustion: unavailable, never invented guidance. Restoration: no
device state was changed; ordinary navigation remains as before. Production
activation/rejoin restoration still belongs to the later runtime design.

## Reproduce

Set `"mode": "transitions"` in the existing study JSON (keys `snapshot`, `track`,
`timeline`) and use a fresh output directory. Omit mode for the prior policy.

```sh
node tools/recovery_ride_study.mjs --input STUDY.json --output NEW_DIRECTORY
node --test tools/test_recovery_transitions.mjs tools/test_recovery_leg_packet.mjs tools/test_recovery_ride_study.mjs tools/test_recovery_study.mjs tools/test_routing_snapshot.mjs
```

Outputs include summary, private trial/graph evidence and `study-legs.bin`. Do not
publish these private outputs: IDs and geometry can locate the ride. The
[sanitized aggregate](../mining/recovery-transitions-20261115.json) publishes counts,
input/code hashes and explicit gaps. Default conservative mode is retained for
comparison. Validation/review results are recorded below after the final check.

## Verification and review

51 focused Node tests pass, including an integrated ride/snapshot fixture,
barrier segments, node access, no/only turns, same-way reversal, alternate arrival
states, conservative fallback, packet bounds and the old source/snapshot tests.
Independent review found one Important issue: an unimplemented scoped
`restriction:*` key could hide behind a recognized generic rule. A failing
fixture reproduced it; such combinations now quarantine, including bicycle
exception/override combinations. The complete focused suite passes after that
single fix pass. Replaying the private source afterward reproduces the entire
aggregate summary exactly. No further device validation is inferred.

Deferred minor: missing-association cause aggregation uses excluded ways; local
blocked-node causes are retained in private `graph.json` but not yet added to
that aggregate. This does not change search eligibility or this replay's result.
Legal cycling, physical passability, source completeness, live association and
target costs remain explicit unvalidated boundaries, not review acceptance.
