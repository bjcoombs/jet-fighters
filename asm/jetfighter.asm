; jetfighter.asm - the game ROM the emulator runs.
;
; This is the bootstrap: a complete, running program that exercises every path
; between the CPU and the outside world - the display sweep, the input matrix,
; the plate bus and the speaker pin - without yet being the finished game. Task 9
; grows it into one. Everything here is meant to be edited, so every routine says
; what it does, what registers it expects and what it leaves behind.
;
; Assemble it:
;   npx vite-node tools/hmasm/cli.ts asm/jetfighter.asm --listing /tmp/jf.lst
;
; Run it:
;   npx vite-node tools/probe/machine-probe.ts --cycles 400000
;
; --- The shape of the program -----------------------------------------------
;
; The device has no clock. There is no interrupt driving the frame, no vblank and
; no scheduler: the display sweep *is* the timebase, and everything else happens
; between grid strobes. So the whole program is one master loop:
;
;   for each grid D0..D9:
;       put that grid's plate pattern on R0-R2
;       raise the grid
;       read D15 - on D0-D6 the grid line is also the input strobe line
;       hold the grid lit for the dwell period
;       drop the grid
;   decode the sampled contacts
;   redraw the plate table
;   advance the game state
;   repeat
;
; Because D0-D6 do double duty as grid drives and input strobes (board.ts), the
; sweep samples the case controls for free: whichever contact sits on the line
; currently being lit answers on D15. There is no separate keyboard scan.
;
; --- Timing is provisional, and deliberately so -----------------------------
;
; docs/evidence/timing-analysis.md records that the per-skill gameplay video does
; not exist yet, so no real cadence - sweep rate, enemy step interval, blip
; length - can be derived from the unit. Every timing constant below is marked
; PROVISIONAL and carries the reasoning that picked it. None of them is a
; measurement, and none should be read as one.
;
; The single exception is the blip *pitch*: the acceptance contract
; (docs/contract/v2.contract.md, criterion V5) states 1480-1632 Hz as the band
; measured from the owner's v1 recordings of the real unit, and task 10 extracts
; that measurement to docs/evidence/audio-reference.md. TONE_HALF_OUTER and
; TONE_HALF_INNER below are chosen to land inside it, and the arithmetic that
; gets there is written out so a later contributor can re-derive it.

; --- Hardware map -----------------------------------------------------------
;
; Grids D0-D9, plates R0-R4 (20 lines), speaker D14, input read-back D15. This
; mirrors src/machine/cpu/ports.ts and src/machine/board/display.ts; those files
; carry the provenance for the topology.

.EQU GRID_COUNT,    10          ; display grids, D0..D9
.EQU GRID_LAST,      9

.EQU R_PLATE0,       0          ; R0 drives plates 0-3
.EQU R_PLATE1,       1          ; R1 drives plates 4-7
.EQU R_PLATE2,       2          ; R2 drives plates 8-11

.EQU D_SPEAKER,     14          ; the 1-bit piezo
.EQU D_INPUT,       15          ; the matrix read-back line

; Strobe lines, which are the low grid lines. See INPUT_SWITCHES in
; src/machine/board/input.ts - this table is the ROM's side of that wiring.
.EQU LINE_FIRE,      0
.EQU LINE_LEVER,     1          ; lines 1,2,3 = lever up, centre, down
.EQU LINE_SKILL,     4          ; lines 4,5,6 = skill 1, 2, 3

; --- Plate assignments ------------------------------------------------------
;
; A segment is a (grid, plate) pair, so the same plate line means different
; things under different grids - that is how a multiplexed tube works, not an
; overload. Plates 0-11 are the ones the segment atlas addresses
; (src/machine/tube/atlas-schema.ts).
;
;   plate 0      ground line, under the playfield columns
;   plates 4-6   the launcher, one plate per lane, under grid 0
;   plates 0-6   the seven digit segments, under the two HUD columns
;   plate 8      the enemy jet
;   plate 9      the missile in flight

.EQU PLATE_ENEMY,   %0001       ; R2 bit 0 -> plate 8
.EQU PLATE_MISSILE, %0010       ; R2 bit 1 -> plate 9

.EQU LAUNCH_GRID,    0          ; the launcher's column
.EQU MISSILE_GRID,   1          ; the column the missile shows in
.EQU SCORE_GRID,     8          ; HUD: shots fired
.EQU HUD_GRID,       9          ; HUD: skill dial setting

