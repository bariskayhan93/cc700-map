# Native replay: prepared next operation

2026-11-13. **Update: the owner approved this storage read and it completed.**
See [fresh inventory and the verified offline candidate](native-replay-current-storage.md)
for current results and the subsequently approved, verified installation.
Replay activation has not been performed. The operation below records the
executed read and its original approval scope.

The [replay contract](../current/native-replay-contract.md) now establishes nominal 1000 Hz
RTOS timing and the specific loading/resume activation guard. The
[FIT candidates](native-fit-fixture.md) are CRC-checked, plain FIT files. The
[storage access audit](../current/device-storage-access.md) found no proven normal-app
arbitrary-file reader. Current storage is the next prerequisite; the historical
snapshot cannot establish it.

## Operation to approve

Run the prepared local script:

```sh
bash .local/native-replay-readiness/read-current-storage.sh
```

It uses installed esptool 4.8.1 and the inventoried USB serial node. Its exact
device command is:

```sh
/private/tmp/claude-501/cc700/venv/bin/python3 -I -m esptool \
  --chip esp32s3 --port /dev/cu.usbmodem1101 --baud 921600 \
  --before default_reset --after hard_reset --connect-attempts 3 \
  read_flash 0x860000 0x79e000 \
  /Users/baris/cc700-map/.local/native-replay-readiness/acquisition/storage-current.bin
```

Effects: reset into download mode, upload/execute the standard esptool RAM stub,
read exactly **7,987,200 bytes** from the storage partition, then request a
hardware reset. Normal navigation/recording execution is interrupted. It does
not program or erase flash/storage and does not target the firmware partitions.
The private image can contain personal files and remains ignored by git.
No coredump files will be opened or decoded during the readiness inventory.

The script refuses an existing destination or missing expected serial node.
It captures raw device output privately, checks exact size and records SHA-256.
Failure stops before inventory; a failure during communication may leave the
device in download mode. A checksum record identifies the acquired image; it
does not prove replay readiness or a safe future write delta.

## Recovery and approval scope

The [owner's handoff addendum](/Users/baris/cc700-backup/HANDOFF_ADDENDUM.md)
records: “the CC700 stays OFF” after an esptool reset, and says the owner performs
the physical power-button operation. Be prepared to unplug USB, wait about five
seconds and long-press power if needed, following the recorded recovery method.
No automatic series of alternate reset attempts is part of this operation.

Approval here covers the maintenance interruption, RAM stub and storage read,
followed by the one requested hardware reset. It does **not** cover installing
the candidate configuration/FIT/route, editing ride recovery files, firmware
changes, coredump inspection, forcing activation, or replaying a synthetic
activity into the current ride.

After acquisition, inventory only replay/configuration directories, route list,
session-recovery prerequisite metadata and filesystem capacity. Then prepare
the exact file changes and rollback from that fresh image. If the app runs and
changes storage before a later edit, synchronize again before applying it.
The handoff explicitly requires approval before a flash/storage write.

## Already prepared for the later review

- Five-row positional configuration candidate, with both optional prescans off.
- Two 61-fix/60-second synthetic plain FIT candidates, with independent CRC and
  host reader checks; native target decoding remains untested.
- A matching synthetic navigation-route candidate: 4,096 bytes, three records,
  geohash field 8 in every record, right then left prompts. It uses the same
  semicircle-quantized coordinates as the FIT. Host round-trip passes.
  Name images are the existing CLI's blank bitmap stand-ins, so text rendering
  is excluded. It is a candidate for a narrow position/progress test, not a
  dense-map or physical ride fixture.
- Native activation/deactivation guards and EOF/freshness assertions. A normal
  new-ride start deactivates replay; successful loading/resume is the traced
  activation path. No safe bypass or direct activation command is assumed.

These candidates are private local files; none has been transferred. Readiness
does not remove the session-loading guard or imply a valid recoverable session.
