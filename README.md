# CC700 Map

This web page makes navigation routes for the GEOID / Magene **CC700** bike computer and sends them over Bluetooth.
Use it in Chrome on Android. Select a GPX file. The page makes the route file and sends it to the device.

## Watch the ride preview

![Animated three-panel ride preview near the Hofgarten. OnelapFit junction hints, the Junction map, and Sunlight rotate together as the turn card and compass update.](docs/comparison/tour-d3-device-replay.webp)

All three views replay the same section of Düsseldorf’s public Tour D3 at 4× speed. Each uses the
Pages preview’s proportions for the turn window, compass, 100 m scale, heading, progress and distance
to the finish.
[Open the interactive CC700 Map app](https://bariskayhan93.github.io/cc700-map/)

## Compare the three navigation views

Six heading-up scenes from Tour D3. The rider’s direction of travel points toward the top of the
screen, and the compass shows where north is. Each excerpt is generated as its own route file.
The panels share the same position, heading and scale. Their turn windows follow their route
records. Open any image to zoom in.
[City of Düsseldorf Tour D3 and GPX](https://www.duesseldorf.de/radverkehr/fahrradtouren/tour-d)

| Navigation mode | What the CC700 displays |
|---|---|
| **OnelapFit with stock firmware** | Blue route line with straight, equal-length grey spokes at junctions. Driveways, garage exits, streets and paths use the same size. Closely spaced spokes overlap. |
| **CC700 Map Junction map with stock firmware** | Blue route line over connected grey and white roads, with grey built-up blocks, striped water and long-dashed railways enabled for these examples. |
| **CC700 Map Full Sunlight map with patched firmware** | Red route line over a colour map with distinct road classes, outlined green areas and water, and optional street names, tram layers and amber traffic signals. |

The OnelapFit schematic uses mapped OpenStreetMap connections near Tour D3. Each arm is drawn
at about 100 m, so nearby entrances and paths can stack into a dense cluster, as at the Hofgarten.
The Junction and Sunlight panels use the GitHub Pages map renderer with their generated route files.
The Junction map examples have **Bebauung grau**, **Wasser gestreift (Test)** and
**Bahnlinien lang gestrichelt (Test)** enabled. Blue or red marks the route ahead, and grey marks
the part already ridden.

### Graf-Adolf-Platz

The route turns at a wide junction where tram tracks and traffic signals cross the Königsallee corridor.

![Graf-Adolf-Platz in three views. The Sunlight map shows tram tracks and amber signals at the turn.](docs/comparison/graf-adolf-platz-device-layers.webp)

### Altstadt near Liefergasse

Connected side streets and bends show the shape of the Old Town street network.

![Altstadt in three views. The Junction map and Sunlight map show connected side streets around Liefergasse.](docs/comparison/altstadt-liefergasse-device-layers.webp)

### Hofgarten and the Landskrone pond

The park paths, water edge and city streets meet near the Kö-Bogen.

![Hofgarten in three views. The Sunlight map distinguishes the Landskrone pond, park paths and nearby streets.](docs/comparison/hofgarten-landskrone-device-layers.webp)

### Rhine at Rheinkniebrücke

The river, promenade and bridge approach are visible together at the riverbank.

![Rhine riverbank in three views. The Sunlight map shows the river, promenade and Rheinkniebrücke.](docs/comparison/rhine-rheinkniebruecke-device-layers.webp)

### MedienHafen

The harbour entrance puts the path between two water edges, making the shape of the waterfront visible.

![MedienHafen in three views. The Sunlight map shows the path between the harbour water and the Rhine.](docs/comparison/medienhafen-device-layers.webp)

### Railway near Bilk

The long white dashes across the blue route show how the experimental railway layer reads on
stock firmware. The grey blocks show built-up areas around the crossing.

![Railway near Bilk in three views. The Junction map draws grey blocks and long railway dashes across the route.](docs/comparison/railway-near-bilk-device-layers.webp)

## What the page does

- **Turn prompts at real decision points.** The page finds the junctions in the OpenStreetMap road network. It
  gives a prompt only where the rider must choose a road. A bend without a junction is not a turn.
- **Turn prompts that move forward.** Each route record has a geohash index. The CC700 uses this index to find the
  rider on the route. Without it, the CC700 stays on the first section and shows "Go straight" for the full route.
- **Street names** in the top widget, with a "dann links" hint when a second turn comes within 50 m.
- **A map around the route.** The CC700 has no map of its own. The page puts OpenStreetMap data into the route file.

## CC700 Map settings

The app starts in **Original (Kreuzungskarte)**. Select **Patch v16 (farbige Sunlight-Karte)** only if
your CC700 has the v16 patch for firmware V1.414. The preview updates from the generated route file.
Choose **Abspielen** to replay the route at 1×, 4×, or 8× the speed set in **Einstellungen**.
The slider lets you move to any point during playback. The ride preview shows the next instruction,
distance, heading and route progress using the generated route.

| | Junction map (Original) | Full Sunlight map (Patch) |
|---|---|---|
| Map drawing | connected grey lines with a white core | coloured map |
| Roads | widths vary by road class | main, minor, service, path, cycleway, track |
| Areas | optional grey built-up areas and striped water | built-up, green, water, with outlines |
| Rail and tram | option: long dash | rail, tram lines, tram stops |
| Bridges, tunnels | no | black edge for bridges, dashed edge for tunnels |
| Street names on the map | no | yes |
| Traffic signals | no | yes |
| Route line | blue | red |
| Turn arrow on the map | no | option (off by default), 150 m before the turn |
| Map when off route or riding backwards | can disappear | can stay visible within the area stored in the route file |

For the patched firmware, these layers are options: street names, traffic signals, tram stops, tram lines, rough
tracks, footways and paths, park paths and cycle tracks next to streets, separate carriageways, turn arrow.

## How to use

1. Open https://bariskayhan93.github.io/cc700-map/ in Chrome on Android.
2. Select the firmware installed on your CC700. Open **Einstellungen** to change the optional map layers.
3. Select a GPX file, or share it to the page from another app. The page makes the route immediately.
   For a new region, the page needs internet.
4. Close OnelapFit, because it holds the Bluetooth connection. Stop the navigation on the CC700.
5. Push "An CC700 senden". The route menu of the CC700 shows the GPX name.

## How it works

| File | Function |
|---|---|
| `js/route.js` | GPX to route file: sections, turns, name images, geohash index, header |
| `js/osm.js` | OpenStreetMap data from Overpass, one query for each grid cell (about 5.5 km). The phone keeps the cells for 30 days. |
| `js/mapsec.js` | map layer: connected junction segments (stock) or styled entries (patch) |
| `js/ble.js` | Bluetooth file transfer, CRC-16/XMODEM |
| `js/preview.js` | preview from the finished file |
| `tools/test_route.mjs` | makes a route file in Node with the page code |

The GPX stays on the phone. The Overpass server sees only the grid cells, not the route.

The route file is nanopb 0.3 protobuf (firmware 1.414). Name images are LVGL `INDEXED_2BIT`.

## Patched firmware

The v16 patch changes the map drawing of firmware V1.414. It is not part of this repository.
Route files for the patched firmware do not show a usable map on the original firmware.

## Legal

- This is an unofficial and independent project, for interoperability with a device that you own. Magene, GEOID
  and Onelap do not support or approve it. Product names only identify the device.
- The page contains no firmware, app code, icons, fonts or map data from the manufacturer. The file format and the
  Bluetooth protocol come from the owner's own device and its traffic. The only copied bytes are format constants
  in the route header template (`js/route.js`).
- Add `?debug` to the page address to see the Bluetooth log.
- Use it at your own risk. A bad route file can stop the navigation. Then delete the route or send a new one.

## License

- Code: MIT, see `LICENSE`.
- Map data: © OpenStreetMap contributors, Open Database License 1.0 (https://www.openstreetmap.org/copyright).
  A route file from this page contains OpenStreetMap data. Keep the attribution "© OpenStreetMap contributors"
  when you share it. The pictures in `docs/` also contain OpenStreetMap data.
