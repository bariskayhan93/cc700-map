# Target resource capture and empirical calibration

`tools/resource_calibration.py` analyzes **actual target measurements only**. No
real target capture has been supplied for this implementation. Test fixtures are
synthetic validation inputs and are not calibration evidence. Existing budgets
remain unchanged. Static geometry/work counters are never converted to guessed
milliseconds.

Run:

```sh
python3 tools/resource_calibration.py capture.json --expected-identity current-identity.json > analysis.json
```

The CLI writes JSON. Exit 2 means invalid input; exit 0 means a valid analysis,
which can still have `accepted: false`. Consumers must inspect `accepted`.
`budget_increase_authorized` is always false, including for accepted reports.
An accepted report means only that the specified observations satisfy an empirical
envelope assessment. It does not release a selection policy or authorize a larger
workload, firmware installation, or resource budget.

## Receipt and trust boundary

The root object has `schema: "cc700-resource-capture-v1"`, `identity`, `provenance`,
and a nonempty `runs` array. `--expected-identity` is a separate JSON object that
must come from independently verified current target/build/route receipts; copying
it from an unverified capture defeats the stale-evidence check.

`identity` contains lowercase 64-digit SHA-256 values for `test_image_sha256`,
`base_image_sha256`, `route_sha256`, `source_sha256`, `collector_sha256`, a nonempty
`device_id`, and positive integer `cpu_hz`. Every identity field must exactly match
the supplied current identity. Run receipts must additionally retain the restoration
receipt and collector installation review described in the stationary measurement
contract. This offline tool neither installs a collector nor verifies restoration.

`provenance` requires these fields:

| Field | Required value/meaning |
|---|---|
| `origin` | `"target"`; host, synthetic, replay-estimated and fabricated origins rejected |
| `frozen` | `true`; export occurs after owned capture is frozen |
| `identity_verified` | `true`; operator verified runtime identity |
| `clock` | `"monotonic_us"`; durations are actual target microseconds |
| `clock_verified` | `true`; clock conversion/wrap/frequency/preemption checked |
| `overhead_us` | measured nonnegative integer collector overhead, retained without subtraction |
| `overflow`, `dropped_samples` | integer zero; unknown loss is not zero |
| `disturbance` | `"none"`; no export/printf/halt during timed intervals |

These fields are **attestations**, not signatures. Software cannot distinguish
fabricated JSON falsely labelled as genuine hardware evidence. Reject known
fabricated inputs before analysis; compare raw captures, checksums, receipts and
instrumentation review externally. The tool rejects declared non-target,
incomplete, stale, disturbed, lossy, overflowing or numerically invalid evidence.
No real capture should be inferred from tests that exercise these validation paths.

## Runs and samples

Each run has a globally unique nonempty `run_id`, `split` (`train` or `held_out`),
`workload`, `temperature` (`cold` or `warm`), and nonempty `samples` array. A run
cannot be split across training and assessment. Collect independent target runs
and choose held-out runs before inspecting outcomes. Unique labels alone do not
prove independence; copied/repeated exports are invalid evidence.

Workloads are exactly `city`, `village`, `forest`, `polygon-heavy crossing`,
`repeated block loads`, `off-route redraw`. All twelve workload/temperature
combinations are required by the CLI. The Python API can scope `required_strata`
for a bounded study; such acceptance says nothing about omitted combinations.

Every sample includes:

- `block_id`, `section_id`: actual nonempty file identities, never a decoded pointer.
- `layers`: nonempty array of named selected layers.
- `camera`: numeric latitude [-90,90], longitude [-180,180], heading [0,360],
  positive effective `zoom`; `surface`: `[240,256]`.
- `state`: explicit boolean `recording`, `radio`, `replanning`.
- `timings_us`: integer `frame`, `iterator`, `mutex_wait`, `mutex_hold`,
  `projection`, `raster`, `text`, `fill`, `canvas`, `flush`, `block_load`.
  Each is measured at the named native boundary in the stationary contract;
  zero means measured no work, not a missing channel. Sum repeated component
  calls within the sample. Frame includes iterator, canvas and flush, while
  block load is its own associated transition interval. Components may overlap;
  durations are not summed into a predicted frame.
