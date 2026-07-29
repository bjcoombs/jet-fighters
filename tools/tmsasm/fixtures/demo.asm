; A fixture program for tools/tmsasm's end-to-end tests. Paths in this file are
; relative to the repository root.
;
; Not the game. `asm/jetfighter.asm` is the game. This file exists so the
; assembler, its CLI and its Vite plugin can be proved end to end against a
; program that lands code on more than one page, without the proof depending on
; what the game program happens to contain.
;
; Directives exercised here: `.EQU`, `.PAGE`, `.INCLUDE`, `.DB`, `.DW`, `.END`,
; and `.OPLA` by way of the included table. **`.ORG`, `.CHAPTER` and `.RES` are
; not**, and the claim is narrowed rather than the fixture padded: each of those
; three moves where code or data lands, and a fixture that used them to say it
; covered them would be asserting about its own layout rather than about the
; assembler. They are covered by unit tests in `../assembler.test.ts`.
;
; It is deliberately small and deliberately not a display sweep: nothing here is
; a claim about how the game works.

; --- Constants ---------------------------------------------------------------

.EQU RAM_FRAME, 0                       ; frame counter nibble
.EQU RAM_STATE, 1                       ; game state nibble
.EQU GRID_COUNT, 9                      ; grids the tube has
.EQU PAGE_MAIN, 0                       ; where the main loop lives

; --- The O output PLA --------------------------------------------------------
;
; The real table, included rather than restated. `asm/opla.inc.asm` is this
; machine's O output PLA - 31 of the 32 slots declared, slot 0 all plates dark
; because reset writes index 0 to the O register before the program has chosen
; anything. Task 8's `asm/jetfighter.asm` includes the same file, so the fixture
; and the game assemble the same vocabulary and there is no second copy to go
; stale.
;
; It is included here and not merely tested in isolation because a table nothing
; assembles is a table nothing proves: this is the source the CLI and the Vite
; plugin actually emit an O PLA image from today.

.INCLUDE "../../../asm/opla.inc.asm"

; --- Reset -------------------------------------------------------------------
;
; Chapter 0, page 15, word 0. The page allocator holds this page back from
; general code, so putting the reset routine here is an explicit claim rather
; than a race with whatever `.PAGE` happened to hand out.

.PAGE 15
reset:  CLA                             ; O index 0 - plates dark
        TDO
        LDX 0
        TCY 0
clear:  TCMIY 0                         ; zero a nibble, step Y
        YNEC 0                          ; status = Y has not wrapped
        BR clear
        LDP PAGE_MAIN
        BR main

; --- The main loop -----------------------------------------------------------

.PAGE PAGE_MAIN
main:   LDX 0
        TCY RAM_FRAME
        IMAC                            ; frame counter + 1
        TAM
        TCY RAM_STATE
        TMA
        YNEC 0
        CALL step
        LDP PAGE_MAIN
        BR main

; --- A subroutine ------------------------------------------------------------
;
; Same page as its caller. A `CALL` from inside a subroutine loses the outer
; return address on this core and a `BR` inside one cannot change page, so a
; single-page routine is the shape that is always safe.

step:   TCY RAM_STATE
        TMA
        IAC
        TAM
        RETN

; --- Data --------------------------------------------------------------------

.PAGE 1
grids:  .DB GRID_COUNT, 0, 1, 2, 3, 4, 5, 6, 7, 8
name:   .DB "JET"
wide:   .DW $1234, $ABCD

; --- The end of this file ----------------------------------------------------
;
; `.END` stops assembling *this* file. The label below it is deliberately live
; assembly that must never reach the image: `example.test.ts` asserts
; `after_end` is absent from the symbol table, so the directive is proved to do
; something rather than merely to parse. An `.END` that was quietly ignored
; would leave the label defined and that test would fail.

.END

after_end:
        .DB $FF
