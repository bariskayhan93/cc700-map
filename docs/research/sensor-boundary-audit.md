# CC700 sensor and peer boundary audit

Evidence date: 2026-11-13. Offline, bounded inspection of stock V1.414 and
comparison with saved v16. No device access, packet injection, firmware write,
storage write or coredump read was performed. This follows the
[stationary sensor observations](../reports/popup-and-sensor-followup.md) and
[transport extraction](../reports/remaining-extraction-and-device.md).

The ESP32 image supports magnetic and inertial packet inputs. It does not
establish that this CC700 board populates those sensors or that its peer sends
those packets. The new findings close the UART setup, distinguish a downstream
IMU file gate from sampling control, and locate the separate peer update source.
No proven command to enable magnetic or inertial sampling was found in this
bounded pass.

## What the receiver actually supports

Payload handler `0x4203b9d8` selects `0xf1`, calls `ImuDataInit` first, then
accepts the following subtype byte at payload `+1`. This is compiled receiver
support, not an advertised or measured board capability.

| Subtype | Directly established action |
|---|---|
| 0 | Pack three little-endian 16-bit words from `+2..+7`; call magnetic OTP helper `0x42141c1c` using auxiliary bytes `+8/+9`, then magnetic input `0x42142160` |
| 1 | Pack the same three words; call inertial input `0x42141674` |
| 2 | Pack the same three words; call inertial input `0x42141760` |
| 3 | Decode signed 16-bit `+2/+3` and a 32-bit value beginning at `+4`; scale both by 100, perform additional arithmetic, enqueue record type 2 |
| 4 | Decode a 32-bit value at `+2`, combine a 16-bit value at `+6/+7` and helper output; enqueue record type 9 |
| 10 | Convert signed 16-bit `+2/+3` to float and store at `0x3fc9fac8` |
| Other values | Return 48 after general IMU initialization; no subtype-specific processing in this handler |

Subtype 1 writes its raw record at `0x3c3ae428 +10`; subtype 2 writes at
`0x3c3ae428 +0`. Both publish their raw values and validity byte before their
buffer checks. Their processing scales differ: raw/32767 ×32 for subtype 1,
raw/32767 ×2000 for subtype 2. These scales are consistent with acceleration
and gyroscope inputs respectively; the physical unit/range interpretation is
an inference. Do not assign sensor models from these constants. The table leaves
subtype 3/4/10 physical labels unresolved rather than inferring them from the
product specification.

The wrappers also expose useful RAM arrival latches: magnetic subtype 0 writes
byte `0x3c3ae43c = 1` before the OTP-pointer check; subtype 1 writes
byte `0x3c3ae43a = 1`; subtype 2 writes byte `0x3c3ae430 = 1`, before buffer
checks. A zero axis vector by itself does not distinguish a received all-zero
sample from no sample. These bytes strengthen a read-only observation, but their
complete reset lifecycle is not audited here. There is no subtype counter in the
fully extracted payload handler. Ring-buffer occupancy would indicate transient
general traffic, not magnetic or inertial packet counts, and inspecting it alone
would not close this boundary.

The already captured post-rotation `state-imu-raw.log` covers all three latches:
`mag_axes` starts at `0x3c3ae43c` and its 12 bytes are zero; `imu_raw` starts
at `0x3c3ae428` and its 20 bytes are zero. Thus all three sampled arrival latches
were **0**, not just their associated axis values. No additional device halt was
necessary to establish that observation. Without the complete clear/reset
contract this still does not prove that a subtype never arrived during the session.

The private saved `state-imu-raw.log` was checked independently: its 20-byte
`imu_raw` range and 12-byte `mag_axes` range are entirely zero, covering all
three latches above. Thus their sanitized sampled values were magnetic **0**,
subtype 1 **0**, subtype 2 **0**. This strengthens the boundary to **no raw-input
arrival latch was set at the sampled time**, including no evidence of received
all-zero samples. Because every reset/clear writer and sampling interleaving has
not been audited, it does not prove no packet ever arrived since boot. The
existing capture already contains these fields; another identical stationary
snapshot would not resolve the peer/hardware question.

The existing receiver path is UART2 → ring buffer → frame checks → outer type
16 → this handler. Valid frame delivery can be observed separately from subtype
0/1/2 activity. A nonnull general IMU allocation cannot distinguish them, since
every `0xf1` subtype initializes that context.

## UART startup and commands

Task entry `0x420092d4` calls initializer `0x4203b11c`, startup barrier
`0x42009918(2)`, then frame-consumer loop `0x4203afc0`.

The initializer calls adapter `0x421496b4` with logical channel 1, baud 115200,
receive size 3072, transmit size 264 and remaining arguments zero. The adapter
maps channel 1 to hardware UART index 2, installs/configures it and selects pin
arguments 42 and 41 at `0x42149766..0x4214976c` (the low-level pin API argument
order is preserved; electrical wiring was not measured). It also constructs the
10-item, 12-byte transmit queue and receive ring buffer. There is no magnetic or
inertial sampling-enable command in this initializer or task-entry wrapper.

