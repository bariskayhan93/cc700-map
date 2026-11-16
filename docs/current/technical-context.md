# CC700 constraints and development context

Latest consolidated status: [mining closure](../reports/mining-closure.md). The historical
edge suite has now been recovered and rerun (10/12 pass, the same two failures),
and latest patch inputs/artifacts are preserved locally outside temporary storage.
Geometry, sensor transport and lifecycle follow-ups supersede older open-item
wording below without claiming moving-runtime or simulation equivalence.

Reviewed 2026-11-13 against repository HEAD `24b8617`, the imported November 12
handoff, the subsequent local Claude session, current patch sources, and saved
v16 artifacts. This is a record of known constraints, not a claim that every
device limit has been discovered. The initial review was offline; a subsequent
[connected baseline](../reports/remaining-extraction-and-device.md) sampled inactive device state.

The subsequent [firmware mining report](../reports/firmware-mining-2026-11-13.md) adds binary
evidence, corrections, and a reproducible v16 build. Its main correction is that
off-route loading works but a separate stock drawing gate still suppresses the map.

Evidence labels:

- **Code:** present in the inspected implementation or build artifact.
- **Historical device:** reported in the prior session or handoff; not repeated here.
- **Safeguard:** application policy, not a proven hardware maximum.
- **Open:** needs measurement, tracing, or a ride.

## Current baseline and source locations

- This repository contains the phone application and preview, not the firmware patch.
- The extracted sibling directory `../cc700-backup/` contains `HANDOFF.md`,
  `HANDOFF_ADDENDUM.md`, `FINDINGS.md`, `PATCH_PLAN.md`, dumps, and patch sources.
- Those handoff documents stop at v1b. Later source changes are in
  `../cc700-backup/patch/src/{map.c,blk.c,arrow.c,fw.h,tramp.S,patch.ld}`.
- The later Claude project memory and transcript are under
  `~/.claude/projects/-Users-baris/`. The relevant session ID is
  `c6ad4359-31e5-4fa3-9745-7ba7da4ceda3`.
- Later build artifacts are in that session's `scratchpad/pb/` under
  `/private/tmp/claude-501/-Users-baris/<session-id>/`: `patch16.elf`,
  `ota_1_v16.bin`, and `v16back_args.txt` with rollback blocks. Temporary files
  can disappear. The older `patch/ota_1.bin` and `patch/src/patch.elf` in the
  extracted backup are v1b-era artifacts; do not assume their generic names mean latest.
- Historical installation: v16 on `ota_1`. The connected sample reports
  `CC700_V1.414-cc16`, and 16 sampled iterator-hook bytes match saved v16.
  This is not a full live firmware hash or an active-navigation validation.

## Hardware and patch envelope

| Constraint | Evidence and consequence |
|---|---|
| ESP32-S3, 16 MiB flash, 2 MiB PSRAM, RGB565/LVGL | Historical device/dump. Internal and external heap are separate budgets. |
| Display described as 240 x 320; map canvas 240 x 256 | Map dimensions now traced in binary. Its RGB565 buffer consumes 122880 bytes of external byte-accessible RAM, excluding other display resources. |
| `ota_0` at `0x20000`, `ota_1` at `0x440000`, each `0x420000` bytes | Dump/build. Keep the stock image and full backup available. |
| Storage at `0x860000`, size `0x79e000`, 4096-byte blocks | Historical dump. Free space is time-dependent; the old ~6.3 MB figure is not current capacity evidence. |
| Patch code/data must fit before `0x421e0000` | Code: linker assertions and `mkpatch.py`; free OTA partition space alone does not determine patch capacity. |
| Saved v16 uses 5536 bytes `.text` and 296 bytes `.rodata` in the tail | Artifact checked here with objdump. End `0x421ddc98`; 9064 bytes remain before the page boundary under this layout. |
| No writable patch globals | Code: linker asserts zero `.data` + `.bss`. New state requires a deliberate storage design. |
| `call8` reach is insufficient for the distant patch | Historical implementation: trampolines use literals and indirect `callx8`. |
| Byte/halfword reads through IROM can fault | Historical v1 crash. Constant tables use the `0x3c...` data-bus alias. Preserve this linker mapping. |
| Addresses and structure layouts belong to firmware V1.414 | Code. Do not apply these hooks to another firmware version without matching its layout. |

## Navigation and file constraints

