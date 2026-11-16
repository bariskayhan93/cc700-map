# On-route preview guidance — 14 November 2026

The preview previously counted down to the end of its current route record.
Records also subdivide long straight roads to fit geometry and map limits, so
this countdown could reset before the next actual maneuver. The map renderer's
current record index is not a next-turn index.

The new `js/preview_guidance.js` helper independently finds the current record
from cumulative on-route progress, then scans forward through direction-zero
records to the next maneuver or destination. It returns that target's remaining
distance. A maneuver more than 300 m away displays a straight icon/instruction;
at 300 m or less it displays the maneuver direction. This threshold is based
on the stock `GetDirIcon` routine at `0x4204dcd4`, comparing the cached next-turn
distance at `0x3c389340` with 300 and reading the next point's direction at +4.
The helper scans only the supplied finite route-record array.

A coordinate-free regression fixture uses these cumulative distances:

| Record | End distance (m) | Direction |
|---|---:|---|
| 78 | 15281.84 | Straight |
| 79 | 15591.02 | Straight |
| 80 | 15858 | Right |

At synthetic progress 15192.58 m the next maneuver is 665.42 m away. The old
countdown was only 89.26 m. The ride photo displayed 666 m; rounding this
synthetic subtraction displays 665 m. This one-metre difference remains an
explicit quantization/progress-estimation limit, not an adjustment applied to
the preview. The test verifies that passing either straight boundary does not
reset the countdown.

The turn card has exactly two rows: distance and one caption, beside a single
arrow. Within 300 m, its caption comes from `sections[targetIndex + 1].caption`,
the outgoing record's actual serialized field-6 text. This follows the stock
caption lookup; it is distinct from the legacy `.text` metadata and the name
bitmap channel. Generated `then … · ` prefixes remain in that same caption row;
there is no added instruction, street or `Danach` row. Synthetic 22 m and 27 m
pairs exercise this path. Explicit waypoint captions are consumed through the
same outgoing-record lookup. Legacy fixtures without `.caption` can fall back
to `.text`; generated current routes always supply `.caption`.

Above 300 m, the caption is `Go straight`, matching the supplied reference,
rather than prematurely exposing the outgoing street or waypoint.
At an exact maneuver distance the preview retains a zero countdown, advancing
after that point. The position slider now permits fractional metres and uses
the exact route length rather than declaring arrival at its integer floor.

## Limits

This is a bounded on-route replay helper, not a firmware navigation simulator.
It uses generated cumulative route distance, not live GPS positions or the
firmware's association result. It does not reproduce off-route handling,
backtracking, timing, hysteresis, GPS-derived speed, remaining-distance filtering,
or the complete native text/waypoint state machine. Destination flags and
arrival at exact route length remain preview conventions. Native terminal
behavior has not been established by the icon-threshold evidence alone.
The helper does not mutate route records or map geometry. The separate caption serializer correction supplies the actual field-6 strings.

## Verification

```sh
node --test tools/test_preview_guidance.mjs tools/test_service_worker.mjs
```

Functional tests cover the synthetic photo distances, both straight boundaries,
the inclusive 300 m threshold, passed maneuvers, single-row close-turn captions, outgoing
waypoint/street lookup, terminal/no-turn/empty routes and fractional
arrival. Replacing lookahead with the old current-record-only target makes the
regression tests fail. Service-worker cache `cc700-app-v11` includes the helper;
the existing offline-module-graph test executes a fresh install and traverses
all imported modules.
