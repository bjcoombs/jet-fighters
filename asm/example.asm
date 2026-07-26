; example.asm - a worked example of the HMCS40 assembler in this repo.
;
; Not the game. asm/jetfighter.asm is the ROM the emulator runs; this file is a
; small, complete program that exercises every part of the tool chain - labels,
; forward references, constants, expressions, all four data and layout
; directives, page-0 subroutine entry points, in-page branches, long jumps and a
; pattern table - so that `hmasm` is proven end to end by something that could
; plausibly run on the device rather than by a single instruction.
;
; It is assembled and round-tripped through the CPU's own decoder by
; tools/hmasm/example.test.ts: every word it emits must decode back to the
; instruction written here. That is the property that stops the assembler and
; the emulator drifting apart.
;
; Assemble it:
;   npx vite-node tools/hmasm/cli.ts asm/example.asm --listing /tmp/example.lst

; --- RAM map ----------------------------------------------------------------
;
; The device has 160 nibbles: ten files of sixteen, selected by X, with Y
; indexing within a file (src/machine/cpu/memory.ts). A name beginning RAM_ is
; read by the assembler as a RAM address and counted into the high-water mark it
; reports; the FILE_ and NIB_ names are what the instructions actually take,
; because X wants a file number and Y wants a nibble index.
;
; The addresses are written as sums rather than computed: the expression grammar
; is additive only, deliberately, so an operand can never hide arithmetic.

.EQU FILE_SHIP,   0
.EQU FILE_STATE,  1
.EQU BASE_STATE,  16            ; FILE_STATE * 16, spelled out

.EQU NIB_SHIP_X,  0
.EQU NIB_SHIP_Y,  1
.EQU NIB_ENEMY_X, 2
.EQU NIB_ENEMY_Y, 3
.EQU NIB_FRAME,   0
.EQU NIB_SCORE,   1
.EQU NIB_LIVES,   2

.EQU RAM_SHIP_X,  NIB_SHIP_X
.EQU RAM_SHIP_Y,  NIB_SHIP_Y
.EQU RAM_ENEMY_X, NIB_ENEMY_X
.EQU RAM_ENEMY_Y, NIB_ENEMY_Y
.EQU RAM_FRAME,   BASE_STATE + NIB_FRAME
.EQU RAM_SCORE,   BASE_STATE + NIB_SCORE
.EQU RAM_LIVES,   BASE_STATE + NIB_LIVES

; --- Hardware ---------------------------------------------------------------

.EQU R_DISPLAY,   0             ; R0/R1 carry the segment pattern
.EQU D_SPEAKER,   0             ; D0 drives the piezo
.EQU PRESCALE,    6             ; timer tick every 2^6 machine cycles
.EQU START_X,     8
.EQU START_Y,     4
.EQU TONE_LEN,    12
.EQU PAT_SHIP,    0             ; pattern table the P instruction selects

; --- Page 0: the reset word and the subroutine entry points -----------------
;
; CAL reaches page 0 and nowhere else - it carries a five-bit offset and its page
; is fixed at 0 (src/machine/cpu/isa.ts) - so page 0 is a table of long jumps and
; the routines themselves live wherever they fit. Calling one costs a word here
; and buys the whole 2048-word region to put the body in.

.ORG $000
reset:      JMPL main
sub_clear:  JMPL clear_ram
sub_wait:   JMPL wait_tick
sub_draw:   JMPL draw_ship
sub_sound:  JMPL sound_tick

; --- Page 1: start-up and the frame loop ------------------------------------

.PAGE 1
main:
        LPI PRESCALE            ; prescaler ratio
        LTI 0                   ; counter from zero
        RECF                    ; timer mode, not event counting
        RETF                    ; clear a stale overflow flag
        SEIE                    ; interrupts on
        CAL sub_clear

        LXI FILE_SHIP
        LYI NIB_SHIP_X
        LAI START_X
        LMAIY                   ; ship X, then Y steps to NIB_SHIP_Y
        LAI START_Y
        LMAIY                   ; ship Y

        LXI FILE_STATE
        LYI NIB_LIVES
        LAI 3
        XMA                     ; three lives

frame:
        CAL sub_wait
        CAL sub_draw
        CAL sub_sound

        LXI FILE_STATE
        LYI NIB_FRAME
        LAM
        AI 1
        XMA                     ; frame counter, wrapping every sixteen
        BR frame

; --- Page 2: clear every implemented RAM nibble -----------------------------
;
; The file number comes out of B rather than a literal LXI, which is exactly the
; case the assembler's RAM high-water mark cannot see: it counts literal LXI
; operands and RAM_ constants, and a file chosen at run time is invisible to it.
; See tools/hmasm/assembler.ts.

.PAGE 2
clear_ram:
        LBI FILE_STATE          ; highest file this program uses
clear_file:
        LAB
        LXA                     ; X <- the file number in B
        LYI 0
clear_nibble:
        LAI 0
        LMAIY                   ; M <- 0, Y <- Y + 1, ST = "Y did not wrap"
        BR clear_nibble
        DB                      ; B <- B - 1, ST = "B did not wrap"
        BR clear_file
        RTN

; --- Page 3: wait for the timer to overflow ---------------------------------

.PAGE 3
wait_tick:
        TTF                     ; ST <- the timer overflow flag
        BR tick_ready
        BR wait_tick            ; ST is 1 again after a branch, so this is a loop
tick_ready:
        RETF                    ; TF <- 0
        LTI 0                   ; and start the next interval
        RTN

; --- Page 4: put the ship on the display ------------------------------------

.PAGE 4
draw_ship:
        LXI FILE_SHIP
        LYI NIB_SHIP_X
        LAM
        P PAT_SHIP              ; A <- pattern low nibble, B <- high nibble
        LRA R_DISPLAY
        LRB R_DISPLAY + 1

        LYI NIB_SHIP_Y
        LAM
        LYA                     ; Y <- the row to strobe
        SEDY                    ; D pin (Y) <- 1
        TDY
        BR draw_done
        REDY                    ; the pin refused to rise - drop it again
draw_done:
        RTN

; --- Page 5: one tick of the sound ------------------------------------------

.PAGE 5
sound_tick:
        LXI FILE_STATE
        LYI NIB_SCORE
        LAM
        ALEI 0                  ; ST <- (A <= 0): nothing scored, nothing to play
        BR sound_off

        SED D_SPEAKER
        LAI TONE_LEN
        LBA
tone_wait:
        DB
        BR tone_wait
        RED D_SPEAKER
        RTN

sound_off:
        RED D_SPEAKER
        RTN

; --- Page 6: data -----------------------------------------------------------

.PAGE 6
title:
        .DB "JET", 0            ; one word per character, byte-sized
lamps:
        .DW $001, $002, $004, $008
        .DW $010, $020, $040, $080

.ALIGN 8
scratch:
        .RES 4                  ; four words left as the mask ROM has them
limits:
        .DB START_X, START_Y, TONE_LEN

; --- The pattern region -----------------------------------------------------
;
; 128 ten-bit words above the program region, in eight tables of sixteen, read by
; the P instruction rather than executed. `.PATTERN 0` is the first of them.

.PATTERN PAT_SHIP
ship_shapes:
        .DW $000, $011, $033, $077
        .DW $0FF, $1FF, $3FF, $1FF
        .DW $0FF, $077, $033, $011
        .DW $000, $000, $000, $000

.END
