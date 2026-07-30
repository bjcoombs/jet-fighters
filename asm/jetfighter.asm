; jetfighter.asm - the game ROM the machine runs, in TMS1370 assembly.
;
; Paths in this file are relative to the repository root.
;
; The whole game: the four-pass display sweep, the K input matrix, the R plate
; lines, the R15 speaker, and the rules from docs/prd/jet-fighters-v1.md R2/R6.
; Everything here is meant to be edited, so every routine says what it expects
; in X, Y and A and what it leaves behind, and every constant that has an
; evidence item cites it.
;
; Assemble it:
;   npx vite-node tools/tmsasm/cli.ts asm/jetfighter.asm --listing /tmp/jf.lst
;
; ============================================================================
; What is different about this machine, and what the source has to do about it
; ============================================================================
;
; This is a rewrite and not a port. Five properties of the TMS1370 shape every
; page below, and not one of them is a preference:
;
; 1. **The O port is a 32-entry PLA, not a latch.** `TDO` presents the mask the
;    table in `asm/opla.inc.asm` holds for the five-bit index
;    `status_latch:accumulator`. There is no eight-bit O write and no `CLO`, so
;    blanking the low plates is `TDO` with A = 0 and the latch clear - slot 0.
;    A jet column's O-visible state is 8 x 4 x 3 = 96 masks against 32 slots, so
;    a grid cannot be drawn in one strobe: the sweep draws **one lane family per
;    pass**. docs/research/pla-design.md works that arithmetic; this file spends
;    the table that document designed and does not redesign it.
;
; 2. **The status latch is loaded by exactly one instruction, `YNEA`.** No set
;    and no clear. A bank crossing is `CLA; TCY k; YNEA` and costs three
;    instructions, so the sweep runs both low-bank passes, crosses once, runs
;    both high-bank passes, and crosses back - two crossings a sweep and never
;    one per grid. `YNEA` appears in exactly two places in this file for that
;    reason, and nowhere else may use it: it is not a comparison here, it is the
;    bank select.
;
; 3. **One level of subroutine return.** The return address is one 6-bit SR plus
;    the chapter latch, and the save is guarded by the call latch, so a `CALL`
;    inside a subroutine silently loses the outer return address and fails at
;    some later `RETN`. `tools/tmsasm` rejects it at assembly time. Everything
;    here is therefore a flat main loop of page-to-page branches - the call
;    latch is clear through all of it - plus four leaf routines that call
;    nothing: `strobe`, `note`, `clear_file` and `lane_bit`.
;
; 4. **A branch is conditional only when the test is the instruction before it.**
;    Status is 1 at the start of every instruction and driven to 0 only by a
;    test, so anything between a test and its branch makes the branch
;    unconditional - and it assembles cleanly on real silicon. Three idioms
;    follow and all three are used throughout. A two-armed test is written
;    `<test> / BR true / BR false`, the second branch being unconditional
;    because the first ended the sequence and the scan stops there. A jump that
;    has to carry a page is `LDP page / BR target`, unconditional provided the
;    four instructions behind it do not test - which is why the `LDP` of a
;    *conditional* cross-page branch goes above its test rather than between the
;    test and the branch. Where that cannot be arranged, the jump is written
;    `LDP page / TCY 0 / YNEC 1 / BR target`: a test whose answer is in its own
;    two operands, so the branch is conditional in form and always taken in fact.
;
; 5. **The program counter is a shift register.** A label is an LFSR state and
;    not a position, and straight-line code walks a page in the LFSR's order.
;    The assembler places the words; what this file has to respect is that flow
;    **wraps within a page** rather than running on into the next one, so every
;    page ends with a branch that goes somewhere.
;
; And one that is not the CPU's. `SETR` and `RSTR` index the R latch as
; `BIT(X, 2) << 4 | Y`, so **X must be below 4 whenever an R line moves**. With
; X >= 4 the write addresses R16-R31, which do not exist: the intended line
; never moves and nothing reports it. That is why the four display files are
; files 0-3 rather than any other four, and why the speaker's parameters live in
; file 0 beside them - the sweep, the input strobes and every sound edge write R
; lines, and every one of them does it with a display file selected.
;
; ============================================================================
; The sweep, in one picture
; ============================================================================
;
;   pass 1  near   plates 0-2   grids 0-5   6 strobes   latch clear
;   pass 2  far    plates 3-5   grids 0-6   7 strobes   latch clear
;   pass R  plates 8-11 on R11-R14, O dark, latch clear
;   ---- CLA / TCY 1 / YNEA : the latch takes 1 ----
;   pass 3  pair   plates 6-7   grids 0-8   9 strobes   latch set
;   pass 4  digit  plates 0-6   grids 7-8   2 strobes   latch set
;   ---- CLA / TCY 0 / YNEA : the latch takes 0 ----
;
; 24 O strobes and two crossings, which is exactly the 54-instruction selection
; bound docs/research/pla-design.md states: two instructions a strobe - `TMA`
; from the nibble the render step maintains for this grid and this pass, then
; `TDO` - and three a crossing. No term depends on the game state, on how much
; is on the tube or on the dial, because there is no search, no decode loop and
; no table walk anywhere in the path.
;
; **What the R-plate pass costs, and the one fidelity this program trades.**
; Plates 8-11 are R lines and stay where they are put, so they are not a fifth
; O pass; they are a walk over the grids that holds one line high across one
; grid's dwell. A grid's R-plate nibble names **one** line rather than carrying
; a bitmap of four, and that is a deliberate limit rather than an oversight: a
; bitmap needs `TBIT1`, whose bit index is a literal, so four unrolled sub-walks
; with their own Y bookkeeping - about ninety words and up to 180 instructions a
; sweep against this loop's thirty-five and seventy. The cost is that a grid
; wanting two of plates 8-11 in the same sweep shows the later one only. Two
; cases can reach it and both are transient: an explosion on the player's grid
; while the lever is in lane 2 (plate 8 is `launcher_lane2` and plates 9-11 the
; explosion), and a jet-kill burst in the same column as a lane-2 missile. Every
; (grid, plate) the atlas defines is still driven - conformance is over pairs,
; not over simultaneity - and the burst is what wins, which is the right way
; round for a flash that lasts 210 ms.

.INCLUDE "opla.inc.asm"

; ============================================================================
; Hardware map - src/machine/cpu/tms1370/ports.ts
; ============================================================================
;
; R0-R8   the nine VFD grids            R9, R10  the two input strobe columns
; R11-R14 plates 8-11                   R15      the speaker
; O0-O7   plates 0-7, through the PLA   K1,K2,K4 strobed returns; K8 unstrobed

.EQU GRID_BSHIP,     0          ; battleship, sea, battleship burst
.EQU GRID_COL_FIRST, 1          ; the five playfield columns are grids 1-5, and
.EQU GRID_COL_LAST,  5          ;   grid 1 is the far end, beside the horizon
.EQU GRID_PLAYER,    6          ; launcher, capture burst, explosion
.EQU GRID_SC_T,      7          ; score tens digit, hundreds indicator
.EQU GRID_SC_U,      8          ; score units digit, SCORE label

.EQU R_STROBE_SKILL, 9          ; drive R9 to read the skill dial on K1/K2/K4
.EQU R_STROBE_LEVER, 10         ; drive R10 to read the lever on K1/K2/K4
.EQU R_PLATE_FIRST,  11         ; R11 is plate 8; R11-R14 are plates 8-11. Spent
                                ; as the `A10AAC` in sweep_rplate, for the
                                ; reason the thresholds below are: an addend is
                                ; part of its mnemonic and cannot be a name
.EQU R_SPEAKER,      15

.EQU K_BIT_FIRE,     3          ; K8, the fire contact, live on every K read

; ============================================================================
; RAM map - 7 files of 16 nibbles, 112 of the device's 128
; ============================================================================
;
; Files 0-3 are the display, and they are the low four files for the reason the
; header gives rather than by taste: every `SETR` and `RSTR` in this program
; runs with one of them selected. The sound parameters sit in file 0's tail for
; the same reason - `note` toggles R15 between its delays.

.EQU FILE_D0,        0          ; near values, grids 0-5, then the sound state
.EQU FILE_D1,        1          ; far values, grids 0-6
.EQU FILE_D2,        2          ; pair values, grids 0-8
.EQU FILE_D3,        3          ; R-plate codes, the two digits, render scratch
.EQU FILE_STATE,     4          ; the entities
.EQU FILE_TIME,      5          ; countdowns and the score
.EQU FILE_JETS,      6          ; one jet per lane, and the squadron's own state

; --- FILE_D0: the near pass's nibbles, then the sound ------------------------
;
; Nibbles 0-5 hold what the near pass hands `TDO` for grids 0-5: OPLA_A_NEAR
; plus a three-bit lane bitmap, which on this table *is* the bitmap. The low
; bits of a low-bank index are the lane map itself, so a routine that has worked
; out which lanes are lit has already worked out the index and there is no
; lookup anywhere in the display path.

.EQU NIB_HALF_O,     6          ; note: half-period outer count
.EQU NIB_HALF_I,     7          ;       half-period inner count
.EQU NIB_PER,        8          ;       periods per burst, minus one
.EQU NIB_BURSTS,     9          ;       bursts in the note, minus one
.EQU NIB_PLEFT,     10          ;       periods left in this burst
.EQU NIB_BLEFT,     11          ;       bursts left in this note
.EQU NIB_BUZZ,      12          ; buzz: O strobes to the next edge, 0 = not running
.EQU NIB_BPHASE,    13          ;       the square's phase, in bit 0
.EQU NIB_KSCR,      14          ; the K sample being decoded
.EQU NIB_SGRID,     15          ; `strobe`'s parked grid - see that routine

; --- FILE_D1, FILE_D2: the far and pair passes -------------------------------
;
; Nibbles 0-6 and 0-8. A far value is OPLA_A_FAR plus a bitmap of plates 3-5, a
; pair value OPLA_A_PAIR plus a bitmap of plates 6-7. Both blank to their own
; group's empty subset and not to zero, because zero is the *near* group's empty
; subset and writing it here would light plates 0-2 under every grid.

; --- FILE_D3: the R plates, the digits, and the render's scratch -------------
;
; Nibbles 0-6 name one R plate line each for grids 0-6: 0 for none, then 1 to 4
; for R11 to R14. Grids 7 and 8 have no R plates - the score block is plates 0-7
; - so their nibbles carry the two decoded digits instead, which is what the
; digit pass reads with `TMA` and hands straight to `TDO`.

.EQU NIB_DIG_T,      7          ; tens digit, 0-9, or OPLA_A_DIGIT_BLANK
.EQU NIB_DIG_U,      8          ; units digit, 0-9
.EQU RPL_R11,        1          ; the code that names plate 8
.EQU RPL_BURST,      2          ; +lane: plates 9-11, the burst and the explosion
.EQU NIB_RGRID,     10          ; render scratch: the grid being drawn into
.EQU NIB_RBIT,      11          ;                 the lane bit being drawn
.EQU NIB_RLNE,      12          ;                 the lane `lane_bit` converts

; --- FILE_STATE: the entities ------------------------------------------------
;
; A column value is the grid the actor stands on, 1 to 5, with 0 for "not in
; flight" - the same convention for the jets, the rocket and the player's
; missile, so one `MNEZ` spells "is there one" for all three.

.EQU NIB_LANE,       0          ; lever lane, 0 top .. 2 bottom
.EQU NIB_LANEB,      1          ; the same lane as a one-bit map, 1/2/4
.EQU NIB_SKILL,      2          ; skill dial, 1..3
.EQU NIB_FIRE,       3          ; fire contact this sweep
.EQU NIB_FIREP,      4          ; fire contact last sweep - firing is edge triggered
.EQU NIB_MCOL,       5          ; player missile grid, 0 = none in flight
.EQU NIB_MLANE,      6          ; player missile lane
.EQU NIB_RCOL,       7          ; jet rocket grid, 0 = none in flight
.EQU NIB_RLANE,      8          ; jet rocket lane
.EQU NIB_BSLANE,     9          ; battleship lane, or BS_NONE when not crossing
.EQU NIB_HITS,      10          ; launchers destroyed so far, 0..3
.EQU NIB_STATE,     11          ; ST_PLAY / ST_OVER / ST_WIN
.EQU NIB_KILLS,     12          ; jets shot down in this wave, 0..6
.EQU NIB_ROTOR,     13          ; which lane fires the next rocket - see rocket_fire
.EQU NIB_KCOL,      14          ; burst cell: the grid it stands on plus one
.EQU NIB_KLANE,     15          ; the lane that burst is in

; --- FILE_TIME: countdowns and the score -------------------------------------
;
; A countdown longer than fifteen sweeps is a low/high nibble pair holding
; `high * 16 + low`, spent low first. The battleship's gap is longer than a pair
; can express at all, so it counts sixteen-sweep units instead - see NIB_BS_LO.

.EQU NIB_TICK,       0          ; sweeps, wrapping every sixteen. The only clock.
.EQU NIB_ENTRY_LO,   1          ; sweeps until the next jet is released, low
.EQU NIB_ENTRY_HI,   2          ;   "                                   high
.EQU NIB_MSTEP,      3          ; sweeps until the player's missile advances
.EQU NIB_RSTEP,      4          ; sweeps until the jet's rocket advances
.EQU NIB_KSTEP,      5          ; sweeps the burst stays on the glass
.EQU NIB_ROCK_LO,    6          ; sweeps to the next rocket launch, low
.EQU NIB_ROCK_HI,    7          ;   "                              high
.EQU NIB_BS_LO,      8          ; battleship countdown, low - see BSHIP_GAP_HI
.EQU NIB_BS_HI,      9          ;   "                    high
.EQU NIB_SC_U,      10          ; score, BCD units
.EQU NIB_SC_T,      11          ; score, BCD tens
.EQU NIB_SC_H,      12          ; score, BCD hundreds
.EQU NIB_STEP_LO,   13          ; sweeps to the squadron's next step, low
.EQU NIB_STEP_HI,   14          ;   "                                high
.EQU NIB_CAPTURE,   15          ; sweeps the capture burst stays lit

