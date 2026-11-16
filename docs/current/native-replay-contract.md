# CC700 native replay configuration and activation contract

Evidence date: 2026-11-13. Read-only local analysis of stock V1.414 and private
rebuilt v16. No device access or device/configuration/storage changes. This
extends [native replay extraction](navigation-behavior-extraction.md),
[configuration parser findings](remaining-extraction-and-device.md), and
[lifecycle scheduling findings](lifecycle-audit.md).

## Configuration is indexed by ID and row, not by name

Boolean query `0x420b5738` and numeric query `0x420b5714` calculate
`0x3c38eb14 + requested_ID * 16`. Both require stored signed-ID equality and a
nonnull name pointer. Neither compares the name's contents. The Boolean query
requires mode other than 1 and returns whether value is nonzero; the numeric
query requires mode nonzero and returns its stored word. The ordinary parser
produces mode 0 for `Enable` and mode 1 otherwise.

Thus there is no required spelling such as `Replay` encoded into these query
contracts. Names are labels supplied by the configuration file; vendor-original
names/defaults were not recovered. `Enable` and `true` are actual parser tokens.
For a normal usable file, numeric ID must equal its zero-based parsed row
ordinal. Malformed rows can consume ordinals. Keep full tokens, ordinary decimal
single-digit IDs and small nonnegative decimal values when preparing a fixture;
the parser's permissive prefix/numeric behavior is not a validation guarantee.

| ID | Query type | Exact uses in the replay path |
|---|---|---|
| 0 | Boolean | Parser success plus ID 0 true permits test-task creation (`0x42009484..0x420094c8`); activation/deactivation wrapper also requires ID 0 true (`0x420b5782..87`). False/missing is a gate, not an instruction to perform cleanup. |
| 1 | No replay query identified | A positional placeholder is needed if rows for IDs 2–4 are supplied. This pass does not assign it a replay behavior. |
| 2 | Boolean | Together with nonzero numeric ID 3, arms preskip flag `0x3c38edb9` during initialization and activation. Otherwise activation uses the initial-record qualification path. Calls at `0x420b581c` and `0x420b5954`. |
| 3 | Numeric | Preskip target. Zero disables the ID-2 preskip combination; positive value is compared with the skip counter in `0x420b5d80..0x420b5e06`. The counter can incorporate valid FIT timestamp differences; it is not simply an unconditional number of records to discard. |
| 4 | Boolean | Controls an additional scan while current record field `+706` is zero; up to 251 decode attempts, with early termination on nonzero field or decode result (`0x420b5a99..0x420b5aea`). That field feeds converted GPS speed at `0x420b5b8f..0x420b5bc1`. False avoids this optional zero-speed prescan. |
| 37 | Boolean | A callback at `0x420b5858` returns Boolean ID 37 and is registered through `0x421415e4` in parser completion. This is an auxiliary IMU/test-control hook; it is not a required condition for the GPS replay task/activation path. Its complete downstream semantics are outside this pass. |

Direct-call and literal-reference scans guided this bounded inventory; they are
not proof against every indirect or aliased query elsewhere in the firmware.
The unused IDs are not silently assigned defaults or vendor meanings.

The following is a **prepared configuration profile**, using arbitrary labels,
that enables the task gate and disables the two optional prescans. It is not a
recovered vendor file and has not been installed or activated:

```text
$ReplayGate={0,Enable,true}
$ReservedRow={1,Value,0}
$PreskipGate={2,Enable,false}
$PreskipTarget={3,Value,0}
$ZeroSpeedPrescan={4,Enable,false}
```

The parser path is `/littlefs/ModuleDataTest/ModuleDataTest.cfg`. Five ordinary
rows align IDs 0–4 with slots 0–4. Missing ID 37 queries false; there is no need
to add 33 filler rows merely to represent that false state. The profile does
**not** select a filename, force activation, bypass a ride-state guard, or prove
that the required task exists in an already-running boot.

## The source is selected from an enumerated filename table

