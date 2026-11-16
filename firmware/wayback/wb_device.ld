/* Way-back test layer on cc23. Code goes after the cc23 tail. One literal is replaced: the cc_rt word of tramp_rt. */
MEMORY {
 tail(rx): ORIGIN = 0x421de800, LENGTH = 0x421e0000 - 0x421de800
 lit(rx): ORIGIN = 0x420496b8, LENGTH = 4
}
SECTIONS {
 .text : { *(.literal .text .literal.* .text.*) . = ALIGN(4); } > tail
 .lit_wb_rt : { KEEP(*(.lit_wb_rt)) } > lit
 .data : { *(.data .data.* .sdata.*) } > tail
 .bss : { *(.bss .bss.* .sbss.* COMMON) } > tail
 .rodata : { *(.rodata .rodata.* .srodata.*) } > tail
 /DISCARD/ : { *(.comment .xtensa.info .xt.*) }
}
ASSERT(SIZEOF(.data)+SIZEOF(.bss)+SIZEOF(.rodata)==0,"no writable globals or instruction-bus byte data")
