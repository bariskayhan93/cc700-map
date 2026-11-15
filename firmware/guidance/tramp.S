/* Reuse only the displaced tails of v21's map replacements. The original
 * functions are already unconditionally redirected by their existing entry. */
.macro WRAP name, target
.section .tramp_\name,"ax"
.global tramp_\name
tramp_\name:
  entry a1, 32
  j 1f
  .align 4
2: .word \target
1:
  l32r a8, 2b
  mov a10, a2
  mov a11, a3
  mov a12, a4
  callx8 a8
  retw
.endm
WRAP guidance_card, cc_guidance_card
WRAP guidance_popup, cc_guidance_popup
.macro CALL name, target
.section .call_\name,"ax"
.begin no-transform
call8 \target
.end no-transform
.endm
CALL guidance_card_timer, tramp_guidance_card
CALL guidance_card_initial, tramp_guidance_card
CALL guidance_popup_timer, tramp_guidance_popup
CALL guidance_popup_initial, tramp_guidance_popup
