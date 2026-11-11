# Road data license

The files in this folder (`*/index.json`, `*/c*.bin`) are a derivative database of
**OpenStreetMap** data, © OpenStreetMap contributors.

They are made available under the **Open Database License (ODbL) 1.0**:
https://opendatacommons.org/licenses/odbl/1-0/

- Source: Geofabrik extract of OpenStreetMap (file name in `index.json` → `source`).
- How it was made: `tools/build_pack.py` (road selection, dual-carriageway centrelines,
  sidewalk removal, simplification). Anyone can rebuild it from the OSM extract with these tools.
- Attribution for produced works (e.g. a route file on a bike computer): "© OpenStreetMap contributors",
  https://www.openstreetmap.org/copyright
