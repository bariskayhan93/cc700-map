# Map page UI: static mining, 2026-11-23

Scope: read-only static analysis of `.local/cc25/ota_1_cc25.bin` (stock image).
No device access. No BLE. No flashing. No edits to `firmware/`, `js/` or `tools/`. Not committed.

## Answer first

1. The remaining-distance text comes from setter `0x420949dc`. The setter writes the 20-byte buffer `0x3fca0ffa`. OBSERVED.
2. The stock km format rounds the hundredths wrongly. For 12,980 m it prints `12.103 km`. DERIVED.
3. Builder `0x42094e70` creates the owner object O1 with alignment value 4 at x = W − 16. The numeric values of W, y and the child object are UNKNOWN.
4. Font index 2 selects style slot `0x3fca0ef8`. Font metrics, colours, compass and rider icon are UNKNOWN.

## Evidence levels

- OBSERVED: bytes or instructions from the disassembly. The address is given.
- DERIVED: arithmetic on OBSERVED values. The arithmetic is shown.
- UNKNOWN: not proven. The item names what settles it.

Function names carry a confidence tag: HIGH, MEDIUM or LOW. No LVGL headers exist on this machine (checked `~/.espressif`, `~/esp`, `~/.platformio`). All LVGL names are inferred from behaviour.

## Setup and method

- Image header: magic `0xe9`, 5 segments, entry `0x40374ff8` (OBSERVED).
- Segments (OBSERVED from the header):

| Segment | Address | Length |
|---|---|---|
| DROM | `0x3c1e0020` | `0x19b114` |
| DRAM | `0x3fc98200` | `0x4edc` |
| IROM | `0x42000020` | `0x1deb8c` |
| DRAM | `0x3fc9d0dc` | `0x1a10` |
| IRAM | `0x40374000` | `0x14108` |

- Split method: skip the 24-byte header. Read `(u32 addr, u32 len)`, then `len` bytes. Repeat 5 times.
- A linear disassembly desyncs at literal pools. Example: `0x42094e6f` holds a stray `00` byte. The function entry is `0x42094e70` (OBSERVED).
- Method used: decode each function from its entry.
  `xtensa-esp32s3-elf-objdump -D -b binary -m xtensa --adjust-vma=0x42000020 --start-address=0x<entry> --stop-address=0x<end> seg2_42000020_1deb8c.bin`
- Scratch files, not in the repo: `/private/tmp/claude-501/-Users-baris-cc700-map/030ba5d8-3729-462a-8d63-7ab9e695e019/scratchpad/mine/` (split segments, `mem.py`, `table.py`, `irom.s`).

## A. Remaining-distance label

### A1. Setter `0x420949dc` (name HIGH, code OBSERVED)

```
420949dc  entry a1, 48
420949e3  l32r a8, 0x421434dc ; callx8    ; reader; a10 = 2 (field id), a11 = &stack
420949e9  l32i.n a8, a1, 0                ; valid flag
420949eb  l32r a2, 0x3fca0ffa             ; text buffer, size 20
420949ee  beqz a8, 0x42094a55             ; invalid: copy "----"
420949f4  lsi f0, a1, 8                   ; value, float
420949f7  wfr f1, a3                      ; a3 = 0x447a0000 = 1000.0
420949fa  olt.s b0, f0, f1                ; value < 1000.0 ?
```

### A2. Formats (OBSERVED)

- Value below 1000.0: `trunc.s` to int `n`. Call `snprintf(buf, 20, "%ld m", n)`. Format at `0x3c33f977`.
- Value 1000.0 or more: `n = trunc(value)`.
  - `q = n / 1000`: `mulsh(n, 0x10624dd3) >> 6`, minus the sign of `n`. This is the usual signed division by 1000. DERIVED.
  - `r = n − 1000·q`: computed by shifts and adds (`slli 5`, `sub`, `addx4`, `slli 3`, `sub`).
  - `h = (r + 50) / 10`: `addi a8, a14, 50`, then `mulsh(·, 0x66666667) >> 2`, minus the sign.
  - Call `snprintf(buf, 20, "%ld.%02ld km", q, h)`. Format at `0x3c33f97d`.
- Invalid value: copy `"----"` (`0x3c1ee9fe`) through `0x40001218`. Identity MEDIUM (copy routine).
- `snprintf` identity: `0x421ba00c`. Identity MEDIUM (5-argument call with format string).

