# Route-exit crash, 24 Nov 2026 (image 7826c660)

Evidence: `.local/cc27-pack/crash-read-20261124T212124Z/coredump.bin` (SHA 582544ae…). The core dump changed after
the 21:39 install (d01c1cb8… before). The owner saw a fast restart when a route closed (maybe N4).

## Record

- Task `MapDraw` (TCB 0x3fcc0824). EXCCAUSE 28 (LoadProhibited), EXCVADDR 0.
- PC `0x42050464` `l32i.n a3, a10, 0`. a10 is the return value of `0x4204a4ec`, which returns the map context
  `*0x3c388cfc`. The context was 0.
- Chain: `0x42050464` ← `0x4205484d` (position handler `0x42054684`) ← `0x4204dad8` (wrapper `0x4204dabc`)
  ← `0x420093d5` ← `0x40380911`. No return address is in the patch area `0x4237b134..0x42380000`.
- EPC1 `0x42008575` is the same stale value as in the 15 Nov core.

## Stock code

- Wrapper `0x4204dabc`: reads the navigation state `*0x3fc9fc34` at `0x4204dacb` **before** it takes the
  navigation lock (`0x4204c794` at `0x4204dad0`). If the state is 2 or more, it calls the handler with that old
  state under the lock, then unlocks (`0x4204c7a8`).
- Teardown `0x4204cecc` (11 callers): takes the same lock, sets the state to 0, and at `0x4204cf2e` calls
  `0x4204c500`, which frees the point lists and the context and writes 0 to `0x3c388cfc` (`0x4204c544`). It
  then closes the six file slots (`0x420488b4`) and unlocks.
- Handler `0x42054684` → `0x42050404` uses the context without a null check (`0x42050464`).

## Inference (not proven)

A stock check-then-lock race: MapDraw reads state ≥ 2, the route teardown in another task holds the lock and
clears the context, MapDraw then gets the lock and runs the handler on a freed route. Our code does not write
`0x3c388cfc` and reads it only with a null check (`fw_proj_zoom`). Not yet known: whether our code makes the
teardown hold the lock longer (file close with the far-map page cache) or makes MapDraw reach `0x4204dacb`
more often during a route exit.

## Distinguishing observation

The race needs the teardown to hold the lock while MapDraw is between `0x4204dacb` and `0x4204dad0`. A guard
that rereads `*0x3fc9fc34` and `*0x3c388cfc` after the lock and skips the handler when either is 0 removes it.
If a crash with the same record comes back with the guard in place, the inference is wrong.
