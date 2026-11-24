# Lab: map-layer research (24 Nov)

Host scripts for `docs/research/map-layers-2026-11-24.md`. They read route files through the page code in `js/`.
They are research tools, not part of the build or the tests.

## Set up

From the repo root:

```sh
sh tools/lab/setup.sh
```

The script downloads the two GraphHopper OSM extracts (north-bayreuth, monaco), converts them to JSON
(`osm2json.py`), copies `js/` to `.local/lab/jsv/` with the variant switches of `variants.patch`, and builds four route
files with `build.mjs` and the Overpass emulator `emu.mjs`:

| File | Variant |
|---|---|
| `nb_V0.bin`, `mc3k.bin` | A today (rural, city) |
| `nb_V6.bin`, `mc_V6.bin` | B handover: `FLOORMAX=0 DFILL=none HO=300 FEXIT=1` |

The files are the same as the lab files of 24 Nov, apart from 18 bytes of build id and checksum.
The routes are in `data/` (`mkroute.py` made them). To use your own route, give `build.mjs` an OSM JSON and a GPX, or
use a route file from the page.

## Run

Run the scripts from `.local/lab` (they read and write files in the current folder):

```sh
cd .local/lab
node ../../tools/lab/olblock.mjs nb_V0.bin
```

| Script | What it does |
|---|---|
| `measure.mjs`, `perclass.mjs`, `summarize.mjs`, `compare.mjs` | per-screen detail and far work, by class |
| `outline.mjs`, `olblock.mjs`, `share.mjs`, `seam.mjs`, `olrender.mjs` | outline cost, shared green edges, PNG renders |
| `areas.mjs`, `farfill.mjs` | fill edge checks, overdraw, work on areas beside the screen |
| `dumpfill.mjs` + `fill/` | screen dumps; old against band fill (identity and host time) |
| `cachesim.mjs` | PSRAM cache misses for each frame |
| `farcache.mjs` | far reads for each frame with a cell cache |
| `wbreads.mjs` | way-back reads for each frame (replay of `wayback.c`), page cache, option C |
| `simall.mjs`, `agg.mjs` | all variants on the same frames, percent against today |
| `sim.mjs`, `sim2.mjs`, `cells.mjs` | coverage while turning, stop simulation |
| `overlap.mjs`, `extra.mjs`, `audit.mjs`, `validate.mjs`, `peek.mjs` | detail/far overlap, checks, file inspection |

All variants: `node ../../tools/lab/simall.mjs nb_V0.bin A_nb` (also `nb_V6.bin B_nb`, `mc3k.bin A_mc`,
`mc_V6.bin B_mc`), then `node ../../tools/lab/agg.mjs`. Optional: `SETUP` and `FARMS` set the far setup time and the
stop in ms.

## Fill bench

```sh
gcc -O2 -Ifirmware/raster -Ifirmware/common -o .local/lab/bench \
  tools/lab/fill/bench.c tools/lab/fill/fill_band.c firmware/raster/raster.c
cd .local/lab && node ../../tools/lab/dumpfill.mjs nb_V0.bin det_nb.bin detail && ./bench det_nb.bin 20
```

`fill_band.c` is a candidate for `raster.c` (work package 2). It is not in the firmware. For ESP32-S3 instruction counts
use the Espressif `xtensa-esp32s3-elf-gcc` with `-Os -mlongcalls -mtext-section-literals` and `objdump -d`.
`fill/pj.c` is the own-projection loop for the same count.