### A3. Rounding defect (DERIVED)

- Input `n = 12,980`: `q = 12`, `r = 980`, `h = (980 + 50) / 10 = 103`. Output: `12.103 km`.
- Correct hundredths of `r` metres: `r / 10 = 98`. The rounded form is `(r + 5) / 10 = 98`. Output: `12.98 km`.
- For `r` from 950 to 999, `h` runs from 100 to 104. Output such as `12.100 km` appears.
- Cause: the constant is 50. Two-digit rounding of `r / 10` needs 5.

### A4. Table record for "Dist" (OBSERVED)

- Record words at `0x3fc99380`: `{0x42094490, 0x420949dc, 0x00000000, 0x00000015}`.
- Name getter `0x42094490`: `entry`, `l32r a2, 0x3c32c98d`, `retw.n`. The string is `"Dist"`.
- Section H lists all records.

### A5. Builder `0x42094e70` (OBSERVED calls; object meaning MEDIUM or LOW)

Order of calls:

1. `0x4205c54c()` returns parent `P`. It reads an area with `0x421ceab8`: `l16ui` at +2, +4 and +6 (`lv_obj_get_coords`-like, MEDIUM).
2. `Bv = 0x42021244(0x42021238())` and `Cv = 0x4202126c(0x42021238())`. `0x42021238` returns the word at `0x3fc9f640`. That word is runtime data (not in the image). `0x42021244` and `0x4202126c` read a 16-bit field from that object:
   - `0x42021244` returns `u16` at +2 of `*(object)` when bit 4 of `*(*(object)+16)` is set (OBSERVED: `l16si a2, a2, 2`).
   - `0x4202126c` returns `u16` at +0 under the same test (OBSERVED: `l16si a2, a2, 0`).
   - The object meaning is UNKNOWN. A display driver struct (`hor_res`, `ver_res`) is one candidate. An area struct is another.
3. `O1 = 0x4205c4b4(P, x = Bv − 16, y = Cv + 20, align = 4)` at `0x42094eb6` (OBSERVED arguments).
   - `0x4205c4b4` calls `0x42015554` (create child, MEDIUM), `0x42016498(obj, x, y)` (set position, MEDIUM), `0x4202630c(obj, align)` (set alignment, MEDIUM), `0x42015568(obj, 16)` (set flag word at +28, MEDIUM).
   - Alignment value 4. In LVGL 8 the enum order puts 4 at BOTTOM_LEFT (MEDIUM, from memory of the enum, not from a header).
4. Style slot: `0x4208f5b8(2)` returns `0x3fca0ef8`. Then `0x42018fe0(O1, 0x3fca0ef8, 0)` at `0x42094ee5`. See section F for the open question about this call.
5. Registrations on O1, period `0x3e8` = 1000 ms (OBSERVED `movi a11, 0x3e8` before each call):

| Setup address (call 4 bytes later) | Record | Name | Helper |
|---|---|---|---|
| `0x42094eee` | `0x3fc99350` | SPD | `0x420a6540` |
| `0x42094ef6` | `0x3fc99380` | Dist | `0x420a63ac` |
| `0x42094f01` | `0x3fc9933c` | CAD | `0x420a6540` |
| `0x42094f0c` | `0x3fc99328` | HR | `0x420a6540` |
| `0x42094f17` | `0x3fc99314` | PWR | `0x420a6540` |
| `0x42094f22` | `0x3fc99300` | ALT | `0x420a6540` |
| `0x42094f2d` | `0x3fc992ec` | UNKNOWN | `0x420a6540` |
| `0x42094f38` | `0x3fc99364` | Ride Time | `0x420a6708` |
| `0x42094f43` | `0x3fc99374` | Local | `0x420a63ac` |

6. O2 = `0x4205c490(P, x = Bv − 16, y = 120)` at `0x42094f65` (OBSERVED). `0x4205c490` calls `0x42016498` and `0x420155c4(obj, 16)`. It sets no alignment.
   - Style slot: `0x4208f5b8(2)` at `0x42094f6d`. Same slot as O1.
   - Registration `0x3fc992c0` on O2 with helper `0x420a60f0` at `0x42094f86` (period 1000 ms).
