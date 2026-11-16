# Native guidance validity candidate

A presentation-only candidate now hides the native navigation instruction cues
while the firmware's **committed** off-route getter is nonzero. It restores and
refreshes the cues on the next on-route update. This prevents a retained arrow,
countdown or “Go straight” caption from implying that an old on-route instruction
is current. It does not change matching, accepted progress, route files, remaining
distance, recording or the v21 basemap gate.

The reviewed cc22 image was subsequently installed and verified, then retained
in cc23; see the
[installation report](../releases/cc22-release-2026-11-15.md). The extraction and candidate
checks below preceded that installation. Native screen/transition acceptance
remains separate from flash verification and boot.

## Actual consumers and the stale-pixel mechanism

The own-device stock IROM was disassembled with GNU Xtensa objdump at explicit
function/branch starts. Nine inspected native code ranges are identical in stock
and v21; hashes and disassemblies are private under
`.local/navigation-phase/guidance/trace-evidence.json` and adjacent files.
Global linear disassembly sometimes loses Xtensa instruction alignment after
padding; branch blocks were restarted at their actual addresses.

| Path | Native callback table | Consumer and call sites |
|---|---|---|
| Navigation card | `0x3fc98b60` | `0x42081d1c`; initial `0x420822cd`, refresh `0x42081ee2` |
| Legacy navigation popup | `0x3fc989f0` | `0x42086ec8`; initial `0x4208758d`, refresh `0x420870ca` |

Both consumers take three pointer arguments: card root, callback table, scratch
buffer. At both refresh call sites `a10/a11/a12` are populated from the event
root, callback table and scratch buffer respectively. The event-target helper
`0x421cf630` reads event word zero. Initial creation supplies the same three
arguments. The new local trampoline forwards `a2/a3/a4` to `a10/a11/a12`, calls
the C wrapper through `callx8`, and returns with `retw`. The linked binary was
checked for these instructions and all four short-call targets.

The generic card table contains icon selector `0x42061744`, formatted distance
`0x42061788`, distance unit `0x4206176c` and caption/bitmap callback
`0x42061548`. The first three call validity helper `0x42061708`, which already
checks off-route through `0x42050618`. The caption callback has its own state,
position and 300 m logic and can still choose the straight-ahead caption.
In consumer `0x42081d1c`, a null image/text callback result skips the corresponding
LVGL setter. **It does not clear the previously rendered contents.**

The legacy table has image callback `0x4204dcd4` and countdown `0x4204db24`.
These test the retained prompt-valid byte but do not check committed off-route.
Consumer `0x42086ec8` similarly skips the image setter for a null image and the
countdown setter for `0xffffffff`. Merely returning those sentinels from new
callback wrappers would therefore leave stale pixels. Its text updater callback
is `0x4204ef3c`; the alternate bitmap callback is `0x4204f0cc`.

The candidate hooks the **consumer call sites** instead. For the exact navigation
table only, it sets `LV_OBJ_FLAG_HIDDEN` (bit zero) on the cue children while
committed off-route, bypassing stale callbacks. **It never changes the card root's
flags**, so another page owner's root visibility remains intact. The generic
card's child 0 contains its icon/distance/unit group; children 1/2 are its caption
text/bitmap alternatives. The legacy popup's children 0/1/2 are image/distance/
unit, while 3/4 are its caption text/bitmap alternatives. On-route, the hook clears
the stable cue children's hidden flags (generic child 0; legacy children 0..2)
and calls the unmodified native consumer. That consumer exclusively restores its
selected caption alternative and hides the other one (`0x42081e54..0x42081e94`
and `0x42086fbc..0x42087079`). Caption alternatives are not blindly unhidden by
the hook. The add/clear functions at
`0x42015568`/`0x420155c4` were checked in the binary: add ORs the object flag word
at +28, clear removes the requested flags; hidden-bit handling invalidates the
object. Native consumer code also uses those functions with flag 1 to switch
between caption text and bitmap children. Other callback tables and null inputs
are passed directly to their native consumer, preserving its guards.

## Timer delivery and root ownership

Creation installs timer callbacks `0x42081d04` / `0x42086eb0` through native
`0x420223bc`, passing the card root as timer user data. Each callback reads timer
word +12 and directly calls `0x42022dac(root, 30, NULL)`. The event sender builds
and dispatches an event without consulting object visibility. Its dispatcher
`0x42022cdc` selects registered callbacks by event code; it does not gate that
selection on the object's HIDDEN bit. The native widget event callback obtains
the root from `0x421cf630(event)` and reaches the hooked refresh calls for event
30. These function/branch starts were directly disassembled and preserved in the
private evidence directory.

External root HIDDEN ownership cannot be exhaustively established from global
pointer xrefs. The initial implementation's root hide/clear operation was
therefore replaced by child suppression. Because the root and its event/timer
metadata are untouched, this candidate introduces no root-hidden state that could
block or be stuck waiting for a rejoin update. The native creation and update
paths own the cue children; the caption switch explicitly restores the selected
alternative on each usable native update. Host transition tests model that mined
native caption contract and check both text and bitmap selection; they are not
an LVGL runtime test.

## Distance and the requested third line

Remaining-distance getter `0x4204fd98` remains untouched. Its unavailable
`0xffffffff` value must continue through the native `--` formatter. In particular,
this patch does not turn an unavailable route estimate into zero or display a
retained estimate as fresh. Ridden distance is a separate recording value.

