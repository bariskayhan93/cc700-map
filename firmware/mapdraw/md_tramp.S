/* cc26: the literals of tramp_iter (0x42049678) and tramp_line (0x4205bd98) held the v21 cc_iter and cc_line.
 * They now hold the copies in the second code area (A: no draw call off the canvas, B: frame limit). */
.section .lit_cc_iter,"a"
.global cc_iter_literal
cc_iter_literal:
 .word cc_iter
.section .lit_cc_line,"a"
.global cc_line_literal
cc_line_literal:
 .word cc_line
