# Feature capability ledger — inputs, not promises

The supplied list is intentionally unranked. Each idea is considered in the whole
system: source data, geometry/graph preparation, encoded storage, firmware/UI,
activation/lifecycle, and verification. Shared resources are constraints across
features; there is no presumed free percentage reserved for an undecoded feature.

Evidence terms: **implemented** = existing working code with scoped tests;
**traced** = a bounded native interface/asset is identified; **hypothesis** =
end-to-end behavior or controllable input is unverified. A name or string alone
is not an API contract.

| Idea | Established mechanism | Missing contract / cost dimension |
|---|---|---|
| Corridor POIs/saved places | Implemented label and signal/stop entry machinery | Generic POI glyph semantics and icon types are not implemented. Share text/collision/entry budgets; do not disguise POIs as signals. |
| Proximity course-point alerts | Point field 4 exists and is currently written as zero | Field meaning/trigger lifecycle remains unknown. Setting it is not established as a safe native alert. |
| Gravel-ahead captions | Original surface evidence, rough overlays and captions are implemented | Ahead-range aggregation and cue priority; preserve turn and close-turn text within the native 63-byte UTF-8 caption bound. |
| Off-route rejoin vignette | Map polylines can carry prepared geometry | Needs validated recovery path, conditional off-route activation and cue lifecycle. It is not generation-only with the current renderer. |
| Return-home legs | Route polylines and native BackFlag/Return-to-Home traces exist | Direction/access-valid legs, reachable origins, lookup and activation/restoration; no validated return planner yet. |
| Personal ride heat | FIT extraction exists | Map matching, privacy, a dedicated semantic style and intensity encoding; current fixed styles do not offer an arbitrary heat channel. |
| Hazard warnings | Some OSM source tags and captions are available | Hazard source completeness, correct applicability/direction, trigger distance and false-warning control; restrictions need graph-aware handling. |
| River/park/district names | Area and label classes implemented | Name acquisition, anchor placement and label priority/collision. Area presence does not guarantee its name was retained. |
| Grade/surface-colored course | Elevation data and route-color patch hook exist | Per-segment selection and meaning/legend; do not imply that the current opaque fixed-color route already has this behavior. |
| Rotated street names | Existing text rendering/label placement | Rotation or along-path glyph placement, actual font metrics, clipping and extra raster cost. |
| Ambient night palette | Eight-byte ambient-light record and auto-backlight path traced | Valid/fresh lux, thresholds/hysteresis and state-safe palette switching; not implemented by finding EnvLight. |
| SHS_N_10 / accented labels | Embedded fallback fonts/cmaps traced | Correct descriptor ownership, proportional metrics and readability. The name does not mean a 10-pixel glyph height; mined descriptor height is 14. |
| Elevation strip | Route points contain elevation | Profile sampling, HUD space, draw cost and missing-elevation behavior. |
| Grey past course / red ahead | Route-color hook exists | Progress/pass association at crossings/reverse travel, per-segment coloring and stale-progress fallback. |
| Rejoin distance instead of -- km | Stock unavailable sentinel behavior traced | Actual validated remaining recovery distance and explicit semantic label; never substitute straight-line distance as route distance. |
| Automatic zoom | Native zoom/state logic traced | Thresholds, hysteresis, protected detail and label/casing behavior across zoom; more zoom changes require seam/rotation tests. |
| Native climb screens | Header 0x58 is a climb-data offset; climb assets/code exist | Payload schema, valid sample and lifecycle; no generated native climb feature is claimed. |
| Workouts/intervals | Native workout tables/functions identified | File schema, state transitions, target units and validation. |
| Native offline rerouting | mg_offline_yaw_route_plan and result paths identified | Road source/ownership and controllable valid graph. Finding the routine does not establish routability of our corridor entries. |
| Junction diagrams in name images | Bitmap name records are generated | Placement/activation and what text space is displaced; preserve ordinary captions and valid image bounds. |
| Indoor route simulation | Native imitation/replay paths partly traced | Activation, live-input restoration and end-to-end delivery remain separate acceptance gaps. |
| Roundabout exit glyphs | Existing turn/roundabout handling | Exact native exit semantics, source topology and legible glyph/text representation; do not infer all exits from geometry alone. |
| Generation-time graph answers | Original node/way source is preserved separately in new cells | Graph completeness/access/restriction rules and whole-path validation. Labels/polylines store answers, not evidence of correctness. |
| Personal section ETAs | Header/section times and FIT history available | Reliable matched observations, units, interpolation and native consumption semantics; averages are not individualized certainty. |
| Effort/stamina estimate | Elevation and physiological inputs are possible sources | A validated model and coherent live inputs, not just available data; new compute/UI state and misleading-precision risk. |
| Shade hints | Some green/tree-related area source exists | Actual canopy/shade geometry and time/sun effects. A park/forest polygon does not establish shade on a road. |
| Vendor map downloads / real basemap | WiFi map/list/map_md5 strings and LOCAL MAP LOADED identified | The existing findings associate the channel with route transfers. An independent basemap format/render pipeline is **not established**; cannot declare corridor limits obsolete. |
| Home WiFi route sync | Transfer/download-related paths traced | Protocol/authentication, write/commit semantics, storage identity and interrupted-transfer recovery. |
| Free-ride climb detection | Barometer/native climb-related mechanisms exist | Detection thresholds, no-route lifecycle and UI entry; not established as an unlockable native feature. |

## Resource implications shared across the list

- **Phone generation:** source completeness, graph algorithms and preparation time.
- **Device storage/file format:** navigation records, map blocks, graph/leg indexes,
  POI/text payloads and atomic replacement. The 4 MB app guard is not a flash limit.
- **RAM:** decoded map, route state, labels, graph/lookups and transition peaks;
  capability-specific contiguous space is separate from aggregate free bytes.
- **CPU/display:** projection, rasterized pixels, text, loading, locks and redraw
  frequency. A distant low-vertex road and a large polygon have different costs.
- **Firmware:** mapped executable page, ABI/hooks, lifecycle ownership and rollback.
- **UI:** limited 240×320 screen, separate 240×256 map, competing cues and ambiguity.

Sources: [format/assets/resource mining](firmware-mining-2026-11-13.md),
[behavior extraction](navigation-behavior-extraction.md),
[runtime ownership](navigation-runtime-extraction.md),
[ride findings](ride-review-2026-11-14.md), and
[the current reliability contract](map-reliability-contract.md).