; --- Pattern tables ---------------------------------------------------------
;
; `P` reads one word of the pattern region and splits it: low nibble into A,
; high nibble into B. Every table below is therefore "R0 bits in the low nibble,
; R1 bits in the high nibble" so a single lookup fills both plate ports.

.EQU PAT_LANE,       0          ; lever lane -> launcher plate bit
.EQU PAT_DIGIT,      1          ; 0-9 -> seven-segment plates
.EQU PAT_GROUND,     2          ; grid -> the ground line under that column

; --- RAM map ----------------------------------------------------------------
;
; 160 nibbles: ten files of sixteen, X selects the file and Y indexes within it
; (src/machine/cpu/memory.ts). Five files are used.
;
; The plate table is the important one. Three files hold, per grid, the nibble
; that goes to R0, R1 and R2 when that grid is strobed. The sweep does no
; drawing at all - it copies three nibbles and lights the grid - so redrawing
; and displaying are completely separate, which is what keeps the sweep short
; enough to have a stable period.

.EQU FILE_PLATE0,    0          ; per-grid R0 nibble, indexed by grid 0-9
.EQU FILE_PLATE1,    1          ; per-grid R1 nibble
.EQU FILE_PLATE2,    2          ; per-grid R2 nibble
.EQU FILE_STATE,     3          ; the game state
.EQU FILE_INPUT,     4          ; one nibble per strobe line: 1 = contact closed

; Nibble indices within FILE_STATE.
.EQU NIB_LANE,       0          ; lever lane, 0 top .. 2 bottom
.EQU NIB_SKILL,      1          ; skill dial, 1..3
.EQU NIB_FIRE,       2          ; fire contact, this sweep
.EQU NIB_FIRE_PREV,  3          ; fire contact, previous sweep
.EQU NIB_TICK,       4          ; sweeps counted, wrapping every sixteen
.EQU NIB_ENEMY,      5          ; the enemy jet's column
.EQU NIB_BLIP,       6          ; bursts left in the blip being played
.EQU NIB_SCORE,      7          ; shots fired, wrapping at ten

; The assembler counts any constant named RAM_* into the high-water mark it
; reports (tools/hmasm/assembler.ts), so the highest nibble the program touches
; is declared rather than left to be inferred from the LXI operands alone.
.EQU RAM_STATE_TOP,  63         ; FILE_STATE * 16 + 15
.EQU RAM_INPUT_TOP,  79         ; FILE_INPUT * 16 + 15

; --- Values -----------------------------------------------------------------

.EQU LANE_TOP,       0
.EQU LANE_CENTRE,    1
.EQU LANE_LAST,      2          ; three lanes, 0..2
.EQU SKILL_ONE,      1
.EQU SKILL_LAST,     3          ; three skill settings, 1..3
.EQU CONTACT_NONE,  15          ; find_contact's "nothing was closed" answer
.EQU ENEMY_START,    4
.EQU ENEMY_LAST,     7          ; the enemy flies columns 0..7; 8,9 are the HUD
.EQU SCORE_LAST,     9

; --- Timing constants -------------------------------------------------------
;
; PROVISIONAL, all of them. See the header: no gameplay recording exists to
; measure against yet.
;
; DWELL: how long one grid stays lit. The loop below costs
; (DWELL_OUTER + 1) * (2 * DWELL_INNER + 5) + 4 machine cycles, so 16 * 35 + 4 =
; 564, and one grid costs about 586 cycles including the sweep's own work. Ten
; grids is ~5.9 ms, i.e. a sweep somewhere near 68 Hz at the 400 kHz oscillator
; (src/machine/cpu/cpu.ts). That is inside the range a VFD has to run at to look
; steady rather than a figure taken from the unit; when the reference video
; arrives, the real rate replaces these two numbers and nothing else.
.EQU DWELL_OUTER,   15
.EQU DWELL_INNER,   15