; --- FILE_JETS: one jet per lane, and the squadron's own state ---------------
;
; Not a rank in every lane and not a block: a wave is six jets released into
; free lanes one at a time, and each stands where its nibble says.
; assets/reference/device-front-gameplay.jpg is what that is read off - two jets
; airborne, in different lanes, at different distances.
;
; The march itself is one squadron-wide countdown rather than three. That is
; what the only measured figure here supports: the march beep's onsets run at
; 205 ms (n = 21, sd 22 ms) in assets/reference/gameplay-audio.m4a, which is a
; *squadron* step rate. Jets at different distances come from staggered entry,
; which is what the photograph actually shows; three independent countdowns
; would produce the same picture and would additionally produce a beep rate no
; recording supports.

.EQU NIB_J_LANE0,    0          ; lane 0's jet: the grid it stands on, 0 = empty
.EQU NIB_J_SENT,     3          ; jets of this wave released so far, 0..6
.EQU NIB_J_ROTOR,    4          ; the lane the next entry tries first
.EQU NIB_J_WORK,     5          ; the lane a loop is working on
.EQU NIB_J_MOVED,    7          ; set when a jet stepped this sweep
.EQU NIB_J_TMP,      8          ; arithmetic scratch
.EQU NIB_J_SCR,      9          ; arithmetic scratch

; ============================================================================
; Values
; ============================================================================

.EQU LANE_COUNT,     3          ; three lanes, 0..2
.EQU BS_NONE,       15          ; NIB_BSLANE when no crossing is in progress
;
; The next two are thresholds rather than operands, and they read as unused
; because of how a threshold is tested here. There is no compare-against-a-
; constant instruction: "A >= n" is `A(16-n)AAC` and a read of the carry, so
; JET_COUNT is spent as the `A10AAC` in jet_release and HITS_LAST as the
; `A13AAC` in launcher_down. The addend is part of the mnemonic, so the name
; cannot appear in the operand and has to appear in the comment beside it.
.EQU JET_COUNT,      6          ; a squadron: six jets, released a few at a time
.EQU HITS_LAST,      3          ; three launchers; the third loss ends the game
.EQU ST_PLAY,        0
.EQU ST_OVER,        1
.EQU ST_WIN,         2

