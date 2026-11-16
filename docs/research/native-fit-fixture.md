# Native FIT replay fixture readiness

2026-11-13. Two wholly synthetic, plain FIT candidates are built and checked
offline. **Neither has been opened by the device or executed by its FIT decoder.**
This establishes file construction and host readability, not on-target replay
compatibility, timing, navigation progress, or sensor equivalence. No network,
device access, configuration change, storage write, or app feature was used.

## Reviewable artifacts

Private working directory: `/private/tmp/cc700-native-fit/`. These files are
outside public git and can be preserved with the other ignored local evidence.

| File | Purpose / observed result |
|---|---|
| `build_fixtures.py` | Deterministic, standalone standard-library generator; no downloaded dependencies or private ride input |
| `synthetic-minimal.fit` | 1,339 bytes; file-ID message plus 61 record messages; SHA-256 `4d558aab6ea1f5134967a65d1ee399738d8e68db63238695bfaecceda7f26812` |
| `synthetic-timer-events.fit` | 1,368 bytes; same records with timer start/stop-all messages; SHA-256 `20f2d004be056f93a91bbeab44af8953650218ac9c60c58000d941c606a35f73` |
| `fixture-manifest.json` | Versions, definitions, sizes, hashes and synthetic provenance |
| `verify_fixtures.py` | Independent CRC implementation, narrow structural checks, firmware-profile comparison, and existing recovered host-reader comparison |
| `verification.json`, `verification.log` | Actual verification results for both files and aggregate historical packed/plain findings |
| `extract_fit.py`, `decode-extraction.json` | Exact bounded disassembly provenance and byte-range hashes |
| `check_extraction.py`, `extraction-verification.json`, `extraction-verification.log` | Repeatable stock/v16 byte-range comparison and GNU instruction/branch comparison |
| `fit-wrapper*.txt`, `fit-converter*.txt`, `fit-accessors*.txt` | Local and GNU disassembly of the native wrapper/converter/accessor entry |

Both candidates represent 60 seconds with 61 fixes at one-second intervals,
5 m point steps, two right-angle changes, and a cumulative 300 m distance.
The first and last recorded speeds are zero; intermediate speeds are 5 m/s.
Elevation is a constant 100 m. Their origin and timestamps are synthetic;
no recorded route, address, manufacturer identity, serial number, or device ID
was copied. A compatible route would still need to be prepared separately for
navigation tests: a FIT replay file alone is not a loaded navigation route.

Rebuild and verify locally:

```sh
python3 /private/tmp/cc700-native-fit/build_fixtures.py
python3 /private/tmp/cc700-native-fit/verify_fixtures.py
```

Both commands exited 0. Verification confirms exact header/data/trailer lengths,
header and whole-file CRC remainder zero, 61 records, consecutive timestamps,
encoded units, matching positions/timestamps/distances from the existing
`../cc700-backup/tools/ride.py` reader, and exact membership of every definition
field in the native firmware profile. Deliberately corrupting one payload byte
causes the independent checker to reject the copy for file CRC.

No installed `fitparse`, `fitdecode`, `garmin_fit_sdk`, or `fit_tool` module was
found in this Python environment. No SDK was downloaded. The new checker is
deliberately limited to these fixtures' normal little-endian definitions and
data messages. It is not a general FIT conformance validator, nor a port of
the native parser. The existing recovered reader does not check FIT CRC itself.

## Conservative construction contract

This is the smallest candidate construction checked here, not a proven minimum
accepted by the device. File-ID is included for a conventional activity envelope;
the extraction does not establish that it is required. The second candidate
allows timer-event presence to be reviewed independently. Session/lap summaries,
developer fields, enhanced speed/altitude and compressed timestamps are omitted.

Header: 14 bytes, protocol `0x10` (1.0), profile 2132 (21.32), little-endian data
size, ASCII `.FIT`, and a two-byte header CRC. These versions match the header
of the recovered plain ride, avoiding an invented newer protocol requirement.
All message definitions use normal record headers and little-endian architecture.

| Global message / local number | Fields in encoded order |
|---|---|
| File ID, global 0 / local 0 | Field 4 `time_created`, uint32; field 0 `type`, enum = 4 (activity) |
| Record, global 20 / local 1 | 253 timestamp uint32; 0 latitude sint32; 1 longitude sint32; 5 distance uint32; 2 altitude uint16; 6 speed uint16 |
| Event, global 21 / local 2, optional candidate | 253 timestamp uint32; 0 event enum = 0 (timer); 1 event-type enum = 0 (start) or 4 (stop-all) |

| Field | FIT encoding used | Native evidence / caution |
|---|---|---|
| Timestamp 253 | Seconds since 1989-12-31 UTC; explicit in every record | Current record starts at replay-state +668; the pump reads its timestamp and compares it with replay counters |
| Latitude 0 / longitude 1 | Signed semicircles; degrees = raw × 180 / 2³¹ | Profile offsets +4/+8; pump checks `0x7fffffff` invalid values and converts them into GPS coordinate representation |
| Distance 5 | Centimetres; raw / 100 = metres | Profile record offset +12; existing recovered reader confirms distance |
| Altitude 2 | Raw / 5 − 500 = metres; fixture raw 3000 | Profile record offset +36; pump reads state +704, divides by 5 and subtracts 500 |
| Speed 6 | Raw / 1000 = m/s; fixture raw 5000 | Profile record offset +38; pump reads state +706 and applies approximately raw × 3.6 / 1.854 before GPS publication. Preserve this observed firmware conversion separately from standard FIT units; it is not a simple raw-to-km/h result |