; TONE: the missile-fire blip. Unlike the dwell, this one is pinned to a
; measurement - contract V5's 1480-1632 Hz band, taken from the owner's v1
; recordings of the real unit.
;
; The half-period routine costs (TONE_HALF_OUTER + 1) * (2 * TONE_HALF_INNER + 7)
; + 2 = 4 * 31 + 2 = 126 cycles, and the tone loop adds six cycles of its own per
; period (two port writes, two calls, a decrement and a branch), so one period is
; 2 * 126 + 6 = 258 cycles and the pitch is 400000 / 258 = 1550 Hz - the middle
; of the band. Changing either constant moves the pitch; the divisor to aim at is
; 400000 / f.
.EQU TONE_HALF_OUTER, 3
.EQU TONE_HALF_INNER, 12

; Burst length. TONE_PERIODS + 1 periods per burst, BLIP_BURSTS + 1 bursts, so
; 4 * 16 * 258 = 16512 cycles = 41 ms. PROVISIONAL: the contract requires the
; blip to be shorter than 150 ms and nothing narrower is known, so this sits
; comfortably inside that ceiling rather than at it.
.EQU TONE_PERIODS,  15
.EQU BLIP_BURSTS,    3

; PRESCALE: the timer is set free-running at reset and never read by this
; bootstrap. It is started here because the game (task 9) takes its randomness
; from the counter's phase, and a counter that only starts when it is first
; needed is not random at all. 2^6 machine cycles per tick is PROVISIONAL.
.EQU PRESCALE,       6

; ============================================================================
; Page 0: the reset vector and the routines CAL can reach
; ============================================================================
;
; CAL carries a five-bit offset and its page is fixed at 0 (src/machine/cpu/isa.ts),
; so page 0 is the only place a one-word call can land. It holds the two routines
; called from inside loops - the grid dwell and the tone half-period - and the
; contact scan. Everything else is reached with CALL, which costs a second word
; but goes anywhere.

.ORG $000
reset:  JMPL main

; --- dwell: hold the current grid lit ---------------------------------------
;
; In:  nothing. Out: nothing. Clobbers: B, and X/Y via the shadow pair.
;
; The sweep keeps the grid index in Y and the RAM file in X, and this routine
; needs a spare counter, so it parks both in the shadow pointers with XSP and
; puts them back on the way out. That is what XSP is for; saving Y to RAM would
; cost more cycles than the counter it frees.
dwell:  XSP                     ; sweep's X/Y -> SPX/SPY
        LBI DWELL_OUTER
dw_out: LYI DWELL_INNER
dw_in:  DY                      ; ST <- 1 until Y wraps out of four bits
        BR dw_in
        DB                      ; ST <- 1 until B wraps
        BR dw_out
        XSP                     ; SPX/SPY -> X/Y
        RTN

; --- half: one half-period of the blip tone ---------------------------------
;
; In:  nothing. Out: nothing. Clobbers: A, Y, carry.
;
; It counts down in A rather than in B, because B is where its only caller keeps
; the number of periods left in the burst - a delay routine that ate the loop
; counter of the loop calling it produced an endless tone, which is the kind of
; bug that is invisible in a listing and obvious in an edge stream.
;
; Called only from tone_burst, which owns no pointer state, so this one does not
; bother with XSP. Cost is quoted in TONE_HALF_OUTER above and is load bearing -
; edit the constants, not the shape of the loop.
half:   LAI TONE_HALF_OUTER
hf_out: LYI TONE_HALF_INNER
hf_in:  DY
        BR hf_in
        NOP                     ; timing pad: makes the outer pass an odd number
                                ; of cycles, which is what puts the pitch on
                                ; 1550 Hz rather than either side of it
        AI 15                   ; A - 1; carry <- 1 unless it borrowed
        TC                      ; ST <- carry
        BR hf_out
        RTN

; --- find_contact: which of three matrix lines answered ---------------------
;
; In:  X = FILE_INPUT, Y = first strobe line to test, A = the value that line
;      stands for. Out: A = the value of the closed line, or CONTACT_NONE.
; Clobbers: B, Y, ST.
;
; The lever and the skill dial are both three-position switches on three
; consecutive lines, so both decode through this. A position switch always has
; exactly one contact closed, so CONTACT_NONE means the sweep has not sampled
; those lines yet - which is true for the first sweep after reset, and is why
; the caller checks for it rather than trusting the answer.
find_contact:
        LBI 2                   ; three lines: this one and two more
fc_test:
        TM 0                    ; ST <- bit 0 of M; the sweep stored 1 or 0
        BR fc_found
        IY                      ; next strobe line
        AI 1                    ; next value
        DB
        BR fc_test
        LAI CONTACT_NONE
