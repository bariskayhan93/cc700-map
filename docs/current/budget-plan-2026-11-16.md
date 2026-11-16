# Budget plan: what each feature may use

Status: plan. It sets the rules for new features. It does not change the generator or the
firmware. Numbers are measured unless marked as an estimate.

## Goals and the order of priority

1. Stable navigation: route records, turns, captions, guidance state and the installed fixes.
2. The current map features, which are good today: nearby detail, styles and the existing names.
3. Routes up to about 70 km.
4. Optional features, in this order: better street-name positions, landmark names, the
   elevation graph in place of the progress bar, and the detour (way back).

A lower item never takes a resource from a higher item. If an optional feature does not fit,
it is left out for that block or route, and the report says so.

## Rules

1. **Separate limits.** Each limit below is checked on its own. Spare bytes do not pay for
   projection work, and spare storage does not pay for code space.
2. **Every feature declares its cost** in each limit it touches, before it is built.
3. **Headroom comes from evidence, not from a fixed percentage.** Until the device is
   measured, the current working limits stay as they are (they are conservative targets, not
   hardware maxima). No feature may raise a working limit from an offline result.
4. **Protected content goes in first.** Optional content fills what is left, in priority order,
   and stops at the first limit it reaches.
5. **Unavailable is a valid answer.** A feature that does not fit shows nothing. It never
   shows a guess.
6. **A route has a size budget, not only each block.** Today the budgets work per map block,
   and only the 4 MB app guard limits a whole route. On a long route the generator must first
   reduce optional outer context, then optional features, and never the protected content.

## The ledger

| Limit | Value today | Measured use | Protected | Room for optional features |
|---|---:|---|---|---|
| Map block, serialized | 65,536 B | 56,160 to 62,075 B in the measured blocks (86 to 95%) | Nearby detail and route records | Little in dense blocks; more in villages and forest |
| Projection calls per block | 1,400 | up to 1,374 in the busiest city block (98%) | Nearby detail | **None in dense city blocks.** This is the binding limit |
| Projected points per block | 7,000 | 5,989 to 6,338 in the measured blocks | Nearby detail | Little |
| Names per block | 12 names, 384 B packed | 12 of 12 in the measured blocks | The names in use today | **No new names; only better choice and placement** |
| Turn caption | 63 B UTF-8 | per turn | Turn text | Shared with "gravel ahead" style hints |
| Route file | 4,000,000 B app guard | 792 KB for 22.6 km (35 KB/km); 308 KB for the 4.2 km city commute (74 KB/km). Map data is 85 to 91% of each file | Navigation and map | 70 km: about 2.4 MB at 35 KB/km, about 5.2 MB at 74 KB/km (estimates). These files predate the adaptive budget, which made one dense file 1.75 times larger (about 125 KB/km). A realistic 70 km ride has city only at the start and end: about 2.8 to 3.4 MB by estimate, so 0.6 to 1.2 MB under the guard |
| Device storage | 7,987,200 B partition | 5.6 MB free in the 15 Nov saved image (7.2 MB on 12 Nov), falling about 0.5 MB a day | Rides, logs, routes | Live read-only check still needed |
| Patch code space | 6,144 B free after cc23 | — | One future stability fix: keep at least **1,768 B**, the size of the largest fix so far (cc23) | **About 4,376 B** |
| Worker stack | 4,096 B | 2,944 B free at the loop retry, against a 3,072 B guard | Loop start, guidance | **None**: the guard already fails there |
| Screen | 240 × 320, map 240 × 256 | The progress bar is a thin strip under the map | Map, turn card, data fields | The progress-bar strip only |
| Drawing time | — | **Not measured**; cc24 crashed while drawing lines | Map drawing | Unknown until the cc24 cause and a timing capture |

The code-space reserve is not a percentage. It is the size of the largest stability fix shipped
so far, so that the next fix of that kind still fits.

## What each goal costs, and whether it fits

| Goal | Limits it touches | Fits? |
|---|---|---|
| 70 km routes | Route file, device storage | Yes for a realistic ride (city only at the start and end): about 2.8 to 3.4 MB by estimate. The offline 70 km probe is synthetic (about 100 KB) and does not show real map size. Measure one real 70 km route on the host, and check the free space on the device. |
| Better street-name positions | Names per block, drawing time | Yes, if the generator chooses which 12 names and where. No new names, no rotated text. |
| Landmark names | Names per block | Yes, but only by **replacing** a lower-value name in the same block. A rule must rank them. |
| Elevation graph in the progress bar | Code space, screen, drawing time, a little route data (448 B per profile) | Likely within the 4,376 B, if the drawing code stays small. Waits for the cc24 cause and a mined hook for the stock bar. |
| Detour | Device storage, code space, stack, drawing time | **Not yet.** The core alone needs 5,546 B, more than the 4,376 B room. A 70 km route at today's rate needs about 4 MB of packages. Needs a smaller core or a second code area, a per-window reach and a storage budget per route. |

## Measurements that close the unknowns

| Unknown | How | Device? |
|---|---|---|
| Free device storage | Read-only storage read; count free blocks offline | Yes, read only, about 15 minutes |
| Drawing time per block | Timing capture with the measurement collector (work package 2) | Yes, after the cc24 cause |
| Code size of the elevation drawing | Build it on the host and measure | No |
| A second code area | Read the image layout offline | No |
| Package storage for a 70 km route | Generate packages for a 70 km test route on the host | No |

## Order of work

1. Detour portals and coverage on the host, sized for 70 km, with a per-window reach.
2. Street names and landmarks: generator ranking and placement, inside 12 names per block.
3. cc24 crash cause, offline from the saved core file.
4. Code space: the elevation drawing size and a search for a second code area.
5. Firmware, one feature per candidate, each with a named hypothesis and one bounded device test.

Sources: `research/adaptive-map-budget-2026-11-14.md`, `reports/map-evaluation-report-2026-11-15.md`,
`current/map-limits.md`, `mining/map-budget-observation.json`, `research/recovery-package-2026-11-15.md`,
`research/elevation-study-2026-11-15.md` and the cc22/cc23 build records.
