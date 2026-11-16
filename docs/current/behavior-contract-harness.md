# Offline extracted behavior contracts

`tools/behavior_contract.py` makes a small set of already extracted CC700
branches executable on the host. It is a **manually transcribed extracted model**.
It does not execute firmware instructions, compare a running firmware result,
perform differential instruction testing, or provide a complete simulator.
A passing test protects the transcription against regression; it does not prove
runtime equivalence, successful device cleanup, or that an arbitrary firmware
change is ready for a ride.

No device, firmware image, debugger, configuration change or network access is
needed to run these tests:

```sh
python3 -m unittest discover -s tools -p test_behavior_contract.py -v
```

The module has no third-party dependencies or implicit reset state. Callers
supply the previous state and post-geometry values explicitly. Dataclass state
objects are immutable. Unsupported inputs raise `UnsupportedInput`, a subclass
of `ValueError`, rather than receiving an invented firmware interpretation.

## Supported contracts and evidence

| API | Executable boundary | Evidence |
|---|---|---|
| `offroute_candidate(P, Q, A, S)` | Final distance selection, uint32 multiplication wrap and strict substitution comparison, ordered angle/speed decision, and whether output uses projected, center or input coordinates | [Route extraction](route-state-extraction.md), `0x4204bd9f..0x4204be06`, `0x4204bf49..0x4204bfa3` |
| `persist_offroute(state, candidate, ...)` | Normal-completion candidate change/reset, uint16 increment before saturation, commit, proximity flag, mode-1 reset | [Route extraction](route-state-extraction.md), `0x4204bf68..0x4204bff5` |
| `select_heading(...)` | Speed/course/cache/magnetic branch, context heading and direct mode-1 map-heading update | [Navigation extraction](navigation-behavior-extraction.md), `0x4204dfe0..0x4204e049` |
| `set_heading(...)` | One subtraction above 360; mode-zero truncation/rejection counter and unusual unchanged previous-heading state on small differences | [Navigation extraction](navigation-behavior-extraction.md), `0x4204a504..0x4204a55b` |
| `gui_elapsed`, `timer_expired`, `advance_gui_clock` | Modular uint32 subtraction, unsigned elapsed threshold and the identified +2 GUI clock writer | [Lifecycle audit](lifecycle-audit.md), `0x42021420..29`, `0x42022557..60`, `0x42037e04..0c` |
| `replay_transition(...)` | Three core-pointer/config-0 guards before either request direction, unchanged-request guard, selected scalar state writes and source/cleanup intent | [Native replay contract](native-replay-contract.md), `0x420b5764..0x420b5852` |
| `ride_replay_request(...)` | Observed STARTING, LOADING, ENDING and ENDWITHOUTFIT calls to the wrapper; failed LOADING produces no call | [Native replay contract](native-replay-contract.md), `0x42042605..0a`, `0x420426f1..0x42042705`, `0x42043900`, `0x42041baf` |

Private evidence used to cross-check the transcription is under
`.local/cc700-evidence-20261113/mining/`: `geometry-matcher.txt`,
`zoom_frame.txt`, `heading_set.txt`, and
`replay-contract-activation-gnu.txt`. Public provenance and image hashes remain
in the source reports and their sanitized manifests. These files are evidence
inputs to manual review, not a hidden runtime dependency of the harness.

## Inputs and returned state

`P` and `Q` are already converted unsigned uint32 distances. `A` is already
truncated signed angle difference, without circular normalization. This module
does not derive them from positions or floating-point distances. The decision
returns `distance`, `candidate`, `center_substituted`, and `output_position`.
`center_substituted` records the strict `uint32(10*P) < Q` choice; a subsequent
`D > 50` still makes `output_position` be `input`. It returns coordinate-source
labels, not constructed coordinates.

`OffrouteState(previous_candidate, committed, count)` uses Boolean-valued
candidate/state bytes and the full uint16 counter domain. A changed candidate
starts at count zero. Ten matching evaluations after that change commit it,
so eleven evaluations including the change are required in both directions.
A starting count of 65535 wraps to zero before the saturation check. Search
mode 1 resets the counter whenever the resulting committed state is one.
The returned proximity flag uses the committed state, `D <= 24` and `P > 150`.
No invocation count is converted to elapsed seconds.

Heading inputs and each modeled arithmetic result are rounded to binary32.
The course input is a signed int32 word: the source selector uses `float.s`
before division by 1000. This distinction is observable at course 16777217,
which converts to binary32 16777216 before division. NaN **speed** follows the
proven comparison-false fallback path. Nonfinite cache, magnetic values and
setter arithmetic are excluded. Magnetic heading is only consumed when its
branch is selected. The fast speed branch does not check the GPS validity
byte; a course of zero retains the cache. No cache initialization is inferred.