fc_found:
        RTN

; ============================================================================
; Page 1: the master loop
; ============================================================================
;
; One pass is one display frame. The board closes a PWM frame when a grid rises
; that has already risen since the last boundary (src/machine/board/display.ts),
; so the frame period is decided here, by how long this loop takes, exactly as it
; is on the real tube.

.PAGE 1
sweep:  LYI 0                   ; Y is the grid index for the whole sweep
sweep_grid:
        ; --- put this grid's plate pattern on the bus ---
        LXI FILE_PLATE0
        LAM
        LRA R_PLATE0
        LXI FILE_PLATE1
        LAM
        LRA R_PLATE1
        LXI FILE_PLATE2
        LAM
        LRA R_PLATE2

        ; --- light the grid; on D0-D6 this also strobes the input matrix ---
        SEDY                    ; D(Y) <- 1
        SED D_INPUT             ; release the read line so the matrix drives it
        TD D_INPUT              ; ST <- 1 when a contact on this line is closed
        LAI 0                   ; does not disturb ST
        BR sweep_hit
        BR sweep_store          ; ST is 1 again after a branch is not taken
sweep_hit:
        LAI 1
sweep_store:
        LXI FILE_INPUT
        XMA                     ; input[line Y] <- A; the old sample is discarded

        ; --- hold it lit, then blank before stepping on ---
        CAL dwell
        REDY                    ; D(Y) <- 0
        IY
        YNEI GRID_COUNT         ; ST <- 0 once Y has passed the last grid
        BR sweep_grid

        ; --- between sweeps: everything that is not the display ---
        CALL input_scan
        CALL render_field
        CALL tick
        BR sweep

; ============================================================================
; Page 2: turn the sampled matrix lines into control positions
; ============================================================================

.PAGE 2
; In:  FILE_INPUT holds one nibble per strobe line, written by the sweep.
; Out: FILE_STATE's lane, skill, fire and fire-previous nibbles.
input_scan:
        ; --- carry last sweep's fire state forward before overwriting it ---
        ; The blip fires on the press, not on the hold, so the edge has to
        ; survive from one sweep to the next.
        LXI FILE_STATE
        LYI NIB_FIRE
        LAM
        LYI NIB_FIRE_PREV
        XMA

        ; --- fire: a momentary contact, read straight off its line ---
        LXI FILE_INPUT
        LYI LINE_FIRE
        LAM
        LXI FILE_STATE
        LYI NIB_FIRE
        XMA

        ; --- lever: lines 1-3 stand for lanes 0-2 ---
        LXI FILE_INPUT
        LYI LINE_LEVER
        LAI LANE_TOP
        CAL find_contact
        ALEI LANE_LAST          ; ST <- 0 when the answer was CONTACT_NONE
        BR input_lever_ok
        BR input_skill
input_lever_ok:
        LXI FILE_STATE
        LYI NIB_LANE
        XMA

        ; --- skill dial: lines 4-6 stand for settings 1-3 ---
input_skill:
        LXI FILE_INPUT
        LYI LINE_SKILL
        LAI SKILL_ONE
        CAL find_contact
        ALEI SKILL_LAST
        BR input_skill_ok
        RTN
input_skill_ok:
        LXI FILE_STATE
        LYI NIB_SKILL
        XMA
        RTN

; ============================================================================
; Page 3: redraw the plate table - the field and the launcher
; ============================================================================
;
; Rendering writes RAM only. Nothing here touches a port: the sweep is the only
; code that drives the tube, so a half-finished redraw can never reach the glass.

.PAGE 3
render_field:
        ; --- clear all three plate files ---
        ; The file number comes out of B, so the assembler's static RAM
        ; high-water mark cannot see these accesses - which is why the RAM_*
        ; constants at the top declare the ceiling explicitly.
        LBI FILE_PLATE2
rf_file:
        LAB
        LXA                     ; X <- the file number in B
        LYI 0
rf_nibble:
        LMIIY 0                 ; M <- 0, Y <- Y + 1, ST <- 1 until Y wraps
        BR rf_nibble
        DB
        BR rf_file

        ; --- the ground line, one lookup per column ---
        LYI 0
