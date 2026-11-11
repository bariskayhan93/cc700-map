# CC700 Map

Web page (Chrome on Android) that turns a GPX track into a complete navigation route for the
GEOID / Magene **CC700** bike computer and sends it over Bluetooth:

- turn icons (straight, left, slight left, right, slight right, U-turn) from the track geometry
- street names from OpenStreetMap, with extra hints: `scharf links`, `Kreisverkehr`, `Radweg`, `Schotterweg`, `▶ checkpoint`
- a road map around the route, drawn in the device's junction layer (the CC700 has no map of its own)

Everything runs on the phone. The road data is downloaded once and kept offline; the GPX never leaves the phone.

## Use
1. Open the page in Chrome on Android. Load the map data once (≈ 70 MB).
2. Send any route from OnelapFit to the CC700 once (the page replaces that route slot), then close OnelapFit.
3. Choose a GPX, check the preview and the turn list, connect, send.

## How it works
- `js/route.js` – GPX → route file (sections, turns, name images, header)
- `js/mapsec.js` – map layer (junction section): main roads 3 lines, tertiary 2, streets 1, paths/tracks dashed
- `js/ble.js` – file transfer protocol (begin / info / 200-byte packets with ack every 10 / end, CRC-16/XMODEM)
- `js/preview.js` – preview read back from the built file
- `tools/build_pack.py` – builds `data/<region>/` from a Geofabrik `.osm.pbf` (road classes, dual-carriageway
  centrelines, sidewalk removal, path networks; OpenMapTiles zoom-13 rules)

Format notes: the route file is nanopb 0.3 protobuf (CC700 firmware 1.414); name images are LVGL `INDEXED_2BIT`.

Unofficial project, not affiliated with Magene/GEOID. Use at your own risk.

Map data © OpenStreetMap contributors, available under the [ODbL](https://opendatacommons.org/licenses/odbl/).
