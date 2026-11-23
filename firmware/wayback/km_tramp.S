/* The stock map frame calls the remaining-distance overlay fw_km_overlay (fw.h; arguments left, total, bar_w,
 * show_text). tools/cc27_build.py (KM_CALL, KM_TRAMP) changes that call to call8 km_tramp. This trampoline sends the 4
 * arguments to wb_km (firmware/wayback/wb_device.c), which draws the lens chart or calls fw_km_overlay. Place: the
 * linker region tramp_km (wb_area2.ld), in a dead stock body after the guidance card range. The same 0x1c B form as
 * the other trampolines. */
 .section .tramp_km,"ax"
 .begin no-transform
 .align 4
 .global km_tramp
km_tramp:
 entry a1, 32
 j 1f
 .align 4
2:
 .word wb_km
1:
 l32r a8, 2b
 mov.n a10, a2
 mov.n a11, a3
 mov.n a12, a4
 mov.n a13, a5
 callx8 a8
 retw.n
 .end no-transform
