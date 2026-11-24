#!/bin/sh
# Rebuild the lab data of the map-layer research (24 Nov) under .local/lab. Run from the repo root.
# Needs: node, python3, curl (only when the OSM extracts are not there yet).
set -e
L=.local/lab; T=tools/lab
mkdir -p "$L"
GH=https://raw.githubusercontent.com/graphhopper/graphhopper/master/core/files
for f in north-bayreuth.osm.gz monaco.osm.gz; do [ -f "$L/$f" ] || curl -sSfL -o "$L/$f" "$GH/$f"; done
[ -f "$L/nb.json" ] || python3 $T/osm2json.py "$L/north-bayreuth.osm.gz" "$L/nb.json"
[ -f "$L/mc.json" ] || python3 $T/osm2json.py "$L/monaco.osm.gz" "$L/mc.json"
# Page variants: a copy of js/ with the switches of variants.patch (HO, HOMAJ, DFILL, FLOORMAX, FSKIP, FEXIT).
rm -rf "$L/jsv"; cp -r js "$L/jsv"; (cd "$L/jsv" && patch -s -p2 < ../../../$T/variants.patch)
B="node $T/build.mjs"
$B "$L/nb.json" $T/data/nb_route.gpx "$L/nb_V0.bin" > "$L/nb_V0.json"          # A today, rural
$B "$L/mc.json" $T/data/mc_route.gpx "$L/mc3k.bin" > "$L/mc3k.json"            # A today, city
V6="FLOORMAX=0 DFILL=none HO=300 FEXIT=1 JSDIR=$PWD/$L/jsv/"
env $V6 $B "$L/nb.json" $T/data/nb_route.gpx "$L/nb_V6.bin" > "$L/nb_V6.json"  # B handover, rural
env $V6 $B "$L/mc.json" $T/data/mc_route.gpx "$L/mc_V6.bin" > "$L/mc_V6.json"  # B handover, city
echo "lab data in $L"