; --- what a jet is worth, and where the three numbers come from --------------
;
; The overlay silkscreens a scoring ruler - `10 / 3 / 2 / 1 / G` - and these are
; it. A jet scores by the column it stood in when the missile reached it, which
; `score_jet` reads out of NIB_KCOL.
;
; **The derivation, from the ink rather than from taste.**
; src/machine/tube/layout.ts registered the ruler photographically against both
; lit close-ups, correcting the keystone by locating the printed frame rails at
; two rows apiece and interpolating to the ruler's own row. Three things come out
; of that registration and none of them was assumed:
;
;   - The field is seven cells (COLUMN_COUNT), counted off the unlit-tube
;     teardown photo: cell 0 the battleship over printed sea, cells 1-5 the jet
;     columns, cell 6 the player's end at the G line. Those are grids 0-5 here.
;   - The ruler runs on its *own* pitch, not the cell pitch: seven ticks across
;     seven and a half tick-pitches of field width. So tick k sits k * 0.9333
;     cells right of the left crosshair, and floor(0.9333k) = k-1 for k = 1..7 -
;     every tick lands in its own cell, one cell per tick, in order.
;   - Each numeral's bracket drops on a tick: 10 on tick 1, 3 on tick 2, 2 on
;     tick 3, 1 on tick 4, G on tick 6. Ticks 5 and 7 carry no label.
;
; A raw pixel scan of assets/reference/screen-overlay-closeup.jpg agrees: left
; crosshair at x=507, separator ticks at 596 / 684 / 769 / 856 / 944, right
; crosshair at 1156 - even spacing near 88 px across a 648 px span - with the
; bracket verticals of 3, 2 and 1 at 684 / 770 / 856 and G's at 1030.
;
; The cross-check that the registration is the right one: cell centres computed
; from layout.ts land at 111.4 / 142.5 / 173.6 / 204.7 / 235.9 / 267.0 / 298.1
; atlas units, against measured atlas sprite centres of 113.0 for the battleship,
; 139.8 / 170.7 / 201.2 / 232.3 / 263.1 for jets 1-5 and 307.3 for the launcher.
; One unit of agreement in a 31-unit cell.
;
; So the labelled band [tick k-1, tick k] is 79-100% covered by cell k-1:
;
;   ruler `10` -> cell 0, the battleship's own cell, which carries no jet column
;   ruler `3`  -> cell 1 = grid 1, the far end beside the horizon
;   ruler `2`  -> cell 2 = grid 2
;   ruler `1`  -> cell 3 = grid 3
;   ruler `G`  -> cell 6, the launcher's cell - the capture line, not a score
;
; **`10` is the boat's tick, not a jet value.** It drops wholly inside cell 0,
; where no jet ever stands, and the battleship-kill burst is the only thing seen
; there (sprites/README.md: it occurs only at u 0.27, the boat's own position).
;
; **`G` is the capture line.** Its bracket is *mirrored* - the vertical drops on
; tick 6 and the horizontal runs right to the letter, where 10/3/2/1 all put the
; numeral to the left of their drop - so G labels the band to the *right* of tick
; 6, which is cell 6, the launcher's. Measured launcher u = 6.190, sd 0.059.
;
; **Grids 4 and 5 are a clamp, and are written here as a clamp rather than
; dressed up as a reading.** The ruler names no value past `1`; grids 4 and 5
; carry bare ticks. They cannot be worth more than grid 3 - the ink is monotone,
; farther is more - and a kill worth nothing is not a reading anyone has
; proposed, so the last named band extends to G. That is an inference from two
; constraints, not a fourth numeral on the overlay.
.EQU SCORE_JET,      1          ; the near bands: grids 3, 4 and 5
.EQU SCORE_JET_MID,  2          ; ruler `2`: grid 2
.EQU SCORE_JET_FAR,  3          ; ruler `3`: grid 1, the far end
;
; **This overturns a committed prohibition, by testimony and not by measurement.
; Say so plainly, because the next reader needs to see which kind of evidence
; moved it.**
;
; Until now this was a flat `SCORE_JET, 1`, and that was a reasonable conclusion
; from the evidence then available rather than an oversight. The superseded note
; read, and it is kept here because a deleted rule gets reinvented:
;
;   > MEASURED. assets/reference/sprites/README.md reads the score off the
;   > gameplay video across the cell-0 burst at frames 6134-6159: 28 at frame
;   > 6106 and 38 at frame 6162, "exactly +10 across it", with the three jet-kill
;   > bursts that follow accounting for a further +3 by frame 6234 - a jet at one
;   > point and the boat at ten, in the same seven seconds of one recording. PRD
;   > v1 R4 says the same.
;
; That section of sprites/README.md went further and forbade this change: "Until
; then, no distance-dependent jet score should be built into the ROM." Three
; things lifted it, in descending order of weight:
;
;   1. **The owner, playing the physical unit, confirms that farther kills score
;      more.** Asked directly, with the prohibition and the re-reading below both
;      put in front of him. He has the machine; this ROM is a reconstruction.
;      This is testimony, and it is what actually settles it.
;   2. One of the three burst episodes the +1-per-kill count rests on is a
;      probable double-detection - four frames against a 19-frame median, at the
;      same cell and lane as an episode that ended seven frames earlier, starting
;      on the same frame as the cell-3 burst. On the two-kill reading the window
;      holds kills at cell 2 and cell 3, and 2 + 1 = 3 is exactly the digits that
;      were read. See sprites/README.md, which now records this.
;   3. The one unambiguously isolated kill in the recording - cell 3, score 41 at
;      frame 6290 to 42 at frame 6400 - pays +1, which is what the table above
;      says cell 3 pays. It does not discriminate between the two readings, but
;      it corroborates one row of the table directly.
;
; Point 2 is a re-reading of someone else's detection output, not a fresh
; measurement, and the video is not in the tree to re-derive it from. If the
; score is ever decoded on every frame, that is the measurement that would
; settle this properly, and it should be run against the table above.
;
; tools/probe/scoring-ruler.test.ts asserts the table from the outside.
;
; Like JET_COUNT and HITS_LAST above, the name cannot appear in an operand. Ten
; does not fit the units path: `add_score` sums the points into NIB_SC_U with a
; four-bit `AMAAC`, and ten plus a units digit of nine is nineteen, which wraps
; the nibble before the BCD correction ever runs. Ten points *is* one on the tens
; digit, so `score_bship` spends this constant as an `IMAC` on NIB_SC_T and joins
; `add_score` at its carry arm.
.EQU SCORE_BSHIP,   10          ; points for the battleship

; ============================================================================
; Timing, and why every figure here is a division rather than a number
; ============================================================================
;
; INSTRUCTION-RATE PROVISIONAL. Every wall-clock figure below is computed from
; `src/machine/cpu/tms1370/timing.ts`'s CYCLE_HZ, which is MAME's fitted
; RC-oscillator approximation OSCILLATOR_HZ = 350 kHz divided by the
; architectural CLOCK_DIVIDER = 6, so **58333 instruction cycles a second**.
; That figure carries MAME's own stated +/-50 kHz spread, so the honest range is
; 50000 to 66667 cycles a second and 58333 is the midpoint of it, never a
; threshold. docs/research/mp2110-timing-measurement.md records the four-step
; non-circular route that would replace it with a measurement of the owner's
; own unit; until then every constant in this section is provisional in exactly
; that one way and says so.
;
; One instruction is one cycle on this family, so a sweep's period is however
; many instructions the sweep loop executed. This program has no dwell loop at
; all - a grid is lit for the work `strobe` does while it is lit - so the sweep
; period *is* the program's own cost, and that cost depends on what is on the
; glass: the buzz ticks in every strobe while the boat is up and the R-plate
; walk only visits grids that want a line. SWEEP_INSTRUCTIONS is therefore
; **measured off the running machine** by tools/probe/tms1370-probe.ts rather
; than counted off this source:
;
;   SWEEP_HZ = CYCLE_HZ / SWEEP_INSTRUCTIONS = 58333 / 889 = 65.6 Hz
;
; **It is not tuned to an interval, and that is a decision rather than a miss.**
; docs/evidence/vfd-appearance.md section 2 leaves 70.6-72.5 Hz open: the
; reference video's 10.6-12.5 Hz beat against a 30 fps camera admits only
; disjoint refresh intervals and that is one of them. v2 reached it by tuning a
; dwell loop, and doing the same here would be false precision, because
; OSCILLATOR_HZ's stated +/-50 kHz puts this same 889-instruction sweep anywhere
; from 56.2 Hz to 75.0 Hz depending on the unit - a range that contains the
; video's interval whole. Tuning the instruction count so the *midpoint* landed
; at 71.5 Hz would be tuning to the one number the contract says must appear
; nowhere as a threshold. What pins the refresh is measuring the oscillator, not
; moving this constant.
;
; The sweep is not frequency-stable either, and is not meant to be. Measured off
; this ROM over 30 s of emulated time: 65.6 Hz median with nothing on the tube,
; 65.6 Hz on a lever-only game and 65.3 Hz on a played one - and 60.5, 60.7 and
; 60.2 Hz as *means*, once the sweeps a sound blanked are counted in. Quoting one
; of those without saying which population it came from is what would make this
; look tuned to two decimal places. `src/machine/board/tms1370-cadence.ts`
; derives the probe side's horizons from the same figure, and a test asserts the
; two agree, so they cannot drift.

.EQU SWEEP_INSTRUCTIONS_LO,  9  ; SWEEP_INSTRUCTIONS = 889, written as two
.EQU SWEEP_INSTRUCTIONS_HI, 55  ; nibbles because every operand field on this
                                ; machine is four bits wide: 55 * 16 + 9.
                                ; Nothing reads these two. They are the sweep
                                ; length every cadence constant below converts
                                ; through, written down beside them rather than
                                ; left in a comment.

; --- The battleship's buzz ---------------------------------------------------
;
; MEASURED, docs/evidence/audio-reference.md, battleshipBuzz: a 93.4 Hz
; repetition rate wandering between 79 and 111 Hz within a single arrival,
; continuous for about 4.0 s. The wander is the evidence for the mechanism
; rather than noise on top of it - it moves the same way in both arrivals,
; starting near 100-106 Hz and drifting to 80-88 - and that is what a buzz
; clocked off a display sweep does and what a delay-loop tone cannot do.
;
; So the buzz is clocked by the sweep, one tick per O strobe inside `strobe`:
;
;   f = 24 strobes * SWEEP_HZ / (2 * BUZZ_DIV) = 24 * 72.4 / 18 = 96.5 Hz
;
; inside the measured band. It never blanks the tube, which is the property the
; four-second figure forces: `note` does not strobe the grids, and four seconds
; of a dark display cannot be right for a boat the player is meant to shoot at.
.EQU BUZZ_DIV,       8          ; O strobes between speaker edges

; --- Travel ------------------------------------------------------------------
;
; PROVISIONAL. v1 moved both a missile and a rocket one column per 60 Hz tick;
; T7 and T8 of docs/evidence/timing-analysis.md are unmeasured. The two are
; deliberately different. The rocket is the one shot the player has to *respond*
; to - the only defence is to move the lever out of its lane before it lands -
; so its flight is the game's reaction window, and 7 sweeps is 97 ms a column,
; putting a mid-board flight inside the 300-500 ms a see-decide-move response
; costs. The player's missile keeps the fast figure because nothing is dodged in
; response to it and slowing it would only take time away from the player.
.EQU MISSILE_SWEEPS, 2          ; 28 ms a column
.EQU ROCKET_SWEEPS,  7          ; 97 ms a column

; --- The squadron's march ----------------------------------------------------
;
; DERIVED from the one measurement this cadence has: the march beep's onsets in
; assets/reference/gameplay-audio.m4a run at 205 ms (n = 21 intervals inside
; five uninterrupted runs, sd 22 ms). That is a squadron step rate, so it bounds
; the *floor* of the ladder - the unit was never observed to step faster - and
; it does not fix any other rung.
;
;   STEP_HI = STEP_HI_MAX - kills - STEP_SKILL * (skill - 1), floored
;
; and a step is STEP_HI * 16 + STEP_LO + 1 sweeps. The low nibble is reloaded to
; 15 and spent first, and the step falls on the sweep *after* the pair reaches
; zero, so a rung is (STEP_HI + 1) * 16 sweeps and not STEP_HI * 16 -
; `tools/probe/battleship-arrival.test.ts` already carries the same correction
; for the battleship's pair. Skill 1 with a full squadron is 160 sweeps and the
; floor is 32. Thinning the squadron walks it down six rungs and the dial
; another four, so both terms matter and neither can pin it on its own.
;
; **The rungs do not bracket the measurement, and the constants below are
; deliberately left as they are.** At the measured sweep of 15.24 ms
; (SWEEP_INSTRUCTIONS = 889 over the provisional CYCLE_HZ - see
; `docs/research/mp2110-timing-measurement.md` before treating any ms figure
; here as settled) the top rung is 2438 ms against the ~2040 ms slowest march
; the evidence gives, and the floor is 488 ms against the 205 ms the unit was
; never observed to beat. The figures this replaces - "144 sweeps = 1989 ms" and
; "16 sweeps = 221 ms" - dropped the low nibble *and* converted at 13.81 ms a
; sweep, which is not this machine's sweep; the two errors partly cancelled and
; the ladder read as though it sat inside the evidence. Moving STEP_HI_MAX or
; STEP_HI_MIN is a gameplay change and belongs to whoever owns the cadence
; ladder, not to the control-flow fix that surfaced the arithmetic.
.EQU STEP_HI_MAX,    9          ; skill 1, full squadron: 160 sweeps, 2438 ms
.EQU STEP_HI_MIN,    1          ; the floor: 32 sweeps, 488 ms
.EQU STEP_SKILL,     2          ; rungs the dial is worth, per notch

; --- Releasing the squadron --------------------------------------------------
;
; PROVISIONAL. Six jets a wave, at most three airborne because there are three
; lanes, released one at a time into whichever lane is free.
.EQU ENTRY_HI,       3          ; 48 sweeps, 663 ms, between releases

; --- The rocket the jets fire ------------------------------------------------
;
; PROVISIONAL. Counted in sixteen-sweep units, like the battleship's gap, because
; a low/high nibble pair tops out at 255 sweeps and a rocket every three seconds
; at the easiest setting is not a game. The interval is
; (ROCK_HI_BASE - (skill - 1)) * 16 units of 16 sweeps, so skill 1 is 768 sweeps
; and skill 3 is 256 - about 10 s and 3.5 s at the rate the sweep actually runs.
; A rocket only launches if a jet is airborne in the lane the rotor lands on, so
; the effective rate is lower again early in a wave.
.EQU ROCK_HI_BASE,   3

; --- The battleship ----------------------------------------------------------
;
; MEASURED off the owner's unit for the two intervals, and off *this* machine
; for the sweep counts that reproduce them. This is the one block here that
; rests on no inference at all:
; docs/evidence/audio-reference.md, battleshipBuzz. The owner recorded his own
; unit in a quiet room - "the boat appears for 4s then disappears if you haven't
; hit it" - and the two clips are one take trimmed twice, so this is a sample of
; **one interval** rather than two.
;
;   appearance  4.05 s and 3.80 s   -> three lane steps of 65 sweeps = 3.9 s
;   interval    19.80 s onset to onset, stable to 0.05 s across three thresholds
;
; The gap is the interval minus the appearance, 15.8 s, which overflows a
; low/high nibble pair at any plausible sweep rate. It is counted in
; sixteen-sweep units instead - 49 of them, 784 sweeps - which is what
; NIB_BS_LO and NIB_BS_HI hold while NIB_BSLANE is BS_NONE.
;
; The gameplay video says one crossing every 51 s and the disagreement is a
; factor of 2.6. The recording is preferred, for reasons rather than by
; default: it measures the machine's own sound directly against a detector with
; controls in the same file, while the video's count is an inference from a
; detection pass whose own lane split is 8 / 2 / 7 and which therefore demonstrably
; drops episodes. But n = 1, and two minutes of the unit recorded the way these
; clips were, counting arrivals rather than timing one gap, is what would settle it.
.EQU BSHIP_STEP_LO,  0          ; a lane step is BSHIP_STEP_HI * 16 + LO + 1 =
.EQU BSHIP_STEP_HI,  4          ;   65 sweeps; three of them is 3.9 s MEASURED
                                ;   off the running machine by tools/probe/
                                ;   tms1370-probe.ts, because a sweep with the
                                ;   boat on the glass is longer than an idle one
                                ;   - the buzz ticks in every strobe - and the
                                ;   nominal arithmetic would run 50% short
.EQU BSHIP_GAP_LO,  13          ; the steady gap: 3 * 16 + 13 + 1 = 62 units of
.EQU BSHIP_GAP_HI,   3          ;   sixteen sweeps = 992 sweeps. MEASURED off
                                ;   the running machine at 19.7 s onset to onset
                                ;   against the recording's 19.80 s: the gap
                                ;   runs while the boat is away and the
                                ;   appearance is the rest of the interval. A
                                ;   sweep during a played game costs half as
                                ;   much again as an idle one once the sounds
                                ;   that blank it are counted, so the nominal
                                ;   arithmetic cannot set this figure.
.EQU BSHIP_OPEN_LO,  1          ; and the first crossing after power-on: 33
.EQU BSHIP_OPEN_HI,  2          ;   units = 528 sweeps = 8.8 s. The owner's
                                ;   complaint was that the boat comes too often
                                ;   and never that it comes too soon, and a game
                                ;   shorter than one interval should still show
                                ;   it once.

; --- Bursts ------------------------------------------------------------------
;
; PROVISIONAL, and the only figure this ROM has ever had for either. The
; gameplay video shows a jet-kill burst caught in several consecutive frames
; alongside a separately visible missile, so it outlives the sweep that made it
; by a clear margin rather than flashing for one. Fifteen sweeps is 207 ms and
; is also the longest a nibble can express.
.EQU BURST_SWEEPS,  15
.EQU CAPTURE_SWEEPS, 15         ; the capture burst on the player's own grid

; ============================================================================
; The sounds
; ============================================================================
;
; Every one is a square wave on R15 built by `note` out of four nibbles, and
; every one cites its row in docs/evidence/audio-reference.md, per PRD R7. The
; frequency a recipe produces is
;
;   f = CYCLE_HZ / (2 * D + 9),  D = (HALF_O + 1) * (2 * HALF_I + 6) + 2
;
; and its length is (PER + 1) * (BURSTS + 1) periods of it. The `+ 9` and the
; `+ 6` are `note`'s own instruction counts. They are **counted off the running
; machine** by tools/probe/tms1370-probe.ts rather than off the source: the
; first draft of this block counted seven for the outer term by reading the
; loop, put the fire blip at 1423 Hz against a measured band of 1480-1632, and
; assembled and sounded perfectly plausible. The frequency each recipe actually
; reaches is written beside it, against the measured figure it targets, and
; tools/probe/tms1370-sound.test.ts asserts each one lands in its band.
;
; missileFire - 1480-1632 Hz measured, ~20 ms, and owner-confirmed to be the
; same beep a missile makes when it *hits*, so one recipe covers both events.
.EQU SND_FIRE_O,     0          ; D = 14, f = 58333/37 = 1577 Hz
.EQU SND_FIRE_I,     3
.EQU SND_FIRE_P,    14          ; 15 x 2 = 30 periods = 19.0 ms
.EQU SND_FIRE_B,     1

; jetMarch - 600-650 Hz measured, ~70 ms a step.
.EQU SND_MARCH_O,    1          ; D = 42, f = 58333/93 = 627 Hz
.EQU SND_MARCH_I,    7
.EQU SND_MARCH_P,   14          ; 15 x 3 = 45 periods = 71.8 ms
.EQU SND_MARCH_B,    2

; launcherHitWarning - 455-545 Hz measured, ~10 ms a beep with 25-28 ms gaps.
; Two beeps on the first hit and three on the second, both owner-confirmed; the
; third hit plays the loss sound instead of a warning.
.EQU SND_WARN_O,     1          ; D = 58, f = 58333/125 = 467 Hz
.EQU SND_WARN_I,    11
.EQU SND_WARN_P,     4          ; 5 periods = 10.7 ms
.EQU SND_WARN_B,     0

; win - 750 / 937 / 1248 Hz and a resolution of 1868, ~1.88 s: three arpeggios
; and a sustain. Every figure is the spacing of its own partial series, taken
; from gameplay-audio.m4a; the note names in that document are labels applied
; afterwards, so these target the measured fundamentals and not the tempered
; pitches.
;
; **The resolution is an octave above the middle note, not equal to it.** It read
; as 940 until the tail was analysed in its own right - see audio-reference.md,
; "The resolution was never measured" - and playing the middle note again is what
; the owner heard and reported as wrong.
.EQU SND_WIN1_O,     0          ; D = 34, f = 58333/77  = 758 Hz  (750 measured)
.EQU SND_WIN1_I,    13
.EQU SND_WIN1_P,    15          ; 16 x 9 = 144 periods = 190 ms
.EQU SND_WIN1_B,     8
.EQU SND_WIN2_O,     0          ; D = 26, f = 58333/61  = 956 Hz  (937 measured)
.EQU SND_WIN2_I,     9
.EQU SND_WIN2_P,    15          ; 16 x 9 = 144 periods = 151 ms
.EQU SND_WIN2_B,     8
.EQU SND_WIN3_O,     0          ; D = 20, f = 58333/49  = 1190 Hz (1248 measured)
.EQU SND_WIN3_I,     6          ; 1296 is nearer on pitch and wrong on interval -
.EQU SND_WIN3_P,    15          ; 16 x 11 = 176 periods = 148 ms
.EQU SND_WIN3_B,    10          ; see win-jingle.test.ts ARPEGGIO_TOLERANCE.
; The resolution. 1768 is the closest this note generator reaches to the measured
; 1868 - the neighbours are 1768 (5.4% low) and 2012 (7.7% high), a 13.8% step -
; and at that pitch one `note` call is 256 periods of 0.57 ms, or 145 ms, which
; would make the resolution *shorter* than an arpeggio note. So it is called
; twice: 512 periods, 290 ms, against the measured 349. Three arpeggios and the
; jingle is 1757 ms against the measured 1880.
.EQU SND_WINE_O,     0          ; D = 12, f = 58333/33  = 1768 Hz (1868 measured)
.EQU SND_WINE_I,     2
.EQU SND_WINE_P,    15          ; 16 x 16 = 256 periods a call, called twice
.EQU SND_WINE_B,    15

; gameOver - a brief 455-545 Hz transient collapsing to an 80-97 Hz buzz, then a
; 200-280 Hz rasp decaying to a ~147 Hz floor; five notes, 660 ms of tone. The
; collapse band is what tells this sound from the battleship's buzz on any
; silicon, which is why the two are reached by deliberately different mechanisms
; - this one blanks the tube and the buzz never does.
.EQU SND_LOSS1_O,    1          ; 467 Hz - the same pitch as the warning beep
.EQU SND_LOSS1_I,   11
.EQU SND_LOSS1_P,   11          ; 12 periods = 25.7 ms
.EQU SND_LOSS1_B,    0
.EQU SND_LOSS2_O,   12          ; D = 314, f = 58333/637 = 91.6 Hz (96 measured)
.EQU SND_LOSS2_I,    9
.EQU SND_LOSS2_P,    3          ; 4 periods = 43.7 ms
.EQU SND_LOSS2_B,    0
.EQU SND_LOSS3_O,    3          ; D = 114, f = 58333/237 = 246 Hz (240 measured)
.EQU SND_LOSS3_I,   11
.EQU SND_LOSS3_P,   14          ; 15 x 3 = 45 periods = 183 ms
.EQU SND_LOSS3_B,    2
.EQU SND_LOSS4_O,    4          ; D = 142, f = 58333/293 = 199 Hz (196 measured)
.EQU SND_LOSS4_I,   11
.EQU SND_LOSS4_P,   10          ; 11 x 3 = 33 periods = 166 ms
.EQU SND_LOSS4_B,    2
.EQU SND_LOSS5_O,    6          ; D = 198, f = 58333/405 = 144 Hz (147 measured)
.EQU SND_LOSS5_I,   11
.EQU SND_LOSS5_P,   11          ; 12 x 3 = 36 periods = 250 ms
.EQU SND_LOSS5_B,    2

; The gap between warning beeps: 25-28 ms MEASURED. `warn_gap` is the same
; nested shape `note` uses with the speaker left alone, so the arithmetic is the
; same: (WARN_GAP + 1) * (2 * 15 + 6) + 2 = 398 cycles a pass, and
; (WARN_GAP_PASSES + 1) passes is 1592 cycles = 27.3 ms, inside the band. Ten
; and three are the pair that lands there; nine gives 24.8 ms and eleven 29.8,
; both outside it.
.EQU WARN_GAP,      10
.EQU WARN_GAP_PASSES, 3

; ============================================================================
; Page map
; ============================================================================
;
; Chapter 0's sixteen pages. Page 15 is the reset page and the allocator
; reserves it, so it is named with `.PAGE P_RESET` explicitly rather than
; allocated. Every `LDP` in this file names one of these constants, and a page
; with room left over holds whichever routine did not fit on its own - `BR` and
; `CALL` carry six bits within a page, so where a routine lives is a placement
; decision and not a structural one.

.EQU P_SWEEP,        0          ; the main loop, the near pass, the far pass
.EQU P_RPLATE,       1          ; the R-plate pass and the crossing into bank 1
.EQU P_PAIR,         2          ; the pair pass, the digit pass, the crossing back
.EQU P_STROBE,       3          ; `strobe`, and `fire_missile` in the room left
.EQU P_LEAF,         4          ; `note`, `clear_file`, `lane_bit`
.EQU P_INPUT,        5          ; the input matrix
.EQU P_TICK,         6          ; the sweep counter, the burst, the missile
.EQU P_HIT,          7          ; what a missile runs into
.EQU P_SCORE,        8          ; the score, and the win test
.EQU P_JETS,         9          ; the squadron's march
.EQU P_SPAWN,       10          ; releasing jets, and the next wave
.EQU P_ROCKET,      11          ; the rocket: travel, launch, and which jet fires
.EQU P_SPILL,       12          ; whatever did not fit on the page it belongs to
.EQU P_BSHIP,       13          ; the battleship
.EQU P_SPARE,       14          ; the one page this program does not use. The
                                ; render step was here and outgrew it - see
                                ; C1_REND1 - and it is left named rather than
                                ; deleted because a page is the unit a routine
                                ; has to fit in, so "one page free" is the
                                ; headroom figure that matters and not the 588
                                ; words the listing reports.
.EQU P_RESET,       15          ; the reset routine

; Chapter 1. `BR` and `CALL` both copy the chapter buffer into the chapter
; address, and `COMC` is the only thing that moves the buffer, so a crossing is
; `COMC` then an ordinary paged jump and the buffer stays equal to the current
; chapter everywhere else. That invariant is the whole discipline: a `BR`
; executed with the two out of step lands in the other chapter.
;
; The endgame lives here because it is the one part of the program that is
; reached from a handful of places, runs to completion and returns to exactly
; one - so it costs three crossings in and three out, and buys back two pages of
; chapter 0 for the loop that runs every sweep.
;
; A `CALL` from here to a chapter-0 leaf is `COMC` / `LDP` / `CALL` / `COMC`:
; the call copies the buffer into the address, `RETN` restores the address from
; the saved chapter latch, and the second `COMC` puts the buffer back in step
; with it. Without that second one the next `BR` would leave for chapter 0.

.EQU C1_LOSE,        0          ; a launcher lost, and the warning beeps
.EQU C1_OVER,        1          ; the loss sound
.EQU C1_WIN,         2          ; the win jingle
.EQU C1_FIRE,        3          ; which jet fires the next rocket
.EQU C1_BSHIP,       4          ; the battleship arriving and leaving
.EQU C1_REND1,       5          ; the render step: blanking every nibble
.EQU C1_REND2,       6          ;                  the jets and the rocket
.EQU C1_REND3,       7          ;                  the rocket
.EQU C1_REND4,       8          ;                  the missile
.EQU C1_REND5,       9          ;                  the launcher
.EQU C1_REND6,      10          ;                  the burst
.EQU C1_REND7,      11          ;                  the capture and the score
.EQU C1_WINTEST,    12          ; the win test, which P_SCORE had no room for
.EQU C1_LADDER,     13          ; the cadence ladder
.EQU C1_REND0,      14          ; the render step: the battleship
.EQU C1_LAUNCH,     15          ; deciding to launch a rocket


; ============================================================================
; Page 0 - the main loop, and the two low-bank passes
; ============================================================================
;
; The loop is entered by branch and never by call, so the call latch is clear
; through every page of it and each leaf routine can be reached with `CALL`.
; That is the whole reason this program has no call tree: a second level would
; silently lose the first level's return address, and `tools/tmsasm` would
; refuse to assemble it.

.PAGE P_SWEEP

; --- pass 1: near, plates 0-2, grids 0-5, latch clear ------------------------
;
; The battleship on grid 0 and a jet column on each of grids 1-5. Six strobes,
; two instructions each: `TMA` from the nibble the render step left for this
; grid, then `TDO` inside `strobe`.

sweep:
        CLA
        TAY                     ; Y is the grid for the whole pass
sw_near:
        LDX  FILE_D0
        TMA                     ; A <- OPLA_A_NEAR + this grid's lane bitmap
        LDP  P_STROBE
        CALL strobe
        IYC
        YNEC GRID_COL_LAST + 1
        BR   sw_near

; --- pass 2: far, plates 3-5, grids 0-6, latch clear -------------------------
;
; The sea under the battleship on grid 0, the attacker's colon on grids 1-5, the
; capture burst on grid 6. Seven strobes.

        CLA
        TAY
sw_far:
        LDX  FILE_D1
        TMA                     ; A <- OPLA_A_FAR + bitmap
        LDP  P_STROBE
        CALL strobe
        IYC
        YNEC GRID_PLAYER + 1
        BR   sw_far

        LDP  P_RPLATE
        BR   sweep_rplate

; --- back from the sweep: the game's own work --------------------------------
;
; Reached from the end of the digit pass. Everything from here to `render` runs
; with the tube dark, which is what the real unit does between sweeps too.

main_work:
        LDP  P_INPUT
        BR   input_scan

; --- what a missile runs into, when it runs past the last column -------------
;
; Placed here rather than on P_HIT because that page is full and this one is
; not. It is reached by branch like everything else in the loop.

ms_horizon:
        LDX  FILE_STATE
        TCY  NIB_BSLANE
        TMA
        TCY  NIB_MLANE
        MNEA                    ; status = the boat is in some other lane
        BR   ms_missed
        BR   bship_kill
ms_missed:
        LDX  FILE_STATE
        TCY  NIB_MCOL
        TCMIY 0                 ; the missile is spent against the horizon
        LDP  P_JETS
        BR   jet_march


; --- the battleship is hit ---------------------------------------------------

bship_kill:
        LDX  FILE_STATE
        TCY  NIB_MCOL
        TCMIY 0
        TCY  NIB_BSLANE
        TMA
        TCY  NIB_KLANE
        TAM
        TCY  NIB_KCOL
        TCMIY GRID_BSHIP + 1
        TCY  NIB_BSLANE
        TCMIY BS_NONE           ; the crossing ends early
        LDX  FILE_D0
        TCY  NIB_BUZZ
        TCMIY 0                 ; and the buzz stops with the boat
        TCY  R_SPEAKER
        RSTR                    ; leaving the pin low
        LDX  FILE_TIME
        TCY  NIB_KSTEP
        TCMIY BURST_SWEEPS
        TCY  NIB_BS_LO
        TCMIY BSHIP_GAP_LO
        TCMIY BSHIP_GAP_HI
        LDP  P_SCORE
        BR   score_bship



; ============================================================================
; Page 1 - the R-plate pass, and the crossing into the high bank
; ============================================================================
;
; Plates 8-11 are R11-R14 and are outside the output PLA entirely: `SETR` and
; `RSTR` drive them one line at a time and they stay where they are put. So this
; is not a fifth O pass. It is a walk over grids 0-6 that, for each grid naming
; a line, raises that line, lights the grid for a dwell, and puts both back.
;
; O has to be dark for all of it or the far pass's mask would be lit again under
; every grid this one strobes. Dark is slot 0 - `TDO` with A = 0 and the latch
; clear - which is why this pass runs before the crossing rather than after it.
;
; The grid index has to be parked in NIB_RGRID rather than kept in a register,
; because Y is needed twice with different values (the plate line, then the
; grid) and A is needed for the line arithmetic in between.

.PAGE P_RPLATE

sweep_rplate:
        LDX  FILE_D3
        CLA
        TDO                     ; O dark; the latch is still clear
        CLA
        TAY                     ; Y = grid 0
rp_grid:
        LDX  FILE_D3
        MNEZ                    ; does this grid name a plate line?
        BR   rp_lit
        BR   rp_next
rp_lit:
        TYA
        TCY  NIB_RGRID
        TAM                     ; park the grid
        TMY                     ; and take it straight back into Y
        TMA                     ; A <- the line code, 1..4
        A10AAC                  ; A <- 11..14, the R line itself
        TAY
        SETR                    ; the plate line up
        TCY  NIB_RGRID
        TMY                     ; Y <- the grid
        SETR                    ; the grid on
        CLA
        A3AAC
rp_dwell:
        A15AAC                  ; the dwell, matched to an O strobe's
        BR   rp_dwell
        RSTR                    ; the grid off
        TCY  NIB_RGRID
        TMY
        TMA                     ; the line code again
        A10AAC
        TAY
        RSTR                    ; the plate line down
        TCY  NIB_RGRID
        TMY                     ; Y <- the grid, for the walk
rp_next:
        IYC
        YNEC GRID_PLAYER + 1
        BR   rp_grid

; --- the crossing: latch clear -> latch set ----------------------------------
;
; `YNEA` is the only instruction on this core that loads the status latch. There
; is no set and no clear, so three instructions with Y != A is the whole
; mechanism, and the sweep is ordered so that it is needed exactly twice.

        CLA
        TCY  1
        YNEA                    ; Y != A, so the latch takes 1
        LDP  P_PAIR
        TCY  0
        YNEC 1
        BR   sweep_pair

; --- pressing fire -----------------------------------------------------------
;
; Edge triggered, so a held button fires once. There is no auto-repeat in the
; hardware and there is none here.

tick_fire:
        LDX  FILE_STATE
        TCY  NIB_FIREP
        MNEZ                    ; was it already down last sweep?
        BR   tick_jets
        TCY  NIB_FIRE
        MNEZ
        BR   tk_fired
        BR   tick_jets
tk_fired:
        TCY  NIB_MCOL
        MNEZ                    ; one missile at a time
        BR   tick_jets
        LDP  P_STROBE
        BR   fire_missile

tick_jets:
        LDP  P_JETS
        BR   jet_march



; ============================================================================
; Page 2 - the two high-bank passes
; ============================================================================

.PAGE P_PAIR

; --- pass 3: pair, plates 6-7, grids 0-8, latch set --------------------------
;
; The battleship's burst on grid 0, the player's missile on grids 1-5, the
; launcher on grid 6, and one indicator each on grids 7 and 8 - `score_hundreds`
; and `score_label`, both plate 7. Nine strobes.
;
; The single exception in the whole layout lives here and is enforced by the
; render step rather than by this loop: on grids 7 and 8 plate 6 is segment g of
; the digit, so those two nibbles may carry lane 1 and must never carry lane 0.
; A pair strobe with lane 0 set would put a bar through the numeral at half
; brightness and read as a renderer fault rather than as a ROM one.

sweep_pair:
        CLA
        TAY
sw_pair:
        LDX  FILE_D2
        TMA                     ; A <- OPLA_A_PAIR + bitmap
        LDP  P_STROBE
        CALL strobe
        IYC
        YNEC GRID_SC_U + 1
        BR   sw_pair

; --- pass 4: digit, plates 0-6, grids 7-8, latch set -------------------------
;
; The BCD nibble passes through the table untouched: the seven-segment decode
; lives in the mask, so a score digit is drawn by `TDO` with no conversion at
; all and no ROM page is spent on a decoder. The blank tens digit has its own
; high-bank slot so that suppressing a leading zero costs the same two
; instructions as drawing one and does not move the latch.

        TCY  GRID_SC_T
sw_digit:
        LDX  FILE_D3
        TMA                     ; A <- the digit, or OPLA_A_DIGIT_BLANK
        LDP  P_STROBE
        CALL strobe
        IYC
        YNEC GRID_SC_U + 1
        BR   sw_digit

; --- the crossing back: latch set -> latch clear -----------------------------

        CLA
        TCY  0
        YNEA                    ; Y == A, so the latch takes 0
        LDP  P_SWEEP
        TCY  0
        YNEC 1
        BR   main_work

; --- the fire button, read with both strobe columns low ----------------------

input_fire:
        LDX  FILE_STATE
        TCY  NIB_FIRE
        TMA
        TCY  NIB_FIREP
        TAM                     ; last sweep's contact, before this one is taken
        LDX  FILE_D0
        TKA                     ; R9 and R10 are both low: this is K8 alone
        TCY  NIB_KSCR
        TAM
        TBIT1 K_BIT_FIRE
        BR   if_down
        BR   if_up
if_down:
        LDX  FILE_STATE
        TCY  NIB_FIRE
        TCMIY 1
        BR   if_done
if_up:
        LDX  FILE_STATE
        TCY  NIB_FIRE
        TCMIY 0
        BR   if_done
if_done:
        LDP  P_TICK
        BR   tick



; ============================================================================
; Page 3 - `strobe`, and the room left over
; ============================================================================
;
; `strobe` is called 24 times a sweep, once per O strobe.
;
;   in    A = the accumulator half of the PLA index, Y = the grid
;   out   Y unchanged, A = the grid, X = FILE_D0
;
; It is a leaf and calls nothing. That is not a style choice: the return address
; is one register guarded by the call latch, so a `CALL` from in here would lose
; the sweep's own return and the assembler refuses it.
;
; X is loaded here rather than trusted from the caller because `SETR` and `RSTR`
; index the R latch as `BIT(X, 2) << 4 | Y`. With X >= 4 the grid would never
; light and nothing anywhere would report it.
;
; The buzz is ticked *between* `SETR` and `RSTR` so that its work is part of the
; grid's dwell rather than added to the dark time between strobes. The grid
; index is parked in A across it, which works because `DMAN`, `MNEZ`, `TCMIY`,
; `TBIT1`, `SBIT`, `RBIT`, `SETR` and `RSTR` all leave A alone - one register is
; enough to get Y back.

.PAGE P_STROBE

strobe:
        TDO                     ; O <- the mask this index selects
        LDX  FILE_D0
        SETR                    ; the grid on
        TYA                     ; park the grid in A
        TCY  NIB_BUZZ
        MNEZ                    ; is the battleship's buzz running?
        BR   st_buzz
        BR   st_off
st_buzz:
        TCY  NIB_SGRID
        TAM                     ; and park it in RAM as well, because `DMAN` is
        TCY  NIB_BUZZ           ; decrement-into-*accumulator* and would take
        DMAN                    ; the grid with it. Only this arm pays for it,
        TAM                     ; and it is the arm the boat is on the glass for
        MNEZ                    ; zero is the edge; anything else is still
        BR   st_grid            ; counting down to it
        TCMIY BUZZ_DIV          ; reload, and step Y on to the phase nibble
        TBIT1 0
        BR   st_fall
        BR   st_rise
st_fall:
        RBIT 0
        TCY  R_SPEAKER
        RSTR
        BR   st_grid
st_rise:
        SBIT 0
        TCY  R_SPEAKER
        SETR
        BR   st_grid
st_grid:
        TCY  NIB_SGRID
        TMA                     ; A <- the grid, back out of RAM
        BR   st_off
st_off:
        TAY                     ; the grid, back out of A
        RSTR                    ; the grid off
        RETN

; --- fire_missile ------------------------------------------------------------
;
; One missile at a time, which is what NIB_MCOL being a single column nibble
; means. It leaves in the lane the lever is in and travels outward, grid 5
; toward grid 1 and then the horizon.

fire_missile:
        LDX  FILE_STATE
        TCY  NIB_LANE
        TMA
        TCY  NIB_MLANE
        TAM
        TCY  NIB_MCOL
        TCMIY GRID_COL_LAST
        LDX  FILE_TIME
        TCY  NIB_MSTEP
        TCMIY MISSILE_SWEEPS
        LDX  FILE_D0
        TCY  NIB_HALF_O
        TCMIY SND_FIRE_O
        TCMIY SND_FIRE_I
        TCMIY SND_FIRE_P
        TCMIY SND_FIRE_B
        LDP  P_LEAF
        CALL note               ; missileFire: 1496 Hz, 20.1 ms
        LDP  P_JETS
        BR   jet_march


; ============================================================================
; Page 4 - the three remaining leaves
; ============================================================================

.PAGE P_LEAF

; --- note: one square-wave burst on R15 --------------------------------------
;
;   in    X = FILE_D0, with NIB_HALF_O / NIB_HALF_I / NIB_PER / NIB_BURSTS set
;   out   the speaker low, X = FILE_D0
;
; The tube is dark for the whole of it. That is what the real machine does -
; docs/evidence/vfd-appearance.md records that every beep is a visible blink -
; and it is exactly why the battleship's four-second buzz cannot be a note and
; is clocked off the sweep instead.
;
; The delay is nested because a single nibble loop bottoms out around 380 Hz and
; gameOver's collapse is at 92.

note:
        TCY  NIB_BURSTS
        TMA
        TCY  NIB_BLEFT
        TAM
nt_burst:
        TCY  NIB_PER
        TMA
        TCY  NIB_PLEFT
        TAM
nt_period:
        TCY  R_SPEAKER
        SETR
        TCY  NIB_HALF_O
        TMA
nt_hi_out:
        TCY  NIB_HALF_I
        TMY
nt_hi_in:
        DYN
        BR   nt_hi_in
        A15AAC
        BR   nt_hi_out
        TCY  R_SPEAKER
        RSTR
        TCY  NIB_HALF_O
        TMA
nt_lo_out:
        TCY  NIB_HALF_I
        TMY
nt_lo_in:
        DYN
        BR   nt_lo_in
        A15AAC
        BR   nt_lo_out
        TCY  NIB_PLEFT
        DMAN                    ; A <- periods left - 1
        BR   nt_next_period
        TCY  NIB_BLEFT
        DMAN
        BR   nt_next_burst
        RETN
nt_next_period:
        TAM
        BR   nt_period
nt_next_burst:
        TAM
        BR   nt_burst

; --- clear_file: sixteen nibbles of the selected file, to zero ---------------
;
;   in    X = the file      out   X unchanged, Y = 0, A = 0
;
; Reset calls it seven times. **RAM is not cleared by hardware reset on this
; part**, and clearing it costs 112 nibbles times five instructions - about
; 10 ms at this rate - so it has to finish before the first strobe or the tube
; shows one frame of whatever the RAM powered up holding.

clear_file:
        CLA
        TAY
cf_nibble:
        CLA
        TAM
        IYC                     ; carry only when Y wraps out of the file
        BR   cf_done
        BR   cf_nibble
cf_done:
        RETN

; --- lane_bit: a lane number, as the bit the display files want --------------
;
;   in    X = FILE_D3, NIB_RLNE = the lane      out   NIB_RBIT = 1, 2 or 4
;
; Three lanes and no shifter, so it is a three-way test rather than arithmetic -
; and it is a subroutine rather than four copies of itself because the render
; step needs it for the battleship, the rocket, the missile and the burst.

lane_bit:
        TCY  NIB_RLNE
        TBIT1 1
        BR   lb_two
        TBIT1 0
        BR   lb_one
        TCY  NIB_RBIT
        TCMIY 1
        RETN
lb_one:
        TCY  NIB_RBIT
        TCMIY 2
        RETN
lb_two:
        TCY  NIB_RBIT
        TCMIY 4
        RETN


; ============================================================================
; Page 5 - the input matrix
; ============================================================================
;
; Three reads a sweep, and their shape is the wiring:
;
;   R9  high  -> K1/K2/K4 return the skill dial's three positions
;   R10 high  -> K1/K2/K4 return the lever's three positions
;   neither   -> K8 returns the fire button, which is not on a column at all
;
; **One column at a time, never both.** `read_inputs` is a plain wired-OR over
; the driven columns, so with both up the dial and the lever arrive superimposed
; on the same three lines and cannot be told apart. The hardware does not
; object - it returns the OR and carries on - which is exactly why it has to be
; the program that never does it.
;
; The fire read is deliberately taken with both columns *low* rather than folded
; into either strobed sample. K8 is ORed into every K read whatever R9 and R10
; are doing, so the separate read costs three instructions and is the one that
; demonstrates the difference: a build that routed fire through a strobe column
; would see nothing here.
;
; There is no input latch and no edge detector anywhere on the input side, so a
; contact closed and released between two reads is never seen at all. Debounce
; and edge detection are this program's problem, which is what NIB_FIRE and
; NIB_FIREP are for.

.PAGE P_INPUT

input_scan:
        LDX  FILE_D0
        TCY  R_STROBE_SKILL
        SETR
        TKA                     ; K1/K2/K4 from R9, plus K8
        TCY  NIB_KSCR
        TAM
        TCY  R_STROBE_SKILL
        RSTR
        TCY  NIB_KSCR
        TBIT1 0
        BR   is_skill1
        TBIT1 1
        BR   is_skill2
        TBIT1 2
        BR   is_skill3
        BR   is_lever           ; nothing closed - leave the dial where it was
is_skill1:
        LDX  FILE_STATE
        TCY  NIB_SKILL
        TCMIY 1
        BR   is_lever
is_skill2:
        LDX  FILE_STATE
        TCY  NIB_SKILL
        TCMIY 2
        BR   is_lever
is_skill3:
        LDX  FILE_STATE
        TCY  NIB_SKILL
        TCMIY 3
        BR   is_lever

is_lever:
        LDX  FILE_D0
        TCY  R_STROBE_LEVER
        SETR
        TKA                     ; K1/K2/K4 from R10, plus K8
        TCY  NIB_KSCR
        TAM
        TCY  R_STROBE_LEVER
        RSTR
        TCY  NIB_KSCR
        TBIT1 0
        BR   is_lane0
        TBIT1 1
        BR   is_lane1
        TBIT1 2
        BR   is_lane2
        BR   is_fire            ; the lever between detents - hold the lane
is_lane0:
        LDX  FILE_STATE
        TCY  NIB_LANE
        TCMIY 0                 ; NIB_LANEB follows NIB_LANE, so one run of
        TCMIY 1                 ; TCMIY writes the lane and its bit together
        BR   is_fire
is_lane1:
        LDX  FILE_STATE
        TCY  NIB_LANE
        TCMIY 1
        TCMIY 2
        BR   is_fire
is_lane2:
        LDX  FILE_STATE
        TCY  NIB_LANE
        TCMIY 2
        TCMIY 4
        BR   is_fire

; --- the fire button ---------------------------------------------------------
;
; Read on P_PAIR, in the room the two high-bank passes leave over. Every lane
; arm above falls to this jump rather than carrying its own, which is four words
; on this page instead of twelve.

is_fire:
        LDP  P_PAIR
        BR   input_fire


; ============================================================================
; Page 6 - the clock, the burst, and the player's missile
; ============================================================================
;
; A sweep is the only clock this program has. There is no timer read anywhere in
; it: NIB_TICK counts sweeps and wraps every sixteen, and every countdown in
; FILE_TIME is spent once per pass through here.

.PAGE P_TICK

tick:
        LDX  FILE_TIME
        TCY  NIB_TICK
        IMAC                    ; NIB_TICK + 1 -> A
        TAM

        LDX  FILE_STATE
        TCY  NIB_STATE
        MNEZ                    ; anything above ST_PLAY is a finished game
        BR   tk_ended
        BR   tick_burst
tk_ended:
        COMC
        LDP  C1_REND1
        BR   render             ; a finished game still shows its final score

; --- the burst on the glass --------------------------------------------------

tick_burst:
        LDX  FILE_STATE
        TCY  NIB_KCOL
        MNEZ
        BR   tk_burst_live
        BR   tick_capture
tk_burst_live:
        LDX  FILE_TIME
        TCY  NIB_KSTEP
        DMAN                    ; A <- one sweep off its life
        BR   tk_burst_left
        LDX  FILE_STATE
        TCY  NIB_KCOL
        TCMIY 0                 ; spent, and the cell goes dark
        BR   tick_capture
tk_burst_left:
        TAM
        BR   tick_capture

; --- the capture burst on the player's own grid ------------------------------

tick_capture:
        LDX  FILE_TIME
        TCY  NIB_CAPTURE
        MNEZ
        BR   tk_capture_live
        BR   tick_missile
tk_capture_live:
        DMAN                    ; A <- one sweep off it
        BR   tk_capture_left
        BR   tick_missile       ; spent: it was already zero, so leave it there
tk_capture_left:
        TAM
tick_missile:
        LDX  FILE_STATE
        TCY  NIB_MCOL
        MNEZ
        BR   tk_missile_live
        BR   tk_to_fire
tk_missile_live:
        LDX  FILE_TIME
        TCY  NIB_MSTEP
        DMAN                    ; A <- one sweep off the step
        BR   tk_missile_wait
        LDP  P_HIT
        BR   missile_step
tk_missile_wait:
        TAM
        BR   tk_to_fire

; --- pressing fire, and the squadron -----------------------------------------
;
; Both read on P_RPLATE, in the room the R-plate walk leaves over. Two arms
; above reach the first through this jump rather than each carrying a page.

tk_to_fire:
        LDP  P_RPLATE
        BR   tick_fire


; ============================================================================
; Page 7 - what a missile runs into
; ============================================================================

.PAGE P_HIT

missile_step:
        LDX  FILE_TIME
        TCY  NIB_MSTEP
        TCMIY MISSILE_SWEEPS
        LDX  FILE_STATE
        TCY  NIB_MCOL
        DMAN                    ; outward: grid 5 toward grid 1
        BR   ms_step_ok
        LDP  P_SWEEP
        BR   ms_horizon         ; past the last column is the battleship's row
ms_step_ok:
        TAM
        MNEZ                    ; grid 0 is the horizon, not a column
        BR   ms_flying
        LDP  P_SWEEP
        BR   ms_horizon
ms_flying:
        TCY  NIB_MLANE
        TMA
        LDX  FILE_JETS
        TAY
        TMA                     ; A <- the grid the jet in that lane stands on
        LDX  FILE_STATE
        TCY  NIB_MCOL
        MNEA                    ; status = that jet is somewhere else
        BR   ms_clear
        BR   missile_kill
ms_clear:
        LDP  P_JETS
        BR   jet_march

; --- a jet is shot down ------------------------------------------------------

missile_kill:
        LDX  FILE_STATE
        TCY  NIB_MLANE
        TMA
        TCY  NIB_KLANE
        TAM                     ; the burst stands where the jet did
        TCY  NIB_MCOL
        TMA
        A1AAC                   ; NIB_KCOL is the grid plus one, so 0 is "none"
        TCY  NIB_KCOL
        TAM
        LDX  FILE_TIME
        TCY  NIB_KSTEP
        TCMIY BURST_SWEEPS
        LDX  FILE_STATE
        TCY  NIB_MCOL
        TCMIY 0
        TCY  NIB_MLANE
        TMA
        LDX  FILE_JETS
        TAY
        CLA
        TAM                     ; that lane is empty again
        LDX  FILE_STATE
        TCY  NIB_KILLS
        IMAC
        TAM                     ; and the squadron is one thinner, which is a
        LDP  P_SCORE            ; rung down the cadence ladder
        TCY  0
        YNEC 1
        BR   score_jet

; ============================================================================
; Page 8 - the score
; ============================================================================
;
; Three BCD nibbles. A digit carries the classic way: add six and read the
; carry, because a nibble sum of ten or more is exactly a nibble sum of sixteen
; or more once six is added, and adding ten afterwards takes the six back off
; when it was not wanted. One instruction more than a comparison, and no
; scratch nibble at all.

.PAGE P_SCORE

; A jet is worth what the ruler prints over the column it died in - 3 at the far
; end, 2 in the middle band, 1 from there to G. See the derivation beside
; SCORE_JET.
;
; The column at the moment of impact is already in hand: `missile_kill` writes
; NIB_KCOL as the grid *plus one* (so that zero can mean "no burst") before it
; branches here, and that is the grid the missile actually reached the jet on,
; not the grid the jet was released into. So this needs no new state and reaches
; into nothing on P_HIT.
;
; Three points is safe through the units stage, which ten is not: `add_score`
; sums into NIB_SC_U with a four-bit AMAAC, and 3 + 9 = 12 stays inside the
; nibble for the add-six correction to work on. That is the whole reason
; `score_bship` has its own path, and the reason this one does not need one.
score_jet:
        LDX  FILE_STATE
        TCY  NIB_KCOL
        TMA                     ; A <- the burst's grid, plus one
        TAY
        YNEC 2                  ; grid 1, under the ruler's `3`
        BR   sj_not_far
        TCY  SCORE_JET_FAR
        TYA
        BR   add_score
sj_not_far:
        YNEC 3                  ; grid 2, under the ruler's `2`
        BR   sj_near
        TCY  SCORE_JET_MID
        TYA
        BR   add_score
sj_near:
        TCY  SCORE_JET          ; grids 3, 4 and 5 - the clamp to the last band
        TYA
        BR   add_score
; The boat is ten points, which is one on the tens digit and nothing at all on
; the units, so it does not go through `add_score`'s units stage - it does that
; stage's *carry* arm instead, which is the same four instructions `as_carry_u`
; runs. Adding ten through the units would need a five-bit sum.
score_bship:
        LDX  FILE_TIME
        TCY  NIB_SC_T
        IMAC                    ; SCORE_BSHIP, spent as a tens increment
        TAM
        A6AAC                   ; carry iff the tens digit reached ten
        BR   as_carry_t
        BR   as_to_done

add_score:
        LDX  FILE_TIME
        TCY  NIB_SC_U
        AMAAC                   ; A <- points + units
        A6AAC
        BR   as_carry_u
        A10AAC                  ; no carry, so the six comes straight back off
        TAM
        TCY  0
        YNEC 1
        BR   as_to_done
as_carry_u:
        TAM                     ; the six left A holding units - 10
        TCY  NIB_SC_T
        IMAC
        TAM
        A6AAC
        BR   as_carry_t
        BR   as_to_done
as_carry_t:
        LDX  FILE_TIME
        TCY  NIB_SC_T
        TCMIY 0                 ; the tens wrap
        TCY  NIB_SC_H
        IMAC
        TAM
        TCY  0
        YNEC 1
        BR   as_to_done

as_to_done:
        COMC
        LDP  C1_WINTEST
        BR   as_done

as_out2:
        LDP  P_JETS
        BR   jet_march


; ============================================================================
; Page 9 - the squadron's march
; ============================================================================
;
; One countdown for the squadron, not three. When it runs out every airborne jet
; steps one grid closer to the player and the march beep sounds once, which is
; the rate assets/reference/gameplay-audio.m4a measures. A jet that steps off
; grid 5 has reached the launcher, and that is a capture.

.PAGE P_JETS

jet_march:
        LDX  FILE_TIME
        TCY  NIB_STEP_LO
        DMAN                    ; a pair is spent low first; the low nibble
        BR   jm_low_left        ; wrapping to 15 is what spends a high one
        TAM
        TCY  NIB_STEP_HI
        DMAN
        BR   jm_high_left
        BR   jm_step
jm_high_left:
        TAM
        BR   jm_waiting
jm_low_left:
        TAM
        BR   jm_waiting
jm_waiting:
        LDP  P_SPAWN
        BR   jet_release

jm_step:
        LDX  FILE_JETS
        TCY  NIB_J_WORK
        TCMIY 0
        TCY  NIB_J_MOVED
        TCMIY 0
jm_lane:
        LDX  FILE_JETS
        TCY  NIB_J_WORK
        TMA
        TAY                     ; Y <- the lane
        MNEZ                    ; is there a jet in it?
        BR   jm_move
        BR   jm_lane_next
jm_move:
        IMAC                    ; one grid closer
        TAM
        A10AAC                  ; carry iff it has stepped past grid 5
        BR   jm_to_capture
        LDX  FILE_JETS
        TCY  NIB_J_MOVED
        TCMIY 1
jm_lane_next:
        LDX  FILE_JETS
        TCY  NIB_J_WORK
        IMAC
        TAM
        A13AAC                  ; carry iff every lane has been walked
        BR   jm_lane_done
        BR   jm_lane

jm_to_capture:
        LDP  P_SPILL
        BR   jm_capture

jm_lane_done:
        LDX  FILE_JETS
        TCY  NIB_J_MOVED
        MNEZ
        BR   jm_beep
        BR   jm_reload
jm_beep:
        LDX  FILE_D0
        TCY  NIB_HALF_O
        TCMIY SND_MARCH_O
        TCMIY SND_MARCH_I
        TCMIY SND_MARCH_P
        TCMIY SND_MARCH_B
        LDP  P_LEAF
        CALL note               ; jetMarch: 641 Hz, 70.2 ms
                                ; and on into the reload below
jm_reload:
        COMC
        LDP  C1_LADDER
        CALL step_reload
        COMC
        LDP  P_SPAWN
        BR   jet_release


; ============================================================================
; Page 10 - releasing jets, the next wave, and the cadence ladder
; ============================================================================

.PAGE P_SPAWN

; --- releasing one jet -------------------------------------------------------

jet_release:
        LDX  FILE_JETS
        TCY  NIB_J_SENT
        TMA
        A10AAC                  ; carry iff the whole squadron has been released
        BR   jr_to_wave
        LDX  FILE_TIME
        TCY  NIB_ENTRY_LO
        DMAN
        BR   jr_low_left
        TAM
        TCY  NIB_ENTRY_HI
        DMAN
        BR   jr_high_left
        BR   jet_enter
jr_high_left:
        TAM
        BR   jr_out
jr_low_left:
        TAM
        BR   jr_out

jet_enter:
        LDX  FILE_JETS
        TCY  NIB_J_TMP
        TCMIY LANE_COUNT        ; three lanes to try before giving up
je_try:
        LDX  FILE_JETS
        TCY  NIB_J_ROTOR
        IMAC
        TAM
        A13AAC                  ; carry iff the rotor ran past lane 2
        BR   je_wrap
        BR   je_look
je_wrap:
        LDX  FILE_JETS
        TCY  NIB_J_ROTOR
        TCMIY 0
        BR   je_look
je_look:
        LDX  FILE_JETS
        TCY  NIB_J_ROTOR
        TMY                     ; Y <- the lane the rotor names
        MNEZ                    ; is a jet already flying in it?
        BR   je_busy
        BR   je_place
je_busy:
        LDX  FILE_JETS
        TCY  NIB_J_TMP
        DMAN                    ; A <- tries left - 1
        BR   je_retry
        BR   jr_out             ; all three lanes busy - wait a sweep
je_retry:
        TAM
        BR   je_try
je_place:
        TCMIY GRID_COL_FIRST    ; the jet enters at the far end of the field
        LDX  FILE_JETS
        TCY  NIB_J_SENT
        IMAC
        TAM
        LDX  FILE_TIME
        TCY  NIB_ENTRY_LO
        TCMIY 15
        TCMIY ENTRY_HI
        BR   jr_out

jr_to_wave:
        LDP  P_SPILL
        BR   jr_wave_test

jr_out:
        LDP  P_ROCKET
        BR   tick_rocket


; ============================================================================
; Page 11 - the rocket
; ============================================================================

.PAGE P_ROCKET

tick_rocket:
        LDX  FILE_STATE
        TCY  NIB_RCOL
        LDP  P_ROCKET
        MNEZ
        BR   tr_flying
        BR   tr_to_launch
tr_to_launch:
        COMC
        LDP  C1_LAUNCH
        BR   rocket_launch
tr_flying:
        LDX  FILE_TIME
        TCY  NIB_RSTEP
        DMAN                    ; A <- one sweep off the step
        BR   tr_step_left
        BR   rocket_move
tr_step_left:
        TAM
        BR   tr_done

rocket_move:
        LDX  FILE_TIME
        TCY  NIB_RSTEP
        TCMIY ROCKET_SWEEPS
        LDX  FILE_STATE
        TCY  NIB_RCOL
        IMAC                    ; inward: toward the player
        TAM
        A10AAC                  ; carry iff it has reached the launcher line
        BR   rm_arrived
        BR   tr_done
rm_arrived:
        LDX  FILE_STATE
        TCY  NIB_RCOL
        TCMIY 0                 ; spent, whatever it found there
        TCY  NIB_RLANE
        TMA
        TCY  NIB_LANE
        MNEA                    ; status = the launcher is in some other lane
        BR   tr_done
        COMC
        LDP  C1_LOSE
        BR   launcher_hit

tr_done:
        LDP  P_BSHIP
        BR   tick_bship

; ============================================================================
; Page 12 - the spill page
; ============================================================================
;
; `BR` and `CALL` carry six bits within a page, so where a routine lives is a
; placement decision and not a structural one. This page holds the ones whose
; own page filled up: each is reached by a paged branch, runs to a paged branch,
; and carries nothing across the boundary.

.PAGE P_SPILL

; --- a jet reaches the launcher: the player is captured ----------------------
;
; Placed on P_SPILL because P_JETS is full; it is reached
; by branch like the rest of the loop and carries no state across the page.

jm_capture:
        LDX  FILE_JETS
        CLA
        TAM                     ; the lane empties whether or not it cost
        TYA                     ; anything: the jet has crossed the G line
        LDX  FILE_STATE
        TCY  NIB_KLANE
        TAM
        TCY  NIB_LANE
        MNEA                    ; status = the launcher is in some other lane
        BR   jm_flew_past
        LDX  FILE_TIME
        TCY  NIB_CAPTURE
        TCMIY CAPTURE_SWEEPS
        COMC
        LDP  C1_LADDER
        CALL step_reload        ; the walk's own reload is below `jm_lane_next`
        LDP  C1_LOSE            ; and this path never returns there, so the
        BR   launcher_down      ; countdown is reloaded here instead

; A jet that crosses the line the player is *not* standing in costs nothing.
; That is the whole of what moving the lever is for, and without it the machine
; loses all three launchers to the first squadron whatever the player does.
jm_flew_past:
        LDP  P_JETS
        BR   jm_lane_next



; --- a squadron cleared ------------------------------------------------------

jr_wave_test:
        LDX  FILE_JETS
        LDP  P_SPAWN            ; PB holds until something else loads it, so the
                                ; three tests below share one, above them all
                                ; rather than between each test and its branch
        TCY  NIB_J_LANE0
        MNEZ
        BR   jr_out
        TCY  NIB_J_LANE0 + 1
        MNEZ
        BR   jr_out
        TCY  NIB_J_LANE0 + 2
        MNEZ
        BR   jr_out
        LDX  FILE_JETS
        TCY  NIB_J_SENT
        TCMIY 0
        LDX  FILE_STATE
        TCY  NIB_KILLS
        TCMIY 0                 ; a fresh squadron, and the ladder resets with it
        LDP  P_SPAWN
        BR   jr_out


; ============================================================================
; Page 13 - the battleship
; ============================================================================

.PAGE P_BSHIP

tick_bship:
        LDX  FILE_STATE
        TCY  NIB_BSLANE
        TMA
        LDX  FILE_JETS
        TCY  NIB_J_TMP
        TCMIY BS_NONE
        TCY  NIB_J_TMP
        MNEA                    ; status = the boat is on the glass
        BR   bs_crossing
        BR   bs_waiting

; --- between crossings, counted in sixteen-sweep units -----------------------

bs_waiting:
        LDX  FILE_TIME
        TCY  NIB_TICK
        MNEZ                    ; spend a unit only on the sweep the tick wraps
        BR   bs_out
        TCY  NIB_BS_LO
        DMAN
        BR   bw_low_left
        TAM
        TCY  NIB_BS_HI
        DMAN
        BR   bw_high_left
        COMC
        LDP  C1_BSHIP
        BR   bship_enter
bw_high_left:
        TAM
        BR   bs_out
bw_low_left:
        TAM
        BR   bs_out

; --- crossing ----------------------------------------------------------------

bs_crossing:
        LDX  FILE_TIME
        TCY  NIB_BS_LO
        DMAN
        BR   bc_low_left
        TAM
        TCY  NIB_BS_HI
        DMAN
        BR   bc_high_left
        BR   bc_step
bc_high_left:
        TAM
        BR   bs_out
bc_low_left:
        TAM
        BR   bs_out
bc_step:
        LDX  FILE_STATE
        TCY  NIB_BSLANE
        IMAC
        TAM
        A13AAC                  ; carry iff it has run past the last lane
        BR   bs_to_leave
        LDX  FILE_TIME
        TCY  NIB_BS_LO
        TCMIY BSHIP_STEP_LO
        TCMIY BSHIP_STEP_HI
        BR   bs_out

bs_to_leave:
        COMC
        LDP  C1_BSHIP
        BR   bs_leave

bs_out:
        COMC
        LDP  C1_REND1
        BR   render

; ============================================================================
; Page 15 - reset
; ============================================================================
;
; The machine enters here: chapter 0, page 15, PC 0. Nothing about page 15 is
; guessable from the rest of the layout, which is why the assembler's page
; allocator reserves it rather than letting a program grow into it and collide
; at the end of an assembly.
;
; **RAM is not cleared by hardware reset on this part.** Reset clears the R
; latches, writes O index 0, clears status and the call latch, and leaves the
; 128 nibbles holding whatever they powered up with. So the first thing the
; program does is clear them, and it must finish before the first strobe. At
; five instructions a nibble that is 83 cycles a file and 581 for the seven -
; about 10 ms, and 833 cycles from reset to the first grid rising once the state
; below is written too. Every one of those cycles is time the tube would
; otherwise be showing whatever the RAM powered up holding, and
; tools/probe/tms1370-rom.test.ts asserts nothing lights before them.

.PAGE P_RESET

reset:
        LDX  FILE_D0
        LDP  P_LEAF
        CALL clear_file
        LDX  FILE_D1
        LDP  P_LEAF
        CALL clear_file
        LDX  FILE_D2
        LDP  P_LEAF
        CALL clear_file
        LDX  FILE_D3
        LDP  P_LEAF
        CALL clear_file
        LDX  FILE_STATE
        LDP  P_LEAF
        CALL clear_file
        LDX  FILE_TIME
        LDP  P_LEAF
        CALL clear_file
        LDX  FILE_JETS
        LDP  P_LEAF
        CALL clear_file

; --- the state a cleared RAM does not already describe -----------------------

        LDX  FILE_STATE
        TCY  NIB_LANE
        TCMIY 1                 ; the lever starts centred
        TCMIY 2                 ; and NIB_LANEB with it
        TCMIY 1                 ; NIB_SKILL follows: the dial starts at 1
        TCY  NIB_BSLANE
        TCMIY BS_NONE           ; no crossing in progress
        LDX  FILE_TIME
        TCY  NIB_BS_LO
        TCMIY BSHIP_OPEN_LO     ; the opening crossing comes sooner than a full
        TCMIY BSHIP_OPEN_HI     ; interval, so a short game still sees the boat
        TCY  NIB_STEP_LO
        TCMIY 15
        TCMIY STEP_HI_MAX
        TCY  NIB_ENTRY_LO
        TCMIY 15
        TCMIY ENTRY_HI
        TCY  NIB_ROCK_LO
        TCMIY 15
        TCMIY ROCK_HI_BASE
        LDX  FILE_D3
        TCY  NIB_DIG_T
        TCMIY OPLA_A_DIGIT_BLANK
        COMC
        LDP  C1_REND1
        BR   render

; ============================================================================
; Chapter 1, page 0 - losing a launcher
; ============================================================================

.CHAPTER 1
.PAGE C1_LOSE

; --- a rocket arrives in the launcher's lane ---------------------------------

launcher_hit:
        LDX  FILE_STATE
        TCY  NIB_RLANE
        TMA
        TCY  NIB_KLANE
        TAM
        LDX  FILE_TIME
        TCY  NIB_CAPTURE
        TCMIY CAPTURE_SWEEPS
        BR   launcher_down

; --- a launcher is destroyed, however it happened ----------------------------
;
; Two ways in, because the player has two ways to lose one and they cost the
; same thing: a rocket arriving at the station, and a jet reaching the G line.
; PRD v1 R6 and audio-reference.md's launcherHitWarning: two beeps on the first
; hit, three on the second, and on the third the full loss sound. All three are
; owner-confirmed.

launcher_down:
        LDX  FILE_STATE
        TCY  NIB_KCOL
        TCMIY GRID_PLAYER + 1   ; the starburst on the player's own grid: the
        LDX  FILE_TIME          ; same three plates a jet-kill burst uses, which
        TCY  NIB_KSTEP          ; is what the tube gives every playfield cell
        TCMIY BURST_SWEEPS
        LDX  FILE_STATE
        TCY  NIB_HITS
        IMAC
        TAM
        A13AAC                  ; carry iff all three launchers are gone
        BR   ld_to_over
        LDX  FILE_STATE
        TCY  NIB_HITS
        TMA
        LDX  FILE_JETS
        TCY  NIB_J_TMP
        TAM                     ; hits is 1 or 2, so beeps is hits + 1
lw_beep:
        LDX  FILE_D0
        TCY  NIB_HALF_O
        TCMIY SND_WARN_O
        TCMIY SND_WARN_I
        TCMIY SND_WARN_P
        TCMIY SND_WARN_B
        COMC
        LDP  P_LEAF
        CALL note
        COMC               ; launcherHitWarning: 474 Hz, 10.5 ms
        LDX  FILE_JETS
        TCY  NIB_J_SCR
        TCMIY WARN_GAP_PASSES
lw_gap_out:
        CLA
        A10AAC                  ; WARN_GAP passes of the middle loop
lw_gap_mid:
        TCY  15
lw_gap_in:
        DYN
        BR   lw_gap_in
        A15AAC
        BR   lw_gap_mid
        LDX  FILE_JETS
        TCY  NIB_J_SCR
        DMAN
        BR   lw_gap_more
        LDX  FILE_JETS
        TCY  NIB_J_TMP
        DMAN
        BR   lw_next_beep
        LDP  C1_REND1
        BR   render
lw_gap_more:
        TAM
        BR   lw_gap_out
lw_next_beep:
        TAM
        BR   lw_beep

; The third hit is the loss sound rather than a warning. The trampoline sits
; here, past the last branch of the routine above, because a page's words run in
; the shift register's order and anything placed mid-routine is fallen into.
ld_to_over:
        LDP  C1_OVER
        BR   game_lost

; ============================================================================
; Chapter 1, page 1 - the loss sound
; ============================================================================

.PAGE C1_OVER

game_lost:
        LDX  FILE_STATE
        TCY  NIB_STATE
        TCMIY ST_OVER
        LDX  FILE_D0
        TCY  NIB_HALF_O
        TCMIY SND_LOSS1_O
        TCMIY SND_LOSS1_I
        TCMIY SND_LOSS1_P
        TCMIY SND_LOSS1_B
        COMC
        LDP  P_LEAF
        CALL note
        COMC               ; the 474 Hz transient
        LDX  FILE_D0
        TCY  NIB_HALF_O
        TCMIY SND_LOSS2_O
        TCMIY SND_LOSS2_I
        TCMIY SND_LOSS2_P
        TCMIY SND_LOSS2_B
        COMC
        LDP  P_LEAF
        CALL note
        COMC               ; the collapse to 92 Hz
        LDX  FILE_D0
        TCY  NIB_HALF_O
        TCMIY SND_LOSS3_O
        TCMIY SND_LOSS3_I
        TCMIY SND_LOSS3_P
        TCMIY SND_LOSS3_B
        COMC
        LDP  P_LEAF
        CALL note
        COMC               ; the rasp body
        LDX  FILE_D0
        TCY  NIB_HALF_O
        TCMIY SND_LOSS4_O
        TCMIY SND_LOSS4_I
        TCMIY SND_LOSS4_P
        TCMIY SND_LOSS4_B
        COMC
        LDP  P_LEAF
        CALL note
        COMC               ; drifting down
        LDX  FILE_D0
        TCY  NIB_HALF_O
        TCMIY SND_LOSS5_O
        TCMIY SND_LOSS5_I
        TCMIY SND_LOSS5_P
        TCMIY SND_LOSS5_B
        COMC
        LDP  P_LEAF
        CALL note
        COMC               ; the low decay
        LDP  C1_REND1
        BR   render


; ============================================================================
; Chapter 1, page 2 - the win jingle
; ============================================================================

.PAGE C1_WIN

; --- the win jingle ----------------------------------------------------------
;
; Three arpeggios of 750 / 940 / 1240 Hz and a sustained 940, which is the
; sequence audio-reference.md transcribes. The E6 pass-tone an earlier v1
; transcription carried was re-analysed and is not in the recording: do not
; reintroduce it.

game_win:
        LDX  FILE_STATE
        TCY  NIB_STATE
        TCMIY ST_WIN
        LDX  FILE_JETS
        TCY  NIB_J_TMP
        TCMIY 2                 ; three passes of the arpeggio
gw_pass:
        LDX  FILE_D0
        TCY  NIB_HALF_O
        TCMIY SND_WIN1_O
        TCMIY SND_WIN1_I
        TCMIY SND_WIN1_P
        TCMIY SND_WIN1_B
        COMC
        LDP  P_LEAF
        CALL note
        COMC
        LDX  FILE_D0
        TCY  NIB_HALF_O
        TCMIY SND_WIN2_O
        TCMIY SND_WIN2_I
        TCMIY SND_WIN2_P
        TCMIY SND_WIN2_B
        COMC
        LDP  P_LEAF
        CALL note
        COMC
        LDX  FILE_D0
        TCY  NIB_HALF_O
        TCMIY SND_WIN3_O
        TCMIY SND_WIN3_I
        TCMIY SND_WIN3_P
        TCMIY SND_WIN3_B
        COMC
        LDP  P_LEAF
        CALL note
        COMC
        LDX  FILE_JETS
        TCY  NIB_J_TMP
        DMAN
        BR   gw_again
        BR   gw_last
gw_again:
        TAM
        BR   gw_pass
gw_last:
        LDX  FILE_D0
        TCY  NIB_HALF_O
        TCMIY SND_WINE_O
        TCMIY SND_WINE_I
        TCMIY SND_WINE_P
        TCMIY SND_WINE_B
        COMC
        LDP  P_LEAF
        CALL note
        COMC
        COMC                    ; a second burst at the same pitch: `note` leaves
        LDP  P_LEAF             ; NIB_HALF_O/I and NIB_PER/NIB_BURSTS as it found
        CALL note               ; them, so the nibbles above still stand and only
        COMC                    ; the call repeats. 512 periods, 290 ms.
        LDP  C1_REND1
        BR   render



; ============================================================================
; Chapter 1, page 3 - which jet fires the next rocket
; ============================================================================

.PAGE C1_FIRE

; --- which jet fires it ------------------------------------------------------
;
; **This is the v2 defect PRD R5 forbids inheriting, fixed.** v2 drew this lane
; from NIB_RAND - the free-running timer as it stood the last time the *player*
; pressed fire. A player who never fires never moves it, so two of the three
; lanes were permanently safe and the launcher could only ever be threatened in
; one; docs/evidence/open-questions.md section 3d records it and contract
; criterion V7 parks the lever in each lane in turn and requires a warning burst
; in all three.
;
; The lane now comes from NIB_ROTOR, a round robin this routine owns and that
; nothing on the input path touches. It advances on every launch attempt whether
; or not the attempt finds a jet, and an empty lane walks it on to the next - so
; all three lanes are reached, in turn, from a source with no dependence on the
; player whatsoever.

rocket_fire:
        LDX  FILE_JETS
        TCY  NIB_J_TMP
        TCMIY LANE_COUNT
rf_try:
        LDX  FILE_STATE
        TCY  NIB_ROTOR
        IMAC
        TAM
        A13AAC                  ; carry iff the rotor ran past lane 2
        BR   rf_wrap
        BR   rf_look
rf_wrap:
        LDX  FILE_STATE
        TCY  NIB_ROTOR
        TCMIY 0
        BR   rf_look
rf_look:
        LDX  FILE_STATE
        TCY  NIB_ROTOR
        TMA
        LDX  FILE_JETS
        TAY
        MNEZ                    ; is a jet flying in that lane?
        BR   rf_fire
        BR   rf_empty
rf_empty:
        LDX  FILE_JETS
        TCY  NIB_J_TMP
        DMAN                    ; A <- tries left - 1
        BR   rf_retry
        COMC
        LDP  P_ROCKET
        BR   tr_done   ; nothing airborne - no rocket this time round
rf_retry:
        TAM
        BR   rf_try
rf_fire:
        TMA                     ; A <- the grid that jet stands on
        LDX  FILE_STATE
        TCY  NIB_RCOL
        TAM                     ; the rocket starts from the jet that fired it
        TCY  NIB_ROTOR
        TMA
        TCY  NIB_RLANE
        TAM
        LDX  FILE_TIME
        TCY  NIB_RSTEP
        TCMIY ROCKET_SWEEPS
        COMC
        LDP  P_ROCKET
        BR   tr_done


; ============================================================================
; Chapter 1, page 4 - the battleship arriving and leaving
; ============================================================================
;
; The two ends of a crossing, which happen once every 19.8 s each. The sweep
; between them is on P_BSHIP with the rest of the loop.

.PAGE C1_BSHIP

bship_enter:
        LDX  FILE_STATE
        TCY  NIB_BSLANE
        TCMIY 0                 ; it enters in lane 0
        LDX  FILE_TIME
        TCY  NIB_BS_LO
        TCMIY BSHIP_STEP_LO
        TCMIY BSHIP_STEP_HI
        LDX  FILE_D0
        TCY  NIB_BUZZ
        TCMIY BUZZ_DIV
        TCMIY 1                 ; the phase, so the first edge drives R15 high
        COMC
        LDP  P_BSHIP
        BR   bs_out

bs_leave:
        LDX  FILE_STATE
        TCY  NIB_BSLANE
        TCMIY BS_NONE
        LDX  FILE_D0
        TCY  NIB_BUZZ
        TCMIY 0                 ; the buzz stops with the boat
        TCY  NIB_BPHASE
        TCMIY 0
        TCY  R_SPEAKER
        RSTR                    ; and the pin is left low
        LDX  FILE_TIME
        TCY  NIB_BS_LO
        TCMIY BSHIP_GAP_LO
        TCMIY BSHIP_GAP_HI
        COMC
        LDP  P_BSHIP
        BR   bs_out


; ============================================================================
; Chapter 1, pages 5-8 - the playfield, laid out into the display files
; ============================================================================
;
; One pass over the game state, writing the twenty-four nibbles the sweep reads.
; Everything is blanked first, to each group's *own* empty subset - zero is the
; near group's, and writing it into a far or pair nibble would light plates 0-2
; under every grid.

.PAGE C1_REND1

render:
        LDX  FILE_D0
        TCY  GRID_BSHIP
        TCMIY OPLA_A_NEAR
        TCMIY OPLA_A_NEAR
        TCMIY OPLA_A_NEAR
        TCMIY OPLA_A_NEAR
        TCMIY OPLA_A_NEAR
        TCMIY OPLA_A_NEAR
        LDX  FILE_D1
        TCY  GRID_BSHIP
        TCMIY OPLA_A_FAR        ; the sea blanks with everything else - see
                                ; rd_bs_draw, which lights the boat's own lane
        TCMIY OPLA_A_FAR
        TCMIY OPLA_A_FAR
        TCMIY OPLA_A_FAR
        TCMIY OPLA_A_FAR
        TCMIY OPLA_A_FAR
        TCMIY OPLA_A_FAR
        LDX  FILE_D2
        TCY  GRID_BSHIP
        TCMIY OPLA_A_PAIR
        TCMIY OPLA_A_PAIR
        TCMIY OPLA_A_PAIR
        TCMIY OPLA_A_PAIR
        TCMIY OPLA_A_PAIR
        TCMIY OPLA_A_PAIR
        TCMIY OPLA_A_PAIR
        TCMIY OPLA_A_PAIR       ; grid 7, the hundreds indicator's grid
        TCMIY OPLA_A_PAIR + 2   ; grid 8: SCORE, plate 7, and never plate 6
        LDX  FILE_D3
        TCY  GRID_BSHIP
        TCMIY 0
        TCMIY 0
        TCMIY 0
        TCMIY 0
        TCMIY 0
        TCMIY 0
        TCMIY 0
        LDP  C1_REND0
        BR   rd_bship

.PAGE C1_REND2

; --- the squadron, on grids 1-5's near plates --------------------------------
;
; Three lanes can stand in one column, which is why the near group holds all
; eight subsets and not four, and why this adds rather than overwrites.
;
; **Both scratch nibbles have to be set here, and the order below is the RAM
; map's and not a preference.** `TCMIY` steps Y up, `NIB_RBIT` is 11 and
; `NIB_RLNE` is 12, so the pair is written bit-then-lane. Written the other way
; round the second store lands in nibble 13, which nothing reads, and `NIB_RBIT`
; carries into the walk holding whatever the previous sweep's last `lane_bit`
; caller left - `rd_bship`'s boat lane, `rd_launcher`'s lever lane, or
; `rd_bk_plate`'s R-line code. The squadron is then drawn offset by that lane,
; and once the doubling runs the offset past bit 2 the near nibble leaves the
; NEAR group's 0-7 and indexes FAR instead (`opla.inc.asm`, index 8-15 with the
; latch clear), so the near pass paints the attackers' rockets into cells no
; rocket is in. It ran that way and every address it drove was a legal one, which
; is why the atlas conformance suite went *greener* for it rather than red.
; `tools/probe/render-fidelity.test.ts` is the assertion that catches it.

