# Context selection: targeted research and CC700 decisions

This research answers the current evaluation gaps. It does not select a new
production renderer or implement the feature ledger.

## Separate source, selection, style and order

MapLibre's primary style specification separates source references, feature
filters, zoom visibility, layout and painting. It also exposes symbol ordering
and collision rules. The applicable principle is explicit selection and priority
independent of rendering style—not adopting its GPU engine or imposing its zoom
system on this device. [MapLibre layer specification](https://maplibre.org/maplibre-style-spec/layers/).

**CC700 consequence:** preserve native navigation input independently, prepare
source geometry once, protect nearby semantics, and compare independent optional
layer admission with the shared-radius policy. Use a small deterministic order
before experimenting with many percentage quotas. A failed optional area should
not automatically prevent adding an affordable useful line.

## Count work before assuming savings

LVGL 8's refresh process records invalidated regions, joins them, draws into its
buffer and flushes display portions. Region refresh does not account for work
our map patch already spent rebuilding its separate canvas.
[LVGL 8 drawing mechanism](https://lvgl.io/docs/open/8.3/overview/drawing).

**CC700 consequence:** measure source preparation, block load, projection,
polygon/text/line drawing, lock duration and display flush separately. Fewer
entries or fewer strokes alone cannot establish faster navigation. Existing
hybrid-fill studies already demonstrate that replacing lines with polygons can
increase scanline work substantially.

## Measure allocator capabilities and contiguous requests

ESP-IDF documents capability-specific free size, largest free block and historical
minimum separately. The largest free block constrains an individual allocation;
total free space cannot substitute for it. The guide provides the API semantics,
not proof that any guessed function address in CC700 is safe to call.
[ESP32-S3 heap debugging, IDF 4.4](https://docs.espressif.com/projects/esp-idf/en/release-v4.4/esp32s3/api-reference/system/heap_debug.html).

**CC700 consequence:** keep the existing extracted payload model and engineering
targets. Live function addresses/ABI and telemetry ownership must be verified
before target instrumentation; old heap log samples do not certify a new frame's
headroom. A target sample must identify firmware, workload, phases, capabilities
and measurement disturbance.

## Treat 3 km as a connected recovery feature

The user clarified that 3 km matters for a usable return/rejoin path. Drawing
farther without that behavior is not the goal. A geohash indexes locations; it
does not establish graph edges, bicycle access, bridge connectivity or turn
restrictions. Prepared sparse legs can move computation to the phone, but need
reachable origin coverage, correct lookup and explicit stock/patch activation.

The offline 1/2/3 km experiment therefore measures only **representation capacity**.
A positive result cannot close the recovery feature gate. The feature ledger
records the missing contracts and warns against treating vendor map-download
strings as evidence of an independent usable basemap.

## Decision procedure

1. Enforce protected semantics and native-record isolation.
2. Compare candidates on identical source input and every independent budget.
3. Examine per-case gains and losses, mixed-condition transitions and negative controls.
4. Keep navigation usefulness, raster legibility and target runtime evidence distinct.
5. Ship a new selection policy only when its intended feature benefit and resource
   behavior are demonstrated; otherwise retain the current production policy.
