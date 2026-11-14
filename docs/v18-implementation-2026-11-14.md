# v18 implementation and release state

2026-11-14. Candidate `CC700_V1.414-cc18` corrects the
[v17 review findings](v17-review-2026-11-14.md).
**Installed and readback verified.** The owner approved the firmware write on
2026-11-14. v18 booted from `ota_1` after RTS reset, with no captured panic or
repeated reset in the eight-second boot window. See the
[installation observation](mining/v18-install-observation.json).

## Implemented

- Map selection walks route nodes sequentially, using each starting point's
  section ID at payload +40. It compares minimum distances over complete
  sections with a 25 m preference for the firmware's current section.
- The stale adjacent-section guard is removed. Section numbering no longer
  substitutes for physical distance.
- The stock resolver `0x42050ccc` translates combined navigation IDs into file
  type and local section. Candidates from another file are excluded, and invalid
  local IDs cannot silently select the last block.
- The map and arrow selectors perform no indexed linked-list lookups and no
  allocations. Resolver results are reused across a section's consecutive points.
- Turn arrows use the same corrected domain. They attempt the navigation
  semaphore with **zero wait**, skip the optional overlay when busy, and release
  it before taking the map mutex. This avoids list teardown races without
  reversing the worker's blocking lock order.
- Null list storage is checked before calling the stock count getter. Empty
  indices, missing positions and replaced lists have explicit regression cases.
- The v17 off-route map gate bypass is retained. The stock off-route flag,
  warnings, prompts, replanning and recording code are not patched.

Sources and artifacts are preserved under `.local/patch-v18/`; v16/v17 images
remain preserved. Validated `blk.c` and `arrow.c` were promoted to the sibling
`cc700-backup/patch/src/`, with the original files retained as `*.v17`.
Named sibling artifacts are `patch/src/patch18.elf` and `patch/ota_1_v18.bin`;
older generic artifact names were not repointed.

## Checks completed

| Check | Result and boundary |
|---|---|
| Complete loader/arrow C host suite | 20/20 pass, including failures observed before corrections |
| Replay input suite | 11/11 pass, including corrected shared-endpoint ownership |
| Acquired ride through full loader/gate C | 0/576 samples with absent vertex-coverage proxy, 3 block switches, 0 indexed point lookups |
| Dense 4,000-point fixture | Correct section, 0 indexed lookups, at most 40 section resolutions |
| Fresh independent review | No remaining material source findings after null/lifetime fixes; 270 unambiguous random cases also matched a separate distance reference |
| Installer boot acceptance | 4/4 local checks pass: normal boot, missing app, captured panic and repeated reset; no device call in these checks |
| Xtensa build | ELF links; no writable globals; `.text` 6000 B and `.rodata` 296 B; 8600 B free in mapped page |
| Image validation | esptool checksum and appended validation hash valid; `espimg.py` rebuild byte-identical |
| Diff against v17 | DRAM/IRAM unchanged, DROM version byte only, IROM changes confined to existing patch trampoline/literal sites and patch tail |

Image: `.local/patch-v18/ota_1_v18.bin`, **3,750,336 bytes**.
SHA-256: `ae3539c4a2b174b52f8dce866a93303d7aa2c12476d36cc94844adbb52410bd6`.
The source/artifact manifest is `.local/patch-v18/manifest.json`.
Seven instruction traces and the validated resolver trace are preserved under
`.local/patch-v18/mining/`. Compiler stack-usage output reports 80 bytes for
`cc_map_road` and 336 bytes for `cc_rt`; these are local static frames, not peak
task-stack measurements.

The 576 samples span 598 elapsed seconds. The replay still holds 62 missing
exact-second firmware road values. It uses a single-file stock-service fixture,
matching the log's observed FileType 0 / BackFlag 0, and counts stored vertices
within 300 m. It executes the patch loader/gate, **not** the stock GPS filter,
matcher, scheduler, projection or rendered display. Combined-file behavior is
covered by explicit resolver fixtures and the extracted stock resolver wiring;
it has not been exercised in a live phone reroute.

## Synchronization and file-contract evidence

