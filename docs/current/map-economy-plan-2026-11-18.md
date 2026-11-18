# Map Economy Step 1 and C-Code Studies: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 70 km routes build on the page with fills that follow the context cap (F) and chained lines (Part A). Then measure, on the host only, the open questions that block the new device C code (Part B).

**Architecture:** Part A changes only the page generator (`js/mapsec.js`, `js/map_geometry.js`). The firmware and the file format do not change: v21 draws the new files. Part B adds measurement scripts in `.local/study/` and writes the results to a private report. Part B changes no committed code. The C plan for steps 2 and 3 is written after Part B, from its numbers.

**Tech Stack:** Node.js ES modules with `node:test`. Python 3 (`-I`). No new libraries.

**Spec:** The combination study: artifact `https://claude.ai/artifact/BjdkPmRCA7AMeCEjS8GyQJ`, sections `#study` to `#decide`. The private notes are in `.local/wayback/device/report-20261118.md`, section "Combination study". Read also `AGENTS.md` and `docs/current/budget-plan-2026-11-16.md`.

## Decisions

- **D1 (needs the owner's yes before Task A1):** fills follow the context cap (F). Rule: when a block's context cap is below 600 m, the fill window is the cap. Else it stays as today.
- **D2:** chained lines. Same-style line runs (classes 5 to 11) join at an exact shared end point (same semicircle integers). A join is made only when the joined run has at most 60 points (`MAXPTS`). Water lines (class 4) do not join.
- **D3:** no change to `AHEAD` (300), `BEHIND` (400), the budgets in `js/map_budget.js`, or the 4,000,000 B guard.
- **D4:** the page keeps writing CCWB version 1. The test unit reads only version 1.

## Global Constraints

- Host only. Do not run `esptool`, `flash.sh`, or any command that opens a USB or serial device.
- Do not edit files in `../cc700-patch`, `firmware/`, or `docs/STATUS.md`.
- Stage only the files that a step names. Never use `git add -A`, `git add .` or `git commit -a`. Never push.
- The repository is public. Do not write coordinates, ride data or `.local/` content into a committed file. Private outputs go to `.local/study/out/` (git ignores `.local/`).
- Do not use the network. The study inputs are local: `.local/study/m90/cells/` (OSM cells from the local PBF), `.local/study/m90/t70.gpx`, and the city route file `.local/wayback/device/mining-delta-20261117T233933Z/files/NAVIGATION/route_11171310.bin`.
- Write docs and commit messages in ASD-STE100: short sentences, one idea in each sentence, active voice.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not change a number in "Decisions". Do not add options that this plan does not name.
- If a step fails and the fix is not in this plan, stop and report. Do not weaken a test. Do not tune a value to make a gate pass.
- Every number in a results doc must come from a command that you ran. If a value is missing, write "not measured".

## Review Focus

1. **A fill that the cap cuts must lose its outline.** Today a clipped ring gets style bit `0x400` (no outline), so the cut edge does not draw as a shore. F cuts more rings. Test in Task A1.
2. **A join must never exceed 60 points**, also when three or more runs meet at one point. Test in Task A2.
3. **A join must never mix styles** (bridge, tunnel, level, far bit, rough bit). Test in Task A2.
4. **Identical source gives identical bytes** after chaining (the order of joins is fixed). The existing test `all transitions are bounded and output is deterministic` covers it. Run it in Task A2.
5. **A closed loop of runs** (the end of the last run is the start of the first) must not loop forever. Test in Task A2.

## File Structure

| File | Responsibility |
|---|---|
| `js/mapsec.js` | Fill window rule (A1). Grouping of line runs by style and the call of `chainRuns` (A2). |
| `js/map_geometry.js` | New pure function `chainRuns`. No style knowledge. |
| `tools/test_adaptive_map.mjs` | Fill window tests (A1). |
| `tools/test_map_geometry.mjs` | `chainRuns` unit tests (A2). |
| `tools/test_map_contract.mjs` | Chaining through `buildRoute` (A2). |
| `docs/current/map-limits.md` | Records the new fill rule and the chaining rule (A3). |
| `docs/research/map-economy-step1-2026-11-18.md` | Public results of A3 (numbers only). |
| `.local/study/` | Study scripts and private outputs (Part B). Not in git. |

---

## Part A: Step 1 (page only)

### Task A1: Fills follow the context cap (F)

**Files:**
- Modify: `js/mapsec.js:350-352`
- Test: `tools/test_adaptive_map.mjs:71-76`

**Interfaces:**
- Consumes: `buildStyledSection(sections, data, F)` in `js/mapsec.js` (no signature change).
- Produces: no new names.

- [ ] **Step 0: Record the validation before any change**

Run: `mkdir -p .local/study/out && python3 -I tools/validate_local.py > .local/study/out/validate_before.txt 2>&1`
Expected: the command ends. Keep the file. Task A2 compares with it.

- [ ] **Step 1: Replace the test at `tools/test_adaptive_map.mjs:71-76` with these three tests**

The old test asserted that a ring stays uncut at cap 300. Decision D1 changes that rule, so the old test goes.

```js
const styleOfEntry=e=>parse(Uint8Array.from(e)).find(f=>f[0]===2)[2];
const greenOf=r=>decode(r)[0].find(e=>(styleOfEntry(e)&15)===2);
test('reduced context keeps a fill that is inside the cap unchanged',()=>{
 const data={green:[[[p(100,0),p(250,0),p(250,200),p(100,200)]]],lines:[{kind:1,pts:[p(340,0),p(340,200)]}],opt:options()};
 const a=buildStyledSection(sections(1),data,F),b=buildStyledSection(sections(1),{...data,opt:options({mapBudget:{projectionCalls:2}})},F);
 assert.equal(b.stat.blocks[0].contextRadiusCap,300);
 assert.deepEqual(greenOf(b),greenOf(a));
});
test('reduced context cuts a fill at the cap and the cut fill has no outline',()=>{
 const data={green:[[[p(100,0),p(400,0),p(400,200),p(100,200)]]],lines:[{kind:1,pts:[p(340,0),p(340,200)]}],opt:options()};
 const a=buildStyledSection(sections(1),data,F),b=buildStyledSection(sections(1),{...data,opt:options({mapBudget:{projectionCalls:2}})},F);
 assert.equal(b.stat.blocks[0].contextRadiusCap,300);
 assert.equal(styleOfEntry(greenOf(a))&0x400,0);
 assert.equal(styleOfEntry(greenOf(b))&0x400,0x400);
 assert.notDeepEqual(greenOf(b),greenOf(a));
});
test('a cap of 600 m or more keeps the fill window of today',()=>{
 const data={green:[[[p(100,0),p(550,0),p(550,200),p(100,200)]]],opt:options()};
 const r=buildStyledSection(sections(1),data,F);
 assert(r.stat.blocks[0].contextRadiusCap>=600);
 assert.equal(styleOfEntry(greenOf(r))&0x400,0);
});
```

- [ ] **Step 2: Run the tests and make sure that only the second new test fails**

Run: `node --test tools/test_adaptive_map.mjs`
Expected: `reduced context cuts a fill at the cap and the cut fill has no outline` FAILS (the bit `0x400` is 0). All other tests PASS. If another test fails, stop and report.

- [ ] **Step 3: Change the fill window rule in `js/mapsec.js:352`**

New line 352:

```js
  const areaR = contextRadiusCap < AREA_R ? contextRadiusCap : Math.max(AREA_R, Math.min(contextRadiusCap, coverageFloor));
```

Replace the comment at lines 350-351 with: `// Fills use the 600 m window. A block with a context cap below 600 m cuts its fills at the cap (D1, 18 Nov). A cut ring has no outline (bit 10).`

- [ ] **Step 4: Run the tests**

Run: `node --test tools/test_adaptive_map.mjs tools/test_map_budget.mjs tools/test_map_contract.mjs tools/test_map_coverage.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add js/mapsec.js tools/test_adaptive_map.mjs
git commit -m "Cut fills at the context cap when the cap is below 600 m

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task A2: Chained lines

**Files:**
- Modify: `js/map_geometry.js` (add `chainRuns` at the end)
- Modify: `js/mapsec.js:363-372` (the line loop of `styledEntries`)
- Test: `tools/test_map_geometry.mjs`, `tools/test_map_contract.mjs`

**Interfaces:**
- Produces: `export function chainRuns(runs, keyOf, maxPts)` in `js/map_geometry.js`.
  - `runs`: array of runs. A run is an array of points (any type). Each run has at least 2 points.
  - `keyOf(point) -> string`: two points with the same key are the same point.
  - `maxPts`: integer. No output run made by a join has more than `maxPts` points. An input run that is already longer passes through unchanged.
  - Returns a new array of runs. Each input point is in the output. The input arrays are not changed.

**The join rule** (the same as the study model `econ22/q4_chain.py` `chain()`, with a strict length check):

1. Index each run by the key of its first point and of its last point.
2. Take the runs in input order. Skip a run that is already used. Mark it used. It is the current line.
3. Extend the end: find the first unused run (in input order) that starts or ends at the key of the line's last point, and for which `line.length + run.length - 1 <= maxPts`. Orient it so that it starts at that point. Append it without its first point. Mark it used. Repeat until no run is found.
4. Extend the start in the same way, at the line's first point. Prepend the run (oriented to end at that point) without its last point.
5. Output the line.

A run whose two ends are the same point (a loop) is one run. A chain of runs that closes a loop stops because each run is used only once.

- [ ] **Step 1: Write the failing unit tests in `tools/test_map_geometry.mjs`**

Add `chainRuns` to the import from `../js/map_geometry.js`.

```js
const K=p=>p.join(',');
const run=(...xs)=>xs.map(x=>[x,0]);
test('chainRuns joins two runs that share an end point',()=>{
 assert.deepEqual(chainRuns([run(0,1),run(1,2)],K,60),[run(0,1,2)]);
});
test('chainRuns turns a run around to join it',()=>{
 assert.deepEqual(chainRuns([run(0,1),run(2,1)],K,60),[run(0,1,2)]);
});
test('chainRuns joins at the start of the line',()=>{
 assert.deepEqual(chainRuns([run(1,2),run(0,1)],K,60),[run(0,1,2)]);
});
test('chainRuns never makes a joined run longer than maxPts',()=>{
 const a=Array.from({length:40},(_,i)=>[i,0]),b=Array.from({length:30},(_,i)=>[39+i,0]);
 const out=chainRuns([a,b],K,60);
 assert.equal(out.length,2);assert(out.every(r=>r.length<=60));
});
test('chainRuns joins at most two of three runs that meet at one point',()=>{
 const out=chainRuns([run(0,1),run(1,2),[[1,0],[1,5]]],K,60);
 assert.equal(out.length,2);assert.deepEqual(out[0],run(0,1,2));
});
test('chainRuns stops on a closed loop and keeps every run once',()=>{
 const out=chainRuns([run(0,1),run(1,2),[[2,0],[0,0]]],K,60);
 assert.equal(out.length,1);assert.equal(out[0].length,4);
});
test('chainRuns does not change its input',()=>{
 const a=run(0,1),b=run(2,1),copy=structuredClone([a,b]);
 chainRuns([a,b],K,60);assert.deepEqual([a,b],copy);
});
```

- [ ] **Step 2: Run the tests and make sure that they fail**

Run: `node --test tools/test_map_geometry.mjs`
Expected: FAIL. The message says that `chainRuns` is not exported.

- [ ] **Step 3: Write `chainRuns(runs, keyOf, maxPts)` in `js/map_geometry.js` to the join rule above**

- [ ] **Step 4: Run the unit tests**

Run: `node --test tools/test_map_geometry.mjs`
Expected: all PASS.

- [ ] **Step 5: Write the failing integration tests in `tools/test_map_contract.mjs`**

```js
test('two minor roads that meet end to end become one entry',()=>{
 const a={kind:3,name:'North',pts:[at(50,-100),at(50,1500)]},b={kind:3,name:'South',pts:[at(50,1500),at(50,3200)]};
 const lines=b=>b.filter(e=>(e.style&15)===6);
 for(const blk of new Set(make([a,b]).blocks)) {
  const ls=lines(blk);
  assert.equal(ls.length,1,'one entry per block for the joined road');
 }
});
test('a bridge never joins the road before it',()=>{
 const a={kind:3,name:'Road',pts:[at(50,-100),at(50,1500)]},b={kind:3,name:'Bridge',fl:1,pts:[at(50,1500),at(50,1600)]};
 const blk=make([a,b]).blocks.find(x=>x.some(e=>(e.style&15)===6 && (e.style&0x80)));
 const ls=blk.filter(e=>(e.style&15)===6);
 assert(ls.some(e=>e.style&0x80) && ls.some(e=>!(e.style&0x80)));
});
```

- [ ] **Step 6: Run the integration tests and make sure that the first one fails**

Run: `node --test tools/test_map_contract.mjs`
Expected: `two minor roads that meet end to end become one entry` FAILS (2 entries). The bridge test PASSES.
If the first test passes before Step 7, an earlier stage already joins these roads. Stop and report.

- [ ] **Step 7: Group the runs by style and chain them in `styledEntries` (`js/mapsec.js:366-372`)**

Import `chainRuns` from `./map_geometry.js` (line 5). In the line loop:

- Compute `const st = styleOf(cls, fl | far)` for each run.
- If `cls >= S.MAJ && cls <= S.TRAM`: push the run to `groups.get(st)` (a `Map`, made before the loop; insertion order is the order of the first run of each style). Do not push an entry yet.
- Else (class 4, water lines): push the entries as today.
- After the loop: for each `[st, rs]` of `groups`, for each `r` of `chainRuns(rs, q => sc(q[0]) + ',' + sc(q[1]), MAXPTS)`, push the 60-point pieces of `r` with the same `for (let s = 0; ...)` loop as today.

The label step and the dot step after the loop do not change.

- [ ] **Step 8: Run all map tests and the full node list**

Run: `node --test tools/test_map_geometry.mjs tools/test_map_contract.mjs tools/test_adaptive_map.mjs tools/test_map_budget.mjs tools/test_map_coverage.mjs tools/test_map_labels.mjs tools/test_map_order.mjs tools/test_device_parity.mjs tools/test_preview.mjs tools/test_map_benchmark.mjs tools/test_map_policy_study.mjs`
Expected: all PASS. If a test that asserts an entry count or a byte count fails, stop and report the test name and the two values. Do not change that test.

- [ ] **Step 9: Run the local validation**

Run: `python3 -I tools/validate_local.py > .local/study/out/validate_after.txt 2>&1`
Expected: the same pass and fail lines as `.local/study/out/validate_before.txt` (Task A1, Step 0).

- [ ] **Step 10: Commit**

```bash
git add js/map_geometry.js js/mapsec.js tools/test_map_geometry.mjs tools/test_map_contract.mjs
git commit -m "Join same-style map lines that share an end point, up to 60 points

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task A3: Measure step 1 and record the result

No code change. All outputs go to `.local/study/out/`. Make that folder first.

- [ ] **Step 1: Build the 70 km route and the city route with the changed page code**

```bash
cd .local/study/m90
node build.mjs cells t70.gpx ../out/t70S1.bin > ../out/t70S1.json 2> ../out/t70S1.err
node build.mjs cells /Users/baris/cc700-map/.local/wayback/device/mining-delta-20261117T233933Z/files/NAVIGATION/route_11171310.bin ../out/cityS1.bin > ../out/cityS1.json 2> ../out/cityS1.err
```

Expected: both commands exit 0. `t70S1.err` has no line `FAILSEC`. (Today's page code refuses the 70 km route. That is the main result of step 1.)

- [ ] **Step 2: Count the map coding levers on the new files**

```bash
cd .local/study
ROUTE=$PWD/out/t70S1.bin python3 -I econT/combo.py > out/combo_t70S1.json
ROUTE=$PWD/out/cityS1.bin python3 -I econT/combo.py > out/combo_cityS1.json
```

Expected: one JSON line in each file. Read `blocks`, `cur`, `callsMax`, `decodedMax`, `D_exact`.
Reference values for F without chaining (`m90/combo_t70F.json`): `blocks` 78, `cur` 3,979,078, `callsMax` 1,395, `decodedMax` 53,464, `D_exact` 1,364,636.

- [ ] **Step 3: Run the ride-along compare**

```bash
cd .local/study/m90
node ridealong.mjs t70 100 250 ../out/ride_t70S1.json R=t70R.bin T=t70T.bin S1=../out/t70S1.bin
node ridealong.mjs city 25 50 ../out/ride_cityS1.json R=cityR.bin T=cityT.bin S1=../out/cityS1.bin
node sumride.mjs ../out/ride_t70S1.json
node sumride.mjs ../out/ride_cityS1.json
```

Gates for `S1`, in both routes. If a gate fails, stop and report. Do not tune.

| Field | Gate | F before chaining (70 km / city) |
|---|---|---|
| `emptyTopPositions` | 0 | 0 / 0 |
| `topBandMissVsFull` | at most 0.005 on 70 km, at most 0.025 on the city route | 0.0026 / 0.020 |
| `nearMissVsFull` | at most 0.001 | 0.0004 / (read from `m90/ride_city.json`) |

Report also `nearSameAsTodayShare`, `nearDiffTodayPx.p90` and `frameCalls` (no gate).

- [ ] **Step 4: Write `docs/research/map-economy-step1-2026-11-18.md`**

Content, in ASD-STE100, numbers only (no coordinates, no place names):
- What changed (D1, D2) and why (one sentence each).
- A table: blocks, map bytes, `callsMax`, `decodedMax`, `D_exact` for T (today, 70 km refused), F, F + chaining. Use the reference values above and your Step 2 values.
- The Step 3 table with the gates.
- Gaps: "Not run on the device. Frame time not measured. The dash phase of a path now runs on across a joint; the effect on the device screen is not checked."

- [ ] **Step 5: Update `docs/current/map-limits.md`**

In the table "Current generation settings", change the row "Area/rail/tram/waterway coverage" note to say: fills use 600 m; a block with a context cap below 600 m cuts its fills at the cap. Add one row: "Line chaining | same style, exact shared end point, at most 60 points | Fewer entries and projection calls; dash phase runs on across a joint".

- [ ] **Step 6: Commit**

```bash
git add docs/research/map-economy-step1-2026-11-18.md docs/current/map-limits.md
git commit -m "Record the step 1 map economy measurements

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part B: Studies that the C code needs (host only)

Part B makes no committed change. Each task writes one section in `.local/study/out/c-study.md`. Each section has: the question, the command, the numbers, and the answer in one sentence.

### Task B1: Read cost of a 6-byte way-back node

**Question.** The 6 B node (P6: `x11 y11` inside the cell, `next` as a 13-bit index delta, `dist` 13 bits at 0.5 m) stores no absolute position. The core walks `next` from node to node to draw the line back to the route. Each time `next` goes into another cell, the core must find that cell's record. The study counted the read cost of the window, but not of this walk. How many reads does the walk need?

**Layouts to compare** (bytes and reads on the same 1,500 rider points that `detour.mjs` part 4 uses):

| Id | Node | How the walk finds the position of `next` |
|---|---|---|
| L12 | today, 12 B, absolute `X u24 Y u24` | no lookup |
| L6 | P6, 6 B | binary search of the cell table by node index: `ceil(log2(cell_count))` reads for each cell change |
| L6c | P6, 6 B | as L6, but a cell in the 5 x 6 window (128 m cells, 5 wide, 5 ahead, 1 behind) costs 0 reads |
| L8 | 8 B: `X u20 Y u20` (1/16 m, so at most 65.5 km on each axis), `next` 12-bit delta, `dist` 12 bits at 1 m | no lookup |

**Files:** Create `.local/study/b1_walk.mjs`.

- [ ] **Step 1:** Write `b1_walk.mjs <file.ccwb> <route.gpx> <out.json>`. It decodes the file with `decodeWayback` from `js/wayback_format.js`. It takes the rider points as `detour.mjs` makes them: copy its route reading, `rnd` (seed 7) and the rider loop (lines 10 to 64) without change. For each rider point it takes the nearest node, walks `next` for at most 32 points, and counts for each layout: node block reads (`ceil(nodes*size/192)` as in `detour.mjs` line 83), cell lookups, and the total. It prints p50, p90 and max for each layout, and the file size of each layout: `64 + cells + nodes*size + extras*8 + escapes*8`. An escape is a `next` delta that does not fit the field.
- [ ] **Step 2:** Run it on `m90/t70-v0k3.ccwb` (70 km, 3 km reach) and on `m90/t70-v0.ccwb` (2 km reach).
- [ ] **Step 3:** For L8, report how many nodes are outside 65.5 km on an axis (0 is expected) and the share of `dist` values above 4,095 m.
- [ ] **Step 4:** Write the section. The answer names the layout with the lowest total reads that is under 1.1 MB for the 3 km file.

### Task B2: Map point coding that the stock decoder can read

**Question.** Scheme D (exact delta, 1.36 MB for 70 km) has no protobuf framing. The stock firmware decodes each map block with its own protobuf decoder before the patch draws it. Scheme D thus needs a new block decoder in the firmware. A smaller change keeps the protobuf records and stores each point (field 6, sub-fields 1 and 2) as the difference from the previous point (the first point from the centre, fields 3 and 4). The patch then adds the differences in `draw_entry` (`../cc700-patch/src/map.c`). How many bytes does that smaller change save?

**Files:** Create `.local/study/econT/b2_pbdelta.py`. Use `econT/common.py` and `econT/geom.py` (the same block reader as `combo.py`).

- [ ] **Step 1:** Write `b2_pbdelta.py`. For each block it re-encodes each non-label entry with the record layout of `econT/common.py` `encode_record`, but with each field-6 value replaced by the zigzag difference from the previous point. Label entries (class 12) do not change. It prints one JSON line: `cur`, `pbDelta`, `D_exact`, and the ratios `pbDelta/cur` and `D_exact/cur`.
- [ ] **Step 2:** Check the encoder: with the differences set back to absolute values, the sum must equal `cur` exactly. If it does not, stop and report.
- [ ] **Step 3:** Run it with `ROUTE` set to `out/t70S1.bin` and `out/cityS1.bin`.
- [ ] **Step 4:** Write the section. Give the 70 km total for F + chaining with each coding: map bytes + way-back 3 km file (choose the B1 answer) + the route part 265,176 B. Mark each total as host bytes, and add the unit estimate at the factor 1.19.

### Task B3: Owner questions to collect (no measurement)

- [ ] **Step 1:** Add a last section "Open for the owner" to `c-study.md` with these lines, unchanged:
  - Free storage on the unit after the wipe: not known. Every total in B1 and B2 must be compared with it.
  - cc24 crash cause: not known. The window drawing (step 2) and the delta drawing (step 3) both draw on the same path.
  - Code room: 4,376 B usable, and the way-back test core already uses 4,284 B. Steps 2 and 3 need a second code area.

---

## After this plan (not for this executor)

These items need firmware reading (disassembly) or a device step. They are not host measurements, so they are not tasks here. The next plan (steps 2 and 3 in C) starts from their results and from Part B.

1. **A second code area.** Find unused, mapped flash room in the cc23 image that the instruction bus can run.
2. **Who reads decoded map points.** Find each firmware function, other than the patch, that reads `ent_t.pts` of the current block. If one exists, stored differences break it.
3. **A guard against old firmware.** A v21 unit would draw a delta file as garbage. The page must write delta points only for a firmware that reads them, and the unit must refuse a delta file that it cannot read.
4. **State across frames.** The patch has no writable globals (`patch.ld` asserts it). The 5 x 6 window cache (about 10 KB) needs one RAM word that keeps its pointer between frames.
5. **Frame time on the unit.** A device step, after the cc24 cause. It needs the owner's approval, a hypothesis, a bounded duration and the restore step.
