/* cc25 map block decoder. Code goes after the cc23 tail. One literal is replaced: the entries callback
 * of the block loader at 0x4203e3ec, which now holds the address of cc_entries. */
MEMORY {
 tail(rx): ORIGIN = 0x421de800, LENGTH = 0x421e0000 - 0x421de800
 lit(rx): ORIGIN = 0x4203e3ec, LENGTH = 4
}
SECTIONS {
 .text : { *(.literal .text .literal.* .text.*) . = ALIGN(4); } > tail
 .lit_md : { LONG(cc_entries) } > lit
 .data : { *(.data .data.* .sdata.*) } > tail
 .bss : { *(.bss .bss.* .sbss.* COMMON) } > tail
 .rodata : { *(.rodata .rodata.* .srodata.*) } > tail
 /DISCARD/ : { *(.comment .xtensa.info .xt.*) }
}
ASSERT(SIZEOF(.data)+SIZEOF(.bss)+SIZEOF(.rodata)==0,"no writable globals or instruction-bus byte data")
