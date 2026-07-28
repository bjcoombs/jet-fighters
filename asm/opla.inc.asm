; opla.inc.asm - this machine's O output PLA, the 32 plate masks it can ever
; drive. Paths in this file are relative to the repository root.
;
; Include it; do not copy it:
;
;     .INCLUDE "opla.inc.asm"
;
; from a source in asm/, since tools/tmsasm resolves an include against the
; directory of the file that asked for it.
;
; This file is the machine's copy of the table. src/machine/board/o-pla.ts is the
; same table stated as rules, for the board and the tests to reason about, and
; tools/tmsasm/opla-table.test.ts asserts the two agree slot for slot. If you
; change a mask here, change the rule there - a divergence is a test failure and
; not a merge conflict, deliberately.
;
; --- What this table is, and what it is not ----------------------------------
;
; The TMS1370's eight O pins are not a latch. They are the output of a
; five-bit-to-eight-bit code converter indexed by status_latch:accumulator, whose
; decoding the customer defines (TI Data Manual Dec 1976 section 2.6, quoted in
; docs/research/tms1370-io.md). Thirty-two masks exist for a given chip, ever.
;
; These thirty-two are ours. MAME carries Gakken's own table for our mask ROM as
; `tms1100_ginv_output.pla`; that artifact has NOT been obtained by this project
; and nothing below is derived from it or claims to be. Reproducing Gakken's PLA
; is an explicit non-goal of docs/contract/v3.contract.md.
;
; --- The layout ---------------------------------------------------------------
;
; Plates 8-11 come from R11-R14 and can be set one line at a time, so this table
; only ever expresses subsets of plates 0-7. src/machine/tube/atlas.json puts
; three lane families there, the same three on every playfield grid:
;
;   plates 0-2   NEAR   battleship (grid 0), jet (grids 1-5)
;   plates 3-5   FAR    sea (grid 0), attacker colon (grids 1-5), capture (grid 6)
;   plates 6-7   PAIR   battleship burst, player missile, player ship,
;                       score hundreds, SCORE label
;
; plus a seven-segment digit across plates 0-6 on grids 7 and 8.
;
; A grid cannot be drawn in one TDO. A jet column's O-visible state space is
; 8 jet subsets x 4 colon states x 3 missile states = 96 masks, and 96 > 32 under
; every possible allocation - before a single digit is spent. The sweep therefore
; strobes one family per pass. docs/research/pla-design.md works the arithmetic
; and states the instruction cost.
;
;   index      A     latch  what it selects
;   0-7        0-7   0      NEAR: any subset of plates 0-2, mask = A
;   8-15       8-15  0      FAR:  any subset of plates 3-5, mask = (A-8) << 3
;   16-25      0-9   1      the decoded decimal digit A on plates 0-6
;   26         10    1      the blank digit, for leading-zero suppression
;   27         11    1      reserved, assembles to 0 - task 8's headroom
;   28-31      12-15 1      PAIR: any subset of plates 6-7, mask = (A-12) << 6
;
; Two consequences worth stating out loud.
;
; The low bits of the index ARE the lane bitmap, so a routine holding "which
; lanes of this family are lit" in the accumulator already holds the index. The
; far family costs one A8AAC on top. Nothing here needs a ROM lookup table.
;
; The status latch is loaded by exactly one instruction on this core - YNEA -
; and there is no set and no clear. That is why the digits and the two-plate
; family share the high bank: the sweep runs both low-bank passes, crosses once,
; runs both high-bank passes, and crosses back. Two crossings per sweep, three
; instructions each.

; --- Named accumulator values -------------------------------------------------
;
; These are ACCUMULATOR values, not slot indices: the fifth index bit is the
; status latch and no instruction takes it as an operand, so what a routine
; actually computes is the low nibble. The comment on each name says which bank
; it is only meaningful in. A caller writes OPLA_A_FAR + lanes, never a bare
; number. src/machine/board/o-pla.ts exports the same layout as slot indices.

