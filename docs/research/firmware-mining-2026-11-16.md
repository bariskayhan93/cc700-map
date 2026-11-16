# Firmware and storage mining, 16 Nov 2026

Status: offline only. No device contact, no flash write, no storage write. Dumps and device
files stay in `.local/` and `cc700-backup`, which are not committed. Scripts used here are in
`.local/mining/` and are not committed (gap: rerun needs them restored).

## Later results and corrections (supersede the sections below)

- **Budget, 16 Nov.** The v2 guard table saves 15.5% (2.80 MB against 3.31 MB for 22.75 km), not 3.1 times. The route file for 70 km is 2.52 MB at 36 KB/km and 10.0 MB at 143 KB/km. The 70 km total is 11.14 MB against 5.58 MB free. Details: `.local/eq/budget-70km.txt`.
- **Seed radius (legs only).** Builds at 3 km, 2 km and 1 km give identical packages. The painted map reach is capped at 1000 m for main roads by the class range table in `js/mapsec.js`. The combined table is in `.local/eq/combined-table-70km.txt`.
- **Coverage.** The full-route v2 build recovers 0 of 809 off-route frames in the replay. Details: `recovery-portals-2026-11-16.md`, "Coverage finding".

- **Layout.** The shared-piece layout is dropped. It needs per-leg guard variants (508 cases) and both directions (597 pieces). The per-window guard table is committed as format v2 (`1a1a4d3`). Its real build measures 2.80 MB for 22.75 km (15.5% smaller than v1). The earlier 1.06 MB estimate is withdrawn.
- **Core.** 5,598 B before, 5,438 B after v2 and the trims. The usable room is 4,376 B. The core alone does not fit. Removing the copy and marker checks would save 120 B more, and was not done.
- **Storage, live read (16 Nov, read only, esptool 4.7.0, storage partition only, 891 s, esptool reset the device afterwards).** 588 of 1,950 blocks used, 5.58 MB free, 56 files. `/NAVIGATION` holds two route files: 811,008 B for 22.56 km (36 KB/km) and 598,016 B for 4.19 km (143 KB/km). Dense city routes are much larger per km. The growth between 14 and 15 Nov came from one new route file. Growth is not a daily rate. The 0.5 MB a day figure is wrong.
- **Device crash record.** The device stored its own core on 15 Nov (`/ABNORMAL/CoredumpInfo.bin`, log: "Found core dump 43396 bytes"). It matches the 22:05 files in `.local` record for record. The owner states that a GLM session may have made those files. The stored core is still device-written evidence. EXCCAUSE is 0 and EPC1 is `0x42008575`, in stock code, not the patch. The instruction there is `retw.n`. Causes are not established.
- **Analysis error.** The dead-code list marks `0x4204DABC` as dead. A crash return address, `0x4204DAF2`, lies inside it. The reachability analysis misses at least one reference. Treat the 8,764 B figure as unreliable.

## Answer

- **Code is the binding limit for the detour.** The core needs 5,546 B. The room after the
  patch is 6,144 B, less a 1,768 B reserve, so 4,376 B is usable. The shortfall is 1,170 B.
- **Stock code cannot supply that room.** 104 unreferenced functions hold 8,764 B. They are
  split into 94 pieces. The largest piece is 820 B.
- **Growing the code segment into new pages is ruled out.** The instruction and data buses
  share one MMU table. Page 0x1E already belongs to the rodata segment.
- **Storage is shrinking.** Free space fell from 7.2 MB (12 Nov) to 5.6 MB (15 Nov). Route
  files cause most of the growth. A 70 km route file alone is 2.5 to 5.2 MB.
- **The shared piece layout is the only package layout that leaves room.** See the table below.
- **The crash is not explained.** No recorded address lies in the patch area.

## Code room

| Item | Bytes | Source |
|---|---:|---|
| Stock code segment, end at `0x421DC5C4` | 1,951,140 | `parts/ota_0.bin` |
| Patched code segment (cc23) | 1,959,904 | `ota1-before.bin` segment table |
| Patch size | 8,764 | difference of the two |
| Room left in the 64 KB page | 6,144 | patch notes |
| Reserve (largest stability fix) | 1,768 | budget plan |
| Usable room | 4,376 | budget plan |
| Detour core | 5,546 | recovery build |

