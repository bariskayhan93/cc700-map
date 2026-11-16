# CC700 status

Updated 16 Nov 2026. Times are local (UTC+1) unless marked UTC. The Codex records use UTC.

## Summary

- The device runs **cc23**. A read-only check today matched the install record exactly.
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
