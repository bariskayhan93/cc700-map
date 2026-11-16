# Recovery portals: the 10.1 km and 19.9 km detours

Status: host analysis and one host reach test. No firmware or device change. Private inputs stay in `.local/`.

## Answer

- The 19.9 km detour now has a package. Its window is 19.75 to 20.00 km. It holds three legs. It recovers none of its 456 moments. Recoveries stay at 12.
- The 10.1 km detour gets no leg, for two separate reasons:
  - Its road is `track` or `path` with no bicycle tag. The bicycle policy refuses both.
  - Its rejoin lies inside its own window. The target rule never allows a target there.
- Guard and byte limits block more legs in the 19.9 km window. Guards take 87% of the package. 223 distinct guards are stored 3,103 times.
- A shared guard pool saves the most bytes. The estimate is 2.5 to 3.4 times smaller. A tree of legs saves about 7%. The guard pool comes first.
- A reach of 1 km, 2 km or 3 km gives the same packages on this ride.
- Full coverage of a 70 km route needs about 10 MB of packages at today's rule. The device storage partition is 7.99 MB. A selection rule or the guard pool is needed first (see "Sizing").

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
| Tree of legs: each distinct piece stored once | Leg data about 2.6 KB instead of 6.8 KB. Saves about 4 KB, 7% of the package. |

The guard pool is the lever. The tree is second.

## Reach

- Route metres from the window start to the rejoin, per detour on this ride: 0.92 km (0.85 km detour), 0.23 km (8.28 km), 0.18 km (10.1 km), 1.17 km (19.9 km).
- Packages at 1 km, 2 km and 3 km reach have the same portals and the same sizes. The chosen targets lie at 20.4 km, within 1 km of the window start. The reach does not bind on this ride.
- Reducing the reach saves no bytes here. Keep the 3 km limit until a second ride shows a need.
- The reach is set by `config.reachM` (100 m to 3000 m, default 3000 m). The default output is unchanged.

## Blind zone of the target window

A rejoin inside the entry window cannot be a target. The rule admits targets only after the window end. Two of the four detours on this ride rejoin within 250 m of their entry: the 8.28 km and 10.1 km detours. The 8.28 km detour still got 12 recovering frames, on portal 2 of r0033. The 10.1 km detour got none.

## Proposals that need firmware work (none done)

1. **Shared guard pool (format version 2).** Change the guard reads and mount checks in `recovery.c` (lines 46 to 50 and 123 to 125), and the encoder in `recovery_package.mjs` (lines 22 to 28). Estimated saving 2.5 to 3.4 times per package.
2. **Entry-relative targets.** The core checks the target visit against the window end (`recovery.c` line 43). The generator uses the same bound (`recovery_package.mjs` line 53). The core knows the exact trusted entry at run time. A check against that entry would remove the blind zone. Alternative: finer windows, at the cost of more packages.
3. **Per-window reach field** in the reserved header bytes 152 and 156. The core rejects both bytes today (`recovery.c` line 36). Not needed on this ride, because reach does not bind. Defer.
4. **Seed order.** `generateWindow` admits seeds in way-id order (`recovery_package.mjs` line 68). Under the byte limit, that order decides which legs fit. A distance-based order is a host change, but tuning it to one ride would overfit. Defer until the guard pool exists.

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

- Scaled to 70 km (280 windows), this rule needs about 10.3 MB. The device storage partition is 7,987,200 B (`docs/current/device-storage-access.md`).
- A shared guard pool would bring that to about 3.1 to 4.2 MB. The ratio comes from one package, r0079. It is an estimate.
- So packages cannot cover every window of a 70 km route with this rule. The detour feature needs a selection rule, a smaller cap, or the guard pool. This is a decision for the owner.
- Coverage of the detours the ride used is not measured by this build. Only the bytes are measured.

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

- Reach test: add `"reachM": 1000` (or 2000, 3000) to the config before the build.
- Deterministic seeds: remove `track` and `timeline` from the config, and set `"windows": [79]`. For every window, remove `windows` too.