Mining results for the room:

- **Dead stock code.** Static reachability over 5,546 aligned function entries. Roots are
  every call, branch, and pointer word in every segment. Result: 104 unreferenced functions,
  8,764 B. Largest contiguous piece 820 B. The result is a candidate list, not proof. A
  computed reference could be missed. The patch-replaced functions (`cc_iter`, `cc_line`,
  `cc_blk`, the arrow call) are reachable, as expected.
- **ROM helpers.** The ROM symbol file has `crc32_le` at `0x40001C98`. It has no square root
  or sine routine. Only the CRC loop could move to ROM. Estimated saving: under 100 B.
- **Second code area in new MMU pages.** Ruled out. Growing the code segment past `0x421E0000`
  maps flash page 0x1E, which the rodata segment already uses. A RAM-loaded segment would take
  heap space. The heap size is not measured.
- **Remaining levers.** Trim the core (diagnostic counters and experimental checks that the
  device does not need), or change the reserve rule. Both are owner decisions.

## Storage

Saved images, mounted offline with LittleFS (read only, in memory):

| Image | Date | Used blocks | Free |
|---|---|---:|---:|
| `cc700-backup/parts/storage.bin` | 12 Nov | 186 of 1,950 | 7.23 MB |
| `ride-incident-20261113/.../storage-post-ride.bin` | 13 Nov | 434 | 6.21 MB |
| `ride-20261114/storage.bin` | 14 Nov | 516 | 5.87 MB |
| `arbeit-hin-20261115/storage-20261115.bin` | 15 Nov | 582 | 5.60 MB |

- Growth is about 0.5 MB a day. The `/NAVIGATION` folder (route files) grew from 0.25 MB to
  1.41 MB. `/LOG` is about 0.65 MB.
- The free figure is a ceiling for new data, not a package budget. Saved images are snapshots.
  A live read-only check is still needed. It needs owner approval.

Package layouts against the free space, for a 70 km route (route file 2.5 to 5.2 MB):

| Layout | Packages, 70 km | With the route file | Fits 5.6 MB free? |
|---|---:|---:|---|
| Whole legs, per window (now) | 10.3 MB | 12.8 to 15.5 MB | No |
| Route-wide guard table | 2.7 MB | 5.2 to 7.9 MB | Only at the low end |
| Shared pieces, route-wide | 0.8 MB | 3.3 to 6.0 MB | Yes, most cases |

Estimates from the all-window build (see `recovery-portals-2026-11-16.md`).

## Crash lead (not a cause)

- The 22:05 device files in `.local/navigation-phase/loop-diagnostic-24/session-02/` still have
  no recorded source. `docs/STATUS.md` says not to rely on them until the source is known.
- The register notes are partly decoded. EXTRA_INFO reads as special-register pairs:
  EXCCAUSE 0 (illegal instruction), EXCVADDR `0x40376FF1`, EPC1 and EPS values follow.
  The per-task register layout is not confirmed.
- No record holds an address in the patch area (`0x421DC5C4` to `0x421DFFFF`).
- Several records hold stock drawing-path addresses (near `0x42043CAC`, `0x4204DAF2`,
  `0x42045A40`). A record may also hold a windowed return address. These are leads only.

## Recommendation (simplest path)

1. **Storage.** Choose the shared piece layout, if the firmware change is accepted. It is the
   only layout that fits a 70 km route with its route file in 5.6 MB.
2. **Code.** Close the 1,170 B shortfall by one of: trimming the core, or relaxing the 1,768 B
   reserve. Owner decision.
3. **Crash.** Find the source of the 22:05 files first. Then decode the register layout from
   the ESP-IDF core dump format, and rerun this check.
4. **Live storage check.** Read-only, about 15 minutes, owner approval needed.

## Gaps

- The dead-code result is static. It does not prove a function is unused.
- Storage numbers come from saved images. The device has not been read live.
- The crash record layout is not confirmed.
- Scripts are in `.local/mining/`, not committed.
