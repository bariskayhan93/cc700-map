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
