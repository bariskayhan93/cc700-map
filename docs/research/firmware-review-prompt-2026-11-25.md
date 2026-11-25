# Firmware size review: research and review prompt, 25 Nov 2026

Status: offline only. No device contact. Part 1 is web research. Part 2 is the repo evidence. Part 3 is the prompt.
Gap: section F1 holds three cases found in git history. The owner has not confirmed them, and other cases may exist that left no commit message.

## Part 1: what the web research says

| Topic | Finding | Use here |
|---|---|---|
| Size tracking | Tools that diff two ELF files by symbol exist: [Bloaty, puncover, elf_diff](https://interrupt.memfault.com/blog/best-firmware-size-tools). [Memfault](https://interrupt.memfault.com/blog/code-size-deltas) argues for a size delta on every change, so a reviewer sees which change cost bytes. | `tools/wayback_size.py` already measures size. Add a per-function delta to each review. |
| Size tracking in CI | A [Zephyr paper](https://ceur-ws.org/Vol-4184/paper5.pdf) puts size and stack figures into code review. No source gives a standard threshold per function. | A threshold is our own choice. Gate G4 (stack) is the model. |
| Compiler levers | [TI](https://www.ti.com/document-viewer/lit/html/SLAU646F/GUID-3AC38E7F-FED1-4A97-A30F-8E1A9DC280BD) and [Microchip](https://onlinedocs.microchip.com/oxy/GUID-BD1C16C8-7FA3-4D73-A4BE-241EE05EF592-en-US-9/GUID-32C055DD-42EC-452B-9F65-901B71123809.html) warn that `-ffunction-sections` with `--gc-sections` can make code larger when few sections are unused. A forum report shows the linker removing needed code; `--print-gc-sections` finds it. [Memfault](https://interrupt.memfault.com/blog/code-size-optimization-gcc-flags): `-Os` does not inline when inlining adds size. | Measure each flag on our build. Read `--print-gc-sections` after each link change. |
| Behaviour proof | [Characterization (golden master) tests](https://en.wikipedia.org/wiki/Characterization_test) record what code does now. They show a change in behaviour, not a wrong behaviour. Mask non-deterministic values. [Trail of Bits DIFFER](https://blog.trailofbits.com/2024/01/31/introducing-differ-a-new-tool-for-testing-and-validating-transformed-programs/) joins differential, regression and fuzz testing. | Build old and new code for the host. Feed both the same recorded and fuzzed inputs. Compare the output byte for byte. This is our synthesis; no source describes it for firmware. |
| Binary patching | For monolithic firmware, code caves plus detours are the usual way ([shimware, RAID 2023](https://sites.cs.ucsb.edu/~chris/research/doc/raid23_shimware.pdf)). [PIFER](https://arxiv.org/html/2311.16532v2) keeps the original code correct with instruction translation. Analysis tools can ignore `LITBASE` on Xtensa ([RECON 2023 slides](https://recon.cx/cfp.recon.cx/media/2023/submissions/B38VRX/resources/QCA_Xtensa_RECON_2023_y45U6iX.pdf)). | A disassembly of a stolen-instruction trampoline needs a check against real register state. |
| LLM review | A [2026 preprint](https://arxiv.org/html/2603.00539v1) finds that requiring explanations and fixes raises false rejection of correct code. Scoped checks per defect class, with checklists, [reduce false alarms](https://arxiv.org/pdf/2510.02534). Hybrid pipelines with static analysis remove most false alarms. | Ask for a verdict, a location and a triggering path. Ask for fixes in a second step. Verify each finding with a compile, a test or a disassembly. |

Limits of this research: no source covers size refactors of patched stock firmware. The search found no study of C checklists for LLM review. Most LLM sources are preprints.

## Part 2: what the repo already shows

- Area 2: 18,200 of 18,404 B used at dd4833a, 204 B free. Tail area: 212 B free before the 1,768 B reserve (`docs/research/code-review-2026-11-25.md`).
- Largest functions: `cc_iter` 1,632 B, `wb_scan` 980 B, `wb_km` 836 B, `wb_far` 780 B, `rs_fill` 668 B. The 25 Nov review found no dead branch in them.
- Trims that held: `7f27e9b` (1,388 B) and `8538ec4` (300 B). Each stated "same behaviour" and listed the byte change per edit.
- Pins after trims: `0c01b72` fixed map and way-back frames to recorded values. `aafa85b` tests the readers with ASan on damaged files.
- A stock-code analysis error: the dead-code list marked `0x4204DABC` as dead, and a crash return address lay inside it (`docs/research/firmware-mining-2026-11-16.md`). A size plan that deletes code on a reachability list needs a second proof.
- Route-exit crash: null map context in the stock MapDraw path and a check-then-lock race (`docs/research/route-exit-crash-2026-11-24.md`). This is a hook-boundary fault, not a size fault.

## Part 3: the review prompt

Use it as the whole task text for a review agent. Replace `<RANGE>` and `<IMAGE>` before use.

```text
Task: review the CC700 firmware patch sources in <RANGE> for code-size and behaviour risk.
Do not edit files. Do not touch a device. Report only.

Fixed facts (do not question them):
- Code area 2 is 18,404 B. Free bytes must be read from the build of <IMAGE>, not from this text.
- The 9 stock hooks are frozen. Stock addresses live only in firmware/common/fw.h.
- No library calls, no writable globals, no bss in area 2. No float in wayback.c, wb_grey.c, mapdec.c.
- Stack bound: 3,968 B (gate G4). Time limits: 300 ms file work, 60 ms grey, 400 ms map frame.
- A host test is not a whole-device test. An estimate is not a hardware maximum.
- AGENTS.md rules apply. Do not propose a new feature, a new budget or a new device experiment.

Method:
1. Build the code for <IMAGE>. List every function with its size (tools/wayback_size.py or the
   disassembly). Name the 20 largest.
2. For each size idea, state the byte change you can PROVE (compile and measure), not guess.
3. For each idea, state the proof of equal behaviour: which host harness (far_host, grey_host,
   wayback_device_host, fuzz_readers, replay) shows byte-identical output on the same inputs,
   and which input class it does not cover.
4. Check each failure class F0 to F8 below against the range. One verdict per class: finding or "none".

Failure classes:
F0. Build: each commit in the range compiles for the device and for the host, fits the code
    limit, and passes the tests that passed at its parent. Check each commit, not only the
    end of the range. Report the first command that fails, with its output. If the base image
    is absent, say which build steps did not run.
F1. Size changes that caused a later fault. Known cases (from git history; OWNER: confirm or extend):
    a) 3e81fd6 -> fixed in 83d6c5c: a "no rodata" one-line loop in map_time put
       `o = tx_num(...)`, the '+' and the loop's `}` after a `//` comment. map.c did not
       compile (checked 25 Nov). Check: compact one-line edits, code after `//`, macros that swallow code.
    b) 98c7e0e: the loop-start trampoline frame was 32 B, not 48 B. A window spill wrote
       a4..a7 over stored argument 7 (crash of 2026-11-16). Check: any smaller `entry`
       frame or moved stack slot in a trampoline.
    c) 716bc27: the way-back stack limit went back up to 3,968 B so the stock calls keep
       the 1,904 B they had on ride-tested cc23. Check: any stack cut that reduces the
       room left for stock callees, not only our own frames.
F2. Stack: a merged or non-inlined function that deepens the call path from wb_rt, or a new large local.
    The gate depth (tools/review_gate.py, G4) is an upper bound: each indirect call counts as the
    deepest callback in CALLBACKS. Report the frame delta (from .su files or `entry a1, N`). Compare
    an absolute depth only with a figure from the same method, and say that it is an upper bound.
F3. Hook timing: a shared helper that changes the order or the number of file opens, reads or locks
    between cc_iter, wb_far, wb_km and wb_rt (route-exit crash class: check-then-lock, null map context).
F4. Linker: --gc-sections or section placement that drops, moves or duplicates code or data
    (read the --print-gc-sections output; weak symbols such as tx_num).
F5. Instruction facts: a trampoline or stolen instruction whose decoded form depends on literal
    pool or LITBASE state; a caller that passes arguments in a way the compiler change alters.
F6. Dead-code claims: any deletion that rests on a reachability list. Name the second proof.
F7. Format and limit agreement: a limit or field changed in C but not in the page or the builder (gate G5).
F8. Fallback: a changed path that no longer ends in the stock display when data is absent, bad or late.

Finding format, one per finding, nothing else:
- Class: F0..F8
- Claim: one sentence.
- Location: file:line
- Trigger: the concrete input, state or call order that shows it.
- Evidence: the command and its output, or the exact disassembly lines. A claim without evidence goes
  to the section "Unverified" and is not ranked.
- Byte effect: measured, or "not measured".

Rules for the answer:
- Do not propose a fix in this pass. Fixes are a second pass after the owner reads the findings.
- Do not report style, naming or formatting.
- Rank: device safety, then wrong data, then limits, then size.
- If a function looks correct, say nothing about it.
- End with a section "Gaps" that lists what you could not check and why.

Second pass (separate run, only for ranked findings): try to refute each finding with a compile,
a host test or a disassembly. Keep a finding only if the refutation fails.
```

## Part 4: how to use it

1. Run the prompt on one range, with the owner's F1 list filled in.
2. Run the second pass on the ranked findings.
3. Measure any size idea that survives, one commit per idea, with the byte delta and the equal-output proof in the message.
4. Calibrate once: run the prompt on a range whose faults are known (for example the `7f27e9b` range plus the later fixes). Count the false alarms. Change the prompt if the false alarms are high.

## Part 5: runs

Environment for all runs: the C4 base image (`.local/`) is absent, so `tools/cc27_build.py` did not run. The area-2 link was done by hand with the same flags; the sizes match the commit messages. In the first two runs, `tools/test_renderer_host.py` did not run (commit `6bacafc` is missing; `79fc86f` changed it to `5837e9d`).

### 7f27e9b^..7f27e9b (1,388 B)

- F2: deleting `wb_tick_piece` let gcc inline `wb_commit` into `wb_tick`; its frame went from 192 B to 224 B (`entry a1`, `.su`). Second pass: true. The first pass compared the gate depth (2,144 B) with the 1,904 B target; that depth is an upper bound. At HEAD the gate gives 1,952 B. This led to the F2 note.
- F4: `-ffunction-sections` saves 20 B, not the 564 B in the message (15,024 B without, 15,004 B with). Second pass: true. The total is correct.
- None: gc-sections dropped nothing reachable; `dash` 32-bit math: 0 differences in 300,000 runs; the removed `wb_mount` checks are covered.
- Unverified (needs stock code): the line style is restored before `text()`; `probe()` passes a stack buffer.

### 8538ec4^..8538ec4 (300 B)

- F2: `wbd_open` (64 B frame) now calls `fw_fopen`, so `fopen` gets at least 3,904 B after the `fw_stack()` check, not 3,968 B. Second pass: true, but not a limit risk. The same check covers the reads, 1,248 B deeper (at least 2,720 B left); the read depth did not change. It matters only if stock `fopen` needs about 1,180 B more than stock `fread` (not measured). Not ranked.
- None: one `tx_num` in the image, and both copies disassemble the same; each hook opens and closes once, in the old order; the trailer rule agrees with `js/wayback_embed.js:14`; `c.io` is correct; `test_wayback_device.mjs` 45/45 and `test_fuzz_readers.mjs` 2/2 (ASan, UBSan).
- Behaviour change, damaged files only: a trailer total larger than the file and a trailer moved by padding now fall back to the stock display (the old code drew the line); an elevation section that overlaps the way-back section now draws the line (the old code fell back). The app writer makes none of these files.
- Unverified: a future `#include "text.h"` in a tail source would let the link keep the first `tx_num`.

### 3e81fd6^..3e81fd6 (calibration, blind)

The prompt ran without case F1 a), and the reviewer did not see later commits. The fix copy changes only the `//` on `map.c:254` to `/* */`, so sizes can be measured.

- F0 (added after this run): `map.c:254` does not compile (`invalid storage class for function 'scan'`). Second pass: true; fixed in `83d6c5c`. The blind prompt found the known fault.
- Limits: area 2 is 18,612 B, 208 B over 18,404 B (old: 18,176 B). Second pass: true; `83d6c5c` is also 18,612 B. `9226308` moved `view.c` to the tail area.
- F3: `wbd_at` calls `fw_clock` three times for each read. `test_wayback_device.mjs` passes 41/42 at `83d6c5c` (old: 42/42). Second pass: true; `dbcdda6` changed the slow-clock test.
- F7: `map_time` writes 1 B past `char s[48]` when every number has 5 digits and cut and pd are set (48 characters plus the NUL; ASan). Second pass: true, but only a frame of 10 s or more triggers it. HEAD uses `s[64]` and two rows.
- F2: frame deltas `wbd_frame` 352→368, `cc_iter` 400→416, `rs_fill` 320→464 B (`.su`). Second pass: true. No gate checks the map frame path; G4 starts at `wb_rt` only. The reviewer compared a G4 depth with 1,904 B; the F2 note does not allow that.
- Not ranked: `__lshrdi3` from libgcc is in area 2 (24 B), and it is still there in the 8538ec4 builds. G3 lists only libc names.
- Refuted: `tools/map_budget.py` counts one projection and `js/map_budget.js` counts two. The commit message says that this is on purpose.

### 9226308^..9226308 (view.c to the tail area)

- None in F0 to F8. Area 2 is 18,380 B (24 B free; parent 18,612 B). The tail area is 3,224 B, 212 B before the 1,768 B reserve; `cc27_build.py` checks both. The gc lists are equal. Calls to `vw_fit` and `vw_map` changed from `call8` to `l32r` + `callx8` (4 B each). Net: area 2 −232 B, tail +248 B. Python tests are the same as at the parent.
- Gaps: no device run of `view.c` in the tail (`elev.o` uses the same method); the commit message has no byte figures.

### Result

No false alarm in four runs. The blind run found the known fault and two more real faults that the commit left: the code limit and a failing test. The prompt had no class for "the range builds, fits the code limit and passes its tests"; the reviewer added that check without a class. Class F0 now asks for it. Same gaps in all runs: no full build check without the base image, and no host harness for the `wb_far` open, trailer and close path.
