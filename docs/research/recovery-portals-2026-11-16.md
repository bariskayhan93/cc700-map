# Recovery portals: the 10.1 km and 19.9 km detours

Status: host analysis. No firmware or device change. Private inputs stay in `.local/`.

## Corrections, 16 Nov (supersede the sections below)

- The 3.1 times saving of the guard table is withdrawn. The saved estimate (1.06 MB) kept the v1 legs. The real v2 build admits 620 portals (v1: 394) and totals 2.80 MB against 3.31 MB. The saving is 15.5%. Build: `.local/eq/new-detall`.
- The leg seed radius does not change the bytes. Builds at 3, 2 and 1 km give the same 91 SHA-256 values, because the builder keeps the 8 nearest source segments per window. This covers legs only. The painted map reach was not costed, so this result does not decide reach.
- 70 km budget (`.local/eq/budget-70km.txt`): packages 8.62 MB at 123 KB/km, route file 2.52 MB at 36 KB/km, total 11.14 MB. Free device storage is 5.58 MB. The largest route that fits is about 35 km.
- The route-file upper bound of 5.2 MB for 70 km is wrong. At the city density of 143 KB/km, a 70 km route file is 10.0 MB.
- Combined 1, 2 and 3 km table (`.local/eq/combined-table-70km.txt`): the three rows are identical. Legs are 8.62 MB for 70 km at every reach, because the builder ignores the reach. The painted map is 2.13 MB for 70 km at every reach, because the class range table `SR` in `js/mapsec.js` caps main roads at 1000 m. Measured on the TourD3 proxy route: 500 m gives 528,384 B, 1000 m gives 1,212,416 B, and 1500, 2000 and 3000 m give the same result as 1000 m.
- Route base without map: 0.38 MB for 70 km. Total 11.14 MB against 5.58 MB free. The largest route that fits is 35.1 km.
- Not measured: a seed count below 8, or a per-route package cap.

## Coverage finding, 16 Nov (supersedes the size tables as the main result)

- **The full-route build recovers nothing on the recorded ride.** Replay of `.local/eq/new-detall` (91 packages, 2.80 MB): 0 recovering frames of 809 off-route frames. The 12 recovering frames come only from the ride-seeded bundle (5 packages, 31,180 B). That bundle uses the detour samples of the ride itself. A build made before a ride cannot use them.
- **Cause, measured** (`tools/recovery_outside_audit.mjs`, result in `.local/eq/outside-audit-detall.json`): of the 276 "outside legs" frames, 171 have no leg within 15 m, and 105 have a package with no legs. The other off-route frames are 432 "no trusted position" and 101 "paused". The eight seeds per window lie next to the route. The streets that the rider used are not stored.
- **The trusted-position rule is not the cause.** With the recorded stops shortened (`.local/eq/nogap.json`, a what-if), "no trusted position" falls from 432 to 6, and recovering stays 0. "Outside legs" rises to 602: 457 have no leg within 15 m, and 145 have a package with no legs (`.local/eq/outside-audit-nogap-detall.json`).
- **Distance from the route** in the 809 off-route frames: median 185 m, 90th percentile 740 m, maximum 912 m. There are six episodes. Their maxima are 29, 136, 65, 185, 912 and 240 m. This is one ride.
- **No-leg pointer, aim check** (`.local/eq/pointer-check.mjs`, private, output in `.local/eq/pointer-check.txt`). Two aims were compared. Aim A is the nearest route point by position. Aim B is the nearest route point at or after the last on-route progress, up to 3 km ahead. Aim A lies behind the entry in 93 of 809 frames. Five episodes (697 frames) have a recorded rejoin. In those, aim A lies between the entry and the rejoin in 673 frames, behind the entry in 21, and past the rejoin in 3. Aim B cannot lie behind the entry, by construction. Aim B is not past the rejoin in 697 of 697 frames, and is at most 38 m farther than aim A. The last episode (112 frames) ends with the recording, so it has no rejoin, and the rejoin test is not possible there. The progress comes from the host provider, not from the device matcher. No code size, no device run.
- **Street tree prototype** (host only, private scripts `.local/eq/tree-proto.mjs` and `.local/eq/tree-forward.mjs`; no format, no device code). Each street node stores the next node on the shortest way to the route. Bytes use an assumed layout of 10 B for each node and 4 B for each segment. Reach is ride distance, not straight distance.
  - One tree for the full route, strict bicycle policy: 10.6 KB/km at 1,500 m (0.72 MB for 70 km), 23.6 KB/km at 3,000 m, 36.1 KB/km at 4,500 m. It matches a stored street within 15 m in 636 of 809 off-route frames. In 257 of those, the shortest way ends behind the entry.
  - One forward tree for each route kilometre (goals from the chunk start to 4 km ahead), strict policy: 32.8 KB/km at 1,500 m (2.24 MB for 70 km), 132.7 KB/km at 3,000 m. It matches 636 of 809 frames, with 0 behind the entry and 0 past the rejoin in the testable frames.
  - With `track` and `path` ways admitted without a bicycle tag, both variants match 809 of 809 frames, and the bytes are about 1.7 to 1.8 times larger. Their bicycle access is not proven.
  - Not measured: core code size, device time for the street search, turn restrictions in the tree, parallel-street errors, a second ride.
