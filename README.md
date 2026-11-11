# CC700 Map

Web page (Chrome on Android) that turns a GPX track into a complete navigation route for the
GEOID / Magene **CC700** bike computer and sends it over Bluetooth:

- turn icons (straight, left, slight left, right, slight right, U-turn) from the track geometry
- street names from OpenStreetMap, with extra hints: `scharf links`, `Kreisverkehr`, `Radweg`, `Schotterweg`, `▶ checkpoint`
- a road map around the route, drawn in the device's junction layer (the CC700 has no map of its own)

Everything runs on the phone. The road data is downloaded once and kept offline; the GPX never leaves the phone.

## Use
1. Open the page in Chrome on Android. Load the map data once (≈ 86 MB, road data for Nordrhein-Westfalen only;
   a route outside NRW is refused, a route partly outside gets a warning).
2. Close OnelapFit (it holds the Bluetooth connection) and stop navigation on the CC700.
3. Choose a GPX (or share it to the page from another app), check the preview and the turn list, connect, send.
   Each send adds a new route `route_<MMDDhhmm>.bin`; the CC700 route menu shows the GPX name.
   Two builds in the same minute get the same file name, and the second replaces the first.

## How it works
- `js/route.js` – GPX → route file (sections, turns, name images, header); route points at most 20 m apart,
  because the CC700 measures "off route" as the distance to the nearest route point
- `js/mapsec.js` – map layer (junction section): main roads and motorways 3 lines (to 375 m), tertiary and streets
  2, service roads 1, paths/tracks light dashes (all to 300 m), pedestrian streets and named footways light dashes
  (to 150 m). Motorways are drawn but never used for turn prompts; tunnels closed to bicycles are not in the pack.
  The CC700 draws every line grey 8 px with a white 4 px core (fixed in the firmware), so width can only come from
  parallel lines. A map block holds at most 1200 entries: the grey fill shrinks first (300 → 250 → 200 → 150 →
  100 m), roads only as the last step. Grey rows that continue each other are stored as fans (2 entries fill 5 rows)
- `js/ble.js` – file transfer protocol (begin / info / 200-byte packets with ack every 10 / end, CRC-16/XMODEM);
  a lost ack restarts the transfer (3 attempts)
- `js/preview.js` – preview read back from the built file
- Setting "Bebauung grau" (test, off by default): built-up land (OSM landuse residential/commercial/retail/industrial/
  garages/railway/construction) drawn grey under the roads, with rows 4 m apart that merge into one area.
  Roads are never dropped for it; dense blocks get a smaller grey radius. Data: `data/<region>/a0.bin` from
  `tools/build_areas.py` (≈ 4 MB for NRW).
- `tools/build_pack.py` – builds `data/<region>/` from a Geofabrik `.osm.pbf` (road classes, dual-carriageway
  centrelines, sidewalk removal, path networks; OpenMapTiles zoom-13 rules)

Format notes: the route file is nanopb 0.3 protobuf (CC700 firmware 1.414); name images are LVGL `INDEXED_2BIT`.

## Legal
- Unofficial, independent project for interoperability with a device you own. Not affiliated with or endorsed by
  Magene, GEOID or Onelap; product names are used only to describe compatibility.
- The page contains no firmware, app code, icons, fonts or map data from the manufacturer. The file and Bluetooth
  formats were documented from the owner's own device and its traffic, for interoperability. The only copied
  bytes are format constants in the route header template (`js/route.js`; all route-specific values cleared).
- Debug mode: add `?debug` to the page address to see the Bluetooth log.
- Use at your own risk. A faulty route can at worst stop navigation; delete the route or send another one.

## License
- Code: MIT, see `LICENSE`.
- Road data (`data/`): © OpenStreetMap contributors, Open Database License 1.0, see `data/LICENSE.md`
  and https://www.openstreetmap.org/copyright