- `work`: integer `projection_callbacks`, `projected_points`, `fill_vertices`,
  `label_bytes`, `decoded_bytes`, `serialized_bytes`, observed for that workload.
- `heap`: objects keyed `capability@phase`; each contains integer `free_bytes`,
  `largest_bytes`, `minimum_bytes`. Name capabilities precisely (for example
  `psram_0x404`), without aggregating incompatible capabilities. For **each**
  capability include all phases: `before_load`, `serialized_allocated`,
  `old_decoded_freed`, `new_decoded_allocated`, `serialized_freed`, `frame_end`.
  Use the same capability axes in every sample. Minimum-ever heap must retain
  its documented lifetime; it is not a reconstructed per-frame value.

Numeric resource values must be finite, nonnegative integers at most 2^53−1.
Booleans, NaN, infinity, missing channels, negative values and overflow are invalid.
Largest and minimum heap cannot exceed current free. Mutex wait plus hold must
fit iterator; iterator fits full frame; draw components fit iterator; canvas and
flush fit frame. This does not prove instrumentation correctness externally.

## Analysis and conservative assessment

For each workload/temperature independently, output nearest-rank p50/p95/p99,
minimum, maximum and count for every observed resource/work axis. Timing
prediction is an interpretable empirical upper envelope: `ceil(training_max*1.1)`.
Heap prediction is a separate observed lower margin:
`floor(training_min/1.1)`. Work counters define a rectangular **observed training
range**, without padding. No regression coefficients or single resource score are
fitted. The padding is an explicit review heuristic, not a confidence bound.

Held-out assessment reports raw distributions, resource violations and samples
outside the training work range. Out-of-range samples receive no extrapolated
prediction, even if their actual timing happens to be small. Every assessed
sample must fit all independent envelopes and the work domain. Each stratum also
needs at least three distinct runs and thirty samples in **each** split. Missing
required strata, insufficient data, any held-out domain escape or any envelope
violation makes acceptance false. Data outside a required subset still participates
in validation and assessment; it is never silently discarded.

Frames within a run can be correlated. Thirty observations and zero violations
are not statistical proof, a worst-case bound, or evidence that independent maxima
occur jointly. These envelopes predict only similarly identified measured work,
not a new camera/source/layer distribution, allocator schedule, concurrent task
state, firmware, or unseen feature. Caller must reassess identities and workload
representativeness for every use. Resource budgets require separate deadline,
allocation and fragmentation acceptance plus an engineering review. This analyzer
does not contain or raise those budgets.

## Current collector limitation

The experimental `CC7M1` iterator collector exposes four iterator timestamps,
clock-read cost and PSRAM capability `0x404` before/after heap observations, plus
pointer/count/surface metadata and a line checksum. It does **not** provide native
frame, projection/raster/text/fill, canvas/flush, block-load phases, full work
counters, file block identity or complete sample-loss accounting. It is useful
narrow observation, and cannot populate this schema. Do not invent missing values,
reinterpret iterator duration as a full frame, reinterpret pointers as block file
offsets, or use host timing to fill gaps. A future complete collector plus verified
receipts is required before this analyzer can produce real calibration results.

## Partial observed-channel mode

Narrow captures are useful before full calibration. Use:

```sh
python3 tools/resource_calibration.py observed-capture.json --partial --expected-identity current-identity.json > observed-analysis.json
```

The input schema is `cc700-observed-capture-v1`. `identity` follows the current
identity contract above. Each `runs` entry has unique `run_id`, `split`, named
`workload`, `temperature`, exact `raw_serial` text and a `receipt` object. Receipt
fields are `verified: true`, `clock_verified: true`, lowercase 64-digit
`root_receipt_sha256` and `raw_log_sha256`, plus `block_id`, `section_id`, `layers`,
`camera`, `state` with the meanings above. `raw_log_sha256` hashes UTF-8 bytes of
`raw_serial` including newlines. The external root receipt binds runtime image,
route/source and capture setup to the current identity. Preserve that receipt;
its hash is correlation evidence, not automatic proof of its contents. A run
must maintain the declared block/section/camera/layer setup: use separate receipts
and runs when it changes. A decoded pointer/requested road number does not prove
file block identity. Different modes normally require separate captures and
image identities; analyze them independently with their correct expected image.