rf_ground:
        LAY                     ; A <- the column
        P PAT_GROUND            ; A <- its R0 plates, B <- its R1 plates
        LXI FILE_PLATE0
        XMA
        LAB
        LXI FILE_PLATE1
        XMA
        IY
        YNEI GRID_COUNT
        BR rf_ground

        ; --- the launcher, in whichever lane the lever selects ---
        LXI FILE_STATE
        LYI NIB_LANE
        LAM
        P PAT_LANE              ; A <- the plate bit for that lane
        LXI FILE_PLATE1
        LYI LAUNCH_GRID
        LBM                     ; B <- what the ground pass already put there
        OR                      ; A <- A | B: draw over the field, do not erase it
        XMA

        JMPL render_actors      ; a jump, not a call: the tail returns for us

; ============================================================================
; Page 4: the moving parts
; ============================================================================

.PAGE 4
render_actors:
        ; --- the enemy jet, at the column the tick counter has walked it to ---
        LXI FILE_STATE
        LYI NIB_ENEMY
        LAM
        LYA                     ; Y <- the enemy's column
        LXI FILE_PLATE2
        LBM
        LAI PLATE_ENEMY
        OR
        XMA

        ; --- the missile, drawn while the button is held ---
        LXI FILE_STATE
        LYI NIB_FIRE
        LAM
        ALEI 0                  ; ST <- 1 when the fire nibble is zero
        BR ra_done
        LXI FILE_PLATE2
        LYI MISSILE_GRID
        LBM
        LAI PLATE_MISSILE
        OR
        XMA
ra_done:
        JMPL render_hud

; ============================================================================
; Page 5: the two HUD digits
; ============================================================================
;
; Columns 8 and 9 are not playfield: the ground table leaves them dark and these
; two lookups own them outright, so no OR is needed here.

.PAGE 5
render_hud:
        ; --- shots fired ---
        LXI FILE_STATE
        LYI NIB_SCORE
        LAM
        P PAT_DIGIT             ; A <- segments a-d, B <- segments e-g
        LXI FILE_PLATE0
        LYI SCORE_GRID
        XMA
        LAB
        LXI FILE_PLATE1
        XMA

        ; --- skill dial setting ---
        LXI FILE_STATE
        LYI NIB_SKILL
        LAM
        P PAT_DIGIT
        LXI FILE_PLATE0
        LYI HUD_GRID
        XMA
        LAB
        LXI FILE_PLATE1
        XMA
        RTN

; ============================================================================
; Page 6: one sweep's worth of game state
; ============================================================================

.PAGE 6
tick:   ; --- the sweep counter, which is the only clock the program has ---
        LXI FILE_STATE
        LYI NIB_TICK
        LAM
        AI 1                    ; carry <- 1 when the nibble wrapped
        XMA
        TC                      ; ST <- carry
        BR tk_step
        BR tk_fire

tk_step:
        ; --- the enemy advances one column every sixteen sweeps ---
        ; PROVISIONAL: sixteen sweeps is about a quarter of a second at the
        ; sweep rate above. The real per-skill step rates are unknown until the
        ; gameplay recording exists (docs/evidence/timing-analysis.md).
        LXI FILE_STATE
        LYI NIB_ENEMY
        LAM
        AI 1
        ALEI ENEMY_LAST
        BR tk_store
        LAI 0                   ; off the end of the playfield: come round again
tk_store:
        XMA

tk_fire:
        ; --- fire: act on the press, ignore the hold ---
        LXI FILE_STATE
        LYI NIB_FIRE
        LAM
        ALEI 0
        BR tk_done              ; not pressed
        LYI NIB_FIRE_PREV
        LAM
        ALEI 0
        BR tk_press             ; pressed now, not pressed last sweep: an edge
        BR tk_done              ; still held: no second blip
tk_press:
        JMPL fire_shot
tk_done:
        RTN

; ============================================================================
; Page 7: what a press does
; ============================================================================

.PAGE 7
fire_shot:
        LXI FILE_STATE
        LYI NIB_SCORE
        LAM
        AI 1
        ALEI SCORE_LAST
        BR fs_store
        LAI 0                   ; the HUD digit is one nibble: wrap at ten
fs_store:
        XMA
        JMPL blip               ; tail again: blip's RTN unwinds to tick's caller

