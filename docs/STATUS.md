# CC700 status

Updated 17 Nov 2026. Times are local (UTC+1) unless marked UTC. The Codex records use UTC.

## Summary

- The device runs a **way-back test image** since 17 Nov, 00:30: cc23 with the loop-start trampoline fix (2 bytes) and the way-back adapter (`firmware/wayback/README.md`). It shows test codes on the map. No ride result exists yet. The restore step writes cc23 with the trampoline fix.
- Before that, the device ran **cc23**. A read-only check on 16 Nov matched the install record exactly.
- cc23 has a known gap. After a restart, a stationary route still shows grey. The fix is not verified.
- **cc24 is not installed.** A diagnostic build was rejected after a map-view restart. Its cause is not established.
- Recovery (routing back to the route from up to 3 km away) is host research only. It is not on the device.
- The map patch sources for v18 to v21 are under version control, and each version rebuilds exactly.

## Device (checked today, read-only)

The check used the USB port and wrote nothing.

- `otadata` (flash `0xd000`, 8,192 bytes): SHA-256 starts `a1ed1496`. This matches the cc23 install record.
- `ota_1` (flash `0x440000`, 3,752,784 bytes): SHA-256 starts `6146fb25`. This matches the cc23 candidate.
- After a reset, the boot log reports `Loaded app from partition at offset 0x440000`.

This proves the installed image and the boot slot. It does not prove navigation behaviour on the road.

## Firmware chain

```
stock V1.414 (ota_0, never written)
  -> v21 map patch            (sources: private repo, tag patch-v21)
  -> cc22                     (guidance changes on v21)
  -> cc23                     (loop departure fix on cc22)   <- installed
```

- v18 to v21 rebuild exactly from the private repository `cc700-patch`.
- **cc22 rebuilds byte for byte** from the v21 image with `tools/guidance_build.py`.
- **cc23 rebuilds byte for byte** from the cc22 image with `tools/loop_start_build.py` at commit `1c1fa45`. The current HEAD builds the withheld cc24 candidate instead. Use commit `1c1fa45` for cc23.
- The base images stay in `.local/` and are not in git. Their pinned hashes are in `cc700-patch/builds/chain.json`.
- The mechanism is explained in `cc700-patch/docs/PATCH_MECHANISM.md`.

## cc23: known gaps

- **Stationary departure fails.** After the install, the owner reopened a 22.56 km loop and still saw a grey route while stationary. The route file was not regenerated. The notes say this acceptance **failed, not resolved** (`releases/loop-and-turn-fixes-2026-11-15.md`).
- **Worker stack limit.** A loop correction worked once. A later safety guard skipped it. The worker had 2,944 bytes free. The guard needs 3,072 bytes (`releases/loop-and-turn-fixes-2026-11-15.md`).

## cc24: not installed

- A diagnostic cc24 build was installed for a short test. Opening the map view restarted the device. The runner restored cc23 and verified it.
- The backtrace runs `cc_gate`, `cc_iter`, `draw_entry`, `cc_line`, then the native canvas-line routine. This shows where the code was running. It does not show the cause.
- Open: a bad pointer, a stack overflow, or the candidate's memory use. None is established.
- An earlier summary from 15 Nov said the cause is known and that a cc25 build exists. It was removed from this repository because the records do not support either claim. Do not use any copy of it for decisions.

## Unexplained device files

`core.elf` and `coredump-partition.bin` in `.local/navigation-phase/loop-diagnostic-24/session-02/` were written at 22:05 local on 15 Nov. The owner states that a GLM session may have made these changes. They are not device evidence. Do not use them to explain the cc24 crash.

## Recovery (research)

- Host only. The C core and the package format exist. Nothing is on the device.
- In the replay, 12 of 809 off-route frames get a recovery candidate. Those packages were seeded from the ride itself. A full-route build made without ride data (2.80 MB) gets 0 of 809 (`research/recovery-portals-2026-11-16.md`, "Coverage finding").
- The 512 "no trusted position" moments came from streets the loop uses twice (456), recording gaps (50) and the ride start (6).
- A host rule now finds the trusted position (`research/recovery-ordered-input-2026-11-16.md`). The failures then move to their real causes: no package for the 19.9 km detour (456 moments with stops closed) and positions outside the stored legs (236). Recoveries stay at 12 until portals cover those places.
- Portals (host): the 19.9 km window has three legs, and none covers the detour. The limits are the rejoin window, the road policy, the 64-guard limit and the 64 KB package. Guards take 87% of the bytes. Details: `research/recovery-portals-2026-11-16.md`.
- Details: `research/recovery-*.md`.

## Navigation

- While off route, the remaining distance shows `--`. Version 20 and 21 keep this behaviour (`reports/project-status-2026-11-14.md`).
- Noisy GPS turns and sparse tracks still fail some cases. The fixes are labelled and do not repair every recording (`releases/loop-and-turn-fixes-2026-11-15.md`).

## Validation (offline, 16 Nov)

Command: `python3 -I tools/validate_local.py`. Exit 2 means known gaps remain.

- Python: 188 tests pass, 5 skipped because private inputs are missing.
- Node and offline app: pass.
- Historical route checks: 10 pass, 2 known failures.
- Ride proxy: pass.
- Not covered: device frame and heap budgets, live reroute, real GNSS and heading, native replay timing.

## Repositories

- `cc700-map` (this repo, public): code, the web app, and documentation. No binaries.
- `cc700-patch` (private): patch sources by tag, build recipes, build records, and device readback hashes.
- `cc700-backup` (private, local only): full flash dump, storage copies, and older tools. Some tools still read it.

## Next steps