7. O3 = `0x4205c50c(P, x = 224, y = 60)` at `0x42094f8e` (OBSERVED constants). `0x4205c50c` calls `0x42016498`, `0x420163a4(obj, 0)`, `0x4202630c(obj, 0)` (alignment 0), `0x42015568(obj, 16)`.
   - Style slot: `0x4208f5b8(8)` at `0x42094f9a` returns `0x3fca0ee0`.
   - `224` equals `240 − 16`. This matches a 240-wide display (see E). DERIVED, MEDIUM.
8. Text `"START"` (`0x3c349be8`) goes to an object through `0x4203361c` at `0x42094fe3`. The object is UNKNOWN. Sub-builder `0x42094534` is not decoded.

### A6. Helper shape (OBSERVED)

- Helpers `0x420a6540`, `0x420a63ac`, `0x420a6708` and `0x420a60f0` have the same entry sequence.
- Each helper returns 0 when the object is NULL or the record is zero. Otherwise it calls `0x40376388` (allocator) and then uses size 12 (`movi.n a12, 12`).
- The four copies differ only in their call target. Their roles and the node layout are UNKNOWN.

### A7. Owner of buffer `0x3fca0ffa` (UNKNOWN, with candidates)

- Only the setter refers to `0x3fca0ffa` by literal (OBSERVED from the IROM listing). The updater reaches the buffer through a pointer or the node list.
- Candidate owner: O1. The Dist record is registered on O1 (MEDIUM). O1 also holds 8 other records, so O1 may be a group object with child labels. UNKNOWN.
- Updater: UNKNOWN. The label-text setter candidate `0x4203361c` is used in the builder for the text `"START"`. Its use for the Dist text is UNKNOWN.
- Canvas text path: `0x420dbcd0` draws text with the label descriptor at `0x3c38a570` (`firmware/common/fw.h:102-105`). Literal references to `0x3c38a570` are at `0x4205ba0a`, `0x4205bb08`, `0x4205bc39` and `0x4205bf66` (OBSERVED).
- Refresh rate: the period in the registration is 1000 ms (OBSERVED). Whether the stock updater uses it as an LVGL timer period is UNKNOWN.

## B. Scale label ("100 m" and similar)

- Formatter `0x42056e48` (entry OBSERVED):
  - `a2` = value. `mov.n a5, a2` at `0x42056e4b`.
  - `a3` = flag, byte (`extui a3, a3, 0, 8`).
  - `a4` = second flag, byte (`extui a4, a4, 0, 8`).
  - Output buffer `0x3c38a382`, 16 bytes (memset call `0x400011e8` with `a12 = 16`).
- Mode test: `call8 0x4200d9e4`, then `bnei a10, 1`. Meaning of the mode is UNKNOWN. Imperial is one candidate.
- Metric path, value 999 or less (`movi a8, 0x3e7`, `bgeu a8, a5`):
  - Flag `a3` = 0: `snprintf` with `"%ld"` (`0x3c36b283`).
  - Flag `a3` ≠ 0: unit text from `0x42056b78`, then `"%ld%s"` (`0x3c1f0339`).
- Path for 1000 or more: float conversion (`ufloat.s`), helper calls `0x42056ca0` and `0x42056a9c`, then `"%s"` (`0x3c1f4c54`) or `"%s%s"` (`0x3c1f0b45`). Helper content is UNKNOWN.
- Consumer of `0x3c38a382`: no literal reference except inside the formatter (OBSERVED). The consumer is UNKNOWN.
- Scale values per zoom level: UNKNOWN. Not searched.
- Object, position, font and colour: UNKNOWN.

## C. Compass

- 80 × 80 canvas candidate. `0x4208fa02` allocates `25 << 9` = 12,800 bytes (OBSERVED). DERIVED: 80 · 80 · 2 = 12,800 (RGB565).
- The canvas call at `0x4208fa27` is `0x420dbacc(canvas, buf, w = 80, h = 80, cf = 4)` (OBSERVED constants).
- The buffer pointer is stored at `0x3fca0f38` (OBSERVED `s32i.n a10, a8, 0`).
- The owner function is not found. The linear listing desyncs in that area. Whether this canvas is the compass is UNKNOWN.
- Heading global `0x3c388d08` has two literal readers: `0x4204a54f` and `0x4204c28b` (OBSERVED). Neither is in the builder. The compass rotation source is UNKNOWN.
- Image descriptor (width, height, format, address): UNKNOWN.
- Draw order relative to the map canvas: UNKNOWN.