Field 6 is the outgoing record's native caption channel, consumed through the
record parser and `0x42050ef7` → `0x4204a0b8` next-record path. The generic card
consumer explicitly switches between a single caption text child and its bitmap
alternative. Distance and unit occupy children of another container. These bytes
do not establish an independent following-turn or street-name third row.
The v21 `then …` prefix is part of that single 63-byte caption; a distinct third
line would require a new widget/layout change and independent lifecycle checks.
This patch does not pretend that such a widget already exists.

## Build and integration

```sh
python3 -m unittest tools/test_guidance_hook.py tools/test_guidance_native.py tools/test_guidance_build.py
python3 tools/guidance_build.py
```

The builder requires the exact v21 SHA256
`7deb201d797bdd974bfc0460870288feed2632bb41c81b65338e3307f5d0a139`,
checks mined getter/formatter/consumer hashes, the four original call instructions, and that the existing map
trampolines end with `callx8`/`retw`, and emits **ELF, seven patch fragments and the complete cc22 OTA candidate**
under `.local/navigation-phase/guidance/build`. It never flashes an image. Its
manifest records the expected baseline bytes, fragment hashes, full image hash,
segment delta counts, native guards and structural roundtrip result.
Firmware bytes and disassemblies remain private.

| Fragment | Address | Bytes |
|---|---:|---:|
| New C code and aligned literals | `0x421de050` | 200 |
| Card trampoline | `0x4205bdb0` | 26 |
| Popup trampoline | `0x42049690` | 26 |
| Four consumer calls | addresses above | 3 each |

The trampoline slots are displaced tails of functions whose entries are already
unconditionally redirected by v21: `cc_line` at `0x4205bd90` occupies 28 bytes,
and `cc_iter` at `0x42049670` occupies 28 bytes. The latter new trampoline ends
before existing route trampoline `0x420496b0`; the former ends before the end of
the replaced line body `0x4205bdee`. There is no relocated stock function body,
new RAM state, heap allocation, string or rodata. Additive tail space ends at
`0x421de118`, leaving 7,912 mapped-page bytes. Total emitted payload is 264 bytes.

For a combined patch, compile `guidance.c` with the existing sources, merge the
assembly sections and linker slots, and let the combined linker assign the C
code. **Do not apply this standalone tail at `0x421de050` over a larger combined
patch.** Preserve call-site/slot checks and the no-writable-globals assertion.
Only the four three-byte calls, two displaced slots and newly allocated tail
are allowed integration deltas. Keep the remaining getter and all matcher,
progress, recording and basemap code identical.

## Complete cc22 candidate

The reviewed standalone candidate is
`.local/navigation-phase/guidance/build/ota_1_v22.bin`:

- Version: `CC700_V1.414-cc22`.
- Image bytes: **3,751,024**.
- SHA256: `cc6613211b2796ae95ef19a6967759a53c6e48af4612906b22adcbddc088d50f`.
- Remaining mapped-page space: **7,912 bytes**.
- DROM delta: one changed byte within app-version field +16..47.
- IROM delta: 271 changed/added bytes (208-byte extension includes an eight-byte
  zero alignment gap, plus changed bytes in the two trampolines and four calls).
- Every other segment and every pre-existing IROM byte outside the explicitly
  allowed fragment spans remains identical to v21.

`build_candidate()` validates the complete fragment inventory, pinned addresses,
capacity bounds, non-overlap, fragment lengths/hashes, expected baseline bytes
and exact v21 image hash before applying any fragment. It then checks remaining
getter/formatter and native consumer hashes again, checks every segment byte
against the allowed delta ranges, updates only the DROM version field, rebuilds
the ESP segment length/checksum/appended SHA256, and verifies a complete structural
parse/build roundtrip. No OTA selection or device storage is involved. This image
is a standalone v21 + guidance candidate; combine other firmware changes through
a new verified build, rather than overwriting its tail.

Seven image-builder tests reproduce the complete binary and structural roundtrip,
check the version-only DROM delta and native preservation, and reject fragment
hash drift, baseline-byte drift, overlap, relocated scopes, changed baseline and
missing fragments. Together with hook/native tests, **15 tests pass**.

## Verification and practical limits

Actual hook C compiled on the host with `-Wall -Wextra -Werror`: five tests cover
both card paths, all nonzero flag values tested (1/2/255), on-route restoration,
argument preservation, unrelated callback tables and each null input. A stateful
on-route → off-route → on-route test covers both caption modes, verifies all cue
children recover, and preserves an independently hidden root. Three additional
private native fixture tests pin the remaining getter/formatter hashes and reject
mutated sentinel/formatter instructions. The
unguarded native-delegating implementation first failed the behavior assertions;
the guarded hook passed. The target build passed with the Xtensa toolchain;
linked trampoline forwarding and call targets were inspected and asserted.

The host test stubs native LVGL and the getter; it does not emulate LVGL rendering
or the Xtensa CPU. Native acceptance must check initial off-route page creation,
on-route → off-route → on-route without closing the page, caption/bitmap changes,
arrival/inactive navigation. Suppression occurs at the next native refresh, not synchronously
with the matcher publication. The timer/event instructions establish a refresh path that does not depend on
child visibility; actual redraw timing remains a target observation. The existing off-route notice is retained; this
candidate adds no unverified replacement text or distance.