This mode passes every recognized raw CC7M1/CC7F1/CC7B1 line directly through
`target_measurement.parse_line`. A malformed, interleaved or checksum-failing
telemetry line rejects the analysis. Unrelated boot/log text is ignored. Every
run must have at least one telemetry line. A verified raw-log hash detects changes
after the receipt; checksums alone do not detect entirely omitted invocations.

Output groups by workload, cold/warm and actual channel. It gives observed
minimum/p50/p95/p99/maximum/count independently for measured microseconds,
clock-pair overhead and the before/after capability-0x404 heap channels. Iterator
samples also retain the observed entry count. It does not invent full-frame,
projection or peak-load samples or require fake zero values for missing channels.
The current channels mean:

| Channel | Measured duration | Explicitly absent |
|---|---|---|
| `iterator` (CC7M1) | iterator wall, mutex wait/hold, unlock | full frame and draw component breakdown |
| `map_composition` (CC7F1) | native map composition call | native canvas construction/clear and flush |
| `block_load` (CC7B1) | cc_blk call including possible cache hit/no-op | peak serialized/decoded overlap and phase heap |

Training and held-out runs remain separate. Observed timing/heap envelopes use
the same 10% heuristic as full mode; held-out reports retain actual distributions
and resource violations. Iterator entry-count ranges provide a **narrow useful
work-domain check**, not a geometry-complexity model: counts outside the training
range are flagged and not counted as covered predictions. Composition and block
probes lack measured work counts; their `prediction_assessment` is unavailable,
with null domain-coverage counts. Requested roads, pointers and file types are
identities, not work metrics. Even iterator prediction cannot generalize beyond
similarly identified observed geometry; equal entry counts can have very different
point/raster costs. Do not sum different probe modes into a claimed full frame.

Partial reports always say `status: "incomplete"`, `accepted: false`,
`budget_increase_authorized: false`. They retain root/raw receipt hashes and
explicit unknown sample-loss and post-interval export disturbance. Observations
remain useful for detecting regressions and documenting actual margins under
instrumentation. They establish neither an undisturbed runtime distribution,
worst case, hardware maximum nor budget headroom for new features. No actual
target capture was supplied to this package's tests.

The extended `CC7M2` iterator protocol is also accepted. It adds measured source
scan totals `input_geometry_points`, `input_fill_vertices`, `label_storage_bytes`
to observed distributions and the held-out work domain. Geometry excludes label
entries; source geometry counts include the anchor (`cnt+1`). Fill totals cover
source classes 1–3, and label storage is allocated label count × 8 bytes, **not**
UTF-8 text length. These are input-work counters, not measured native projection
calls, output vertices or text execution. UINT32_MAX is a saturation sentinel;
saturated work counts are rejected. Counting overhead is part of the measured
iterator interval. Legacy CC7M1 retains its narrower entry-count-only domain.

Guarded formats `CC7M3`, `CC7F2`, `CC7B2` add two actual stack observations. Partial
analysis preserves `stack_remaining_bytes` and `stack_a5_prefix_bytes` distributions
and independent lower envelopes; `stack_a5_scan_capped_samples` counts samples
whose A5 prefix reached the 1024-byte scan cap. Remaining bytes are the smaller
observed current-SP distance to the owning GUI task's stack base at the collector's
begin/export helpers. A5 prefix scans only that owning stack, up to 1024 bytes.
Neither observation is a complete stack high-water measurement or a promise about
the deepest native component. `stack_is_full_high_water` is always false. Old
protocols do not acquire inferred stack fields; mixing protocols with differing
axes in one channel/stratum is rejected. The native parser validates each version's
exact payload length before returning fields.

Every partial run additionally requires `manifest` with `mode` (`iterator`,
`composition`, `block`) and `image_sha256` equal to the capture's current
`test_image_sha256`. Preserve the actual collector build manifest/receipt that
these fields describe. The analysis enforces that each checked telemetry channel
matches that manifest's mode. This matters because the protocol checksum protects
payload words and spaces **but excludes the ASCII version/channel prefix**.
A payload-preserving composition-to-block prefix relabel therefore cannot silently
become a valid different-channel observation. Runtime receipt verification must
also bind the original installed image to this build manifest. An embedded JSON
manifest alone is not proof of an installed binary.