| Constraint | Status |
|---|---|
| Every normal route record needs info field 8, the geohash index | Code and historical device comparison. Omitting it caused stuck section progress, growing straight distance, and the wrong map block. `noCells`/`NOCELLS` are diagnostic escape hatches, not production settings. |
| Point field 8 is compass bearing: north = 0, east = 90 | Current code and comparison with the official file. The early `90 - bearing` notes are superseded. |
| Points spaced at most ~20 m, ~5 m near turns | Code safeguard against matching gaps. No guarantee of correct matching for every GPX. |
| At most 50 points per generated record | Code safeguard based on reference files. Earlier 55/71-point failures were confounded by device power state; they do not prove a hard 50-point device ceiling. |
| Sections split around 600 m, or 300 m with stock ground enabled | Code. This is a generator policy, not a firmware maximum. |
| Firmware warns above 999 inflection-list entries | Binary tracing now shows this branch logs and continues. It does not establish a rejection limit. Other count boundaries remain open. |
| Close turns within 50 m get advance text | Code. The current text is `then ...`; older notes call it `dann ...`. There is no separate implemented second-turn icon. |
| Turn icon within ~300 m; optional map arrow within 150 m | Historical firmware tracing/current patch. Arrows are off by default and use encoded route geometry. |
| Backward riding and off-route visibility are separate from forward prompts | Patch selects blocks by position; firmware heading rejection over ~90 degrees remains. A stock draw gate still suppresses the map when the off-route flag is set, even with a loaded block. |
| Off-route thresholds reported as 150 m out, below 60 m back, then 60 m out | Historical log analysis. Older ~220 m statements are not a universal current rule. Behavior also depends on valid indexing. |
| App reroute replaces the active route/map context | [Runtime extraction](../research/navigation-runtime-extraction.md) now traces restart → route/file teardown → map allocation cleanup before reload. Historical `reroute_use.bin` observations agree with that path. Independent retention of the original map is not implemented. |
| Route header/menu names limited to 31 encoded bytes and transliterated to ASCII | Code policy. Earlier claims that an umlaut alone caused failure were not established. |
| Normal new-route transfer guard is five counted files; internal list can reach seven | Binary tracing separates admission from list capacity and special-name/existing-file paths. Historical six-route observations are not a universal slot limit. |

The geohash fix was observed at a stationary route endpoint. The later session
explicitly left continuous riding, prompt advancement, and off-route behavior
for a ride test. Do not promote endpoint evidence into a full ride validation.

## Map coverage, rendering, and load

| Constraint | Status and tradeoff |
|---|---|
| No independent device basemap | Code/design. Only data embedded in the route can be drawn. |
| Stored window extends 400 m behind and 300 m ahead | Code. These are distances along the route window, not a guaranteed off-route radius. |
| Styled ranges: main 1000 m, minor 550 m, service 350 m, paths 300 m, cycleways 350 m, rail/tram/water lines 450 m, areas 600 m | Current code. Detours can lose individual layers at different distances. “Map visible 300 m off route” does not guarantee a filled screen. |
| Map block chosen using nearest section chord and 25 m hysteresis | Patch code. Uses section endpoints rather than all detailed route points; crossings, parallel segments, loops, and long curved sections need targeted validation. This is a review risk, not a demonstrated failure. |
| Nearest-section scan repeatedly indexes a linked list | Binary + source: approximately `(inflection_count - 1)^2` link traversals per full scan. Section count is a separate CPU budget from map-entry count. |
| Styled grouping target: 1150 entries, rough point-size estimate 9000, length 1500 m | Code safeguards when merging groups. A single section can exceed the targets; arrow/rough entries are appended afterward. These are not hard final block caps. |
| App rejects blocks over 1200 entries by default and files over 4,000,000 bytes | Code validation. Debug mode can change the block threshold. These are application limits. |
| 1346 entries reportedly drawn on device | Historical device. Does not establish a maximum, sustained redraw rate, or acceptable worst-case frame time. |
| Stock map has its own 800-entry grouping target and 1200 upper target | Code. Stock and styled map budgeting differ. |
| Patch fills collect at most 128 crossings per scanline | Code, raised from 64 in v16. Complex polygons beyond this remain outside that buffer budget. |
| Map layer levels clamp to -2 through +2 | Code. Deeper vertical stacking cannot be represented distinctly. |
| Names: max 12/block, 23 ASCII bytes, 230 m spacing, repeated names 450 m apart | Code policy. Limited labels are intentional; actual font metrics/overlap are approximate. Names are omitted near screen edges and the compass/scale. |
| Route uses red at 180/255 opacity and is 2 px narrower | Patch code. Visibility through the route improves; readability in sunlight remains a ride check. |
| Minor/service roads beyond 150 m draw thinner/lighter | Code. Park paths, separate carriageways, and tram merging add detail but also consume entries and drawing time. |
| Historical navigation heap around 1.44-1.50 MB; internal DMA/byte-accessible free heap around 48 KB | Log masks are now traced. The third value is default-heap minimum-free, not a third current heap. Largest contiguous allocation and true runtime costs remain open. |