These need the owner's approval before any device action.

1. Confirm with the owner that the 22:05 files came from a GLM session, or find their source.
2. Choose the next device test. Name its hypothesis first (`AGENTS.md`).
3. Decide whether to keep the cc22 and cc23 base images under version control (privately). The build tools are already in git.

## Offline cc28g baseline, 20 Nov 2026

The cc28g image rebuilt byte for byte. The linked code used 17,564 of 18,404 B. The margin was 840 B. The largest function frame was 512 B. The code reserve was 1,768 B. Run `python3 -I -B tools/cc27_build.py --output .local/codex/phase-3-build`. Apply the two pinned local build steps described in the Phase 1 report. The final SHA-256 was `cc1a3fe2cd97053d940fdd2abde9ab322d6f31424ce99de7c302a68d3e01062c`.

Run `NODE_OPTIONS=--require=./.local/codex/phase-2-runs/deny-network.cjs node .local/codex/phase-3-budget.mjs`. The release gate passed for each row. The replay used the saved response for the selected reach and the native part of the saved route. The rebuilt file and section sizes matched the saved sizes. A and B are the two home files. N2b is the replacement for N2.

| Route | Reach (km) | Way-back (B) | Grey (B) | File (B) | Distinct blocks |
|---|---:|---:|---:|---:|---:|
| A | 1 | 52,796 | 8,520 | 114,688 | 2 |
| B | 2 | 196,492 | 47,509 | 360,448 | 4 |
| N1 | 3 | 663,488 | 158,416 | 1,208,320 | 14 |
| N2 | 3 | 297,296 | 77,537 | 458,752 | 3 |
| N2b | 3 | 266,456 | 69,530 | 364,544 | 1 |
| N3 | 3 | 312,756 | 81,909 | 442,368 | 2 |
| N4 | 3 | 415,636 | 100,668 | 610,304 | 4 |
| C2 | 2 | 944,740 | 225,057 | 2,748,416 | 75 |

Run `stat -f "%N %z" .local/cc27-{home,north,pack}/*.bin` and exclude the firmware image. Additional saved route sizes in bytes follow.

A0 106,496, A6 114,688, A7 114,688, A8 114,688, A9 114,688, S1 4,096, S2 4,096.
C1 606,208, C3 249,856, C4 229,376, C5 249,856.

Run `stat -f "%N %z" .local/cc27-north/*/*.bin` for the earlier saved files.
line1k-20261120 — N1 671,744 B, N2 180,224 B, N3 135,168 B, N4 188,416 B.
n2-old-20261120 — N2 458,752 B.

Run `PIX=1 node .local/grey-measure/measure.mjs` with the same network block. The counts give detail street pixels under grey for the current selection and the two experimental selections. The home view uses N1. The N2 view uses N2b.

| View | Current (px) | 10 m selection (px) | 5 m selection (px) |
|---|---:|---:|---:|
| home | 169 | 647 | 647 |
| N2 | 291 | 1734 | 1961 |
| N3 | 132 | 1358 | 1396 |
| N4 | 672 | 3958 | 4041 |

Run `node .local/codex/phase-3-render.mjs` with the host compiled from the current tree. Build it with `cc -O2 -DHOST -Ifirmware/mapdraw -Ifirmware/common -Ifirmware/raster .local/grey-measure/gm_host.c firmware/mapdraw/map.c firmware/mapdraw/proj.c firmware/raster/raster.c -o .local/codex/phase-3-render`. Each pair gives grey raster time (w) and detail raster time (m) in host microseconds, rounded to the nearest microsecond. Each value is the mean of 20 draws. The fixture uses the first section that references each distinct stored block, its first route point, north up and 2.5 m per pixel. It uses the callback projection. Timing excludes file I/O and device UI work.

| Route | Block numbers, starting at 1 | w/m (µs), in block order |
|---|---|---|
| A | 1–2 | 12/287, 16/347 |
| B | 1–4 | 19/358, 10/356, 7/369, 31/412 |
| N1 | 1–10 | 26/566, 23/726, 26/741, 14/583, 14/687, 13/874, 9/552, 5/612, 14/588, 7/707 |
| N1 | 11–14 | 10/696, 11/714, 6/546, 7/563 |
| N2 | 1–3 | 31/492, 23/524, 9/590 |
| N2b | 1–1 | 26/906 |
| N3 | 1–2 | 34/622, 7/409 |
| N4 | 1–4 | 40/589, 28/848, 22/780, 26/637 |
| C2 | 1–10 | 20/402, 11/417, 10/404, 36/479, 11/260, 3/124, 4/248, 5/154, 8/389, 3/202 |
| C2 | 11–20 | 12/335, 20/276, 11/230, 3/262, 13/363, 5/230, 3/179, 3/98, 35/142, 7/317 |
| C2 | 21–30 | 13/245, 4/130, 23/273, 9/404, 20/476, 24/473, 21/452, 13/363, 17/329, 9/258 |
| C2 | 31–40 | 5/277, 7/212, 19/234, 19/314, 13/267, 12/300, 10/309, 24/387, 11/310, 7/336 |
| C2 | 41–50 | 8/338, 13/358, 12/422, 16/429, 14/379, 16/348, 18/383, 18/336, 18/207, 12/272 |
| C2 | 51–60 | 9/382, 13/365, 14/362, 10/305, 8/246, 2/263, 2/258, 4/276, 7/323, 5/170 |
| C2 | 61–70 | 3/230, 9/275, 3/349, 2/177, 6/238, 5/237, 9/205, 7/258, 6/246, 4/227 |
| C2 | 71–75 | 9/252, 8/195, 9/291, 6/269, 8/246 |
