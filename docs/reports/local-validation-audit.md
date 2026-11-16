# Local application and simulation audit

2026-11-14 update: the [v17 review](v17-review-2026-11-14.md) supersedes the
point-list domain assumption in the helper probes below. The real firmware list
contains detailed points, while those toy cases use one segment per section.
Passing them does not establish section-domain hysteresis in the actual loader.

2026-11-13, application HEAD `24b8617`. This pass used Node `24.22.1`,
Python `3.15.0`, and Apple clang `21.0.0` on the host. It read the
[technical context](technical-context.md) and [exploration map](exploration-map.md),
then executed existing application and patch code locally. There was no device
access, network request, firmware/storage write, source feature change, or commit.
Private input files stayed outside the repository. This report records aggregate
results without their coordinates, road names, route identifiers, or binaries.

## Commands and outcomes

Commands below ran from the repository unless an absolute path is shown. Temporary
audit scripts and generated artifacts are under `/private/tmp/cc700-local-validation/`;
they are not a new simulator or a permanent regression suite.

| Command | Observed outcome |
|---|---|
| `node --test tools/test_preview.mjs` | Exit 0; 5 tests passed, zero failures. |
| `for f in js/*.js tools/*.mjs sw.js; do node --check "$f" \|\| exit; done` | Exit 0; all current JavaScript sources and tools parsed. |
| `node /private/tmp/cc700-local-validation/recovered-edge.mjs ../cc700-backup/parts/fs/gpx_1112.json` | Exit 1; 10 of 12 historical cases passed; the two documented failures persist. |
| `node /private/tmp/cc700-local-validation/app-smoke.mjs` | Exit 0; four offline cache/failure probes and two synthetic long-route builds passed the stated checks. |
| `clang -shared -fPIC -DHOST -O2 ../cc700-backup/patch/src/blk.c -o /private/tmp/cc700-local-validation/block-selection.dylib` | Exit 0; existing nearest-section function compiled for host execution. |
| `python3 /private/tmp/cc700-local-validation/section-probes.py` | Exit 0; 9 deterministic `ctypes` selection probes matched the existing implementation's specified policy; saved `section-probes.log`. |
| `clang -DHOST -O2 ../cc700-backup/patch/src/map.c ../cc700-backup/patch/src/host.c -lm -o /private/tmp/cc700-local-validation/map-host` | Exit 0; current host drawing bench compiled. |
| `/private/tmp/cc700-local-validation/map-host /private/tmp/cc700-local-validation/synthetic-entry.bin 0.025 0.04 2.5 /private/tmp/cc700-local-validation/synthetic-map.ppm` | Exit 0; one synthetic entry, one draw call, 134 pixel writes; produced a PPM. This was a smoke check, not a visual comparison. |
| `git diff --check` | Exit 0 for tracked changes; this report was separately checked because it is initially untracked. |

There is no package manifest, bundler build, or application dependency installation
step in the repository. `tools/test_route.mjs` is a route-generation CLI, not a
test-runner suite: it needs an input JSON and output filename and may fetch OSM.
It was inspected rather than run with uncontrolled downloads. Its generator and
readback path were exercised directly by the recovered suite and temporary probes.
The CLI's name images are blank stand-ins, so this does not validate browser canvas
text or real device font rendering.

`observed-results.txt` in the temporary audit directory saves an explicitly
labelled aggregate transcription of the edge and smoke outputs above. It is not
a raw process log or a claim of an additional run.

## Recovered historical edge suite

`../cc700-backup/tools/edge_test.mjs` is absent. A copy was recovered under the
older Claude scratchpad's `handoff/cc700-map/tools/edge_test.mjs` (find with
`rg --files --hidden /private/tmp/claude-501 | rg '/handoff/cc700-map/tools/edge_test.mjs$'`).
The original file SHA-256 is
`76cdab9d087aed45c645b969bf417cceba9cafc85e4990f463082f006c11a706`.

The temporary `recovered-edge.mjs` preserved its inputs, assertions, deterministic
noise seed, and reporting. Only relative imports were redirected to the current
repository, and a prelude disabled real `fetch` and set `navigator.onLine = false`.
It read the existing host temporary `cc700-osm` cache; the four required road cells
have schema 7. This avoids network activity and makes offline fallback explicit.
The original suite by itself can still attempt downloads for missing cells/nodes.
The original commute fixture was used in place, without copying it into git.

| Case | Result | Turns |
|---|---|---:|
| Outbound baseline | Pass | 15 |
| Reverse direction | Pass | 14 |
| Full out-and-back, start equals end | Pass | 31 |
| Shorter out-and-back with U-turn | Pass | 19 |
| GPS recording with 3 m synthetic input noise | **Fail** | **46**, compared with baseline 15 |
| Sparse export retaining every eighth input point | **Fail** | **5**, compared with baseline 15 |
| Missing elevation | Pass | 15 |
| Duplicate points | Pass | 15 |
| Short input slice | Pass | 0 |
| Two endpoint points only | Pass | 0 |
| Two named waypoints | Pass | 15 |
| No road-line data | Pass | 14 |

The suite labels its short slice “60 m”, but the actual recovered fixture slice
produced about 90 m. “No map data” passes no road lines but still supplies cached
built-up areas; it is not a proof that every OSM layer can be absent.
The full out-and-back produced 1,014 decoded points and passed these app checks;
this says nothing about device count acceptance.

Assertions cover decoded section count, map-index count, maximum 1,200 entries,
maximum 150 decoded points per record, gaps at most 20.5 m, approximate path length,
absence of empty sections, turn-count stability for selected variants, and two
waypoint labels. The U-turn's absence would only be a note, not a failure. Prompt
correctness at each junction is not compared to independently labelled truth.
The suite's 150-point assertion is weaker than the app's current 50-point policy.
It does not enforce the 4,000,000-byte UI guard or inspect geohashes.