## D. Rider icon

- Draw path: UNKNOWN.
- Canvas draw calls referenced by the stock image (OBSERVED literal counts):

| Address | Count | Identity |
|---|---|---|
| `0x420dbeb0` | 18 | `fw_draw_line` (`fw.h:96`, MEDIUM) |
| `0x420dbdb0` | 6 | UNKNOWN |
| `0x420dbb30` | 3 | UNKNOWN |
| `0x420dbcd0` | 2 | text draw (`fw.h:102`, MEDIUM) |

- Screen y = 216 of 256: not proven. The constant 216 in `js/preview.js:269` applies only when `options.greySpans` is set. It is a repo model value, not firmware evidence.

## E. Screen and canvas

- Full-size canvas: `0x420593c1` calls `0x420dbacc(canvas, buf, w = 240, h = 320, cf = 4)`. The constants are `movi.n a12, 240`, `movi a13, 0x140` and `movi.n a14, 4` (OBSERVED). The buffer pointer goes to `0x3fc9ff84`.
- Display width 240 and height 320: MEDIUM. The elevation study uses the same 240 × 320 schematic (`docs/research/elevation-study-2026-11-15.md:8`). No runtime read yet.
- Map canvas, descriptor `0x3c38a534`:
  - `w` is `l16si` at +4 (`0x4205bbe0`). `h` is `l16si` at +6 (`0x4205bbdd`).
  - Buffer size = `2 · w · h` (OBSERVED `mul16u` and `add.n a10, a10, a10`).
  - Stored `w` and `h` values are UNKNOWN. Their stores are not traced.
- Map canvas position on the screen: UNKNOWN.
- Objects over the bottom 48 px of the canvas, in creation order: O1, O2 and O3 (A5), with the formulas shown. Numeric values need runtime reads. Other children of `P` are UNKNOWN.

## F. Fonts

### F1. Getter `0x4208f5b8(index)` (OBSERVED)

The getter returns the address of an 8-byte slot. It does not return a font pointer.

| Index | Slot |
|---|---|
| 0 | `0x3fca0f00` |
| 1 | `0x3fca0ef8` |
| 2 | `0x3fca0ef8` |
| 3 | `0x3fca0ef8` |
| 4 | `0x3fca0ef0` |
| 5 | `0x3fca0ef8` |
| 6 | `0x3fca0ee8` |
| 7 | `0x3fca0ef8` |
| 8 | `0x3fca0ee0` |
| 9 or more | `0x3fca0ef8` |

### F2. Slot init (OBSERVED)

- `0x420220b0(slot)` is `memset(slot, 0, 8)` (call to `0x400011e8` with `a12 = 8`). HIGH for the memset call.
- Init code in the function that contains `0x4208f468` to `0x4208f4d8` (OBSERVED, decoded from mid-function addresses; the function entry is not located):
  - `0x4208f358(slot, n)` is called for `0x3fca0ef8` (n = 2), `0x3fca0ef0` (n = 4), `0x3fca0ee8` (n = 6) and `0x3fca0ee0` (n = 8).
  - Slot `0x3fca0f00` gets `0x4208f358(0x3fca0f00, memset_return)`. Its value is the slot address itself, not a font index.
  - Slots `0x3fca0ed0` and `0x3fca0ed8` get the memset only. A second getter at `0x4208f5e4` returns them. That getter is not fully decoded.
- `0x4208f358(slot, n)` calls four setters with the same `n`:

| Setter | Property (`a11`) |
|---|---|
| `0x4202e7ec` | `0x1812` |
| `0x4202e7fc` | `0x1813` |
| `0x4202e7c8` | `0x1810` (`0x181 << 4`) |
| `0x4202e7dc` | `0x1811` |

Each setter calls `0x420222b8(slot, property, n)`. The LVGL meaning of the four property IDs is UNKNOWN.

### F3. Label use (open question)

- Builder: O1 and O2 use index 2. O3 uses index 8.
- `0x42018fe0(obj, slot, 0)` passes `0` (`a4`) into `0x42018b74` as the value, with selector `0xffff`. It does not pass the slot (`a3`) in that first call (OBSERVED). The use of the slot is UNKNOWN until `0x42018b74` and the rest of `0x42018fe0` are decoded.

