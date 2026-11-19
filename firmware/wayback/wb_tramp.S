/* The literal of tramp_rt (fw.h) held cc_rt. It now holds wb_rt, which calls cc_rt first. */
.section .lit_wb_rt,"a"
.global wb_rt_literal
wb_rt_literal:
 .word wb_rt