Thus neither historical failure was closed by current code. They are reproduced
generator defects/limitations, not firmware findings. A fix requires a separate
implementation task with a defined expected route/junction oracle.

## Additional bounded local probes

`app-smoke.mjs` used empty synthetic cell responses and a throwing `fetch` stub.
Fresh cached cells were used offline without a fetch attempt; stale schema-1 cells
were also retained offline without a fetch attempt. A missing mandatory cell
caused a rejected load when all stubbed fetches failed. Missing optional signal/
stop nodes tolerated fetch failure. These confirm these branches only: they do
not validate compatibility of arbitrary old cache payloads, downloaded cell
coverage, retry timing, or browser storage persistence.

A synthetic straight approximately 70 km route without map data was generated
for both palettes. Both round-tripped 117 records; every decoded record had at
most 31 points and a geohash info field 8. Stock output was 110,592 bytes; styled
output was 102,400 bytes. Both were below the file guard. This checks basic long
route assembly and record indexing, not long dense OSM preprocessing, map load,
CPU limits, or physical device acceptance. No extrapolated device memory/frame
budget was inferred from it.

The actual `cc_nearest_sec` in sibling `patch/src/blk.c` was invoked through a
host shared library with synthetic metre-scale coordinates:

| Probe | Observed chosen section |
|---|---:|
| Nearest straight section | 1 |
| 10 m past a section boundary, current road 0 | 0 retained |
| 30 m past boundary, current road 0 | 1 selected |
| Rider on a parallel section 10 m from current section | 0 retained |
| Same parallel geometry with invalid current road | 2, nearest section |
| Exact crossing tie with invalid current road | 0, first encountered |
| Same crossing with current road 2 | 2 retained |
| Degenerate zero-length chord then valid segment | 1 |
| Fewer than two inflection points, current road 7 | 7 returned unchanged |

These nine results confirm code behavior. They do not establish the correct block
for a real ride: current-road preference can retain a different nearby branch,
and exact crossings have no unique geometry-only answer. This function receives
section endpoints, not detailed curved geometry. Its test callback is constant
time, so it does not measure firmware linked-list traversal cost. `cc_blk` itself,
the final-block clamp, GPS acquisition, allocation, and stock off-route draw gate
are excluded by the host boundary and remain integration checks.

## Simulation layers and the remaining equivalence gap

| Existing layer | Runnable locally / what it establishes | What it cannot establish |
|---|---|---|
| App generation plus protobuf readback | Current app code, encoded layers, route structure; five preview assertions plus recovered edges and bounded probes above | Firmware parsing/count limits, prompt advancement, BLE, real canvas text |
| Browser preview | `js/preview.js` draws decoded files; actual palette/layer command paths exercised with a stub context | Device pixels, actual LVGL, map allocation, live block selection, off-route gate, physical heading |
| Historical `navsim.py` and `simtest.py` | Recovered sibling tools can replay a saved route/FIT or deterministic noisy synthetic fixes | They reimplement nearest-route-point progress and historical thresholds in Python; do not execute geohash matcher, result/popup state, queue freshness, direction gates, reroute teardown, or current firmware |
| Patch map host bench | Existing `map.c`/`host.c` compile and render a synthetic entry; actual patch passes/fills can be exercised | Text is stubbed under `HOST`; line rasterization/projection/allocators differ from target; no stock UI, scheduler, sensors, or ESP32 timing |
| Patch nearest-section host function | Actual selection C function, nine bounded probes above | Firmware list callback cost, map-loader lifecycle, nav road-index advancement, display gate |
| Full firmware emulator / matched navigation replay | No validated harness identified or created in this pass | All target behavior remains unproved until a target-equivalent execution boundary is established and compared to observations |
| Device ride/runtime observation | Outside this local audit | Only this layer can establish real moving prompts, sensor freshness, device heap/frame time, BLE reliability, sunlight visibility and physical finish behavior |

The recovered Python `simtest.py` still uses a 150-point record check, an
unconfirmed 999-*point* warning, a simplified 512 KiB map estimate, and a
linear size extrapolation to 70 km. Those are historical policies/estimates,
not newly established firmware limits. It also requires every turn icon to be
seen even where a close pair is intentionally handled by advance “then” text.
Running it indiscriminately over all backed-up route versions would conflate
old malformed files, private rides, outdated expectations and current behavior;
that broad historical sweep was not used as a completion criterion.

## Bounded outstanding work

1. Fix noisy-input excess prompts and sparse-input omissions using the recovered
   deterministic failures and independently specified expected junctions.
2. Add representative, labelled curved-section/parallel/crossing/loop fixtures
   for actual selected-block expectations, then check the complete loader and
   off-route display gate. The direct function probes already cover its basic
   hysteresis and tie behavior; rerunning those alone will not close this gap.
3. Add focused app tests for OSM corridor/cell-boundary completeness, polygon
   holes/complexity and stacking, dense map guards, malformed GPX/file input,
   and browser build/playback concurrency. Existing five preview tests are
   drawing-command assertions, not broad UI coverage.
4. Mock BLE acknowledgement/retry/disconnect and service-worker storage failure
   paths before any controlled live transfer test. No BLE API was invoked here.
5. Measure target frame time, internal/PSRAM allocation peaks and continuous
   navigation behavior on the preserved v16 baseline. Host execution time and
   a successful image render cannot substitute for these measurements.

The finite local pass is complete: recovered tests ran against current code,
known failures were reproduced, and existing host execution seams were verified.
It does not claim firmware/runtime or ride validation is complete.
