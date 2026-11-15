MEMORY {
 tail(rx): ORIGIN = 0x421de120, LENGTH = 0x421e0000 - 0x421de120
 trampoline(rx): ORIGIN = 0x420496d8, LENGTH = 0x40
 callsite(rx): ORIGIN = 0x420547dd, LENGTH = 3
}
SECTIONS {
 .text : { *(.literal .text .literal.* .text.*) . = ALIGN(4); } > tail
 .tramp_loop_start : { KEEP(*(.tramp_loop_start)) } > trampoline
 .call_loop_start : { KEEP(*(.call_loop_start)) } > callsite
 .data : { *(.data .data.* .sdata.*) } > tail
 .bss : { *(.bss .bss.* .sbss.* COMMON) } > tail
 .rodata : { *(.rodata .rodata.* .srodata.*) } > tail
 /DISCARD/ : { *(.comment .xtensa.info .xt.*) }
}
ASSERT(SIZEOF(.data)+SIZEOF(.bss)+SIZEOF(.rodata)==0,"no writable globals or instruction-bus byte data")