; ============================================================================
; Page 8: the blip
; ============================================================================
;
; A burst is sixteen periods; the blip is four bursts. The split exists because
; the period counter lives in B and B is four bits wide, so a burst is as long as
; one register can count - the outer count goes in RAM.

.PAGE 8
blip:   LXI FILE_STATE
        LYI NIB_BLIP
        LAI BLIP_BURSTS
        XMA
bl_burst:
        CALL tone_burst
        LXI FILE_STATE
        LYI NIB_BLIP
        LAM
        AI 15                   ; A - 1; carry <- 1 unless it borrowed
        XMA
        TC
        BR bl_burst
        RTN

; ============================================================================
; Page 9: the tone itself
; ============================================================================
;
; The whole sound system: one pin, toggled in a timed loop. The display is not
; swept while this runs, which is what a machine with one core and no sound
; hardware does - the tube holds its last state for the 41 ms the blip lasts.

.PAGE 9
tone_burst:
        LBI TONE_PERIODS
tb_period:
        SED D_SPEAKER           ; rising edge, timestamped here
        CAL half
        RED D_SPEAKER           ; falling edge
        CAL half
        DB
        BR tb_period
        RTN

; ============================================================================
; Page 10: reset
; ============================================================================

.PAGE 10
main:   ; --- clear every RAM file this program uses ---
        ; RAM comes up undefined on the real device (src/machine/cpu/memory.ts),
        ; so nothing may be read before it is written.
        LBI FILE_INPUT          ; the highest file in use
mn_file:
        LAB
        LXA
        LYI 0
mn_nibble:
        LMIIY 0
        BR mn_nibble
        DB
        BR mn_file

        ; --- the controls the program assumes until the first sweep reports ---
        LXI FILE_STATE
        LYI NIB_LANE
        LAI LANE_CENTRE
        LMAIY                   ; lane, then Y steps on to NIB_SKILL
        LAI SKILL_ONE
        LMAIY

        LXI FILE_STATE
        LYI NIB_ENEMY
        LAI ENEMY_START
        XMA

        ; --- start the timer free running ---
        ; Nothing in the bootstrap reads it. It is started at reset because the
        ; game reads the counter's phase as its randomness source, and a counter
        ; started on first use has no phase to read.
        LPI PRESCALE
        LTI 0
        RECF                    ; timer mode, not event counting
        RETF                    ; clear any stale overflow flag

        SED D_INPUT             ; release the read line before the first strobe
        JMPL sweep

; ============================================================================
; The pattern region
; ============================================================================
;
; 128 ten-bit words above the program, read by `P` rather than executed. Each
; word splits low nibble -> A -> R0 plates, high nibble -> B -> R1 plates.

; --- Lane -> the launcher's plate bit ---------------------------------------
; Lanes sit on plates 4, 5 and 6, which are R1 bits 0, 1 and 2. The value lands
; in A and the caller ORs it into the R1 nibble, so the low nibble carries it.
.PATTERN PAT_LANE
lane_plates:
        .DW $001, $002, $004, $000
        .DW $000, $000, $000, $000
        .DW $000, $000, $000, $000
        .DW $000, $000, $000, $000

; --- Digit -> seven-segment plates ------------------------------------------
; Segments a,b,c,d on plates 0-3 (R0) and e,f,g on plates 4-6 (R1):
;   a=$01 b=$02 c=$04 d=$08 e=$10 f=$20 g=$40
.PATTERN PAT_DIGIT
digit_plates:
        .DW $03F                ; 0: a b c d e f
        .DW $006                ; 1: b c
        .DW $05B                ; 2: a b d e g
        .DW $04F                ; 3: a b c d g
        .DW $066                ; 4: b c f g
        .DW $06D                ; 5: a c d f g
        .DW $07D                ; 6: a c d e f g
        .DW $007                ; 7: a b c
        .DW $07F                ; 8: all seven
        .DW $06F                ; 9: a b c d f g
        .DW $000, $000, $000, $000, $000, $000

; --- Column -> the ground line ----------------------------------------------
; Plate 0 runs under the eight playfield columns. Columns 8 and 9 are the HUD
; and are left dark for the digit lookups to fill.
.PATTERN PAT_GROUND
ground_plates:
        .DW $001, $001, $001, $001
        .DW $001, $001, $001, $001
        .DW $000, $000, $000, $000
        .DW $000, $000, $000, $000

.END