rd_jets:
        LDX  FILE_D3
        TCY  NIB_RBIT
        TCMIY 1                 ; NIB_RBIT is 11 and NIB_RLNE is 12, so the walk
        TCMIY 0                 ; starts at the bit and steps *up* to the lane
rd_jet_lane:
        LDX  FILE_D3
        TCY  NIB_RLNE
        TMY                     ; Y <- the lane
        LDX  FILE_JETS
        MNEZ                    ; is there a jet in it?
        BR   rd_jet_draw
        BR   rd_jet_next
rd_jet_draw:
        TMA                     ; A <- the grid it stands on
        LDX  FILE_D3
        TCY  NIB_RGRID
        TAM
        TCY  NIB_RBIT
        TMA                     ; A <- this lane's bit
        TCY  NIB_RGRID
        TMY                     ; Y <- the grid, with A untouched
        LDX  FILE_D0
        AMAAC
        TAM
rd_jet_next:
        LDX  FILE_D3
        LDP  C1_REND2           ; the loop below branches within this page
        TCY  NIB_RBIT
        TMA
        AMAAC                   ; the bit walks left: 1, 2, 4
        TAM
        TCY  NIB_RLNE
        IMAC
        TAM
        A13AAC                  ; carry iff every lane has been walked
        BR   rd_to_rocket
        BR   rd_jet_lane
