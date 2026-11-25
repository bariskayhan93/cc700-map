# Firmware approach review, 25 Nov 2026

Status: offline only. No device contact. Source: git history (230 commits, 11 to 25 Nov) and the current source tree.
Question: which approaches held, and which approaches caused fix chains and extra code?

## Answer

Designs that a host harness tests and pins to fixed output held. Designs that only the device could check caused chains of fix commits and extra code.

## Method and limits

- Fix commits: `git log -i -E --grep='fix|correct|restore|revert|crash|wrong|bug|retry|guard' -- firmware/<dir>`.
- Churn: `git log --shortstat` on `firmware/wayback`, `firmware/recovery` and `firmware/loop_start`.
- Build scope: `TREE` and `SOURCES` in `tools/cc27_build.py`.
- Limit: the counts come from commit messages and diff sizes. They are signals, not proof. A fix with no keyword in its message is not counted. No device log was used.

## Data

| Directory | Fix commits / commits | Files touched |
|---|---|---|
| wayback | 8 / 48 | 99 |
| mapdraw | 3 / 18 | 27 |
| common | 1 / 11 | 17 |
| raster | 0 / 11 | 16 |
| loop_start | 3 / 3 | 6 |
| recovery | 2 / 2 | 6 |
| elev | 0 / 3 | 6 |
| measurement | 1 / 3 | 11 |
| mapdec | 1 / 2 | 4 |
| guidance | 1 / 1 | 3 |

## Approaches that held

1. Pure modules with a host harness. `raster`, `elev` and `mapdec` decode or draw from input to output. A host program checks the output byte for byte. They have 0 or 1 fix commits.
2. Pinned output before a trim. `0c01b72` pinned the map and way-back frames. The trims `7f27e9b` (1,388 B) and `8538ec4` (300 B) came after the pins and needed no later fix.
3. Checks in the build. Stock addresses live only in `firmware/common/fw.h`. `tools/cc27_build.py` refuses a build if the `wb_rt` frame (`HOOK_FRAME`) or the list of called stock functions (`CALLED`) changes. A mistake stops the build, not a ride.
4. Work at generation time. The page builds the way-back data. The device does a bounded lookup. The format changes caused no fix chain.

## Approaches that caused fix chains and extra code

1. Hand-written code at the hook boundary. All 3 `loop_start` commits are fixes: `ada60dc` (stack budget) and `98c7e0e` (trampoline frame 32 B to 48 B, the crash of 16 Nov). The route-exit guard `05c428e` is the same class: a check-then-lock race. A device crash found each fault.
2. A rewrite for each image. The way-back core changed three times in three days: v1 `2337f3b` (+372 lines), v2 `1f1fe6e` (+321, −266), cc27 tree `b84a368` (+359, −378). `tools/` keeps separate builders for cc23, cc25, cc26 and cc27.
3. The device as the debugger. On 24 Nov, about 17 commits changed the far map and the page cache. About 8 of them changed only the test text (`f s r i d`, then `o e h`, then `P`, then `W`). Each text had to fit the 512 B frame and one text row. The F1 fault of `3e81fd6` (code after a `//` comment) came from this packing. Cause: the host has no model of file read time, so each question needed a new image and a photo.
4. The rule "no data, no bss" in area 2 turns into code. The page cache keeps state between frames: `b5fbb8f` puts a node into the stock pthread TLS key list and adds 4 stock calls. The "no rodata" rule packs text into 64-bit constants; this let in the F1 fault. No document records the rule and its code cost as one decision.
5. Work that was retired later. 31 commits name the grey layer. The far map replaced the grey streets on the unit; the grey draw is compiled only with `WBD_GREY` for host tests. Correction (25 Nov): most modules outside the cc27 source list are still on the unit, because cc27 patches a base image that already holds them. The chain is v21 -> cc22 (`guidance`) -> cc23 (`loop_start`) -> cc23 with the trampoline fix -> cc25 = C4 (`mapdec`) -> cc27. `wb_grey.c` is in the cc27 sources and `wb_far.c` uses it. `recovery` is host research, not retired (AGENTS.md). Only `measurement` (the rejected cc24 diagnostic) is retired.

## Recommendations

1. Write the host harness and pin the output before a new firmware mechanism. This is the one approach that held every time.
2. For time questions, use one fixed test text with fixed fields, or a host model of file read time. Do not make a new text and a new image for each question.
3. Use one checked trampoline template for all hooks, not hand-written assembly for each hook.
4. Record "no data, no bss" as a decision with its cost (TLS node, packed constants), so each workaround is a choice.
5. Mark in each module README which image put it on the unit. A review of the cc27 sources alone does not cover the code that runs on the unit. Do not move `guidance`, `loop_start`, `mapdec` or `wb_grey.c`: the unit runs them, and their builders rebuild the base chain.

## Gaps

- The owner has not confirmed the fault cases.
- No count of device test cycles (image builds and photos) for each approach. The commit count is a proxy.
- The JS page and builder history is not in this review.
- Related: `docs/research/firmware-review-prompt-2026-11-25.md` (size review prompt, F1 cases).
