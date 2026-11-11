# CC700 Map

Web page (Chrome on Android) that turns a GPX track into a complete navigation route for the
GEOID / Magene **CC700** bike computer and sends it over Bluetooth:

- turn icons (straight, left, slight left, right, slight right, U-turn) from the track geometry
- street names from OpenStreetMap, with extra hints: `scharf links`, `Kreisverkehr`, `Radweg`, `Schotterweg`, `▶ checkpoint`
- a road map around the route, drawn in the device's junction layer (the CC700 has no map of its own)

Everything runs on the phone and the GPX never leaves it. The page holds no map data: when a route is built, it
asks a public Overpass server for the OpenStreetMap roads of the grid cells (about 5.5 km) that the route crosses,
and keeps the processed cells on the phone. The server sees the cells, not the route.

## Use
1. Open the page in Chrome on Android and choose a GPX (or share it to the page from another app). The route is
   built immediately; a region that is new to the phone needs internet (a dense city cell is up to 13 MB and
   takes some seconds). Check the preview and the turn list.
2. Close OnelapFit (it holds the Bluetooth connection), stop navigation on the CC700, then press "An CC700 senden".
   Each send adds a new route `route_<MMDDhhmm>.bin`; the CC700 route menu shows the GPX name.
   Two builds in the same minute get the same file name, and the second replaces the first.

## How it works
- `js/route.js` – GPX → route file (sections, turns, name images, header); route points at most 20 m apart,
  because the CC700 measures "off route" as the distance to the nearest route point
- `js/osm.js` – road data on demand: one Overpass query per grid cell (0.05° × 0.08°), road classes (OSRM bicycle
  access rules, OpenMapTiles zoom-13 selection), dual-carriageway centrelines, sidewalk removal, path networks,
  smoothing, built-up areas. Processed cells stay in the phone's Cache Storage and are loaded again after 30 days.
  Servers, in this order: `overpass.openstreetmap.fr`, `overpass-api.de`, `overpass.private.coffee`
- `js/mapsec.js` – map layer (junction section): main roads and motorways 3 lines (to 375 m), tertiary and streets
  2, service roads 1, paths/tracks light dashes (all to 300 m), pedestrian streets and named footways light dashes
  (to 150 m). Motorways are drawn but never used for turn prompts; tunnels closed to bicycles are not drawn.
  The CC700 draws every line grey 8 px with a white 4 px core (fixed in the firmware), so width can only come from
  parallel lines. A map block holds at most 1200 entries: the grey fill shrinks first (300 → 250 → 200 → 150 →
  100 m), roads only as the last step. Grey rows that continue each other are stored as fans (2 entries fill 5 rows)
- `js/ble.js` – file transfer protocol (begin / info / 200-byte packets with ack every 10 / end, CRC-16/XMODEM);
  a lost ack restarts the transfer (3 attempts)
- `js/preview.js` – preview read back from the built file
- Setting "Bebauung grau" (test, off by default): built-up land (OSM landuse residential/commercial/retail/industrial/
  garages/railway/construction) drawn grey under the roads, with rows 4 m apart that merge into one area.
  Roads are never dropped for it; dense blocks get a smaller grey radius.
- `tools/test_route.mjs` – builds a route file in Node with the page code

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
- Road data: © OpenStreetMap contributors, Open Database License 1.0 (https://www.openstreetmap.org/copyright).
  The page downloads it at run time; the repository holds none. A route file made with the page contains
  OpenStreetMap data: keep the attribution "© OpenStreetMap contributors" when you share it.