Field sizes/types are encoded as enum `0x00`, uint16 `0x84`, sint32 `0x85`,
and uint32 `0x86`. Missing fields are left to native profile initialization;
the candidates explicitly supply position, timestamp, altitude and speed to
avoid relying on invalid defaults for the GPS path. They provide no recorded
magnetic heading. Heading still depends on the replay position history and
potential low-speed sensor selection described in the
[navigation behavior extraction](navigation-behavior-extraction.md).

FIT CRC here is reflected CRC-16 with polynomial `0xa001`, initial value zero,
and no final XOR. The writer uses a bitwise implementation; the checker uses
a separate nibble-table implementation matching the native table at
`0x3c34bc3e`. Store little-endian CRC of the first 12 header bytes as bytes
12–13. Append little-endian CRC of the complete 14-byte header plus message
data as the final two bytes. The entire valid file then has CRC remainder zero.
This CRC is distinct from BLE transfer's CRC-16/XMODEM.

## Native decoder boundary recovered

The source is the existing owner's stock V1.414 image, read as data through
the recovered `FW`/`xt.py` tooling. New bounded extraction covers:

| Range / address | Finding |
|---|---|
| `0x420b4fd8` | Replay opener constructs a path under `/littlefs/ModuleDataTest/FitFile`, opens `rb`, then initializes converter state at `0x420cc8a0` |
| `0x420c9b00`–`0x420c9c84` | `FitDecodeFile` wrapper reads bytes directly from the file in chunks of up to eight, calls converter entry `0x420ccf6c`, and copies recognized decoded messages |
| `0x420cc8d0`–`0x420ccf6c` | Streaming converter state machine; normal/compressed record-header branches, definitions, field mapping, byte order, CRC and completion |
| `0x420cd00c`, table `0x3c34bc60` | Lookup over 66 compiled message profiles; record global 20 has 48 profile fields whose byte sizes sum to 99; its wrapper/replay copy is 100 bytes |
| `0x420ccfa0`, table `0x3c34bc3e` | FIT CRC nibble implementation/table |
| `0x420b5125` | Replay decode pump shifts the previous 100-byte record and stores the current record at state +668 |

The wrapper was checked as 138 reachable instructions and the converter as
614; GNU objdump agreed on extracted instruction addresses and all 42/139
direct branch targets respectively. The accessor extraction covers only the
first entry at `0x420ccf6c`; adjacent accessor entries were inspected separately.
Wrapper, converter, CRC and profile-table byte ranges also match the saved,
reproduced v16 image. These comparisons validate static extraction provenance;
they do not execute the firmware instructions.
The sanitized [decoder evidence manifest](../mining/fit-decoder-evidence.json)
preserves the range hashes and GNU comparison results.

The converter explicitly checks the `.FIT` signature and rejects protocol
major versions 3 and above. It has storage/mapping for 16 local message numbers;
the compressed-timestamp header path uses the format's two-bit local number.
It looks up recognized fields against a compiled profile and handles byte-order
conversion. Developer-field skipping and compressed-timestamp code exist, but
neither is needed or claimed tested by these fixtures. Malformed definitions,
maximum field counts, short headers, truncation and unknown profiles are not
established safe-input contracts.

Return codes recover more meaning than the earlier replay-pump audit alone:
0 asks for more input; 1 publishes a decoded message; 3 is the completed-file
branch with zero CRC; 4 is unsupported protocol major; 5 is bad signature.
Code 2 includes CRC failure and inconsistent decoder/file-end state. The wrapper
stores these results for its caller. The replay pump closes on 2/4/5 and returns
1, and closes on other nonzero states (including 3) and returns 2. These are
static branch interpretations, not observed live success/error notifications.

## Packed device recordings are a different envelope

The backed-up `ride_packed.fit` begins with `.ZIP`, followed by a 14-byte FIT
header, then repeated little-endian uint16 compressed-length + zlib stream
chunks, and a final two-byte FIT CRC. It is not a normal ZIP archive.
The replay opener/wrapper traced above has no `.ZIP` decompression stage;
the direct converter expects a plain FIT header at byte zero. Therefore the
ready candidates use plain `.FIT` files, not the device recording envelope.

One historical pair was checked locally: 21 zlib chunks reconstruct 20,788
bytes including header and trailer. Decompressed header/message data match the
existing unpacked ride byte-for-byte, but that old unpacked copy ends in two
zero bytes and **fails whole-file FIT CRC**. Its header CRC is valid. The final
two bytes of the packed original are the correct CRC for the reconstructed
plain FIT bytes; they are not the CRC of the `.ZIP` container bytes. No private
record data was copied or included in this document. Do not use the old
unpacked copy as a CRC-valid positive fixture without repairing its trailer.

## Remaining approval and compatibility boundary

A matching synthetic route candidate was subsequently built from the same
semicircle-quantized coordinates: 4,096 bytes, three records, field-8 geohash
indexes throughout, right then left prompts, and successful host round-trip.
Its images are the existing CLI's blank bitmap stand-ins; text rendering is
excluded. It remains untested on target, alongside both FIT candidates. See
the [prepared operation](native-replay-next-operation.md) for the current gate.

These files are ready for offline review and preservation. Choosing a fixture,
matching it to a navigation route, reviewing the positional configuration, and
authorizing any future device write/activation remain separate steps. No such
authorization or action is implied here. Actual native decoding, file selection,
timestamp preskip, event interaction, EOF behavior, GPS validity/publication,
heading, and navigation result still need controlled target observation.