Frame builder `0x4203ae48` constructs outgoing packets with byte 0 `0xa5`,
byte 1 `payload_length +4`, bytes 2/3 `0x6f/0xf1`, byte 4 the first argument,
byte 5 the second argument, then payload and trailing 16-bit checksum. It queues
the allocated frame through `0x4203ae30`; the consumer sends it on logical
channel 1. This provides a concrete outbound boundary for a later command audit.

The explicitly named `SendPowerOnCmd` at `0x4203c098` sends first argument 2,
second argument 16, and eight-byte payload `e2 02 00 00 00 01 00 00` copied from
`0x3c1ec23b`. Its name and bytes establish a peer power-on request, not a sensor
sampling-enable request. The direct indexed frame-builder callers include power,
charge, slave-mode and ANT callbacks. Their existence does not justify inventing
an `0xf1` sampling command or invoking one. The local index is a search aid, not
proof that every indirect caller was enumerated.

## The IMU disable file is downstream

Cycling initialization `0x420b2ab4` calls `0x42143160` with two cycling callbacks.
That function initializes a substantial calculation context, then calls
`0x4200b11c` with `/littlefs/ImuDisable.txt`. This helper passes the pathname and
a stack buffer through `0x421c128c` into the VFS metadata operation. The caller
sets byte `0x3fca2d4c` to 1 when the operation returns zero and 0 otherwise.
There is no file-content parser in this path.

The calculation function at `0x42143e70` reads the flag at
`0x42143f39..0x42143f42` and `0x42143f91..0x42143f97`, changing its downstream
processing branches. These reads occur after `0x42141850` (`ImuHandleAccData`).
The flag is not read by the inspected UART initializer, packet dispatcher or raw
magnetic/inertial input wrappers. Therefore this file is **not evidence that peer
sampling is disabled**, and creating/deleting it is not a justified way to
activate a compass. Its complete downstream effect is outside this bounded audit.

Product configuration has byte getters at `0x4200d128`, `0x4200d148` and
`0x4200d168`, reading offsets 0/1/2 through pointer `0x3c380bec`. Nearby command
helpers consult them, but no sensor-presence bit or board component inventory
was established. Shared product code and compiled algorithms remain weaker than
board-specific evidence.

## Peer firmware is a separate missing input

`StartSlaveAutoUpg`, `0x420b2484`, calls `GetUpdateFile`, `0x420ec0fc`, using a
node selector stored at update context `+5`, version argument zero, and a filename
output buffer. Success sets update-context `+7` to 1; failure sets it to 0 and
logs `Not Find Slave MCU file!`. `GetUpdateFile` enumerates under `/littlefs/APP`
and selects a candidate using version/node logic. Thus the updater expects a
separate peer firmware file; these routines are not the peer sampling code.

The historical extracted `parts/fs/APP` and `parts/fs/TMP` directories contain
no files. This is a statement about the saved extraction, not current live
storage. No separate peer image was identified in those locations. A string
containing `Nrf` in the ESP32 time-handling code suggests vendor terminology but
does not identify the peer chip or its exact firmware. No public firmware fetch
or update attempt was made.

## Stop boundary and remaining evidence

The existing rotation observations remain valid: zero raw inputs do not
distinguish absent sensors, inactive peer sampling, unsupported peer output,
invalid/missing frames or initialization failures. Further ESP32 algorithm
exploration cannot decide physical population or reconstruct an absent peer
image. The useful next evidence is one of:

- A board schematic/component identification or board-specific capability record.
- The matching peer firmware/update file and its sensor initialization/output code.
- Authorized observation of already flowing UART frames, separating outer framing,
  `0xf1` subtype counts, nonzero raw samples and auxiliary magnetic parameters.

A capture with no subtype 0 during a bounded interval would establish absence
of observed magnetic packets in that interval, not absence of hardware. No
runtime activity, working compass or complete simulation is claimed.

## Verification

Stock SHA-256 remains
`7545ae4d4030b24b1f6198f481ce3a9a183a0e6eb3e5355b86ad2413aead2c31`.
Private script `/private/tmp/cc700-mining-20261113/verify_sensor_boundary.py`
compares 13 inspected ranges with saved v16 and checks all recursively reached
instruction boundaries and direct branch targets against GNU Xtensa objdump.
All checks passed. The input, outputs and range hashes stay in private scratch;
the sanitized [range manifest](../mining/sensor-boundary-evidence.json) is also
available in the reports. No binary or private live records are included in
publishable report files. The prior
packet/input-wrapper verification is recorded in
[mining/popup-sensor-evidence.json](../mining/popup-sensor-evidence.json).

Reproduce the new static checks with:

```sh
python3 /private/tmp/cc700-mining-20261113/verify_sensor_boundary.py
```

For independent entry-point inspection:

```sh
python3 ../cc700-backup/tools/xt.py ../cc700-backup/parts/ota_0.bin dis 4203b11c
python3 ../cc700-backup/tools/xt.py ../cc700-backup/parts/ota_0.bin dis 4203c098
python3 ../cc700-backup/tools/xt.py ../cc700-backup/parts/ota_0.bin refs '/ImuDisable/'
python3 ../cc700-backup/tools/xt.py ../cc700-backup/parts/ota_0.bin dis 420b2484
```

The imported index/linear disassembler assists discovery; the recursive/GNU
checks are the validation. The IMU consumer check covers only its prefix through
`0x42143fa0`; no full extraction of that large algorithm is implied.