- **Route file rate.** The TourD3 proxy at today's generator is 1,212,416 B for 21.15 km (57 KB/km). At that rate a 70 km route file is about 4.0 MB, at the 4,000,000 B app guard. The device file is 36 KB/km. The rate of today's generator on the real route is not measured, because its GPX is not identified.

## Decision (simplest path)

- Keep the current package format and the current bicycle policy. No format change now.
- A leg never uses a way without bicycle access. If the rider goes onto such a way, the core reports unavailable and ordinary guidance continues. The replay ran 4035 fixes, including 262 such moments, with no error.
- Not pursued now: shared piece layout, guard table, reach field, seed ordering, entry-relative targets. Each would add a format or firmware change for a detour that does not fit yet.
- Open decision: how packages are limited per route. See "Sizing".

## Answer

- The 19.9 km detour now has a package. Its window is 19.75 to 20.00 km. It holds three legs. It recovers none of its 456 moments. Recoveries stay at 12.
- The 10.1 km detour gets no leg, for two separate reasons:
  - Its road is `track` or `path` with no bicycle tag. The bicycle policy refuses both.
  - Its rejoin lies inside its own window. The target rule never allows a target there.
- Guard and byte limits block more legs in the 19.9 km window. Guards take 87% of the package. 223 distinct guards are stored 3,103 times.
- Sharing street pieces across legs saves the most bytes. Estimate: about 0.25 MB instead of 3.3 MB for the 22.56 km route, with the same legs and coverage. The earlier tree estimate counted leg data only, and understated the saving.
- A reach of 1 km, 2 km or 3 km gives the same packages on this ride.
- Full coverage of a 70 km route needs about 10 MB of packages at today's rule. The device storage partition is 7.99 MB. The open decision is a per-route size rule (see "Sizing").

## Replay of the window-79 package

The C core replays the provider timeline of the 22.56 km ride.

| Run | No trusted position (4) | No package (12) | Outside legs (6) | Paused (10) | Recovering (2) |
|---|---:|---:|---:|---:|---:|
| Old packages, provider input | 432 | 80 | 196 | 87 | 12 |
| New packages (v4), provider input | 432 | 0 | 262 | 101 | 12 |
| Window-79 package only, deterministic seeds | 432 | 297 | 66 | 14 | 0 |
| New packages, recorded stops shortened | 6 | 0 | 585 | 201 | 12 |

- The "stops shortened" run is a what-if. Each recorded gap longer than 5 s becomes 1 s. Later timestamps move earlier by the same amount. The GPS behaviour during a real pause is still unknown.
- The deterministic run has no packages for the other windows. Its recoveries are zero for that reason.

## Outside moments by package (new packages, provider input)

| Package (window) | Moments | Cause |
|---|---:|---|
| r0003 (0.85 km) | 88 | No seeds. All three detour samples have ambiguous source matches. |
| r0033 (8.28 km) | 3 | Two moments face against a leg. One moment is aligned within 15 m but outside. |
| r0040 (10.1 km) | 37 | No admitted leg. See below. |
| r0079 (19.9 km) | 66 | All face against a leg. |
| r0087 (21.8 km) | 68 | No leg. All eight candidates fail the 64-guard limit. |

"Face against a leg" means the rider is within 5 m of a leg piece, and heading opposite to it. The rider's direction is the missing one. The one aligned moment is probably the first-2 m rule in `firmware/recovery/recovery.c` line 103. This is not checked.

## Why the 10.1 km detour has no leg

The detour runs from 10.01 km to 10.18 km of route progress. Its ways are `track` and `path`, with no bicycle tag.

