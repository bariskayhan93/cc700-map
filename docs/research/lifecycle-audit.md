# CC700 popup, timer and navigation reset audit

The subsequent [native replay contract](../current/native-replay-contract.md) resolves the
RTOS tick-frequency gap below from actual alarm/ISR setup and sparse clock
observations. Nominal 1000 ticks is one second; publication freshness is separate.

Evidence date: 2026-11-13. Bounded offline extraction of stock V1.414 and the
private rebuilt saved v16 image. No device was accessed; no firmware or device storage was
changed. This follows [popup and sensor observations](../reports/popup-and-sensor-followup.md),
[runtime publication](navigation-runtime-extraction.md), [route matching](route-state-extraction.md)
and [arrival](progress-arrival-extraction.md).

## The popup period is GUI milliseconds, with modular arithmetic

The chain is more specific than “a timer was created with −1”:

| Operation | Compiled evidence |
|---|---|
| Configure hardware timer | `0x42038143..0x42038175` registers callback `0x42037e04`, names it `lvgl_tick`, and starts a periodic timer with 64-bit period 2000 |
| Advance GUI clock | `0x42037e04..0x42037e0c` supplies 2 to `0x420213e0`; this adds to uint32 word `0x3fc9f648` |
| Read elapsed GUI time | `0x42021420..0x42021429` subtracts the saved uint32 tick from the current tick |
| Initialize popup timer | `0x420223bc..0x420223f4` stores period at timer `+0`, baseline at `+4`, callback at `+8`, and repeat count −1 at `+16` |
| Test expiry | `0x42022557..0x42022560` compares elapsed and period **unsigned**, skipping callback when elapsed is less |
| Run callback | `0x4202256c..0x42022589` refreshes baseline and calls the callback when repeat count is nonzero and callback is nonnull |

