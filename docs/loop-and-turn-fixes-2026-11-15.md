# Loop departure and production turn fixes

The implementation is locally verified. Device installation and visible target
acceptance are recorded separately below; sparse-track ambiguity is not solved
by changing a turn-count expectation.

## Ordinary loop departure preference

The cc23 matcher wrapper first executes the unchanged native full search. It
considers a retry only for ordinary forward navigation still at global section
zero, with an on-route normal result jumping to the terminal section. Native
arrival must be zero; previous off-route/candidate states are excluded.

The start/end overlap envelope and distance since navigation baseline bound the
preference. The actual loaded head must be the route start and section zero.
An advancing ten-point native retry uses the original previous result; publication
requires a valid on-route result, correct point/window/section/type and independent
finite-coordinate proximity checks. Rejection preserves the original result.

This explicitly prefers departure for a new start near the shared origin, even
at the exact finish coordinate. Position alone cannot distinguish that request
from a fresh nearest-entry request there. Recorded return, accepted later progress,
entry away from the overlap, reverse and connector modes bypass the correction.
It does not fabricate a point, reset accepted state, recolour progress or move GPS.

No capture globals, telemetry, simulation input or heap ownership are added.
An extra native search remains conditional on 3,072 B sampled stack remaining
and a conservative largest PSRAM block check. The existing native allocation
hazards are not a proven safe allocator model. The worker has a 4,096 B stack;
the wrapper/trampoline/retry frames are 64/32/272 B. A failed margin check skips
the preference. Visible target acceptance must confirm it actually executes.

Image cc23: 3,752,784 bytes; SHA256
`6146fb25de504e4aa9684fe519a7ce46a6ce332ae109c698259dc8f00d836b43`.
Mapped-page space remaining: 6,144 B. The exact cc22 baseline, native consumers,
permitted deltas and complete ESP roundtrip are checked. Host tests run the real
wrapper against disclosed native-service fixtures, not the stock matcher CPU.

## Production generator corrections

Source-anchored through-road evidence removes supported false junction and
U-turn prompts caused by recording jitter. A clear selected arm, a stable mapped
continuation and a bounded local corridor are required; close distinct junctions,
short roads, forks, roundabouts and supported reversals prevent suppression.

Exact and supported rounded-reversal evidence preserves real short turnarounds
through smoothing and nearby decision merging. Tests include 2 m turnaround arcs
and offset return lanes, with sparse and dense arc samples. Junction identity now
normalizes tiny signed-zero coordinate differences into the same rounded key.
Supplied route geometry, elevation and distance remain preserved.

## Checks and limits

- 171 Python tests pass, including wrapper behavior and actual Xtensa image build.
- 185 Node tests pass, including 19 new production maneuver regressions.
- Additional straight-road noise exploration: 50/50 seeds have no false prompts.
- Existing private clean/noisy/sparse maneuver vectors and encoded files remain
  unchanged except timestamp. They therefore remain useful non-regression inputs.
- Historical aggregate remains 10/12: noisy recording 25 and sparse export 3
  versus the clean reference 15. These are unresolved broader acceptance cases;
  the new labelled fixes do not claim to repair every noisy recording.
- Missing corners in a sparse GPX are not safely recoverable from display roads
  alone. The sparse-input warning remains; the experimental policy stays gated.

## Target and publication status

cc23 is installed: exact flash readback, unchanged OTA selection metadata and a
normal app boot were verified. No captured crash. cc22 is the rollback image.
Normal boot/readback do not establish live departure, arrival or resume behavior.
The production Pages update requires successful publication and live asset checks.

### Subsequent owner observation

After installation, the owner reopened the existing **22.56 km Leichlinger
Straße** loop and still saw a grey route while stationary. The route BIN was
not regenerated or replaced: generator changes on Pages apply to newly generated
and imported routes. The cc23 departure wrapper is firmware-side and is intended
to work with this existing BIN, so an unchanged BIN does not establish the cause.
Visible stationary departure acceptance therefore remains failed, not resolved.

The owner notes that movement may restore the expected display and asks to avoid
overengineering this special case. Previous captures establish PAUSING with
arrival state zero and a retained end-like map threshold; they do not establish
what the current cc23 session does after movement. Do not change pause thresholds,
force route colour, or weaken resource guards without evidence of the failing
boundary. Distinguish stationary display correctness from moving progress and
legitimate arrival/resume behaviour.

## cc24: target-confirmed worker-stack cause

A coordinated temporary cc23 diagnostic captured 50 checksummed records with
zero rejected records on the existing route. The initial GUI call had 4,416 B
remaining and accepted the native departure candidate (point 0 / section 0).
The following worker call had 2,944 B, skipped at the 3,072 B stack gate, and
published the unchanged native point 720 / section 112. Subsequent calls then
inherited that terminal section. The diagnostic was removed and the complete
ordinary cc23 partition and unchanged OTA metadata were verified.

cc24 retains the 3,072 B guard and every matcher eligibility/validation rule.
It moves the 148 B candidate to an invocation-owned PSRAM allocation using the
existing heap-cap allocator/free ABI. Allocation failure preserves the complete
normal result; every allocated rejection and acceptance path frees the candidate.
The heap-info helper has its own small frame rather than retaining its scratch
array throughout the retry. Compiled retry stack falls from 272 to 144 B; the
wrapper remains 64 B. This admits the observed worker with exactly 3,072 B rather
than weakening the guard. Other call contexts may still reject safely.

Regressions first failed on the observed worker budget and allocation failure,
then passed after the change. Full local verification: 171 Python tests, 185 Node
tests, offline application checks and existing ride coverage proxy pass; the same
two historical noisy/sparse acceptance cases remain unresolved. The C wrapper
also passes address/undefined-behavior sanitizers. These checks do not substitute
for native moving/arrival/resume acceptance or prove all runtime stack peaks.

Ordinary cc24 candidate: 3,752,800 B, SHA256
`61db139e745841e36c58f64a121c02b4d394beae29cd2c68471cf6f8bccb5aa9`.
Mapped-page free space: 6,128 B. The follow-up target check stopped before device
access because USB was absent. cc24 is not installed at this checkpoint. The
coordinated check must demonstrate repeated worker acceptance before ordinary
cc24 installation; otherwise exact cc23 is restored.
