MEMORY {
 tail(rx): ORIGIN = 0x421de050, LENGTH = 0x421e0000 - 0x421de050
 card(rx): ORIGIN = 0x4205bdb0, LENGTH = 0x20
 popup(rx): ORIGIN = 0x42049690, LENGTH = 0x20
 ct(rx): ORIGIN = 0x42081ee2, LENGTH = 3
 ci(rx): ORIGIN = 0x420822cd, LENGTH = 3
 pt(rx): ORIGIN = 0x420870ca, LENGTH = 3
 pi(rx): ORIGIN = 0x4208758d, LENGTH = 3
}
SECTIONS {
 .text : { *(.literal .text .literal.* .text.*) . = ALIGN(4); } > tail
 .tramp_guidance_card : { KEEP(*(.tramp_guidance_card)) } > card
 .tramp_guidance_popup : { KEEP(*(.tramp_guidance_popup)) } > popup
 .call_guidance_card_timer : { KEEP(*(.call_guidance_card_timer)) } > ct
 .call_guidance_card_initial : { KEEP(*(.call_guidance_card_initial)) } > ci
 .call_guidance_popup_timer : { KEEP(*(.call_guidance_popup_timer)) } > pt
 .call_guidance_popup_initial : { KEEP(*(.call_guidance_popup_initial)) } > pi
 .data : { *(.data .data.* .sdata.*) } > tail
 .bss : { *(.bss .bss.* .sbss.* COMMON) } > tail
 .rodata : { *(.rodata .rodata.* .srodata.*) } > tail
 /DISCARD/ : { *(.comment .xtensa.info .xt.*) }
}
ASSERT(SIZEOF(.data) + SIZEOF(.bss) + SIZEOF(.rodata) == 0, "guidance must not use globals or instruction-bus byte data")
