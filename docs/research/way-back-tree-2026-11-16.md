# Way-back street tree: results, 16 Nov 2026

The core fits the code room: 2,782 B with forward mode and the mount checks (room 4,376 B). Tree A plus exceptions gives 12,722 records at 2 km and 2,544 at 1 km. No forward chain stays open on either file. The replay with exceptions has no wrong-part frames; tree A alone gives 69.

Host only. Nothing is on the device. Values come from `.local/wayback/` files written by the commands listed in each section.

Commits on `feat/recovery-ordered-provider` (local, not pushed): `2c478cb` (tree model), `3e1ad10` (format), `6547c7c` (core and host), `cbeecf9` (size measure), `0f0fbcd` (build and replay), `d340c86` (forward exception lists).

## 1. Code size

Command: `python3 -I tools/wayback_size.py` (`.local/wayback/size-a.json`, `size-aplus.json`). Target: Xtensa ESP32-S3, `-Os -mlongcalls -mtext-section-literals -ffreestanding -fno-builtin`.

| Build | text | literal | rodata | total | room | fits | undefined |
|---|---:|---:|---:|---:|---:|---|---|
| Tree A (before forward mode) | 2,294 | 0 | 0 | 2,294 | 4,376 | fits | none |
| Tree A plus exceptions (current core) | 2,782 | 0 | 0 | 2,782 | 4,376 | fits | none |

Literal pools sit in `.text` with these flags, so `literal` is 0.

## 2. File size at 70 km

Command: `node tools/wayback_build.mjs .local/eq/v4.json <out> --reach <line2k|ride1500> [--exceptions]` (`.local/wayback/*-build.json`). The 70 km values scale the 22.56 km ride by 70 / 22.56.

| Build | bytes | header | cells | nodes | extras | chunk table | exceptions | KB/km | MB at 70 km | with 2.5 MB route file (MB) | with 4.0 MB route file (MB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Tree A, 2 km | 472,452 | 64 | 27,504 | 422,748 | 22,136 | 0 | 0 | 20.45 | 1.40 | 3.90 | 5.40 |
| Tree A, 1 km | 236,072 | 64 | 13,920 | 208,320 | 13,768 | 0 | 0 | 10.22 | 0.70 | 3.20 | 4.70 |
| Tree A plus exceptions, 2 km | 574,324 | 64 | 27,504 | 422,748 | 22,136 | 96 | 101,776 | 24.86 | 1.70 | 4.20 | **5.70** |
| Tree A plus exceptions, 1 km | 256,520 | 64 | 13,920 | 208,320 | 13,768 | 96 | 20,352 | 11.10 | 0.76 | 3.26 | 4.76 |

Free space: 5.58 MB. Bold: does not fit.

## 3. Replay on the recorded ride

Command: `node tools/wayback_replay.mjs .local/eq/v4.json <file> <line2k|ride1500>` (`.local/wayback/*-replay.json`). The ride has 809 off-route frames in 6 episodes.

| Build | frames | line frames | forward frames | wrong part | largest reads in one frame | forward frames with WB_DIST_UNKNOWN |
|---|---:|---:|---:|---:|---:|---:|
| Tree A, 2 km | 809 | 636 | 0 | 69 | 788 | 0 |
| Tree A, 1 km | 809 | 636 | 0 | 69 | 823 | 0 |
| Tree A plus exceptions, 2 km | 809 | 636 | 630 | 0 | 1,966 | 23 |
| Tree A plus exceptions, 1 km | 809 | 636 | 630 | 0 | 1,652 | 23 |

Other counts from the same reports: 173 frames have no street within 15 m. The longest line has 74 points. Forward frames: 630 of 636 line frames. The six frames without forward mode come from the episode that starts at row 0 (no trusted exit).

Wrong part is the episode with the exit at 21,815 m in tree A: 69 frames. With exceptions, it falls to 0.

Exception build statistics (`.local/wayback/aplus-line2k-build.json`, `aplus-ride1500-build.json`): at 2 km, 12,722 records remain. 50 records closed a loop and were removed. 44 records were skipped because the node is not stored, and 13 were dropped because the next node is not stored. At 1 km: 2,544 records, none removed, skipped or dropped. The builds report `forwardChains.open` = 0 for both files (every stored node reaches the route in every chunk). Before the loop fix, the 2 km file had 478 such nodes in 5 chunks.

## Answer by question

- **Does the core fit 4,376 B?** Yes: 2,782 B.
- **Does the file fit for 70 km?** Yes with a 2.5 MB route file, for all four builds. With a 4.0 MB route file, tree A at 2 km (5.40 MB) and both 1 km builds fit. Tree A plus exceptions at 2 km does not (5.70 MB against 5.58 MB).
- **How many frames get a line?** 636 of 809, with and without exceptions.
- **How many lead to the wrong part?** 69 without exceptions; 0 with exceptions.

## Gaps

- One ride on one 22.56 km loop. The 70 km values are scaled from it.
- No device provider gives a trusted exit km. The replay took the exit from the ride record.
- The device read time is not measured. One frame reads up to 1,966 times from the file.
- 23 forward frames give `WB_DIST_UNKNOWN`. The 64-node walk limit causes them: with a 512-node limit, the same replay gives 0 (measured on the 1 km build; the core was restored after the test). The plan keeps 64. On the 2 km build, the longest chain that reaches the route has 363 nodes (`forwardChains.maxSteps`). The owner decides the limit.
- In forward mode, an extra piece uses the tree A cost to choose its end (as the plan states). The replay counts 4 frames that turn back at point 1. This count is a geometric proxy, not checked against node ids.
- A device adapter and a test image (`cc23wb1`) exist on the host (`firmware/wayback/README.md`). They are not installed. The cause of the cc24 map-view restart is not known.
- The adapter replay on the recorded ride gives the same result as the core replay: 636 lines in 809 off-route frames, 173 frames with no street. One frame needs at most 792 file reads (median 375) with a mount for each frame. The first ride frames give `50m` with 4 points.
- Direction. Tree A leads to the nearest route point by ride distance, in any direction. The owner wants the closest join without turning back. Tree A does not give that. A host search with a heading from 10 m of track finds such a join for 436 of 443 frames of the long detour and 93 of 100 frames of the short detour. No file format or device code for it exists. The "wrong part" count above uses a km window and is not a measure of direction.
- The map paints main roads up to 1,000 m from the route. A line at 2 km can cross an area with no painted streets. This is not measured.
- Parallel streets less than 15 m apart can give a wrong match.
- Turn restrictions are not in the tree. A node stores one next node only.
- 4,173 graph nodes inside 2 km straight-line distance have no permitted way to the route (`noWayInside2km` in the build reports). The share of all nodes inside 2 km is not computed.
- The route app does not make the file. Only `tools/wayback_build.mjs` does.
- The core engine size is 116 B by field count on the 32-bit device. The Xtensa compiler accepts the `_Static_assert` at 128 B. The size is not measured as a struct.
- The repository validation exits 1. Its five node failures are in `tools/test_map_policy_study.mjs`. They also fail before this work (baseline run). The cause is not established. The way-back tests pass.
- Process: the exception code (`forwardLists` and the chunk encoding) was written in the Task 1 and Task 2 commits, before its tests. Task 6 added the tests. The core forward tests failed before the core change.