### F4. Font metrics and glyphs (UNKNOWN)

- Font objects, line height, base line, glyph range, bpp: UNKNOWN. No font data table is located.
- Digits, `.`, `k`, `m`, `-` and arrows: UNKNOWN.
- Font larger than the km label usable with `fw_canvas_text`: UNKNOWN.

## G. Colours (UNKNOWN)

- No colour argument reaches the builder labels. `0x42017a24(obj, 0)` and `0x42017a54(obj, 12)` write bit fields, not colours (OBSERVED shifts and masks).
- Label descriptor `0x3c38a570`: colour at +12 (`FW_LABEL_COL`), opacity at +26 (`FW_LABEL_OPA`) (`fw.h:103-105`). Runtime values: UNKNOWN.
- Colour helper `0x421d0034` (`fw_color_hex`, `fw.h:95`). Stock colour values: UNKNOWN.
- Map background, scale text, compass, label text: UNKNOWN.

## H. Table at `0x3fc99300` to `0x3fc9938c` (OBSERVED)

Each record starts with a name getter. The getter returns a string (OBSERVED: `entry`, `l32r a2`, `retw.n`). The following words are setters or formatters. A zero word ends the record. A record can have 1, 2 or 3 setters.

| Words | Name | Setters (value formatters) | Evidence |
|---|---|---|---|
| `0x3fc99300` | ALT | `0x42094e28` (field 4, `"%ld"`, buffer `0x3fca1068`, size 15), `0x42094868`, `0x42094838` | `0x42094e28` (OBSERVED) |
| `0x3fc99314` | PWR | `0x420948e0`, `0x420948bc`, `0x42094898` | getter OBSERVED |
| `0x3fc99328` | HR | `0x4209494c`, `0x42094928`, `0x42094904` | getter OBSERVED |
| `0x3fc9933c` | CAD | `0x420949b8`, `0x42094994`, `0x42094970` | getter OBSERVED |
| `0x3fc99350` | SPD | `0x42094b2c`, `0x42094ac8`, `0x42094a64` | `0x42094a64` (OBSERVED, below) |
| `0x3fc99364` | Ride Time | `0x42094768`, `0x420946e8` | getter OBSERVED |
| `0x3fc99374` | Local | `0x42094b90` | getter OBSERVED |
| `0x3fc99380` | Dist | `0x420949dc` (field 2, A1) | A1 (OBSERVED) |
| `0x3fc992ec` | UNKNOWN | not decoded | registration only (A5) |
| `0x3fc992c0` | UNKNOWN | not decoded | registration on O2 (A5) |

- Setter `0x42094a64` (SPD candidate, OBSERVED from its entry): reads field 5 with `movi.n a10, 5` and `l32i.n a10, a1, 20`. It converts to float and multiplies by `10.0` (`0x41200000`). It formats `"%ld.%ld"` (`0x3c1f1449`) into buffer `0x3fca0ff0`, size 10. Tenths come from `int(10·v) mod 10`. This setter does not test the validity flag at `[a1+0]` before it reads the value. OBSERVED.
- Record word `0x15` at `0x3fc9938c` (after Dist): meaning UNKNOWN.
- Field IDs: field 2 is Dist (A1). Field 4 is an integer (ALT candidate). Field 5 is a tenths value (SPD candidate). Field IDs for the other names are UNKNOWN.

## Stock objects table