rd_to_rocket:
        LDP  C1_REND3
        BR   rd_rocket

.PAGE C1_REND3

; --- the rocket, on its column's far plates ----------------------------------

rd_rocket:
        LDX  FILE_STATE
        TCY  NIB_RCOL
        LDP  C1_REND3           ; the in-page arm needs PB naming this page too
        MNEZ
        BR   rd_rk_draw
        BR   rd_to_missile
rd_to_missile:
        LDP  C1_REND4
        BR   rd_missile
rd_rk_draw:
        TMA
        LDX  FILE_D3
        TCY  NIB_RGRID
        TAM
        LDX  FILE_STATE
        TCY  NIB_RLANE
        TMA
        LDX  FILE_D3
        TCY  NIB_RLNE
        TAM
        COMC
        LDP  P_LEAF
        CALL lane_bit
        COMC
        LDX  FILE_D3
        TCY  NIB_RBIT
        TMA
        TCY  NIB_RGRID
        TMY
        LDX  FILE_D1
        AMAAC
        TAM
        LDP  C1_REND4
        TCY  0
        YNEC 1
        BR   rd_missile

.PAGE C1_REND4

; --- the player's missile, on the pair plates --------------------------------
;
; Lanes 0 and 1 are plates 6 and 7 and go through the PLA; lane 2 is plate 8,
; which is R11, so it names a line in FILE_D3 instead.

