# CC700 storage access and replay readiness

Evidence date: 2026-11-13. This audit inspected local tools, saved storage,
existing application code, the historical Claude session and installed OpenOCD
configuration. No USB device or serial port was opened, no target was halted or
reset, and no firmware, device storage or target RAM was written.

There is currently **no proven noninterrupting method to inventory arbitrary
live CC700 files** in this workspace. Offline inventory is ready and works.
The existing BLE route listing cannot list replay configuration or FIT files;
the established full-storage reader interrupts normal firmware execution.

## Available paths and their limits

| Path | Established capability | Boundary |
|---|---|---|
| Saved storage image + local LittleFS | List directories and read file contents entirely offline | Historical state only; cannot establish current live files |
| Mounted filesystem | Local `mount` and `/Volumes` inventory showed no CC700 volume | No mounted mass-storage path is presently available; does not prove firmware never supports one |
| Existing BLE `routeList()` | Request and parse route filenames | Restricted to `route_*.bin`; no arbitrary directory listing or file download implemented |
| esptool storage read/sync | Historically read storage partition at flash `0x860000`, length `0x79e000` | Requires ROM/stub access, interrupts application; sync helper explicitly resets and uploads executable RAM stub |
| JTAG memory sampling | Existing scripts sample named RAM/mapped-code ranges during a bounded dual-core halt | Does not expose the complete LittleFS partition; no safe whole-storage read demonstrated |
| OpenOCD flash-bank reader | Installed configuration declares flash banks and stub work areas | Generic command availability is not proof of a nonhalting, noninjecting storage read |

The local system inventory also showed a USB modem serial-node pair. Merely
listing those nodes did not open them or establish a file-access service.
No USB identifiers or user filenames are needed in this report.

## Offline inventory works, with the matching Python environment

`tools/unpack_lfs.py` reads an image into a bytearray, mounts that in local
LittleFS, walks it, reads files with `rb`, and writes extracted copies to the
chosen host output directory. It does not communicate with a device. Its actual
arguments are `image output_directory python_package_directory`; the third is
required even though the short usage comment omits it.

The backup's bundled LittleFS native extension is Linux x86-64 CPython 3.8.
It cannot be imported by the current macOS Python; a trial offline import failed.
A working macOS ARM64 CPython 3.15 extension exists in the historical temporary
venv at `/private/tmp/claude-501/cc700/venv`. Its Python successfully mounted the
saved `parts/storage.bin` using:

```python
from littlefs import LittleFS
image = open(image_path, 'rb').read()
fs = LittleFS(block_size=4096, block_count=len(image)//4096,
              read_size=128, prog_size=128, lookahead_size=128, mount=False)
fs.context.buffer = bytearray(image)
fs.mount()
names = fs.listdir('/ModuleDataTest')
```

Use that venv's Python with `-I`, without prepending the incompatible backup
`pylib`. This only changes the in-memory copy; the opened image is never written.
The 128-byte read/prog/lookahead settings match the successful historical scripts.
A durable environment remains preferable because `/private/tmp` can disappear.

The saved image was independently inspected during this audit:

| Saved-image field | Result |
|---|---|
| Length | 7,987,200 bytes; 1,950 blocks of 4,096 bytes |
| SHA-256 | `a9abacf226443066ef9d8acee89a6f72918028e845a4bdeab52618ea1f71cf19` |
| `/ModuleDataTest` | One entry, its FIT subdirectory |
| `/ModuleDataTest/ModuleDataTest.cfg` | Absent |
| `/ModuleDataTest/FitFile` | Empty |
| `/APP`, `/TMP` | Empty |

These results concern the saved backup only. They do not establish present
replay readiness, present free space or current firmware-update files.

Despite its comment describing map entries “as the device holds [them] in RAM,”
`tools/blockdump.py` is an **offline route-file decoder**. It reads a supplied
route file, selects the section at a requested distance and writes a host-format
entries file. It has no device connection or RAM reader. It also prints a route
point's coordinates, so raw output belongs in private evidence rather than public
documentation. It cannot inventory storage.

## BLE listing is narrower than filesystem access

In `js/ble.js`, `CC700.routeList()` sends `b0 f1 01 42 06`, waits for response
command `01 42`, decodes names after response offset 9, and retains only names
matching `route_*.bin` without slash/control characters. It returns `[]` both
for no reply and for no parsed names; that result is not a strong absence test.
There is no arbitrary-path listing or file-read method in this client.

