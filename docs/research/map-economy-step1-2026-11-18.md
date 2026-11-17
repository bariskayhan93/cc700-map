# Map economy step 1: results (18 Nov 2026)

Host builds only. Not run on the device. All numbers come from the commands in `docs/current/map-economy-plan-2026-11-18.md`, Task A3 and Task B2.

## What changed

- **Fills follow the context cap (D1, commit `d9aa2f8`).** A block with a context cap below 600 m cuts its fills at the cap. A cut ring has no outline. Before this change the page refused the 70 km test route ("protected 300 m context budget: fillVertices").
- **Chained lines (D2, commit `10d68db`).** Same-style line runs of classes 5 to 11 join at an exact shared end point, at most 60 points for each joined run. This gives fewer entries and projection calls for the same streets.

## Map size and work

| Build | 70 km: blocks | map bytes | max calls | max decoded B | delta exact | City: blocks | map bytes | max calls |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Today (refused by the page; forced build) | 84 | 4,436,567 | 1,389 | 53,464 | 1,517,967 | 10 | 436,249 | 1,400 |
| Fills follow the cap | 78 | 3,979,078 | 1,395 | 53,464 | 1,364,636 | 9 | 374,405 | 1,396 |
| Fills follow the cap + chained lines | 75 | 3,824,867 | 1,044 | 50,648 | 1,293,208 | 4 | 230,601 | 1,089 |

- The 70 km route file with step 1 is 4,091,904 B. This is above the 4,000,000 B guard of the page, so step 1 alone does not give a 70 km file that the page writes.
- With step 1, the binding limits are serialized bytes (64,774 of 65,536), projected points (6,979 of 7,000 in the city) and fill vertices (2,304 of 2,304), not projection calls.

## What the rider sees

Rider-view compare on the host: 694 positions on 70 km, 130 in the city. Reference = a build with no limits.

| Field | Gate | 70 km | City |
|---|---|---:|---:|
| Empty top band (positions) | 0 | 0 | 0 |
| Top band (300 to 520 m ahead) missing | at most 0.005 (70 km), 0.025 (city) | 0.0026 | 0.0023 |
| Near screen (300 m) missing | at most 0.001 | 0.0007 | 0.0006 |
| Near screen pixel-identical to today | no gate | 9.5% | 1.5% |
| Projection calls per frame p50 / max | no gate | 523 / 1,044 | 1,046 / 1,089 |

All gates pass. The near screen is rarely pixel-identical to today because the dash pattern of a path now runs on across a joint. In six sample positions, 64% of the changed pixels swap green and a dash colour (path or rough track) in equal numbers both ways. Nothing is missing against the reference.

## Delta coding (Task B2)

| Coding of the step 1 map | 70 km bytes | Ratio | City bytes | Ratio |
|---|---:|---:|---:|---:|
| Today's records | 3,824,867 | 1.000 | 230,601 | 1.000 |
| Protobuf kept, points as differences | 2,681,396 | 0.701 | 166,918 | 0.724 |
| Scheme D (no protobuf framing) | 1,293,208 | 0.338 | 77,464 | 0.336 |

The protobuf-kept form needs only a running sum in the patch iterator. Scheme D needs a new block decoder in the firmware.

## Gaps

- Not run on the device. Frame time is not measured.
- The effect of the dash phase on the device screen is not checked.
- The device file is larger than the host file (factor about 1.19, measured on one city route).