| Element | x | y | w | h | align | font | colour | evidence |
|---|---|---|---|---|---|---|---|---|
| Remaining-distance owner O1 | W − 16 (`Bv − 16`) | `Cv + 20` | UNKNOWN | UNKNOWN | 4 (BOTTOM_LEFT, MEDIUM) | style slot `0x3fca0ef8` (index 2) | UNKNOWN | `0x42094eb6`, `0x42094ee5`, `0x420949dc` |
| Second object O2 | W − 16 (`Bv − 16`) | 120 | UNKNOWN | UNKNOWN | 0 (default, OBSERVED: no alignment call) | `0x3fca0ef8` (index 2) | UNKNOWN | `0x42094f65`, `0x42094f6d` |
| Third object O3 | 224 | 60 | UNKNOWN | UNKNOWN | 0 (OBSERVED `0x4202630c(obj, 0)`) | `0x3fca0ee0` (index 8) | UNKNOWN | `0x42094f8e`, `0x42094f9a` |
| Scale text | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | buffer `0x3c38a382`, formatter `0x42056e48` |
| Compass | UNKNOWN | UNKNOWN | 80 (canvas candidate) | 80 (canvas candidate) | UNKNOWN | — | UNKNOWN | `0x4208fa02`, `0x4208fa27` |
| Rider icon | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | — | UNKNOWN | UNKNOWN |
| Full-size canvas | UNKNOWN | UNKNOWN | 240 (MEDIUM) | 320 (MEDIUM) | — | — | — | `0x420593c1` |
| Map canvas `0x3c38a534` | UNKNOWN | UNKNOWN | runtime `w` | runtime `h` | — | — | — | `0x4205bbdd`, `0x4205bbe0` |
| Font slot getter | — | — | — | — | — | index 2 → `0x3fca0ef8` | — | `0x4208f5b8` |

Here W is the display width. W equals 240 only if the full-size canvas is the display (MEDIUM).

## Gaps

These items need a device photo, a runtime read or a further static trace.

1. Runtime values of W, `Bv`, `Cv` and the object behind `0x3fc9f640` (`lv_obj_get_coords`-style read on O1).
2. The updater that reads a node, calls the record setter and writes the buffer into a label or canvas. This needs the node list reader.
3. Owner of `0x3fca0ffa` and the text draw call for the Dist text.
4. Font data: find the font table in DROM and the glyph metrics.
5. Meaning of `0x420222b8` property IDs `0x1810` to `0x1813` (LVGL style properties).
6. Colour values: style colour or label descriptor values at runtime (`0x3c38a570`).
7. Compass and rider icon owner. Trace canvas draw calls `0x420dbdb0` and `0x420dbb30`, and the 80 × 80 canvas owner.
8. Stores to `0x3c38a538` and `0x3c38a53a` (map canvas `w` and `h`).
9. Scale values per zoom level. Search the zoom table.
10. Sub-builder `0x42094534` and the `"START"` object.
11. Visible text positions and overlap over the bottom 48 px. This needs a device photo.

## Addendum (2026-11-23, second pass): the bottom of the map is canvas drawing

The map page draws its bottom elements into the 240 × 256 map canvas itself (canvas pointer at `0x3c38a5dc`).
They are not LVGL objects. The LVGL builder `0x42094e70` (section A5) is the ride-data page, not the map page.

Draw helpers (OBSERVED):

- `0x4205b9f8(x, y, max_w, text)`: canvas text `0x420dbcd0(canvas, x, y, max_w, desc 0x3c38a570, text)`.
  It sets the descriptor opacity (+26) to `0xa3` = 163 (64 %) for the call and then back to 255.
  Font pointer at desc +0, text alignment at desc +28 (3 = right, 0 = left; MEDIUM from the LVGL 8 enum).
- `0x420dbdb0(canvas, x, y, img, desc 0x3c38a544)`: image at top-left (x, y).
  `0x4205ba5c`: the same image, centred (x − w/2, y − h/2).
- `0x420697f8(i)`: image `i` (0..139) from the table at `0x3c2915e4`. Header word: w = bits 10..20, h = bits 21..31.

### Remaining distance: `0x4205bf0c(left, total, bar_w, show_text)`

Caller `0x4204ca2e`: `bar_w = 10`; `show_text = 1` when the caller's `a3` is 0 (`0x4204ca24..28`).

| Element | Code | Position (canvas px) | Detail |
|---|---|---|---|
| Number, e.g. `12.4` | `0x4205bf84` | right edge x 232 (x 0, max_w 232, align 3), y 222 | formatter `0x42056e48(left)`; font `0x3c2a54d8` (line 20, base 4) |
| Unit `(km)` | `0x4205bf9c` | x 202, y 204, align 0 | `"%s%s%s"` = `"("` + `0x42056ba0()` + `")"`; font `0x3c29188c` (line 18, base 4) |
| Icon | `0x4205bf60` | x 183, y 204 | image 3, 14 × 14 |
| Progress bar | `0x4205bff9..0x4205c036` | full width, centre y 249 | white line width bar_w + 4 = 14, then a line width 10, colour `0xc86d`; progress x = 240 · (total − left) / total |
| Progress marker | `0x4205c04f..0x4205c061` | (progress x − 7, 242) | image 1, 14 × 14 |