The draw timer holds the result mutex (`0x4204ee94`) while drawing. The navigation
worker takes the navigation mutex (`0x4204c794`) before entering calculations
that take the result mutex. A blocking navigation take inside arrow drawing would
invert this order. The added zero-tick take uses the stock primitive
`0x40381868`, handle `*(void **)0x3fc9fc3c`; its unavailable/success returns are
0/1 in the binary. Give wrapper `0x4204c7a8` uses the same handle. Host tests
check busy skipping, early releases and release before map locking.

`0x42050fe8` resolves the published global section through `0x42050ccc` before
calling the patched loader at `0x42050150`. The candidate applies that same
resolver to each distinct point section, rather than indexing a file with a
combined ID. The point constructor `0x42055ddc` copies input +34 to payload +40;
interior insertion and section-end construction establish starting-point
ownership. Node lookup `0x4204922c` and helper `0x421cfedc` establish node payload
at +0 and next at +4. The target build asserts these offsets.

## Concrete device update boundary

The connected serial node is `/dev/cu.usbmodem1101`. Before programming:

1. Recheck the exact candidate hash and image validity.
2. Interrupt the app into the ROM/stub and acquire a fresh complete `ota_1`
   backup (`0x440000`, length `0x420000`) plus current OTA metadata. Validate the
   current image against preserved v16; stop if the baseline is unexpected.
3. Write only the approved candidate to `ota_1`, retaining stock `ota_0`, OTA
   selection metadata and route/ride storage. Require esptool readback/hash
   verification and retain the fresh backup for rollback.
4. Reset via RTS and require the normal app-load message at `0x440000`.
   A bad boot requires restoring the fresh `ota_1` backup and RTS reset.

The owner explicitly approved this write under the established
[device workflow](../../cc700-backup/HANDOFF_ADDENDUM.md), and the sequence above
completed successfully. The fresh complete `ota_1` backup matched preserved v16
exactly, including the erased partition tail; current OTA selection matched the
expected `ota_1` metadata. esptool write verification and explicit `verify_flash`
passed. No `ota_0`, OTA metadata or route/ride-storage write was performed.
No simulation files or fake positions were installed.

Private acquisition, programming/verification logs and the receipt are under
`.local/patch-v18/installation-20261114T052127Z/`. Its `ota1-before.bin` is the
fresh byte-exact rollback partition, SHA-256
`806223ee013fb56c110c847245cd3532c017c2c7ebb00ac4789212e77b3847fd`.

The exact installer is `.local/patch-v18/install.py`. Without arguments it prints
the checked plan and performs no device operation. `--apply` performs the
approved acquisition/write/verification/RTS sequence, with an automatic restore
attempt from the fresh backup on programming or observed startup failure. The
eight-second boot window rejects captured panics or repeated resets; a confirmed
boot is not a navigation or long-duration acceptance test. Recovery receipts
distinguish verified restored bytes from a confirmed restored app boot.

After deployment, target frame/lock/allocation timing, live reroute and one motion
acceptance ride remain runtime evidence. A host build cannot establish those
measurements, physical compass capability or the exact older restart cause.

## Separate generator investigation

**Later continuation:** [bounded generator correction](generator-closure-2026-11-14.md)
retains a smaller tested change while preserving the reference turn vector.
[Repeatable validation](repeatable-validation.md) is the current test entry point.
The rejected broad candidate described below remains unshipped.

An isolated candidate addressed jitter/self-arm classification and sparse corner
analysis. Ten labelled synthetic tests passed, but the historical suite remained
10/12 and the sparse case worsened. It was not shipped: `js/route.js` was restored
byte for byte to its original HEAD. Its source, tests and red/green evidence are
preserved in `.local/generator-candidate-20261114/`.

The original noisy track still produces 46 turns versus baseline 15, and the
sparse export produces 5. Decimation reduces 238 points to 31, with gaps up to
160 m and original geometry up to 49 m from the retained chords. Count matching
cannot establish the intended path through omitted junctions. These cases need
labelled route reconstruction/quality handling; no fabricated route geometry or
unvalidated prompt fix was added to the app.