1. **Road policy.** `conservativeWayPolicy` (`tools/recovery_study.mjs`) refuses both (`highway-needs-explicit-bicycle-access`). Its window seeds lie on these ways. All four directed candidates fail as `direction-not-admitted`.
2. **Target window.** The trusted entry is at 10.01 km. The rider rejoins at 10.18 km, 167 m later. The window is 10.00 to 10.25 km. A leg target must lie after 10.275 km (window end plus 25 m, `recovery_package.mjs` line 53). No leg can end at this rejoin. Nine route visits on admitted ways lie in the forward zone. The window rule, not the lack of targets, blocks this rejoin.

## Why the 19.9 km detour has few legs

- The trusted entry is at 19.94 km. The window is 19.75 to 20.00 km. The rider rejoins at 20.92 km.
- Seeds: 17 detour samples. Nine give ambiguous source matches between parallel ways. Eight seeds remain.
- Candidates: 16 directed, eight seeds in two directions. Three are admitted, all in the reverse direction. Nine fail `guard-count-limit` (more than 64 guards within 35 m of one piece). Four fail `package-admission` (the 64 KB package is full).
- The rider's direction is the missing one. Every rejected candidate failed one of those two limits.
- A deterministic seed set (eight segments nearest the window's route point, no ride data) gives four legs and 63.5 KB. Those legs lie near the route, not on the detour. Its outside count for this window stays at 66.
- The entry rule does not block this detour. Three recorded stops (83 s in total) clear the trusted entry. So 376 of the 456 moments read "no trusted position" (`recovery.c` line 65). When the stops are shortened, the entry holds. The total outside count then rises from 262 to 585. Legs, not the gap rule, block recovery. Line 65 stays as it is until legs cover the detour. The owner decides the change then.

## Where the bytes go

| Package | Bytes | Guard share | Guard records | Distinct guards | Leg data | Distinct metres / summed metres |
|---|---:|---:|---:|---:|---:|---:|
| r0033 (new) | 6,120 | 81% | 308 | 52 | 904 B | 570 / 687 |
| r0079 (new) | 56,792 | 87% | 3,103 | 223 | 6,792 B | 1,929 / 4,957 |
| r0069 (old, 17.25 km entry) | 64,152 | 85% | 3,398 | 164 | 9,112 B | 1,840 / 7,263 |

- "Distinct metres" counts each street piece once, whatever its direction. "Summed metres" adds every leg's length.
- The old window-69 package came from a research entry at 17.25 km. The provider gives the entry at 19.94 km, so the window is 79. The old package is not used.
- Bytes per distinct metre: r0079 29.4 B/m. r0033 10.7 B/m.

Estimates. No format exists for these.

| Change | Result for r0079 |
|---|---|
| Shared guard pool, 16-byte entry per distinct guard, 2-byte index per guard record | 16.9 KB, 3.4 times smaller |
| Same, 4-byte index | 23.1 KB, 2.5 times smaller |
| Shared pieces, route-wide: each distinct piece and its guards stored once | Route about 0.25 MB instead of 3.3 MB, 13 times smaller (estimate). Legs and coverage unchanged. |

Sharing pieces is the lever. A guard table alone saves less. Splitting legs alone saves nothing, because the same pieces and guards are still stored again.

## Reach

- Route metres from the window start to the rejoin, per detour on this ride: 0.92 km (0.85 km detour), 0.23 km (8.28 km), 0.18 km (10.1 km), 1.17 km (19.9 km).
- A test at 1 km, 2 km and 3 km reach gave the same packages. The chosen targets lie within 1 km of the window start. The reach does not bind on this ride. The test option was removed. The 3 km limit stays.

## Blind zone of the target window

A rejoin inside the entry window cannot be a target. The rule admits targets only after the window end. Two of the four detours on this ride rejoin within 250 m of their entry: the 8.28 km and 10.1 km detours. The 8.28 km detour still got 12 recovering frames, on portal 2 of r0033. The 10.1 km detour got none.

## Options not pursued (each needs a firmware or format change)

1. **Shared piece layout.** Estimated 13 times smaller, same legs and coverage. Legs become lists of piece IDs. Changes the leg format and the read path in `recovery.c` (lines 46 to 50 and 123 to 125).
2. **Entry-relative targets.** Removes the blind zone. Changes the target check in `recovery.c` line 43 and `recovery_package.mjs` line 53.
3. **Seed order.** Under the byte limit, the way-id order decides which legs fit (`recovery_package.mjs` line 68). Tuning this to one ride would overfit.

Revisit these only if the detour is pursued after the names and elevation work.

## Sizing for a 70 km ride

A deterministic build covers every 250 m window of the 22.56 km route. Each window takes the eight segments nearest its route point. The build uses no ride data.

| Result | Value |
|---|---:|
| Windows | 91 |
| Windows with legs | 75 |
| Total package bytes | 3,313,328 B (3.31 MB) |
| Median package | 43,264 B |
| Packages at the 64 KB cap | 2 |
| Bytes per route kilometre | 147 KB |
| Portals, source edges | 394, 728 |
| Rejections | direction-not-admitted 288; source-edge-too-short 306; unreachable 120; package-admission 290; guard-count-limit 35; work-limit 7; no-associated-admitted-forward-visit 10; no-forward-window 6 |

- Simplest rule for the open decision: a route gets packages only if their total size fits the free space the device reports. Otherwise the route gets none, and the detour is unavailable on it. Saved images show 5.6 MB free on 15 Nov, falling about 0.5 MB a day (`firmware-mining-2026-11-16.md`).
- A 22.56 km route needs about 3.3 MB. A 70 km route needs about 10.3 MB.
- Scaled to 70 km (280 windows), this rule needs about 10.3 MB. The device storage partition is 7,987,200 B (`docs/current/device-storage-access.md`).
- A shared guard pool would bring that to about 3.1 to 4.2 MB. The ratio comes from one package, r0079. It is an estimate.
- So packages cannot cover every window of a 70 km route with this rule. The detour feature needs a selection rule, a smaller cap, or the guard pool. This is a decision for the owner.
- Coverage of the detours the ride used is not measured by this build. Only the bytes are measured.

## Cost table (full-route build, 91 windows, 3.31 MB)

Estimates from a host script on the build. The script is not committed.

| Cost | Size | Why | Lever | Saving (estimate) | Price |
|---|---:|---|---|---:|---|
| Guard lists | 2.9 MB (87%) | Each 50 m piece lists the streets within 35 m. Median 9 per piece, p90 25. 180,454 records, 4,217 distinct. | Route-wide guard table with a 2-byte index | about 2.5 MB | Format and firmware change |
| Long legs | 3.7 km of legs per 250 m window | Median leg 484 m, p90 2.4 km, longest 5.2 km | Cap leg path at 3 km | 0.64 MB (19%) | Cuts the 3 km reach for 22 of 394 legs |
| Long legs, 4 km cap | as above | as above | Cap leg path at 4 km | 0.23 MB (7%) | 6 of 394 legs |

Correction: an earlier draft proposed a 2 km cap. It saves 34%, but it removes legs that reach the 3 km target along the route. A leg path can be 4 to 5 km long, even when its end lies within 3 km along the route. The 3 km target stays. The leg cap is not recommended.
| Window spacing | 91 windows of 250 m | One package per window | 500 m windows | about half | Rejoins within 500 m of the entry cannot be targets |
| Seeds | 8 per window | Fixed in the build | Fewer seeds | about proportional | Fewer legs to choose from |
| Visit spacing 100 m | none | One target per leg, stored as 4 bytes | none | 0 | none |

For 70 km (today's rule scaled, about 10.3 MB):
- Route-wide guard table: about 2.7 MB. Fits the 7.99 MB partition.
- No leg cap: about 10.3 MB. Does not fit.

The guard table is the only lever that makes 70 km fit. It needs a firmware change. Without it, detours fit only on short routes.

## Gaps

- One ride. The thresholds (15 m, 45°, 5 m, 3 km, 250 m windows) stay as they are.
- Legality: no leg is validated as legal or rideable. `track` and `path` ways without a bicycle tag are not admitted. Their use by bicycle is unknown.
- The 35 m guard radius and the 64-guard limit are not studied.
- The stops-shortened run is a what-if. Live GPS behaviour during a real pause is unknown.
- No device run. No firmware change.

## Reproduce

```sh
node tools/recovery_package_build.mjs --input .local/recovery-provider-v4-20261116/config.json --output .local/recovery-package-v4-20261116
python3 tools/recovery_package_replay.py --input .local/recovery-provider-v4-20261116/config.json --bundle .local/recovery-package-v4-20261116 --output NEW_REPLAY
node tools/recovery_outside_audit.mjs .local/recovery-provider-v4-20261116/config.json .local/recovery-package-v4-20261116 NEW_REPLAY
node tools/recovery_package_audit.mjs .local/recovery-package-v4-20261116
node --test tools/test_recovery_package_audit.mjs tools/test_recovery_outside_audit.mjs
```

- Deterministic seeds: remove `track` and `timeline` from the config, and set `"windows": [79]`. For every window, remove `windows` too.
