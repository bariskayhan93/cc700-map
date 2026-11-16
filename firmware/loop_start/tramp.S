/* Seven arguments: incoming argument 7 is at the caller's SP, hence our SP+48.
 * Preserve it at our outgoing SP+0 before opening another register window.
 * Frame 48, not 32: a window spill saves our own a4..a7 at caller SP-32..-17 and
 * the base save area of the caller's caller at caller SP-16..-1. With frame 48 these
 * are our SP+16..SP+47. With frame 32, our a4..a7 landed at our SP+0..SP+15, so a
 * spill between the store below and the callee's read replaced argument 7 with
 * our a4 (road index). That is the 2026-11-16 crash. */
.section .tramp_loop_start,"ax"
.global tramp_loop_start
tramp_loop_start:
 entry a1,48
 j 1f
 .align 4
2: .word cc_loop_match
1:
 l32i a9,a1,48
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