Projection allocates/frees a buffer per draw callback, and block loading allocates
coordinate buffers per entry. A decoded saved 1123-entry fixture requires 1741
projection calls per map iterator, before route/arrow work. See the mining report
for payload formulas and the distinction between load peaks and resident memory.

`BlockNavigationRunTime` measures route matching, not map loading/drawing.
The earlier “0-2 ms map load” interpretation is wrong. The planned <=200 ms
frame time and <=512 KB block budget are targets, not established measurements.

## Phone, data, and transfer bottlenecks

- OSM downloads and preprocessing run on the phone. Historical dense responses
  reached ~13 MB uncompressed. Long/dense routes cost network time, JS memory,
  map matching work, file bytes, transfer time, and device redraw work separately.
- Overpass can throttle or fail. Provider timing in old notes is historical.
  The current cache is `cc700-osm-v3`, cell schema 7, with a 30-day policy.
- Cells are about 0.05 x 0.08 degrees, selected with ~550 m reach. The styled
  main-road range of 1 km does not itself guarantee that every necessary cell
  was downloaded near cell boundaries; this needs a boundary test.
- Cached data can be missing or old offline. Browser storage persistence is
  not a permanent offline-map guarantee.
- BLE sends 200-byte payloads and waits for acknowledgements every ten packets;
  large routes take longer. OnelapFit holding the connection, advertising/power
  state, browser support, and reconnect/retry behavior are separate failure causes.
- Data simplification is intentional. Displayed paths/roads do not establish
  access permission or complete OSM coverage. Separate cycle-lane markings and
  general POI symbols remain unimplemented.

## Verification boundary and remaining work

Checked during this mining pass:

- `node --test tools/test_preview.mjs`: 5/5 pass.
- Saved `ota_1_v16.bin`: checksum/SHA rebuild is byte-identical using `espimg.py`.
- Saved v16 ELF section layout inspected; current source and route/map budgets read.

These checks do not execute the ESP32 firmware or prove pixel equivalence.
The host renderer stubs map text, and the browser preview is a separate drawing
implementation. Some README visuals predate the final v16 changes, per the last
Claude session. Current historical coverage is two commute directions and selected
public city scenes, not all route geometries or regions.

Known open items:

1. Ride validation of advancing prompts, off-route/backward maps, dense moving
   redraw, close turns, finish behavior, and route contrast in sunlight.
2. Two historical failures in 12 offline edge cases: noisy GPX produces excess
   turns; sparse GPX misses turns. The edge suite is outside this repository and
   was not rerun against current HEAD during this review.
3. Worst-case frame time, internal/PSRAM peaks, large block behavior, long routes,
   and crossing/loop map selection.
4. Smaller font, close-turn auto-zoom, night palette, map preservation across app
   reroute, general POIs, and cycle-lane markings. Mining now identifies smaller
   built-in fonts with umlaut coverage, a light-state accessor, and existing
   conditional zoom logic; these features are not implemented by this discovery.
5. Durable latest-patch preservation. Current source was rebuilt byte-identically
   to saved v16; the complete command and hashes are in the mining report. The
   temporary build and rollback artifacts still need preservation.
6. Off-route map drawing: binary evidence shows the stock draw gate remains in
   v16. Loading a block by position does not bypass it. No fix was made.

## Device workflow constraints

- Ask before firmware/storage writes or coredump reads, as required by the owner
  in the historical handoff. Reading through esptool can also reset the device;
  coordinate access before interrupting a ride.
- Synchronize current storage before every storage edit, then write and verify
  changed blocks. An old snapshot previously corrupted a LittleFS log.
- A device staying off after esptool reset is not proof of a bad image. Historical
  recovery involved unplugging USB, waiting, and a long power-button press.
- JTAG scripts must handle both cores and promptly resume them. A cpu1 breakpoint
  previously froze the device while a script watched only cpu0.
- Keep firmware dumps, private rides, and addresses out of public git. Use public
  routes for README examples. No commit, push, flash, or storage write was made
  as part of this review.
