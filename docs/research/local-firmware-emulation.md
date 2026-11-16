# Local firmware emulation: booted, blocked before GUI/replay initialization

A bounded local experiment on 2026-11-14 executed the real ESP32-S3 ROM,
bootloader and v18 application using Espressif `esp-emulator` v1.0.0 on macOS
arm64. The bootloader loaded the application from OTA1 at `0x440000`. The
application then repeatedly polled the LCD_CAM transaction-done status during
LCD i80 bus initialization. This is a concrete peripheral compatibility blocker;
there is no evidence of a ready GUI or native FIT replay in this run.

This is executable firmware emulation, with a narrower demonstrated boundary
than full CC700 board emulation. No physical device was connected, reset, read
or written by this experiment. No replay activation was attempted. A separate, explicitly artificial diagnostic
bypassed one virtual LCD wait as described below.

## Inputs and repeatable bounded operation

The official [v1.0.0 release](https://github.com/espressif/esp-emulator/releases/tag/v1.0.0)
archive was checked against its published checksum manifest. Private artifacts
are under `.local/esp-emulator/`; neither the flash contents nor boot/debug logs
belong in the public repository.

| Artifact | SHA-256 |
|---|---|
| macOS arm64 release archive | `d180f76ad6a97f811c11dd810b4a0c7dd7f57f0acd70ca570f0bb649b533dedb` |
| Original saved full flash, before preparing simulation copy | `5d7c26581f9bf073f094a0328f63440f236baaed46d0df4b1c63dc61a02b3e16` |
| Private simulation flash: saved full flash, v18 OTA1 and selected OTA1 metadata | `4ff09f559b5a81b15f41605c18d271c3994ff83323314dc6b8d65a80621012c4` |

A standalone ten-second boot operation is:

```sh
.local/esp-emulator/v1.0.0/esp-emu \
  --chip esp32s3 \
  --firmware .local/esp-emulator/v1.0.0/local-v18-flash.bin \
  --net user,restrict=yes \
  --wifi-ssid CC700_LOCAL_SIM_ONLY \
  --wifi-password simulator-only \
  --timeout 10s
```

The synthetic SSID/password are simulation inputs. No BLE backend, UART bridge,
physical debug interface or `--save-state` is enabled. The original acquisition
is not passed to the emulator. Flash changes made inside the process are
discarded. See the official [CLI reference](https://github.com/espressif/esp-emulator/blob/main/docs/guides/CLI.md)
and [host interfaces](https://github.com/espressif/esp-emulator/blob/main/docs/guides/HOST-INTERFACES.md).

The private read-only readiness runner is:

```sh
python3 .local/esp-emulator/analysis/audit_boot.py
```

It verifies the simulation flash hash, starts an isolated emulator process with
a 20-second hard guest-run limit, connects to its virtual TCP debug server on
loopback, samples at approximately 2, 5 and 10 host seconds, then terminates the
process and checks the flash hash again. Both observed runs preserved the input
hash. Its debugger operations are halt, thread selection, register/memory reads
and continue. It issues no guest memory writes. Results and logs remain private
in `.local/esp-emulator/analysis/`. A debugger halt perturbs execution; the host
intervals below do not measure device timing.

## Readiness observations

The second complete run produced:

| Host elapsed seconds | Core 0 PC | Core 1 PC | RTOS tick `0x3fc9ece4` | GUI clock `0x3fc9f648` |
|---|---|---|---:|---:|
| 2.005 | `0x42136467` | `0x4037e75e` | 529 | 0 |
| 5.005 | `0x42136467` | `0x4037e75e` | 1627 | 0 |
| 10.005 | `0x42136467` | `0x4037e75e` | 3468 | 0 |

An earlier independent run sampled core 0 at `0x42136461`, then twice at
`0x42136467`; ticks were 527, 1633 and 3473. Both addresses are in the same
polling loop. RTOS tick progression proves some firmware execution continues;
the GUI clock did **not** advance.

All three second-run samples also had:

| Read | Value | Interpretation |
|---|---|---|
| LCD_USER `0x60041014` | `0x1a903fff` | LCD start/configuration bits remain set |
| LCD interrupt enable `0x60041064` | 2 | LCD transaction-done interrupt enabled |
| LCD interrupt raw `0x60041068` | 0 | No completion event observed |
| LCD interrupt status `0x6004106c` | 0 | Polling condition remains false |
| Replay-active byte `0x3c38edb8` | 0 | Replay inactive |
| Replay GPS pointer `0x3fca27e4` | 0 | Replay GPS buffer not allocated/published |
| Navigation list pointer `0x3c388cf8` | 0 | No navigation list published |
| First five replay configuration slots `0x3c38eb14`, 80 bytes | All zero | Not the parser's initialized −1-ID table |

No coordinates, saved network credentials, route names or file contents were
included in this report.

## The concrete stall

Disassembly of the actual application at `0x42136461..0x42136467` is:

```text
42136461: memw
42136464: l32i a7, a5, 108
42136467: bnone a7, a13, 0x42136461
```

The preceding code sets `a13 = 2` at `0x421363d8`; the HAL initializer at
`0x421dbf2c` supplies peripheral base `0x60041000`. Consequently the loop waits
for bit 1 at `0x6004106c`. Espressif's
[ESP32-S3 LCD_CAM register definitions](https://github.com/espressif/esp-idf/blob/v5.1/components/soc/esp32s3/include/soc/lcd_cam_reg.h)
identify that register/bit as LCD transaction-done status. The corresponding
[i80 driver source](https://github.com/espressif/esp-idf/blob/v5.1/components/esp_lcd/src/esp_lcd_panel_io_i80.c)
contains a matching initialization sequence: a dummy transaction followed by a
busy wait for completion in `lcd_periph_trigger_quick_trans_done_event`, called
from `esp_lcd_new_i80_bus`. This source comparison identifies the operation; it
does not assert an exact ESP-IDF source revision for the vendor firmware.

This blocker precedes GUI/replay readiness. It does not establish whether later
CC700 board-peer UART, display commands, storage, sensor or radio paths work.
Those paths were not reached or validated by this experiment.

The v1.0.0 debug server's target XML advertised `riscv:rv32` even for this Xtensa
run. Raw `p0` responses decode little-endian to the Xtensa code addresses above,
and those addresses match the disassembly. Do not trust the advertised RISC-V
register layout, label other registers from that XML or infer a valid Xtensa GDB
backtrace from the returned full `g` packet.

## One bounded virtual-PC bypass diagnostic

After preserving the clean boot trace, one separate run changed only virtual
core 0's PC, using `P0=6a641342` to resume at `0x4213646a` after the first LCD
poll. The debug server returned `OK` and readback was `6a641342`. This bypass
is artificial execution steering, not an LCD completion model or a successful
boot. No second bypass or peripheral write was attempted.

| Host elapsed seconds | Core 0 PC | Core 1 PC | RTOS tick | GUI clock |
|---|---|---|---:|---:|
| 2.001, before bypass | `0x42136461` | `0x4037e75e` | 525 | 0 |
| 5.005 | `0x42135f74` | `0x4037e75e` | 1583 | 0 |
| 10.005 | `0x42135f7a` | `0x4037e75e` | 3361 | 0 |

The second location is another LCD completion poll: `0x42135f77` loads
`[a4+108]`, and `0x42135f7a` tests bit mask 2 and loops to `0x42135f74`.
LCD interrupt raw/status remained zero; replay configuration and GPS/navigation
pointers remained zero. The simulation flash hash again matched before and
after. Private evidence is under
`.local/esp-emulator/analysis/lcd-poll-bypass/`. This shows a one-time PC skip
does not provide a usable headless app: subsequent real LCD transactions also
require completion behavior. It supplies no evidence about later board-peer
or replay execution.

## Next finite local operation

The first useful compatibility change is an emulator-side LCD_CAM i80 model
that completes the initialization dummy transfer: model LCD start/update
behavior, set the raw transaction-done event, derive enabled status and honor
interrupt clearing. Re-run the same hash-pinned readiness probe and require
progress beyond the loop plus an advancing GUI clock before attempting a local
UI event or recovery-session fixture. This operation is not implemented here.
Blindly setting replay-active now would bypass guards while its buffers and
configuration are uninitialized.

Once initialization works, use a disposable **simulation flash copy** containing
the [native FIT fixture](native-fit-fixture.md) and a deliberately recoverable
recording session. Follow the [resume activation contract](../current/native-replay-contract.md)
and account for the [recording/lap truncation effects](../current/repeatable-validation.md).
Then require actual decoded/published/consumed record evidence using the
[replay observation checks](native-replay-capture-design.md). Boot success alone
cannot establish that coverage. Emulator scheduling and peripheral shims remain
outside evidence of hardware timing or complete board equivalence.
