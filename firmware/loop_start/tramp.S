/* Seven arguments: incoming argument 7 is at the caller's SP, hence our SP+32.
 * Preserve it at our outgoing SP+0 before opening another register window. */
.section .tramp_loop_start,"ax"
.global tramp_loop_start
tramp_loop_start:
 entry a1,32
 j 1f
 .align 4
2: .word cc_loop_match
1:
 l32i a9,a1,32
 s32i a9,a1,0
 l32r a8,2b
 mov a10,a2
 mov a11,a3
 mov a12,a4
 mov a13,a5
 mov a14,a6
 mov a15,a7
 callx8 a8
 mov a2,a10
 retw
.section .call_loop_start,"ax"
.begin no-transform
 call8 tramp_loop_start
.end no-transform
