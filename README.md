# CC700 Map

This web page makes navigation routes for the GEOID / Magene **CC700** bike computer and sends them over Bluetooth.
Use it in Chrome on Android. Select a GPX file. The page makes the route file and sends it to the device.

![Original firmware and patch, on a route through Düsseldorf](docs/ride.gif)

*Route example: Düsseldorf Hauptbahnhof, Königsallee, old town, Rhine promenade, Rheinpark, Nordpark (Japanese
Garden), 7.1 km. Left: the original firmware. Right: the patched firmware. The map drawing comes from the patch code
(`map.c`), compiled for the PC.*

## What the page does

- **Turn prompts at real decision points.** The page finds the junctions in the OpenStreetMap road network. It
  gives a prompt only where the rider must choose a road. A bend without a junction is not a turn.
- **Turn prompts that move forward.** Each route record has a geohash index. The CC700 uses this index to find the
  rider on the route. Without it, the CC700 stays on the first section and shows "Go straight" for the full route.
- **Street names** in the top widget, with a "dann links" hint when a second turn comes within 50 m.
- **A map around the route.** The CC700 has no map of its own. The page puts OpenStreetMap data into the route file.

## Two firmware choices

Select the firmware in "Einstellungen".

| | Original firmware | Patched firmware |
|---|---|---|
| Map drawing | grey lines with a white core, one star per junction | coloured map |
| Roads | all the same | main, minor, service, path, cycleway, track |
| Areas | no (option: built-up grey) | built-up, green, water, with outlines |
| Rail and tram | option: long dash | rail, tram lines, tram stops |
| Bridges, tunnels | no | black edge for bridges, dashed edge for tunnels |
| Street names on the map | no | yes |
| Traffic signals | no | yes |
| Route line | blue | red |
| Turn arrow on the map | no | yes, 150 m before the turn |
| Map when off route or riding backwards | can disappear | stays |

For the patched firmware, these layers are options: street names, traffic signals, tram stops, tram lines, rough
tracks, footways and paths.

## Snapshots

| Case | Picture |
|---|---|
| Station area: many junctions close together. The original junction stars cover each other. | ![](docs/at_300.png) |
| Main road with tram and traffic signals (Graf-Adolf-Straße) | ![](docs/at_1900.png) |
| Rhine promenade: river, park, tram, footpaths | ![](docs/at_3600.png) |
| Riverside path: the original shows the route line only | ![](docs/at_5200.png) |
| Nordpark: street name and turn arrow | ![](docs/at_6900.png) |

## How to use

1. Open https://bariskayhan93.github.io/cc700-map/ in Chrome on Android.
2. Select a GPX file, or share it to the page from another app. The page makes the route immediately.
   For a new region, the page needs internet.
3. Close OnelapFit, because it holds the Bluetooth connection. Stop the navigation on the CC700.
4. Push "An CC700 senden". The route menu of the CC700 shows the GPX name.

## How it works

| File | Function |
|---|---|
| `js/route.js` | GPX to route file: sections, turns, name images, geohash index, header |
| `js/osm.js` | OpenStreetMap data from Overpass, one query for each grid cell (about 5.5 km). The phone keeps the cells for 30 days. |
| `js/mapsec.js` | map layer: junction stars (original) or styled entries (patch) |
| `js/ble.js` | Bluetooth file transfer, CRC-16/XMODEM |
| `js/preview.js` | preview from the finished file |
| `tools/test_route.mjs` | makes a route file in Node with the page code |

The GPX stays on the phone. The Overpass server sees only the grid cells, not the route.

The route file is nanopb 0.3 protobuf (firmware 1.414). Name images are LVGL `INDEXED_2BIT`.

## Patched firmware

The patch changes the map drawing of firmware V1.414. It is not part of this repository.
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