The periodic timer implementation uses the time getter at `0x403779f4`. Its
hardware adapter is initialized by `0x42006208` with the callback table at
`0x3c1e34ec`: first callback `0x4037f5e0` shifts the 64-bit hardware counter
right by four. Counter read is `0x4038531c`; periodic start is `0x4037788c`.
The ESP32-S3 SYSTIMER counts at 16 MHz, so division by 16 supplies microseconds;
2000 hardware-time units correspond to 2 ms, while the callback adds 2 GUI units.
That establishes the GUI timer period's nominal **millisecond unit**. Hardware
frequency context comes from [Espressif's SYSTIMER reference](https://documentation.espressif.com/esp32-s3_technical_reference_manual_en.pdf);
[the ESP-IDF timer API](https://docs.espressif.com/projects/esp-idf/en/v4.4.8/esp32s3/api-reference/system/esp_timer.html)
independently documents microsecond periodic-timer units. This is a compiled
clock configuration, not a measurement of callback latency or clock accuracy.

There is **no special infinity/sentinel branch** for period `0xffffffff` in the
extracted timer constructor or handler. Its expiry condition is:

```c
(uint32_t)(gui_now - baseline) >= UINT32_MAX
```

This can be true only at elapsed `0xffffffff`. On the extracted ordinary clock
path, the clock advances by 2 and both current and baseline readings have the
same parity. Their modular difference is therefore even, including across wrap;
`0xfffffffe` is followed by 0, never by `0xffffffff`. Consequently that path
never expires the startup-warning timer by elapsed time. This is an arithmetic
consequence under the identified +2 clock-writer contract, not a device-observed
infinite lifetime or a guarantee against other writers, corruption, clock
adjustment or explicit deletion. A literal-address/direct-call scan identified
this updater, but is not whole-program proof excluding every indirect alias.

Ordinary finite periods remain unsigned millisecond thresholds. If processing
misses the eligible part of a wrap cycle, elapsed wraps again; the implementation
does not maintain a wider elapsed duration. The handler runs in GUI service
contexts; an expiry threshold does not establish an exact screen-dismissal time.
Timer allocation failure at `0x420223cb..ce` enters a self-loop, rather than
returning an allocation error to the popup creator.

## Dismissal paths have different side effects

Popup type `0x3fc9fcd0`, notice type `0x3fc9fcbc`, dialog type `0x3fc9fcc0`,
popup object `0x3c389594`, and popup timer `0x3c389590` are separate state.

| Path | Effects and boundary |
|---|---|
| Timer expiry, `0x4204f6b0..0x4204f6f6` | Null timer argument returns immediately. Otherwise deletes timer, clears timer pointer and popup type, destroys popup, then clears dialog and notice parameters. Before clearing notice, type 9 invokes navigation-end helper `0x4204d01c`. Dialog type 1 additionally clears planning step `0x3c38940c`. |
| Popup-framework close callback, `0x4204ddf0..0x4204de28` | Registered by popup creation. Clears object pointer, deletes popup timer if present, conditionally zeroes the 24-byte prompt context when its byte `+8` is zero, and clears popup type. It does **not** directly clear notice/dialog parameters or invoke the type-9 navigation-end branch. |
| Popup destroy wrapper, `0x4204de6c..0x4204de80` | Destroys a nonnull popup through `0x42068a3c` and clears its pointer. Its own body does not perform the expiry callback's complete reset. Framework close may run as part of destruction; reentrancy/order is not established here. |
| Dialog actions, `0x4204f3cc..0x4204f440` | Both clear dialog parameters and destroy popup/delete timer. The second action also calls navigation-end helper if the old dialog type is 1. These callbacks are installed in dialog popup branches; they must not be assigned to notice 8 by analogy. |
| Replacement, `0x4204f6f8..0x4204fa15` | Same popup type returns before deleting/rebuilding anything. A different accepted type first deletes the old timer and, for nonzero requested type, destroys the old popup before constructing its replacement. Thus repeat type-4 requests do not refresh its period or displayed notice. |

For type 4, object allocation failure or notice-component construction failure
logs and returns without reaching the shared timer creation/type assignment.
The old timer has already been deleted. The creator's own failure branches do
not explicitly clear the old popup-type word; the framework close callback can
clear it if destruction invokes that callback. These branches establish partial
construction/failure boundaries, not a reproduced stuck-popup defect.

Notice 9 has a material deferred effect: arrival sets it with period 5000 and
arrival state 2; ordinary timer expiry then calls navigation end. Therefore the
[earlier arrival report](progress-arrival-extraction.md)'s observation that its
immediate event is course-recording rather than ride-stop must not be expanded
into a claim that arrival never ends navigation. Dismissal, expiry and navigation
teardown have separate entry paths. None of these local bodies proves that the
ride recording state itself stops.

## Navigation reset is neither one function nor universally synchronous

Navigation-end helper `0x4204d01c..0x4204d044` sets offline-plan cancellation,
calls navigation teardown, resets end parameters through `0x42050110`, deletes
the fast-route file via its existing helper, clears plan-mode state, and calls
UI/navigation continuation helpers. This describes the compiled stock path;
no file deletion was performed during this audit.

`0x42050110..0x4205014e` resets cached point index, selector, progress flags and
early-index override, then calls `NavigationEndParaInit` at `0x42050030`.
The latter clears the retained progress/display structures, sets arrival word
`0x3fc9fcd4` to 0, invalidates cached indices and clears override bytes. It does
not itself reproduce the popup-expiry callback's entire timer/notice cleanup.

Ordinary navigation teardown `0x4204cecc` is guarded by navigation state being
nonzero; the existing runtime report already establishes point/file/map disposal.
Its call at `0x4204cedc` reaches `0x420507bc`, which deletes a **different** timer
at `0x3fc9fca8`; this is not the popup timer at `0x3c389590`. Its tail requests
popup type 0 through `0x4204fa28(1,0)`, which forwards an event request through
`0x4204e884`. The local teardown return is not acknowledgement that the GUI
has already consumed that request.

The start initializer `0x420506c4` always invalidates a cached index, but returns
before its broad reset when ride-state getter is nonzero. Its full reset zeros
both 148-byte matcher results, remaining distance and popup type; clears notice
and dialog parameters; requests type-0 popup with period 1; and resets display
contexts. These writes and the queued UI cleanup are distinct. A riding restart
must not be modeled as executing this broad reset unconditionally.

Already established failure boundaries remain in force: ignored GUI enqueue
failure can lose asynchronous completion/cleanup requests; a received GUI event
can be discarded without a current target; restart eligibility is not route-load
success; route loading and downstream allocation can fail after state changes.
This pass does not upgrade those calls into transactional operations or audit
all loader/allocation helpers.

## Native replay uses a different clock and retains timestamp state

The bounded follow-up of `0x420b59dc..0x420b5e30` and decode pump
`0x420b5068..0x420b51ba` narrows the earlier
[replay scheduling gap](navigation-behavior-extraction.md):

- The bottom-of-loop 1000 goes to `0x40383714`, which adds it to a saved wake
  tick and compares against RTOS tick word `0x3fc9ece4`; getter `0x403829b4`
  reads that word. These are **1000 RTOS ticks**, not 1000 GUI milliseconds.
  Delay-until updates its saved target even when already late, and can return
  without blocking while catching up. RTOS tick frequency remains unestablished
  by this bounded audit, so a one-second wall-clock contract is not claimed.
- Required buffers, active byte, zero result state and clear pause byte gate
  pumping. Skipped iterations still reach delay-until. The task is not an
  unconditional one-record-per-wake publisher.
- For the ordinary timestamp branch, define logical counter `L` at
  `0x3fc99c04`, retained timestamp `P` at `0x3fc99c00`, and decoded current
  timestamp `T` at record `+668`. If `L == P`, another decode is requested.
  Then `P = T` and `L = (T < old_L) ? T : old_L + 1` using unsigned
  comparisons (`0x420b5a57..0x420b5a7e`). While `L < T`, retained record state
  can be reused. At/after that boundary, an auxiliary 24-byte record is cleared;
  the GPS assembly/publication path can still execute. Gaps and duplicate
  timestamps therefore are not equivalent to decoding exactly one new record
  on every loop. GPS `+20` is `L + 0x259d4c00`, rather than a sampled clock.
- Optional numeric-entry-3 preskip (`0x420b5d80..0x420b5e06`) repeatedly
  decodes and advances a skip counter; valid preceding/current timestamps can
  contribute their difference to it. It periodically yields after more than
  500 RTOS ticks using the same saved delay-until target. Another optional
  branch can scan up to 251 records while a record field remains zero
  (`0x420b5ab3..0x420b5ae8`). These branches can consume multiple records before
  one ordinary publication.
- Decode state 2, 4 or 5 closes the source and returns 1; other nonzero states
  close and return 2. The task stores this result and gates future pumping on
  it being zero. That task gate does not clear the replay-active byte, so the
  replay-aware GPS getter can remain selected with retained buffer contents.
  A result set by a decode inside an already-running iteration does not
  universally abort every remaining operation of that iteration. Exact decoder
  meanings, malformed FIT behavior and RTOS tick frequency remain separate.

Queue acceptance, consumption, calculation and publication are additional stages,
as documented in the runtime report; none of these timing branches guarantees a
fresh navigation snapshot per nominal replay interval.

## Verification and remaining boundary

A private bounded verification script extracted 30 half-open ranges, totaling
1547 reached instructions in 42 contiguous GNU objdump runs. Every instruction
boundary and decoded direct branch target matched GNU Xtensa objdump; every
range matched saved rebuilt v16 byte-for-byte. The hardware callback table was
independently read as data. The instruction counts describe extraction, not
behavioral coverage. Stock source SHA-256:
`7545ae4d4030b24b1f6198f481ce3a9a183a0e6eb3e5355b86ad2413aead2c31`.
The comparison image is a private rebuilt v16 artifact; its SHA-256 is
`2af9c21a3c693c71fed1ffe26ed72ada545e7609c3a47c6dedcfe6c1e7fae8d5`,
matching the saved v16 image.

All intervals below are half-open. Raw binaries, scripts and GNU traces remain
private; the sanitized [range manifest](../mining/lifecycle-evidence.json) accompanies
this report.

| Range | Start | End excluded | Instructions |
|---|---|---|---|
| tick_inc | `0x420213e0` | `0x420213fc` | 10 |
| tick_get | `0x420213fc` | `0x42021420` | 12 |
| tick_elapsed | `0x42021420` | `0x4202142c` | 4 |
| timer_create | `0x420223bc` | `0x420223f8` | 22 |
| timer_delete | `0x4202244c` | `0x4202246c` | 12 |
| timer_handler | `0x4202246c` | `0x420225ec` | 144 |
| tick_callback | `0x42037e04` | `0x42037e10` | 4 |
| tick_registration | `0x42038133` | `0x4203817d` | 27 |
| periodic_timer | `0x4037788c` | `0x40377910` | 53 |
| hardware_time | `0x403779f4` | `0x40377a0c` | 9 |
| timer_hal_init | `0x42006208` | `0x4200625c` | 33 |
| timer_callback_set | `0x40385504` | `0x40385510` | 6 |
| counter_read | `0x4038531c` | `0x40385368` | 27 |
| tick_to_us | `0x4037f5e0` | `0x4037f5f4` | 6 |
| popup_close | `0x4204ddf0` | `0x4204de2c` | 22 |
| popup_destroy | `0x4204de6c` | `0x4204de84` | 8 |
| popup_cancel_a | `0x4204f3cc` | `0x4204f400` | 18 |
| popup_cancel_b | `0x4204f400` | `0x4204f444` | 25 |
| popup_expiry | `0x4204f6b0` | `0x4204f6f8` | 27 |
| popup_create | `0x4204f6f8` | `0x4204fa18` | 298 |
| popup_request | `0x4204fa18` | `0x4204fa44` | 6 |
| navigation_end | `0x4204d01c` | `0x4204d048` | 16 |
| navigation_end_params | `0x42050030` | `0x420500d0` | 59 |
| navigation_end_full | `0x42050110` | `0x42050150` | 24 |
| navigation_start_params | `0x420506c4` | `0x420507bc` | 93 |
| navigation_teardown_tail | `0x420507bc` | `0x420507f0` | 8 |
| replay_task | `0x420b59dc` | `0x420b5e34` | 397 |
| replay_decode | `0x420b5068` | `0x420b51bc` | 132 |
| delay_until | `0x40383714` | `0x4038378c` | 40 |
| rtos_tick_get | `0x403829b4` | `0x403829c4` | 5 |

Remaining: runtime scheduling/latency; any indirect clock writers; every popup
framework deletion callback order; button/key routing for every modal state;
complete load/allocation failure propagation; full FIT decoder semantics and
RTOS tick frequency. No runtime equivalence or complete lifecycle coverage is
claimed.