.EQU OPLA_A_NEAR,        0      ; latch CLEAR: + a 3-bit bitmap for plates 0-2
.EQU OPLA_A_FAR,         8      ; latch CLEAR: + a 3-bit bitmap for plates 3-5
.EQU OPLA_A_DIGIT,       0      ; latch SET:   + the BCD digit, 0-9
.EQU OPLA_A_DIGIT_BLANK, 10     ; latch SET:   the blank tens digit
.EQU OPLA_A_PAIR,       12      ; latch SET:   + a 2-bit bitmap for plates 6-7

; --- Low bank, status latch clear ---------------------------------------------
;
; NEAR - plates 0-2, every subset. Eight and not four because the ROM keeps one
; jet per lane and flies each independently (FILE_JETS in asm/jetfighter.asm), so
; a column can hold three at once. Slot 0 is the empty subset, which is also what
; reset writes and what blanks a grid: the same slot for the same reason, and
; tools/tmsasm rejects a lit mask here.

.OPLA  0, %00000000                     ; -            (dark; reset writes this)
.OPLA  1, %00000001                     ; lane 0
.OPLA  2, %00000010                     ; lane 1
.OPLA  3, %00000011                     ; lanes 0,1
.OPLA  4, %00000100                     ; lane 2
.OPLA  5, %00000101                     ; lanes 0,2
.OPLA  6, %00000110                     ; lanes 1,2
.OPLA  7, %00000111                     ; lanes 0,1,2

; FAR - plates 3-5, every subset. The printed sea is three lane segments that
; read as one horizon, so grid 0 wants the full %111; the colon flies one at a
; time. Holding all eight costs nothing the rest of the table wanted.

.OPLA  8, %00000000                     ; -
.OPLA  9, %00001000                     ; lane 0
.OPLA 10, %00010000                     ; lane 1
.OPLA 11, %00011000                     ; lanes 0,1
.OPLA 12, %00100000                     ; lane 2
.OPLA 13, %00101000                     ; lanes 0,2
.OPLA 14, %00110000                     ; lanes 1,2
.OPLA 15, %00111000                     ; lanes 0,1,2

; --- High bank, status latch set ----------------------------------------------
;
; The ten decimal digits, on plates 0-6: segment a is plate 0 through segment g
; at plate 6, read off src/machine/tube/atlas.json. The BCD nibble passes through
; untouched - a routine holding a score digit in the accumulator draws it with
; TDO and no conversion, which is the use TI's own manual gives as the example.
; The seven-segment decode lives in the mask, so no ROM page is spent on it.

.OPLA 16, %00111111                     ; 0   a b c d e f
.OPLA 17, %00000110                     ; 1     b c
.OPLA 18, %01011011                     ; 2   a b   d e   g
.OPLA 19, %01001111                     ; 3   a b c d     g
.OPLA 20, %01100110                     ; 4     b c     f g
.OPLA 21, %01101101                     ; 5   a   c d   f g
.OPLA 22, %01111101                     ; 6   a   c d e f g
.OPLA 23, %00000111                     ; 7   a b c
.OPLA 24, %01111111                     ; 8   a b c d e f g
.OPLA 25, %01101111                     ; 9   a b c d   f g

; The blank tens digit. Dark, like slot 0, but reachable from the high bank, so
; suppressing a leading zero costs the same two instructions as drawing a digit
; and does not move the status latch. Slot 0 is the same pattern at a different
; price, which is why both exist.

.OPLA 26, %00000000                     ; blank - leading-zero suppression

; Slot 27 is deliberately undeclared and assembles to 0. It is the one slot this
; design leaves unspent, kept as headroom for task 8 rather than filled with a
; mask nothing has asked for.

; PAIR - plates 6-7, every subset. Two plates and not three: each of these
; families has its third lane on plate 8, which is R11 and outside this table.
; The score grids borrow the group for one plate each - score_hundreds and
; score_label are both plate 7 - so the score needs no slot of its own for them.

.OPLA 28, %00000000                     ; -
.OPLA 29, %01000000                     ; lane 0 / plate 6
.OPLA 30, %10000000                     ; lane 1 / plate 7  (hundreds, SCORE)
.OPLA 31, %11000000                     ; lanes 0,1