rd_missile:
        LDX  FILE_STATE
        TCY  NIB_MCOL
        LDP  C1_REND4           ; the in-page arm needs PB naming this page, so
                                ; the other one goes through a trampoline
        MNEZ
        BR   rd_ms_draw
        BR   rd_ms_none
rd_ms_none:
        LDP  C1_REND5
        BR   rd_launcher
rd_ms_draw:
        TMA
        LDX  FILE_D3
        TCY  NIB_RGRID
        TAM
        LDX  FILE_STATE
        TCY  NIB_MLANE
        TMA
        LDX  FILE_D3
        TCY  NIB_RLNE
        TAM
        TBIT1 1                 ; lane 2 is the one that is not on the O port
        BR   rd_ms_plate8
        COMC
        LDP  P_LEAF
        CALL lane_bit
        COMC
        LDX  FILE_D3
        TCY  NIB_RBIT
        TMA
        TCY  NIB_RGRID
        TMY
        LDX  FILE_D2
        AMAAC
        TAM
        LDP  C1_REND5
        TCY  0
        YNEC 1
        BR   rd_launcher
rd_ms_plate8:
        LDX  FILE_D3
        TCY  NIB_RGRID
        TMY
        TCMIY RPL_R11
        LDP  C1_REND5
        BR   rd_launcher

