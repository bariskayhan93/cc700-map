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

- Area 2: 17,888 of 18,404 B used, 516 B free. Tail area: 1,980 B free (`docs/research/code-review-2026-11-25.md`).
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
4. Check each failure class F1 to F8 below against the range. One verdict per class: finding or "none".

Failure classes:
F1. Size changes that caused a later fault. Known cases (from git history; OWNER: confirm or extend):
    a) 3e81fd6 -> fixed in 83d6c5c: a "no rodata" one-line loop in map_time put
       `o = tx_num(...)` and the '+' after a `//` comment. It compiled; the far text lost
       its numbers. Check: compact one-line edits, code after `//`, macros that swallow code.
    b) 98c7e0e: the loop-start trampoline frame was 32 B, not 48 B. A window spill wrote
       a4..a7 over stored argument 7 (crash of 2026-11-16). Check: any smaller `entry`
       frame or moved stack slot in a trampoline.
    c) 716bc27: the way-back stack limit went back up to 3,968 B so the stock calls keep
       the 1,904 B they had on ride-tested cc23. Check: any stack cut that reduces the
       room left for stock callees, not only our own frames.
F2. Stack: a merged or non-inlined function that deepens the call path from wb_rt, or a new large local.
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
- Class: F1..F8
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
