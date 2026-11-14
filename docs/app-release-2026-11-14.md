# Map app update — 2026-11-14

The app identifies the current Sunlight firmware as Patch v18 for V1.414.
The firmware itself is distributed separately. This update does not flash a device.

## Changes

- Turn detection rejects an isolated road's own forward/backward arms as a junction.
- Heading probes are averaged to reduce recording jitter without altering encoded route geometry.
- Sharp bends below 160 degrees require a junction choice when matched to a road.
- Cached map cells retain original OSM highway node IDs, coordinates and raw tags separately from generalized display lines. Conflicting or missing observations are marked incomplete; this is not a routing graph or a new path matcher.
- Existing cached regions remain usable offline, including older cell formats. Missing optional signal/stop overlays no longer initiate requests while offline.
- App cache v4 includes the new navigation-source module so a fresh installation can load the full module graph offline.

## Updating an installed app

Open the app with internet available, then reload after the updated service worker
has installed. The patched firmware option and preview title now say **Patch v18**.
Previously cached map regions remain available. Existing route files on the CC700
are not regenerated automatically; choose the GPX again to generate a new file.

## Validation and limits

The public Node tests exercise route decisions, preview/readback, OSM source
preservation and an actual service-worker installation with network disabled.
Offline app probes also generate and decode 70 km routes in both firmware modes.

One executed TODO remains for a noisy track near a side street. Historical private
fixtures also retain noisy and sparse turn-count failures; this release does not
claim those are solved. Hardware frame times, heap headroom, Bluetooth transfer
and physical navigation acceptance are separate from these host checks.