.PAGE C1_REND5

; --- the launcher, on grid 6's pair plates -----------------------------------

rd_launcher:
        LDX  FILE_STATE
        TCY  NIB_LANE
        TMA
        LDX  FILE_D3
        TCY  NIB_RLNE
        TAM
        TCY  NIB_RGRID
        TCMIY GRID_PLAYER
        TCY  NIB_RLNE
        TBIT1 1
        BR   rd_ln_plate8
        COMC
        LDP  P_LEAF
        CALL lane_bit
        COMC
        LDX  FILE_D3
        TCY  NIB_RBIT
        TMA
        LDX  FILE_D2
        TCY  GRID_PLAYER
        AMAAC
        TAM
        LDP  C1_REND6
        TCY  0
        YNEC 1
        BR   rd_burst
rd_ln_plate8:
        LDX  FILE_D3
        TCY  GRID_PLAYER
        TCMIY RPL_R11
        LDP  C1_REND6
        BR   rd_burst

.PAGE C1_REND6

; --- the burst, and the capture --------------------------------------------
;
; One actor with two meanings, because the tube gives plates 9-11 of every
; playfield grid to whatever bursts in that cell: under grids 1-5 that is the
; pair a jet leaves when the missile kills it, and under grid 6 the starburst
; where the player's own launcher goes. Both are a grid, a lane and a countdown,
; so both are drawn here. On grid 0 the boat's burst is the pair family instead,
; and that case writes a pair nibble rather than an R line.