Timer inputs are uint32 words. `timer_expired` answers only whether the elapsed
threshold is satisfied. Callback/pause/repeat/object conditions and GUI service
ordering remain outside it. `advance_gui_clock(now, callbacks)` counts explicit
+2 writer invocations, including arbitrarily many wraps. With an ordinary
same-parity baseline, elapsed cannot reach odd `0xffffffff`; the test also
shows that the general threshold can be true at that value with another clock
history. No infinity sentinel is introduced, and no wider accumulated elapsed
value survives a wrap.

`ReplayState(active, result, logical_timestamp, previous_timestamp,
first_record, preskip)` deliberately models only these scalar fields.
`core_buffers` is a tuple of three explicit presence flags, `config0` is the
already queried Boolean value, and `source_open` is an externally supplied
success/failure for an accepted activation. `None` is accepted only when no
open is reached. The source helper's already-open success is included in a
true supplied result; no source is opened by Python.

A guarded or unchanged request preserves every modeled field. An accepted
activation resets result even on open failure; failure also clears active.
The first-record/preskip flags follow the extracted ID-2/ID-3 branches.
When the preskip condition is false, the wrapper does **not** write the preskip
byte, so the model retains it rather than inventing a clear. Deactivation
writes result 2 and invalidates both timestamps while retaining the two flag
bytes, which that branch does not write.

`open_required` and `cleanup_required` report external-operation intent, not
completed operations. In particular, the deactivation branch uses smaller
buffer pointers without independent guards. A selected cleanup path does not
prove allocation-failure safety, successful zeroing, source closure, task
termination or subsequent live GPS selection. A false config-0 value gates
out cleanup too. Changing configuration is not a modeled stop operation.

`ride_replay_request` returns 0 or 1 for an observed wrapper call and `None`
when the loading helper failed and no call occurs. Loading requires an
explicit signed-int32 helper result. Other ride states raise `UnsupportedInput`;
this is not a complete ride state machine or a resume-event producer.

## Fixtures and verification

The 27 tests use hand-derived boundary fixtures and explicit sequences. They
cover strict distance ties, uint32 multiply overflow, 50/51 and 99/100 distance
boundaries, 149/150 center-distance and 30/31 angle boundaries, both signs at
150/151 and 209/210, zero speed, negative speed, both persistence directions,
interrupted candidate runs, count 65534/65535, proximity boundaries, mode-1
reset, course-zero and NaN-speed branches, binary32 course conversion, heading
normalization and the seventh large-difference update, timer threshold/wrap/
parity, replay gates in both directions, open failure, retained preskip and
ride loading failure.

The tests were written first: the initial 25 failed with explicit missing-
contract assertions; implementation then passed all 25. The later ride-call
fixture was separately observed failing before its implementation. The
composition fixture then exercised the existing decision and persistence
contracts across a complete leave/return sequence. Temporary test scaffolding
was removed after green; the shipped tests assert behavior directly.

A separate temporary-copy mutation check changed 16 meaningful branches or
state writes, one at a time. Every mutation produced failing behavioral
assertions: multiplication wrap, strict substitution tie, distance threshold,
angle threshold, counter wrap, commit threshold, mode-1 reset, course-zero
handling, single normalization threshold, small-difference previous state,
modular timer subtraction, timer threshold equality, replay guard order,
unchanged-request result retention, retained preskip and loading-result gate.
The mutation experiment was a sensitivity check, not additional firmware
coverage or proof against all possible transcription mistakes.

Final verification in this workspace: the scoped command above passed 27/27;
`python3 -m unittest discover -s tools -p 'test*.py'` passed 77/77, including
the concurrently added renderer and replay-observation tests. The broader Node
command (`node --test tools/test_preview.mjs tools/test_app_offline.mjs
tools/test_route_decisions.mjs tools/test_route_historical.mjs`) exited 1:
preview/offline tests passed, the synthetic side-street-noise case remains a
known TODO, and historical `GPS recording, 3 m noise` and `planner export,
every 8th point` failed their turn-count expectations. Those route-generator
limitations are outside this extracted model. `tools/test_route.mjs` is a
parameterized route-generation CLI, not a Node test-runner suite.

## Deliberate exclusions

This harness does not model nearest-point ties, candidate group arbitration,
projection/fit/coordinate arithmetic, geometry degeneracy, raw float-to-int
conversion exceptions, `INT32_MIN` absolute value, matcher early failures,
unknown search modes, cache initialization, other heading/cache writers,
config parsing or source enumeration, FIT decoding, record scheduling,
queue identity/consumption, GUI callbacks, allocation or filesystem effects,
renderer behavior, concurrency, or hardware timing. Its Boolean replay domain
accepts requests/flags 0 and 1 only, despite the wrapper taking a byte.

Nonfinite off-route inputs, floating distances/angles, out-of-range integer
words, and mode-zero differences requiring unsupported signed conversion are
rejected. Explicitly excluded paths are not marked as passing. Extending this
model requires a new evidence-backed contract and boundary fixtures; completing
an excluded behavior by assumption would weaken its purpose.