Both texts are drawn at 64 % opacity and have no halo. This is the cause of the poor readability (DERIVED).
Branches `beqz a5` at `0x4205bf76` and `0x4205c010` also skip parts when `show_text` is 0; their exact extent is not decoded.

### Left side and rider

| Element | Code | Position | Detail |
|---|---|---|---|
| Compass | `0x4205c32f` | x 8, y 173 | image 51, 32 × 32 → box x 8..40, y 173..205 |
| Scale bracket | `0x4205c0fc(7.0, 236.0)` from `0x420516e2` | x 7..47, y 228..236 | three 2 px lines, 40 px long (`0x42200000`), opacity 163 |
| Scale label | `0x4205c1fd` | x 8, y 214 | `trunc(x + 1)`, `trunc(y − 22)`, max_w 240; font = desc +0 at that time (UNKNOWN, `0x3c1e6f98` line 16 is the candidate) |
| Rider icon | `0x4205c260(S[2], S[3])` from `0x42051773` | centred at runtime (S[2], S[3]) | image 84, 40 × 40; preview model (120, ≈216) → x 100..140, y ≈196..236 (MEDIUM) |

Fonts (OBSERVED headers): `0x3c2a54d8` line 20 base 4; `0x3c29188c` line 18 base 4; `0x3c1e6f98` line 16 base 3.
Each has one cmap that starts at code 32 with 95 entries: printable ASCII, so digits, `.`, `k`, `m`, `-` exist.

### Consequence for the uncommitted cc29 patch

The IROM patch at `0x420949e3` stops the setter of the ride-data page (LVGL). It does not touch the map
canvas text at `0x4205bf84` / `0x4205bf9c`. Whether it changes the map page at all is UNKNOWN; a static
reading says no. The map-page switch is `show_text` at the caller `0x4204ca28` (`movi.n a13, 1`).

### Remaining gaps

1. Runtime rider centre (S[2], S[3]) and the scale-label font.
2. Exact extent of the `show_text = 0` branches (`0x4205bf76`, `0x4205c010`).
3. The meaning of the caller's `a3` at `0x4204ca24` (when the stock hides the text).

## Addendum (2026-11-23, third pass): overlay switch

- `show_text = 0` is not a hide switch. Branch 0x4205bf76 → 0x4205c086 draws a language-table string
  (table 0x3c330cb4 indexed by 0x3fc9f604, +0x4100) at the same place (x 0, max_w 232, y 222). Branch
  0x4205c010 → 0x4205c0a1 draws the bar with other line values (25 / 76 instead of 51 / a3) and marker image 122.
- Caller 0x4204ca22..0x4204ca31: `a13 = 0` when the caller's a3 ≠ 0, else 1; after the call it jumps to `retw`.
  The return value is not used. 0x421d0050 (called at 0x4205c067) is an empty stub.
- Switch for the new bar: at 0x4204ca26 change `bnez.n a3, 0x4204ca2a` to `beqz.n a3, 0x4204ca42` and at
  0x4204ca28 `movi.n a13, 1` to `nop.n`. a3 = 0: the stock overlay is not drawn. a3 ≠ 0: the stock overlay is
  unchanged (a13 = 0 from 0x4204ca24). Encodings must be checked with objdump before use.
- GAP: the meaning of the caller's a3 (second argument of the function that holds 0x4204ca22).
- The existing elevation section (js/elevation_section.js) already has min/max per 4.464 m column, 450 B per km.
  The two-zone bar can use it without a format change.

## Addendum (2026-11-23, implementation)

- The call `0x4204ca2e` (`e54d0f`, call8 `0x4205bf0c`) becomes `253a0f` (call8 `0x4205bdd0`). The trampoline `km_tramp`
  (0x1c B) sits at `0x4205bdd0..0x4205bdec`, in the dead body `0x4205bd90..0x4205bdf0`, after the guidance card range.
  The build refuses any reference into it from outside that span.
- The cc29 patch `0x420949e3` is removed (it stopped a ride-data-page setter, not the map text).
- The lens module runs in the IROM tail (`0x421debac..`, the cc25 method), 2,704 B.
- Not proven on the unit: the overlay switch, the text positions, the stock font use through the label descriptor.