rd_burst:
        LDX  FILE_STATE
        TCY  NIB_KCOL
        LDP  C1_REND6
        MNEZ
        BR   rd_bk_draw
        BR   rd_bk_none
rd_bk_none:
        LDP  C1_REND7
        BR   rd_capture
rd_bk_draw:
        TMA
        A15AAC                  ; NIB_KCOL is the grid plus one
        LDX  FILE_D3
        TCY  NIB_RGRID
        TAM
        LDX  FILE_STATE
        TCY  NIB_KLANE
        TMA
        LDX  FILE_D3
        TCY  NIB_RLNE
        TAM
        TCY  NIB_RGRID
        MNEZ                    ; grid 0 is the boat's burst, on the pair plates
        BR   rd_bk_plate
        COMC
        LDP  P_LEAF
        CALL lane_bit
        COMC
        LDX  FILE_D3
        TCY  NIB_RBIT
        TMA
        LDX  FILE_D2
        TCY  GRID_BSHIP
        AMAAC
        TAM
        LDP  C1_REND7
        TCY  0
        YNEC 1
        BR   rd_capture
rd_bk_plate:
        LDX  FILE_D3
        TCY  NIB_RLNE
        TMA
        A2AAC                   ; lane L is R(12 + L), the code RPL_BURST + L
        LDX  FILE_D3
        TCY  NIB_RBIT
        TAM
        TCY  NIB_RGRID
        TMY
        LDX  FILE_D3
        TCY  NIB_RBIT
        TMA
        TCY  NIB_RGRID
        TMY
        TAM
        LDP  C1_REND7
        BR   rd_capture

.PAGE C1_REND7

; --- the capture burst, on grid 6's far plates ------------------------------

rd_capture:
        LDX  FILE_TIME
        TCY  NIB_CAPTURE
        MNEZ
        BR   rd_cp_draw
        BR   rd_score
rd_cp_draw:
        LDX  FILE_STATE
        TCY  NIB_KLANE
        TMA
        LDX  FILE_D3
        TCY  NIB_RLNE
        TAM
        COMC
        LDP  P_LEAF
        CALL lane_bit
        COMC
        LDX  FILE_D3
        TCY  NIB_RBIT
        TMA
        LDX  FILE_D1
        TCY  GRID_PLAYER
        AMAAC
        TAM
        TCY  0
        YNEC 1
        BR   rd_score

; --- the score --------------------------------------------------------------
;
; The units digit always shows. The tens digit is blanked when the whole score
; is below ten, which is what OPLA_A_DIGIT_BLANK is for - a dark slot in the
; *high* bank, so suppressing it costs the same two instructions as drawing it
; and does not move the status latch. The hundreds indicator is plate 7 of grid
; 7, one lamp rather than a digit, which is why 199 is the top of the range.

rd_score:
        LDX  FILE_TIME
        TCY  NIB_SC_U
        TMA
        LDX  FILE_D3
        TCY  NIB_DIG_U
        TAM
        LDX  FILE_TIME
        TCY  NIB_SC_T
        MNEZ
        BR   rd_sc_tens
        TCY  NIB_SC_H
        MNEZ
        BR   rd_sc_tens
        LDX  FILE_D3
        TCY  NIB_DIG_T
        TCMIY OPLA_A_DIGIT_BLANK
        BR   rd_sc_hund
rd_sc_tens:
        LDX  FILE_TIME
        TCY  NIB_SC_T
        TMA
        LDX  FILE_D3
        TCY  NIB_DIG_T
        TAM
        BR   rd_sc_hund
rd_sc_hund:
        LDX  FILE_TIME
        TCY  NIB_SC_H
        MNEZ
        BR   rd_sc_lamp
        BR   rd_done
rd_sc_lamp:
        LDX  FILE_D2
        TCY  GRID_SC_T
        TCMIY OPLA_A_PAIR + 2   ; plate 7, and never plate 6 on a digit grid
        BR   rd_done
rd_done:
        COMC
        LDP  P_SWEEP
        BR   sweep



; ============================================================================
; Chapter 1, page 12 - the win test
; ============================================================================

.PAGE C1_WINTEST

; --- the win is 199 ----------------------------------------------------------
;
; Two ways to reach it, and both are here because a score that steps by ten can
; jump the exact value. Hundreds reaching two is a score above 199 and is capped
; back to it; otherwise 1-9-9 is tested digit by digit. `A7AAC` carries exactly
; when a BCD digit is nine, which is what makes the test two instructions
; instead of a scratch nibble and a compare.

as_done:
        LDX  FILE_TIME
        TCY  NIB_SC_H
        TMA
        A14AAC                  ; carry iff hundreds >= 2
        BR   as_cap
        BR   as_test_h
as_cap:
        LDX  FILE_TIME
        TCY  NIB_SC_U
        TCMIY 9
        TCMIY 9
        TCMIY 1                 ; 199, the cap
        BR   as_win
as_test_h:
        LDX  FILE_TIME
        TCY  NIB_SC_H
        MNEZ
        BR   as_test_t
        BR   as_out
as_test_t:
        TCY  NIB_SC_T
        TMA
        A7AAC                   ; carry iff the tens digit is nine
        BR   as_test_u
        BR   as_out
as_test_u:
        TCY  NIB_SC_U
        TMA
        A7AAC
        BR   as_win
        BR   as_out
as_win:
        LDP  C1_WIN
        BR   game_win
as_out:
        COMC
        LDP  P_SCORE
        BR   as_out2



; ============================================================================
; Chapter 1, page 13 - the cadence ladder
; ============================================================================

.PAGE C1_LADDER

; --- the ladder --------------------------------------------------------------
;
; STEP_HI = STEP_HI_MAX - kills - STEP_SKILL * (skill - 1), floored at
; STEP_HI_MIN. `SAMAN` is memory minus accumulator, so the subtrahend is built
; in A and the constant put in memory rather than the other way round.
;
; A subroutine rather than a branch target, because the countdown has to be
; reloaded on paths that do not end at `jet_release`. A capture leaves the lane
; walk for `launcher_down` and never reaches the walk's end, so while this was
; entered by branch the countdown stayed as `jet_march` left it - high nibble
; zero, low nibble 15 - and the squadron took its next step sixteen sweeps
; later instead of the ladder's. It holds no `LDP`, which inside a subroutine
; would overwrite the return page, and its one branch stays on this page.

step_reload:
        LDX  FILE_STATE
        TCY  NIB_SKILL
        TMA
        A15AAC                  ; A <- skill - 1
        LDX  FILE_JETS
        TCY  NIB_J_TMP
        TAM
        AMAAC                   ; A <- 2 * (skill - 1), which is STEP_SKILL
        TCY  NIB_J_TMP
        TAM
        LDX  FILE_STATE
        TCY  NIB_KILLS
        TMA
        LDX  FILE_JETS
        TCY  NIB_J_TMP
        AMAAC                   ; A <- kills + 2 * (skill - 1)
        TCY  NIB_J_SCR
        TCMIY STEP_HI_MAX
        TCY  NIB_J_SCR
        SAMAN                   ; A <- STEP_HI_MAX - A
        BR   sr_ok
        CLA
        A1AAC                   ; the floor: one high nibble
sr_ok:
        LDX  FILE_TIME
        TCY  NIB_STEP_HI
        TAM
        TCY  NIB_STEP_LO
        TCMIY 15
        RETN



; ============================================================================
; Chapter 1, page 14 - the battleship, and the sea it sits on
; ============================================================================
;
; The hull is grid 0's near plates and the sea its far plates, and **both are
; drawn here, in the boat's own lane, rather than the sea being held on**. An
; earlier form of this program blanked grid 0's far nibble to `OPLA_A_FAR + 7`
; in `render` instead, which lit all three `sea_lane*` segments on every sweep
; for the life of the game, boat or no boat. Nothing supports that: both of the
; owner's lit-tube close-ups show cell 0 entirely dark, and the 12,237-frame
; video pass written up in `assets/reference/sprites/README.md` tabulates cell 0
; as the battleship and its cyan kill-burst and never a sea. The sea is a real
; anode - `assets/reference/tube-teardown/README.md` finds it in the red-orange
; group beside the hull - but the only evidence of it being *driven* is the boat
; standing on it, so that is when it is driven.

.PAGE C1_REND0

rd_bship:
        LDX  FILE_STATE
        TCY  NIB_BSLANE
        TMA
        LDX  FILE_D3
        TCY  NIB_RLNE
        TAM
        TCY  NIB_RGRID
        TCMIY BS_NONE
        TCY  NIB_RGRID
        LDP  C1_REND0           ; a taken branch always copies PB into PA, so
                                ; even the in-page arm needs PB naming this
                                ; page; the other arm goes through a trampoline
        MNEA                    ; status = the boat is on the glass
        BR   rd_bs_draw
        BR   rd_to_jets
rd_to_jets:
        LDP  C1_REND2
        BR   rd_jets
rd_bs_draw:
        COMC
        LDP  P_LEAF
        CALL lane_bit
        COMC
        LDX  FILE_D3
        TCY  NIB_RBIT
        TMA
        LDX  FILE_D0
        TCY  GRID_BSHIP
        TAM                     ; the hull, on grid 0's near plates
        LDX  FILE_D3
        TCY  NIB_RBIT
        TMA
        A8AAC                   ; OPLA_A_FAR + the same lane bit: the sea the
        LDX  FILE_D1            ; hull sits on, in the hull's own lane. A8AAC
        TCY  GRID_BSHIP         ; carries when the bit is 8 or more, which it
        TAM                     ; never is, and nothing branches on it either
        LDP  C1_REND2
        BR   rd_jets


; ============================================================================
; Chapter 1, page 15 - deciding to launch a rocket
; ============================================================================

.PAGE C1_LAUNCH

rocket_launch:
        LDX  FILE_TIME
        TCY  NIB_TICK
        MNEZ                    ; a unit is sixteen sweeps: spend one only on
        BR   rl_wait            ; the sweep the tick counter wraps
        TCY  NIB_ROCK_LO
        DMAN
        BR   rl_low_left
        TAM
        TCY  NIB_ROCK_HI
        DMAN
        BR   rl_high_left
        BR   rl_due
rl_high_left:
        TAM
        COMC
        LDP  P_ROCKET
        BR   tr_done
rl_low_left:
        TAM
rl_wait:
        COMC
        LDP  P_ROCKET
        BR   tr_done
rl_due:
        LDX  FILE_STATE
        TCY  NIB_SKILL
        TMA
        A15AAC                  ; A <- skill - 1
        LDX  FILE_JETS
        TCY  NIB_J_SCR
        TCMIY ROCK_HI_BASE
        TCY  NIB_J_SCR
        SAMAN
        BR   rl_ok
        CLA
        A1AAC
rl_ok:
        LDX  FILE_TIME
        TCY  NIB_ROCK_HI
        TAM
        TCY  NIB_ROCK_LO
        TCMIY 15
        LDP  C1_FIRE
        BR   rocket_fire

.END
