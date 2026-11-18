/* Way-back test layer on cc26 (D5, E8). The code runs in the second code area: IROM alias 0x4237b134 up to
 * 0x42380000 (20,172 B). The image builder loads it at 0x3c37b134 (DROM, after the constants). One literal is
 * replaced: the cc_rt word of tramp_rt (0x420496b8), which now holds wb_rt. Since bbd323b+1 also the cc_iter and cc_line
 * words of tramp_iter (0x42049678) and tramp_line (0x4205bd98): firmware/mapdraw. No writable globals. */
MEMORY {
 area2(rx): ORIGIN = 0x4237b134, LENGTH = 0x42380000 - 0x4237b134
 lit(rx): ORIGIN = 0x420496b8, LENGTH = 4
 lit_iter(rx): ORIGIN = 0x42049678, LENGTH = 4
 lit_line(rx): ORIGIN = 0x4205bd98, LENGTH = 4
}
SECTIONS {
 .text : { *(.literal .text .literal.* .text.*) . = ALIGN(4); } > area2
 .lit_wb_rt : { KEEP(*(.lit_wb_rt)) } > lit
 .lit_cc_iter : { KEEP(*(.lit_cc_iter)) } > lit_iter
 .lit_cc_line : { KEEP(*(.lit_cc_line)) } > lit_line
 .data : { *(.data .data.* .sdata.*) } > area2
 .bss : { *(.bss .bss.* .sbss.* COMMON) } > area2
 .rodata : { *(.rodata .rodata.* .srodata.*) } > area2
 /DISCARD/ : { *(.comment .xtensa.info .xt.*) }
}
ASSERT(SIZEOF(.data)+SIZEOF(.bss)+SIZEOF(.rodata)==0,"no writable globals or instruction-bus byte data")