Initializer `0x420b5864..0x420b59d8` allocates its buffers and builds a table of
up to 30 names under `/littlefs/ModuleDataTest/FitFile`. It sorts using comparison
callback `0x420b503c`, which calls string comparator `0x40001230`. Table bytes
at `+7680/+7681` hold count/selection, initially zero. Open helper
`0x420b4fd8` requires a nonnull table and nonzero count, forms directory plus
selected table name, opens in `rb` mode and initializes its FIT reader.
It returns success immediately if a source handle is already present.

There is no numeric configuration-ID query in that source-opening function.
Do not infer “entry 1 is the filename index.” Full filename-filtering rules,
selection UI and every enumeration error remain unextracted. A configuration
file alone is insufficient: a suitable source must be inventoried and its
selected entry verified before a controlled run.

## Normal new-ride and resume paths have different replay effects

The firmware's table at `0x3fc9896c` names states 0–9 as INIT, STARTING, LOADING,
ONGOING, PAUSING, ENDWAITING, ENDING, ENDWITHOUTFIT, INIT_WAIT and SAVING,
respectively. The event table at `0x3fc9891c` names event 1
`RIDE_EVENT_RESUME_RIDE`. These names were read from stock data, rather than
inferred from the replay call sites.

| Ride-state path | Replay effect and guard |
|---|---|
| STARTING, state 1 | Dispatcher sends state 1 to `0x420425de`; its continuation sets state 3 and calls `0x420b5764(0)` at `0x42042605..0a`. A normal starting path does not activate replay there. |
| LOADING, state 2 | Dispatcher sends state 2 to `0x420426f1`. It calls helper `0x42041920`; only a zero return advances state to 3 and calls `0x420b5764(1)` at `0x42042702..05`. Nonzero return sets state 0 and skips activation. |
| INIT receiving resume event 1 | The event word `0x3fc989a8` is tested at `0x420421c0..c5`; event 1 selects state 2 at `0x420424cc..d1`. This establishes a resume/loading route to the activation branch; it does not establish every UI path that can enqueue that event. |
| ENDING, state 6 | Dispatcher reaches `0x42043900`, which calls `0x420b5764(0)`. |
| ENDWITHOUTFIT, state 7 | Dispatcher reaches `0x42041baf`, which calls `0x420b5764(0)`. |

The loading helper `0x42041920` invokes `ResumeFitRealSession` (`0x420cb8d4`)
for `/littlefs/FITS/RealSession.db`; if its return is nonzero, it tries
`/littlefs/FITS/RealSession.bak`. These are ride-session recovery paths, separate
from the test FIT source directory. Its ultimate zero return is the local gate;
this audit does not claim that an absent recovery file will satisfy it or that
replay configuration alone makes a resume operation available.

The activation wrapper itself, `0x420b5764..0x420b5852`, requires three core
allocated pointers and Boolean configuration entry 0 true **before either
activation or deactivation**. It returns for an unchanged active byte. On a
changed request it writes the byte, sets first-record/preskip flags, and opens
source; open failure clears active. It resets result state to zero afterward.
The task independently requires additional buffers and clear pause/result state.

On a changed deactivation request it clears decoder state, sets result 2,
invalidates timestamp words, clears position history and replay buffers, then
closes the source. Some smaller buffer pointers are used without separate null
guards in this branch. Allocation-failure safety is not proven by the three
initial pointer checks. Changing configuration entry 0 to false is particularly
not a substitute for this deactivation path, because it makes the wrapper return
before cleanup.

## RTOS tick frequency is now established from actual setup

The earlier lifecycle report left the RTOS rate open. The actual compiled
setup and ISR now close that local gap:

1. Setup `0x40380ee8` registers ISR `0x403771c4` for per-core system-timer
   interrupts. Its hardware conversion table at `0x3c1e17f0` contains
   `0x4037f5e0` (counter >> 4) and `0x4037f5f4` (microseconds << 4).
2. At `0x40380f80..87`, it configures each periodic alarm with **1000** through
   `0x403853d4`. That helper uses the context `+8` conversion callback before
   storing the hardware alarm period: 1000 becomes 16000 SYSTIMER counter units.
3. ISR `0x403771fa..0x40377233` reads the hardware counter, divides by the
   programmed period, tracks elapsed periods per core, and calls `0x40380fd0`
   once per elapsed period. This handles multiple elapsed periods in a loop.
