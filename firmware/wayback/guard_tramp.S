/* Route-exit guard (docs/research/route-exit-crash-2026-11-24.md). The stock wrapper 0x4204dabc reads the navigation
 * state 0x3fc9fc34 before it takes the navigation lock, then calls the position handler 0x42054684 under the lock.
 * A route teardown in another task can set the state to 0 and free the map context in between. tools/cc27_build.py
 * (GUARD_CALL) changes that call to call8 guard_tramp. Under the lock, this code reads the state again and calls the
 * handler with it only when it is 2 or more, as the wrapper does. Place: tramp_guard (wb_area2.ld), the dead stock
 * body after the L1 range. */
 .section .tramp_guard,"ax"
 .begin no-transform
 .align 4
 .global guard_tramp
guard_tramp:
 entry a1, 32
 j 1f
 .align 4
2:
 .word 0x3fc9fc34
3:
 .word 0x42054684
1:
 l32r a8, 2b
 l32i.n a10, a8, 0
 bltui a10, 2, 4f
 l32r a8, 3b
 callx8 a8
4:
 retw.n
 .end no-transform
