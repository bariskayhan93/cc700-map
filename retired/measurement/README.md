# Retired: target measurement probe (cc24 diagnostic)

Moved here on 25 Nov 2026 from `firmware/measurement/` and `tools/`. The cc24 diagnostic was rejected (commit `8dfd968`). No image in the unit chain (v21 -> cc22 -> cc23 -> C4 -> cc27) contains this probe.

- `firmware/`: the probe and journal sources (`probe.c`, `journal.c`) and their README.
- `tools/`: the builder `target_measurement_build.py`, its ABI check `target_measurement_abi.py`, the test `test_target_measurement.py` and its C drivers.

The paths inside these files still name `firmware/measurement` and `tools/`. They do not run from this directory.
Before the move, `python3 -m unittest tools/test_target_measurement.py` gave 4 failures and 5 errors (a warning in `tm_probe_begin` under `-Werror`, and missing pinned images).

Kept in `tools/`: `target_measurement.py` (line parser), because `tools/resource_calibration.py` loads it.
To restore: `git mv` the files back to `firmware/measurement/` and `tools/`.