4. On CPU 0, `0x40380fd0` calls `0x40382a00`; its ordinary unsuspended branch
   increments RTOS tick word `0x3fc9ece4` at `0x40382a35..3c`. CPU 1 uses a
   different continuation, not an additional unconditional increment of that word.

With the [ESP32-S3's documented 16 MHz SYSTIMER](https://documentation.espressif.com/esp32-s3_technical_reference_manual_en.pdf),
the configured RTOS tick rate is nominally **1000 Hz**, or **1 ms per tick**.
The replay task's `delay-until(...,1000)` is therefore a **one-second periodic
target** and its 500-tick yield threshold is nominally half a second. This
supersedes only the rate uncertainty, not the separate scheduling limitations
in the [lifecycle report](lifecycle-audit.md): late targets can return without
blocking, preskip can decode multiple records, timestamps can reuse records,
queue submission is not consumption, and calculation publication is later.
No real-device cadence, jitter or fresh-fix-per-second contract was measured.

### Subsequent sparse clock observation

Three fixed-RAM samples on the connected device corroborated equal GUI-ms and
RTOS-tick increments: **1604/1604** and **1608/1608** across the two intervals.
Host time between GUI reads was 1604 and 1603 ms; debugger interruption and tick
catch-up are included. Replay-active was zero in all three samples. Both cores
were running before and after every sample, whose full halt/read/resume sequences
took 103, 107 and 104 ms. No reset, breakpoint, function injection or storage write
was issued by that sampler.

OpenOCD emitted “Halt timed out, wake up GDB” near the last resume, followed by
the explicit running/running state check. That warning is retained in the
[sanitized observation record](mining/clock-observation.json); these samples are
not a measurement of replay cadence, drawing time or scheduler jitter. No further
halt was needed after the nominal rate was also resolved statically.

## Verification and readiness boundary

A private verification script checked the following 20 bounded ranges against
GNU Xtensa objdump, including every reached instruction boundary and decoded
direct branch target. Each range matched stock and rebuilt saved v16. Config
parser and full replay pump were already checked in the prior reports; they
were not broadened into a whole-program disassembly here. The two hardware
conversion tables and ride-state/event-name tables were independently read as
binary data. Local script, traces and JSON stay private.

This pass verified 715 reached instructions across 24 contiguous GNU runs, with zero boundary/direct-target discrepancies.
The sanitized [range manifest](mining/replay-contract-evidence.json) records the hashes and checks.

| Range | Start | End excluded |
|---|---|---|
| task_gate | `0x42009484` | `0x420094d0` |
| config_queries | `0x420b5714` | `0x420b5764` |
| activation | `0x420b5764` | `0x420b5858` |
| imu_config37 | `0x420b5858` | `0x420b5864` |
| source_open | `0x420b4fd8` | `0x420b503c` |
| replay_init | `0x420b5864` | `0x420b59dc` |
| ride_dispatch | `0x4204193c` | `0x42041a06` |
| ride_end_guard | `0x42041b94` | `0x42041bc2` |
| ride_start | `0x420425de` | `0x42042620` |
| ride_load | `0x420426f1` | `0x42042768` |
| ride_end | `0x42043900` | `0x42043915` |
| ride_resume_gate | `0x420421c0` | `0x420421c8` |
| ride_resume_state | `0x420424cc` | `0x420424d3` |
| resume_helper | `0x42041920` | `0x4204193c` |
| rtos_timer_setup | `0x40380ee8` | `0x40380fd0` |
| rtos_timer_isr | `0x403771c4` | `0x40377245` |
| rtos_alarm_period | `0x403853d4` | `0x40385448` |
| rtos_tick_dispatch | `0x40380fd0` | `0x40380ff4` |
| rtos_tick_increment | `0x40382a1a` | `0x40382a3e` |
| us_to_hw_ticks | `0x4037f5f4` | `0x4037f608` |

Ready statically: a five-row configuration profile, its exact indexed effects,
source-directory/open contract, local ride activation/deactivation guards and
nominal scheduler period. Still required before any controlled activation:
authorized source/configuration inventory and a known suitable FIT fixture;
verification of the selected source and loading/resume prerequisites; a concrete
activation/stop workflow; then observation of queue consumption, fresh snapshots
and cleanup. No activation command or device-write recipe is inferred here.