`connect()` itself connects GATT, subscribes to notifications and writes a hello
request to discover the command characteristic. Thus it is not passive radio
observation. The existing app UI calls `routeList()` after `sendFile()`; clicking
the normal send button to obtain a list also transfers a route. That UI is not a
read-only inventory workflow. This audit did not invoke it.

A dedicated route-list-only action could avoid file transfer, but would still
not inspect `/ModuleDataTest`. An arbitrary-file protocol requires separately
proven commands and response handling; do not extrapolate it from route listing.

## Why the established storage reader needs an interruption

`tools/sync_storage.py` requires an existing correctly sized local image, then:

1. Opens hardcoded Linux port `/dev/ttyACM0` through
   `esptool.cmds.detect_chip(..., 'default_reset', False)`.
2. Calls `run_stub()` and changes baud to 921600.
3. Compares device/local MD5 per 64 KiB region, then per changed 4 KiB block.
4. Reads changed blocks, verifies each checksum, and overwrites the local image.
5. Closes the serial port, leaving the device in download mode as its comment says.

No flash programming is present in this helper, but it is not a zero-side-effect
reader: the local esptool implementation calls the reset strategy to enter the
bootloader; `run_stub()` uploads text/data to RAM and executes its entry point.
The current port name also differs from the helper's hardcoded Linux path.
Do not run this helper unchanged for a noninterrupting inventory request.

The historical Claude session contains macOS commands using `read_flash
0x860000 0x79e000` with `--before default_reset --after no_reset`, and subsequent
commands with `--before no_reset --after no_reset`. The latter occur within an
already established flashing/download workflow. `no_reset` skips the reset
strategy; it does **not** provide a filesystem service while the normal app is
running. Successful historic use is not authorization to interrupt this session.

The owner handoff requires coordination before an interrupting esptool read and
explicit approval before flash writes, storage writes or coredump reads. It
records the device staying off after resets until a long power-button press.
`boot_check.py` toggles RTS and is itself a reset operation, not an innocuous
read verification. No recovery operation was attempted here.

## Why JTAG is not yet the solution

The saved RAM-sampling scripts explicitly halt both cores and promptly resume
them. Their success on small named ranges does not establish acceptable duration
or consistency for an approximately 8 MB storage dump. The storage partition is a
physical flash offset, not an established contiguous CPU mapping. Reading an
arbitrary `0x3c...` range cannot be assumed to return it.

The installed Espressif OpenOCD configuration defines full-flash/IROM/DROM banks,
configures backed-up target work areas under its “ESP Stub flasher configuration,”
and reserves an ESP32-S3 RAM work area. Its GDB-attach handler explicitly calls
`halt 1000` and can call `reset halt` when memory protection is enabled. The
manual's `flash read_bank` command describes a flash-driver read into a host
file; it does not promise a nonhalting or noninjecting implementation.

No driver-level audit or measured no-halt flash-read contract was found here.
A speculative flash-bank dump would exceed the present no-halt/no-injection
scope. Changing MMU mappings, invoking target VFS/ROM functions, loading a flash
stub or bypassing the normal filesystem would also require a separately reviewed
method and authorization. No such action was taken.

## Concrete next prerequisites

For current replay readiness, obtain a **fresh, coherent storage image** during
an owner-coordinated maintenance interruption, or supply a proven arbitrary-file
read/list protocol that runs through the normal firmware. Then inventory the
configuration and FIT directory offline with the working LittleFS environment,
keeping image contents private. The existing saved snapshot contains neither
configuration nor FIT fixtures; it cannot justify replay activation.

A coordinated read plan must establish the actual current serial port, chosen
loader/stub behavior, destination snapshot, recovery/power procedure and the
permitted interruption. It must remain separate from any later configuration,
FIT upload or replay activation, which changes device state. No new permission
was requested or inferred by this audit.

## Validation

Read and inspected: `sync_storage.py`, `blockdump.py`, `unpack_lfs.py`, local
esptool connection/stub implementation, `js/ble.js`, app call sites, owner handoff,
historical storage-read commands and installed OpenOCD scripts/manual. Local
`mount`, `/Volumes` and serial-node inventory used no device opens. Offline
LittleFS mounting/listing succeeded in the matching venv after the incompatible
bundled-extension import was identified. `git diff --check` passed for this report.
