; jetfighter.asm - the game ROM the emulator runs.
;
; The whole game: the display sweep, the input matrix, the plate bus, the speaker
; pin, and the rules from docs/prd/jet-fighters-v1.md R2/R6. Everything here is
; meant to be edited, so every routine says what it does, what registers it
; expects and what it leaves behind, and every constant that has an evidence item
; cites it.
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
;   decode the sampled contacts        (input_scan)
;   redraw the plate table             (render_field ... render_hundreds)
;   advance the game one sweep         (tick ... tick_input)
;   repeat
;
; Because D0-D6 do double duty as grid drives and input strobes (board.ts), the
; sweep samples the case controls for free: whichever contact sits on the line
; currently being lit answers on D15. There is no separate keyboard scan.
;
; --- Call depth --------------------------------------------------------------
;
; The subroutine stack is four levels deep and *wraps* rather than faulting
; (src/machine/cpu/registers.ts), so a fifth simultaneous push silently corrupts
; a return address. The deepest path in this ROM is exactly four and is load
; bearing:
;
;   sweep -CALL-> tick -CALL-> play_sound -CALL-> note_half
;
; with add_score/score_cap/game_win reaching the same depth on the scoring path.
; The `tick` and `render` chains are therefore linked with JMPL, not CALL: a jump
; pushes nothing, so a chain of twenty blocks still costs one stack level. Adding
; a CALL inside play_sound, note_half, or anything they reach would overflow.
;
; --- Paging ------------------------------------------------------------------
;
; BR and CAL carry a five-bit offset against 32-word pages (memory.ts), so a
; BR can only reach a target in its own page. `.PAGE` starts a routine on a page
; boundary, which is the blunt way to guarantee that - and for a long time every
; routine here carried one.
;
; **Most of them did not need it.** A routine only needs its own page if its
; branches would otherwise straddle a boundary, and most of these are short
; enough to fall inside one wherever they land. Sixty `.PAGE` directives cost
; 783 words of alignment padding - more than half the program region - against
; 1240 words of actual code, and the ROM was within ten words of the ceiling
; while nearly a quarter of it was padding. Twenty-four remain, one for each
; routine that genuinely reaches across a boundary without one.
;
; The check is the assembler's, not a convention: a BR whose target is on
; another page is a hard assembly error naming both pages, so a routine that
; grows past what its placement allows fails the build rather than
; miscompiling. If you add code and the assembler complains about a branch,
; putting `.PAGE` back on that routine is the fix.
;
; One warning for anyone checking a paging change by diffing the assembled
; words: **the word streams will not match, and that is expected.** JMPL and
; CALL carry absolute addresses, so moving code necessarily changes their
; operands. What must match is the emitted word *count* and the cycle timing;
; comparing grid-on intervals between two builds is the check that actually
; means something.
;
; A routine may still run past 32 words - draw_jet and close_up do - provided
; nothing past the boundary is a branch target. CAL additionally fixes its page
; at 0, which is why page 0 holds only `dwell` and `find_contact`; everything
; else is reached with the two-word CALL, which goes anywhere.
;
; --- Timing is provisional, and deliberately so -----------------------------
;
; docs/evidence/timing-analysis.md records that the per-skill gameplay video does
; not exist, so **no** cadence in this game can be derived from the unit. Every
; cadence constant is collected in the "Provisional cadence constants" block
; below, is marked PROVISIONAL, and carries the reasoning that picked it. None of
; them is a measurement and none should be read as one. When the video arrives,
; that one block is the only thing that has to change.
;
; The *sound* constants are different: docs/evidence/audio-reference.md measured
; every band from the owner's recordings of the real unit, and the sound table
; near the bottom of this file cites the row each figure comes from. Pitches are
; real targets; the note and burst *lengths* are a mixture (see that table).

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
; The board wires a twenty-line plate bus to R0-R4 (src/machine/board/display.ts,
; PLATE_COUNT = R_PIN_COUNT = 20), so R3 and R4 are there when a grid needs more
; than twelve plates. None does at the moment: the busiest is a jet column, at
; twelve. See the sweep for when that changes.

.EQU D_SPEAKER,     14          ; the 1-bit piezo
.EQU D_INPUT,       15          ; the matrix read-back line

; Strobe lines, which are the low grid lines. See INPUT_SWITCHES in
; src/machine/board/input.ts - this table is the ROM's side of that wiring.
.EQU LINE_FIRE,      0
.EQU LINE_LEVER,     1          ; lines 1,2,3 = lever up, centre, down
.EQU LINE_SKILL,     4          ; lines 4,5,6 = skill 1, 2, 3

; --- Playfield geometry -----------------------------------------------------
;
; The tube is not ours to choose. Which phosphor segment sits at which
; (grid, plate) address is fixed by the glass, and this machine's description of
; that glass is the segment atlas, src/machine/tube/atlas.json - documented in
; src/machine/tube/ATLAS-COORDINATES.md, "Grid and plate mapping". The ROM has to
; drive the tube it is soldered to, so every address below is copied from that
; table with this citation, not invented here:
;
;   grid 0        distance column 0 - the far side, BATTLE SHIP ZONE, ruler "10"
;   grids 1-4     distance columns 1-4 - JET FIGHTER FLYING ZONE
;   grid 5        distance column 5 - the G capture line and the launcher
;   grids 6,7,8   SCORE - hundreds, tens, units
;   grid 9        status: the lit SCORE label, and nothing else - this unit has
;                 no lives display, only the beeped damage warnings
;
; Six distance columns, +x toward the missile station: a jet enters at grid 0 and
; marches toward grid 5. There is no ground-line segment - the
; playfield border, the lane dashes and the 10/3/2/1/G ruler are printed
; silkscreen on the overlay, not phosphor.
;
; The *game's* column numbering runs the other way, and is deliberately left
; alone: column 0 is the G line, column 6 the battleship zone, and the squadron
; advances by counting down. PAT_COLUMN carries the column -> grid translation so
; the tick chain never has to know which end of the glass it is looking at.
;
; **That translation is now one to one.** It used to send both column 5 and
; column 6 to grid 0, because the atlas gave the playfield six grids and the
; ROM has always had seven columns - so the far jet column and the battleship's
; zone shared a grid and neither the ROM nor any test could tell them apart. The
; teardown photographs (assets/reference/tube-teardown/) count seven printed
; cell boxes, and the score is two digit cells rather than three, which is where
; the seventh playfield grid comes from. Column N is now grid 6 - N, and a cell
; and a grid are the same thing.
;
; The overlay's printed ruler reads 10 / 3 / 2 / 1 / G from the far side inwards
; (PRD v1, "The original hardware"). Which column falls in which band is *not*
; established by any reference asset, so the split below (5=3, 4,3=2, 2,1=1) is
; this ROM's reading of the ruler and is recorded in PAT_COLUMN rather than
; spread through the code.

.EQU COL_LAUNCH,     0          ; the launcher's column, and the G line
.EQU COL_MSL_START,  1          ; the column a launched missile appears in
.EQU COL_JET_FAR,    5          ; the far column a jet enters the field at - the
                                ; battleship side of the flying zone, grid 1
.EQU COL_BSHIP,      6          ; the battleship's column
.EQU COL_MSL_LAST,   5          ; the last column a missile is drawn in. The
                                ; tube has no dart in the battleship's cell, so
                                ; a shot that reaches column 6 to test the ship
                                ; is not drawn on the way - which is what the
                                ; video shows: the missile is never lit there.
.EQU COL_NO_BURST,   6          ; the battleship's column, the one column with
                                ; no burst on plates 9-11. The tube does carry a
                                ; burst behind the ship, but it is a different
                                ; shape in a cell of its own and is not drawn
                                ; yet - see ATLAS-COORDINATES.md, known gaps.
.EQU GRID_LAUNCH,    6          ; atlas: the launcher segments live on grid 6
.EQU GRID_BSHIP,     0          ; atlas: the three battleship segments, grid 0
.EQU GRID_SC_T,      7          ; score: the tens digit, and the hundreds
                                ; half-digit that shares its cell
.EQU GRID_SC_U,      8          ; score, units
.EQU GRID_STATUS,    9          ; the lit SCORE label, the grid's one segment

; --- Plate assignments ------------------------------------------------------
;
; A segment is a (grid, plate) pair, so the same plate line means different
; things under different grids - that is how a multiplexed tube works, not an
; overload. Plates 0-11 are the ones the segment atlas addresses
; (src/machine/tube/atlas-schema.ts), and the assignment below is that atlas's,
; not a convention of this file. The two-colour split follows the real unit: red
; for everything on the jets' side, cyan for the player's.
;
;   grid 0 (the battleship's own cell)
;     plates 0-2   red:  the battleship standing in lane 0, 1, 2
;   grids 1-5 (the five jet columns)
;     plates 0-2   red:  the jet in lane 0, 1, 2 of that column
;     plates 3-5   red:  that lane's attacker colon, the shot fired back
;     plates 6-8   cyan: the missile dart crossing that cell
;     plates 9-11  cyan: the burst a jet leaves when the missile kills it
;   grid 6 (the player's own cell, at the G line)
;     plates 6-8   cyan: the launcher standing in lane 0, 1, 2
;     plates 9-11  red:  the burst where it is destroyed
;   grid 7         cyan: plates 0-6 the tens digit a-g, plate 7 the hundreds
;                        half-digit - two strokes reading 1, on one plate
;   grid 8         cyan: plates 0-6 the units digit a-g
;   grid 9         cyan: plate 0 the SCORE label - the only segment on the grid
;
; Neither end cell carries a jet, so grids 0 and 6 have nothing on plates 0-5
; and 3-5 respectively: the teardown photographs show no aircraft printed in the
; battleship's cell or the player's. Those addresses are unwired, and
; tools/probe/rom-atlas-conformance.test.ts fails if this ROM drives one.
;
; Plates 0-3 are R0, 4-7 are R1 and 8-11 are R2, so a segment's plate decides
; which of the three plate files carries it. Several actors straddle a boundary
; - the colons are plates 3,4,5 and the player's object 6,7,8 - so PAT_LANE
; stores the *file* alongside the bit and or_plate below does the dispatch. The
; battleship does not go through or_plate: it is the only thing in its cell, so
; render_bship writes the file directly.

.EQU PLATE_SC_LBL,  %0001       ; R0 bit 0 -> plate 0, under grid 9
.EQU PLATE_SC_HUND, %1000       ; R1 bit 3 -> plate 7, under grid 7: the
                                ; hundreds half-digit. The readout caps at 199,
                                ; so it reads 1 or nothing and needs one bit
                                ; rather than a seven-segment lookup.

; --- Pattern tables ---------------------------------------------------------
;
; `P` reads one word of the pattern region and splits it: low nibble into A,
; high nibble into B. Every table below therefore packs two nibbles per entry and
; the comment says which is which. Eight tables of sixteen entries is the whole
; pattern region (isa.ts, PATTERN_TABLE_COUNT), and all eight are in use.

.EQU PAT_LANE,       0          ; actor+lane -> A = plate file, B = plate bit
.EQU PAT_DIGIT,      1          ; 0-9   -> A = segments a-d,    B = segments e-g
.EQU PAT_COLUMN,     2          ; column -> A = display grid,   B = points
.EQU PAT_ROCKET,     3          ; skill -> rocket interval, sweeps (A lo, B hi)
.EQU PAT_STEP,       4          ; speed -> squadron cadence, sweeps (A lo, B hi)
.EQU PAT_SKILL,      5          ; skill -> A = base index into PAT_STEP
.EQU PAT_SND_A,      6          ; sound -> A = half inner,      B = half outer
.EQU PAT_SND_B,      7          ; sound -> A = half repeat,     B = periods-1

; ============================================================================
; RAM map
; ============================================================================
;
; 160 nibbles: ten files of sixteen, X selects the file and Y indexes within it
; (src/machine/cpu/memory.ts). Eight files are used, so the static high-water
; mark is 128 nibbles.
;
; | file | name        | contents                                             |
; |------|-------------|------------------------------------------------------|
; |  0   | FILE_PLATE0 | per grid, the nibble driven onto R0 when it strobes   |
; |  1   | FILE_PLATE1 | the same for R1                                       |
; |  2   | FILE_PLATE2 | the same for R2                                       |
; |  3   | FILE_STATE  | the game's entities and control positions             |
; |  4   | FILE_INPUT  | one nibble per strobe line: 1 = contact closed        |
; |  5   | FILE_SOUND  | the note being played and its loop counters           |
; |  6   | FILE_TIME   | every countdown, plus the BCD score                   |
; |  7   | FILE_JETS   | the three lanes' jets, and how each one is flown      |
;
; The plate table is the important one. Three files hold, per grid, the nibble
; that goes to R0, R1 and R2 when that grid is strobed. The sweep does no drawing
; at all - it copies three nibbles and lights the grid - so redrawing and
; displaying are completely separate, which is what keeps the sweep short enough
; to have a stable period. It also means the game state lives substantially *in*
; the plate patterns: what is on the tube is a function of RAM files 0-2 and
; nothing else, and every render_* block below writes only those three files.

.EQU FILE_PLATE0,    0
.EQU FILE_PLATE1,    1
.EQU FILE_PLATE2,    2
.EQU FILE_STATE,     3
.EQU FILE_INPUT,     4
.EQU FILE_SOUND,     5
.EQU FILE_TIME,      6
.EQU FILE_JETS,      7

; --- FILE_STATE: the entities ------------------------------------------------
.EQU NIB_LANE,       0          ; lever lane, 0 top .. 2 bottom
.EQU NIB_SKILL,      1          ; skill dial, 1..3
.EQU NIB_FIRE,       2          ; fire contact, this sweep
.EQU NIB_FIRE_PREV,  3          ; fire contact, previous sweep
.EQU NIB_KCOL,       4          ; the burst on the glass: the column it stands
                                ; in plus one, 0 = nothing bursting. Held the
                                ; squadron's leading column when the squadron
                                ; was one rigid block, and has been spare since.
.EQU NIB_MCOL,       5          ; player missile column, 0 = none in flight
.EQU NIB_MLANE,      6          ; player missile lane
.EQU NIB_RCOL,       7          ; jet rocket column, 0 = none in flight
.EQU NIB_RLANE,      8          ; jet rocket lane
.EQU NIB_BSLANE,     9          ; battleship lane, or BS_NONE when not crossing
.EQU NIB_HITS,      10          ; launchers destroyed so far, 0..3
.EQU NIB_STATE,     11          ; ST_PLAY / ST_OVER / ST_WIN
.EQU NIB_KILLS,     12          ; jets shot down in this wave, 0..6
.EQU NIB_WAVE,      13          ; squadrons cleared
.EQU NIB_RAND,      14          ; free-running counter, sampled on a keypress
.EQU NIB_KLANE,     15          ; the lane that burst is in

; --- FILE_TIME: countdowns and the score -------------------------------------
;
; The two-nibble timers are (lo, hi) pairs at consecutive indices, because
; dec_timer takes the lo index in Y and finds hi at Y+1. A pair counts
; hi*16 + lo sweeps, which is the range a squadron cadence needs; the one-nibble
; timers never exceed fifteen sweeps.
.EQU NIB_TICK,       0          ; sweeps counted, wrapping every sixteen
.EQU NIB_ENTRY_LO,   1          ; sweeps until the next jet enters, low nibble
.EQU NIB_ENTRY_HI,   2          ;   "                               high nibble
.EQU NIB_MSTEP,      3          ; sweeps until the player missile advances
.EQU NIB_RSTEP,      4          ; sweeps until the jet rocket advances
.EQU NIB_BSTEP,      5          ; sweeps until the battleship advances
.EQU NIB_ROCK_LO,    6          ; countdown to the next rocket launch, low
.EQU NIB_ROCK_HI,    7          ;   "                                  high
.EQU NIB_BS_LO,      8          ; countdown to the next crossing, low
.EQU NIB_BS_HI,      9          ;   "                             high
.EQU NIB_SC_U,      10          ; score, BCD units
.EQU NIB_SC_T,      11          ; score, BCD tens
.EQU NIB_SC_H,      12          ; score, BCD hundreds
.EQU NIB_SCRATCH,   13          ; render/score scratch
.EQU NIB_SCRATCH2,  14          ; render scratch
.EQU NIB_KSTEP,     15          ; sweeps the burst stays lit for

; --- FILE_SOUND: the note being played ---------------------------------------
;
; NIB_HALF_IN..NIB_PERIODS are consecutive on purpose: play_sound writes all four
; with two `P` lookups and four LMAIY, which is why their order may not change.
.EQU NIB_HALF_IN,    0          ; inner delay count of the half-period loop
.EQU NIB_HALF_OUT,   1          ; outer delay count
.EQU NIB_HALF_REP,   2          ; whole-delay repeat count, minus one
.EQU NIB_PERIODS,    3          ; square-wave periods per burst, minus one
.EQU NIB_REP_LEFT,   4          ; note_half's repeat counter
.EQU NIB_PERIOD_LEFT, 5         ; note_loop's period counter
.EQU NIB_BURST_LEFT, 6          ; note_loop's burst counter
.EQU NIB_SND_ID,     7          ; the sound being set up
.EQU NIB_NOTE_LEFT,  8          ; win jingle: arpeggio repeats left

; --- FILE_JETS: one jet per lane, each flying its own step ---------------------
;
; A lane's jet nibble is the column it stands in *plus one*, so that zero can
; mean "no jet in this lane" without stealing column 0 - which is the G line, and
; a jet has to be able to stand there for jet_move to notice it has arrived.
; Nothing draws it there: draw_jet declines that column because the tube prints
; no aircraft in the player's cell, and jm_capture clears the lane on the same
; sweep. What the player sees at a capture is the burst in that cell.
;
; Each lane carries its own (lo, hi) step countdown, reloaded from the same
; PAT_STEP cadence every jet steps on. Same period, different phase: the jets
; therefore step one at a time rather than as a block, and the phases come from
; the sweeps their lanes happened to be filled on.
.EQU NIB_J_LANE0,    0          ; lane 0's jet: its column + 1, 0 = lane empty
                                ; 1 and 2 are lanes 1 and 2, indexed by the lane
.EQU NIB_J_STEP,     3          ; lane 0's step countdown (lo, hi); lane L's pair
                                ; is at NIB_J_STEP + 2*L
.EQU NIB_J_SENT,     9          ; jets of this wave released so far, 0..6
.EQU NIB_J_ROTOR,   10          ; the lane the next entry tries
.EQU NIB_J_WORK,    11          ; the lane being worked on
.EQU NIB_J_TEMP,    12          ; scratch, for a cadence's high nibble
.EQU NIB_J_FLAG,    13          ; this sweep: bit 0 a jet stepped, bit 1 captured
.EQU FLAG_STEPPED,   0
.EQU FLAG_CAPTURED,  1

; The assembler counts any constant named RAM_* into the high-water mark it
; reports (tools/hmasm/assembler.ts). render_field and main select files through
; LXA, whose operand is a register and therefore invisible to that count, so the
; ceiling is declared here rather than left to be inferred from the LXI operands.
.EQU RAM_TOP,      127          ; FILE_JETS * 16 + 15

; --- Values -----------------------------------------------------------------

.EQU LANE_TOP,       0
.EQU LANE_CENTRE,    1
.EQU LANE_LAST,      2          ; three lanes, 0..2
.EQU LANE_COUNT,     3
.EQU SKILL_ONE,      1
.EQU SKILL_LAST,     3          ; three skill settings, 1..3
.EQU CONTACT_NONE,  15          ; find_contact's "nothing was closed" answer
.EQU BS_NONE,       15          ; NIB_BSLANE when no crossing is in progress
.EQU JET_COUNT,      6          ; a squadron: six jets, released a few at a time
; How many of the six may be in the air at once. Two, from
; assets/reference/device-front-gameplay.jpg: the unit has two jets on the
; screen, in different lanes, at different distances - not a rank in every lane.
; This is a count read off a photograph of the running unit, not a cadence, so it
; is not one of the provisional timing constants below.
.EQU AIRBORNE_MAX,   2

; PAT_LANE is four groups of three, one per actor, indexed by group base + lane.
; Grouping them into one table rather than four costs an AI and keeps the pattern
; region at the eight tables the hardware has (isa.ts, PATTERN_TABLE_COUNT).
.EQU LANEP_JET,      0          ; +lane -> the jet segment of that lane
.EQU LANEP_ROCKET,   4          ; +lane -> that lane's attacker colon
.EQU LANEP_PLAYER,   8          ; +lane -> the player's own object in that cell
.EQU LANEP_BURST,   12          ; +lane -> the burst in that cell
; The atlas gives every playfield grid the same four plate roles, so the last two
; groups each serve two actors: plates 6-8 are the missile dart under grids 0-4
; and the launcher under grid 5, and plates 9-11 are the jet-kill burst under
; grids 0-3 and the player's own destruction under grid 5. The grid decides
; which segment the address reaches, which is what a multiplexed tube is; the
; ROM needs one group each.
.EQU LANEP_LAUNCH,   LANEP_PLAYER
.EQU LANEP_MISSILE,  LANEP_PLAYER

.EQU SPEED_LAST,    15          ; the last entry in PAT_STEP
; NIB_WAVE saturates here rather than wrapping, and because speed_index adds
; NIB_WAVE to the skill dial's entry point, this is also the entire reach of the
; *permanent* part of the cadence descent: however many squadrons a game clears,
; they can move it at most WAVE_LAST rungs. The thin-out term is separate and
; unbounded by this - NIB_KILLS runs 0..6 and resets every wave.
;
; One, not fifteen, and the gameplay video is why. MEASURED, docs/evidence/
; timing-analysis.md T1/T3: one game in that clip covers the whole scoring range,
; 0 to the 199 cap, and its column step goes from 1067 ms at score 87 to 733 and
; 900 ms at scores 164 and 188. Six rungs' worth of change across an entire game,
; and the thin-out term supplies six rungs on its own. At WAVE_LAST 15 the sum
; instead reached entry 15 at around score 30 and stayed pinned there for the
; remaining 85% of the game, so every game converged on the same cadence within
; its first two waves whatever the dial said. That is the "too fast to play"
; complaint, and it is why the dial stopped mattering.
;
; What it costs, plainly: PRD v1 rule 2's second clause - "each cleared squadron
; respawns faster" - is now worth one rung across a whole game rather than one
; per wave. The video does **not** show that clause to be false. It shows the
; combined rate was far too fast and that the readable data needs no permanent
; term to account for it. T3 is what would size the term properly.
.EQU WAVE_LAST,      1
.EQU ST_PLAY,        0          ; game states; anything above ST_PLAY is an end
.EQU ST_OVER,        1
.EQU ST_WIN,         2

; Sound identifiers - indices into PAT_SND_A / PAT_SND_B. See those tables for
; the pitch each one produces and the audio-reference.md row it targets.
.EQU SND_MISSILE,    0
.EQU SND_MARCH,      1
.EQU SND_BSHIP,      2
.EQU SND_WARN,       3
.EQU SND_WIN1,       4          ; 750 Hz
.EQU SND_WIN2,       5          ; 940 Hz
.EQU SND_WIN3,       6          ; 1240 Hz
.EQU SND_LOSS1,      7
.EQU SND_LOSS2,      8
.EQU SND_LOSS3,      9
.EQU SND_LOSS4,     10
.EQU SND_LOSS5,     11

; Burst counts, minus one, passed to play_sound in B. A burst is
; (NIB_PERIODS + 1) periods, so a note is (bursts) * (periods) square-wave
; cycles; the arithmetic for each is in the sound table at the foot of the file.
;
; These are note *lengths*, not game cadence: they say how long one sound lasts,
; never how often the game triggers it. The provisional-cadence block below owns
; the second question and none of these constants appear in it.
.EQU BURSTS_MISSILE, 3
.EQU BURSTS_MARCH,   2          ; 3 bursts x 15 periods = 70.4 ms, see the table
.EQU BURSTS_BSHIP,   1          ; 2 bursts x 10 periods = 69.7 ms, see the table
.EQU BURSTS_WARN,    0
.EQU BURSTS_WIN1,    8
.EQU BURSTS_WIN2,    8
.EQU BURSTS_WIN3,   11
.EQU BURSTS_WINEND, 15
.EQU BURSTS_LOSS1,   0
.EQU BURSTS_LOSS2,   0
.EQU BURSTS_LOSS3,   3
.EQU BURSTS_LOSS4,   1
.EQU BURSTS_LOSS5,   1

; ============================================================================
; Provisional cadence constants
; ============================================================================
;
; PROVISIONAL - see docs/evidence/timing-analysis.md.
;
; Every number in this block, and every entry of PAT_STEP and PAT_ROCKET at the
; foot of the file, is provisional. The gameplay video that T2-T10 of that
; document are to be measured from is owner-supplied and still pending, so the
; thin-out speed-up curve, the wave respawn speed-up, the battleship crossing
; duration and interval, the missile and rocket travel times and the rocket fire
; rate have **no measured values at all**.
;
; One row is no longer in that state. T1's audio cross-check has now been done:
; the march beep fires once per sweep in which a jet stepped, and its onsets in
; assets/reference/gameplay-audio.m4a run at 205 ms (n = 21 intervals inside five
; uninterrupted runs, sd 22 ms, 55-121 s of that recording). timing-analysis.md
; records the method and the interpretation limits. That figure is a squadron
; step rate, not a per-jet period, so it bounds the *floor* of the ladder below -
; the real unit was never observed to step faster than that - and it is cited
; there as derived rather than invented. It does not fix any other rung.
;
; What the rest of these numbers are: the v1 browser game's behavioural
; approximations, which timing-analysis.md preserves in its "Current unverified
; working values" table precisely so the v2 ROM would not guess a second time,
; adjusted where the machine was measurably unplayable. v1 ran logic at 60 Hz, so
; its tick counts convert to seconds as ticks/60; this ROM's sweep is its only
; clock and runs at 13.46 ms with an idle playfield (measured by driving the
; emulated machine, not off the unit - see DWELL below), so seconds convert back
; to sweeps at roughly 74 per second. That is the figure every ms in this block
; converts through, for the same reason the old block used the old 15.46 ms: it
; is the sweep the ROM's own arithmetic produces, reproducibly, with nothing
; drawn. A sweep during play is longer - see DWELL for the spread - so these
; nominal figures run short of wall clock even before a sound stops the sweep.
; The conversion is arithmetic on an approximation - it does not make the result
; a measurement.
;
; Every sweep count in this block was re-derived when the sweep rate moved from
; 64.5 Hz to 71.5 Hz during play (D4 of docs/evidence/vfd-appearance.md). The
; wall-clock figures are what the anchors are stated in - v1's tuning, a human
; reaction window, the march beep's measured 205 ms - so the ms figures were held
; and the sweep counts recomputed against the shorter sweep, not the other way
; round.
;
; A sweep count is not the whole story in wall clock, and the gap matters here:
; note_loop does not sweep the tube while a sound plays, so a cadence of N sweeps
; lands longer than N * 13.46 ms whenever a note fires inside it. The measured
; figures quoted below are wall clock off the probe; the nominal figures are the
; sweep arithmetic. Both are given, because only the first is what a player
; experiences and only the second is what the ROM stores.
;
; What the mechanism is, and is not: the cadence *mechanism* here is real work -
; integer sweep counts, a per-skill entry point into one cadence ladder, a
; thin-out and per-wave speed-up that walk down that ladder, and a floor at its
; last entry. When the video arrives, only the numbers move.

; DWELL: how long one grid stays lit, and with it the sweep rate. The loop below
; costs (DWELL_OUTER + 1) * (2 * DWELL_INNER + 6) + 4 machine cycles - the 6
; rather than 5 being the pad NOP, see below - so 15 * 32 + 4 = 484, and one grid
; costs about 506 cycles including the sweep's own work. A whole sweep with an
; idle playfield is
;
;   10 * ((DWELL_OUTER + 1) * (2 * DWELL_INNER + 6) + 4) + 543
;
; machine cycles - the 543 being the ten grids' own port and matrix work plus
; input_scan, render_field and tick between sweeps with nothing on the tube. That
; is 5383 cycles = 13.46 ms; a sweep during play runs about 210 cycles longer,
; because render_field has jets, rockets and a score to lay out, so the rate that
; matters lands near 71.5 Hz. Both figures are measured off the emulated machine.
;
; 64.5 Hz is **excluded by the reference video**. docs/evidence/vfd-appearance.md
; section 2 measures the beat between the tube's refresh and the camera's 30 fps
; sampling at 10.6-12.5 Hz; 64.5 Hz would beat at |64.5 - 60| = 4.5 Hz, 2.4x to
; 2.8x too slow. Aliasing admits only disjoint intervals - 40.6-42.5, 47.5-49.4,
; 70.6-72.5, 77.5-79.4, 100.6-102.5, 107.5-109.4 and 130.6-132.5 Hz - and 64.5 Hz
; falls in the gap between the second and the third. 70.6-72.5 Hz is the interval
; adjacent to what this ROM used to do, and is the one targeted here.
;
; **Which sweeps the interval is a statement about.** It brackets the *mean*
; refresh rate of a tube being watched during play, so that is the population
; tuned to here: the ROM playing a game, over the sweeps that carry no sound. A
; sweep with a note in it is the note's length longer - note_loop does not strobe
; the grids - and vfd-appearance.md excludes blanked frames from its own refresh
; figures for the same reason. The spread across populations is real and is wider
; than the interval: this ROM runs 74.3 Hz with nothing on the tube, 71.9 Hz on
; an unattended game and 71.5 Hz on a played one. Quoting one number without the
; population is what would make this look tuned to two decimal places.
;
; Why the extra NOP in the dwell loop. Both counters are nibbles, so
; (DWELL_OUTER + 1) * (2 * DWELL_INNER + 5) can only take the values 465, 490,
; 495 and 496 anywhere near the target, and the gaps between them are 1.8 Hz -
; almost the whole width of the interval. Every one of those rungs puts a played
; game at 69.5-70.2 Hz, below the interval, and the rung above overshoots it
; entirely. One NOP inside the outer pass makes the multiplier even, which moves
; the reachable set, and 15 * 32 + 4 = 484 lands the played-game mean at 71.5 Hz,
; the middle of the interval. It is a timing pad in a delay loop, which is what
; the loop is - the same device as the seven NOPs in note_half.
;
; The interval brackets the mean, not every pass: the video also shows the sweep
; is not frequency-stable, and this ROM's is not either - the between-sweep game
; work varies with what is on the tube, and a sound stops the sweep outright.
; src/machine/board/display.ts derives the frame period from the ROM rather than
; imposing one, which is what keeps that true.
.EQU DWELL_OUTER,   14
.EQU DWELL_INNER,   13

; How many sweeps a shot spends in each column. PROVISIONAL: v1 moved both a
; missile and a rocket one column per 60 Hz tick, i.e. ~16.7 ms, which converts
; to about one sweep here. T7 and T8 remain unmeasured.
;
; The two are no longer the same number, and the asymmetry is deliberate. The
; rocket is the one shot the player has to *respond* to: the only defence is to
; move the lever out of its lane before it lands, so its flight is the game's
; reaction window. At ROCKET_SWEEPS = 2 the probe measured a rocket crossing the
; whole board in 235 ms mean (n = 5, max 387 ms), and from a jet mid-board in
; ~150 ms - at or below the ~250 ms floor for a simple human reaction, and well
; below the 300-500 ms a see-decide-move-the-lever response costs. That is the
; measured reason the game could not be played, and it is the anchor for the new
; figure: 7 sweeps is ~94 ms nominal per column, so a full-board flight is a
; little over half a second and a mid-board one is inside the reaction band.
; The anchor is human reaction time, not the unit - still not a measurement of
; the real machine. It was 6 sweeps at the old 15.46 ms sweep, which is the same
; 93-94 ms window; the count moved with the sweep so the window would not.
;
; The player's missile keeps the fast figure. Nothing has to be dodged in
; response to it, so slowing it would only take time away from the player, and
; the complaint being fixed here is that the game is too fast. Two sweeps is
; 26.9 ms, which already rounds up from v1's ~16.7 ms, so it did not move.
.EQU MISSILE_SWEEPS, 2
.EQU ROCKET_SWEEPS,  7

; The battleship. PROVISIONAL: v1 crossed the far zone in 400 ms, which over the
; three lanes of this geometry is ~133 ms per lane step.
;
; Nine sweeps was that figure divided by the sweep alone, and the sweep is not
; all a lane step costs. Every lane step triggers a buzz, note_loop does not
; scan the tube while it runs, so the note's own 67.9 ms is part of the step and
; not something that happens beside it. Nine sweeps therefore bought
; 9 * 14.5 + 67.9 = 198 ms a step, and the crossing came out at 593 ms MEASURED
; against the 400 ms it was sized for - half as long again.
;
; That overrun is what the owner heard as the crossing not being announced. The
; three buzzes are 68 ms each whatever this constant says; stretching the
; crossing only pushes them apart, and at 198 ms a step they sat 142 ms of
; silence apart and covered 26% of the crossing. Three isolated blips the same
; length and envelope as a jet-march step do not read as the "distinctly lower,
; sustained buzz" audio-reference.md records - they read as more marching.
;
; Four sweeps is the same 400 ms target with the note counted: 4 * 14.5 + 67.9 =
; 126 ms a step, 378 ms the crossing, the buzzes 58 ms apart and sounding for
; 54% of it. The count is what moved, not the target. Four rather than five
; (421 ms nominal) because a sweep inside a crossing is routinely stretched by
; the march and missile notes landing in it, so a crossing measures longer than
; nominal in play: 457 ms against 522 ms, either side of v1's 400 ms.
;
; The gap between crossings is BSHIP_GAP_HI*16 plus the sampled counter, i.e.
; 48-63 sweeps, 646-848 ms, straddling v1's ~833 ms mean, with the spread coming
; from the only randomness source the machine has rather than from a measured
; distribution. That constant did not move: the gap is expressible only as
; HI*16 + 0..15, and the next rung up is 64-79 sweeps, 861-1063 ms, which
; overshoots v1 by more than 3 understates it. T5 and T6 remain unmeasured,
; including whether the real interval is random at all.
.EQU BSHIP_SWEEPS,   4
.EQU BSHIP_GAP_HI,   3

; How long a burst stays on the glass, in sweeps. PROVISIONAL, and the only
; number this ROM has ever had for it: nothing drove a burst segment before, so
; there is no earlier value to preserve and no measurement to honour. The
; gameplay video shows a jet-kill burst persisting long enough to be caught in
; several consecutive frames alongside a separately-visible missile, so it
; outlives the sweep it is created on by a clear margin rather than flashing for
; one; fifteen sweeps is about 200 ms at the current sweep rate. It is a nibble,
; so fifteen is also the longest this counter can express.
.EQU BURST_SWEEPS,  15

; The gap between launcher-hit warning beeps. This one is *measured*: 25-28 ms
; (docs/evidence/audio-reference.md, launcherHitWarning.gapMs). The loop runs
; WARN_GAP + 1 passes of two dwells plus two cycles. It is counted in dwells, so
; it moved when the dwell did: a pass costs 972 cycles now against 1132 before,
; so WARN_GAP = 8 would have given 8757 cycles = 21.9 ms, below the measured
; band. Eleven passes is 10697 cycles = 26.7 ms, near the middle of it; ten is
; 24.3 ms and twelve is 29.2 ms, both outside. All four figures are counted off
; the machine.
.EQU WARN_GAP,      10

; PRESCALE: the timer runs free from reset and is read only by tick_input, which
; samples it when the player presses fire. That sample is the machine's entire
; randomness source (PRD R3) - there is no RNG - so it is started at reset rather
; than on first use, because a counter with no history has no phase to read.
; PROVISIONAL: 2^6 machine cycles per tick.
.EQU PRESCALE,       6

; ============================================================================
; the reset vector and the routines CAL can reach
; ============================================================================
;
; CAL carries a five-bit offset and its page is fixed at 0
; (src/machine/cpu/isa.ts), so page 0 is the only place a one-word call can land.
; It holds the two routines called from the tightest loops - the grid dwell and
; the contact scan. Everything else is reached with CALL, which costs a second
; word but goes anywhere, and page 0 is deliberately left with room to spare.

.ORG $000
reset:  JMPL main

; --- dwell: hold the current grid lit ---------------------------------------
;
; In:  nothing. Out: nothing. Clobbers: B. Preserves X and Y.
;
; The sweep keeps the grid index in Y and the RAM file in X, and this routine
; needs a spare counter, so it parks both in the shadow pointers with XSP and
; puts them back on the way out. That is what XSP is for; saving Y to RAM would
; cost more cycles than the counter it frees. warn_gap relies on the same
; property to count its own loop in Y.
dwell:  XSP                     ; caller's X/Y -> SPX/SPY
        LBI DWELL_OUTER
dw_out: LYI DWELL_INNER
        NOP                     ; timing pad - see DWELL above for why one cycle
                                ; per outer pass is the knob the sweep rate needs
dw_in:  DY                      ; ST <- 1 until Y wraps out of four bits
        BR dw_in
        DB                      ; ST <- 1 until B wraps
        BR dw_out
        XSP                     ; SPX/SPY -> X/Y
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
; the master loop
; ============================================================================
;
; One pass is one display frame. The board closes a PWM frame when a grid rises
; that has already risen since the last boundary (src/machine/board/display.ts),
; so the frame period is decided here, by how long this loop takes, exactly as it
; is on the real tube.
;
; This routine must stay inside page 1, because `BR sweep_grid` and `BR sweep`
; both reach backwards within it. A fourth CALL would not fit; the three below
; each head a JMPL chain, which is how the game gets more code without more
; stack or more pages here.
;
; It drove a fourth plate file onto R3 for as long as the battleship sat above
; plate 11, which it did only because it shared the far jet column's grid. The
; seventh playfield grid gave the ship a cell of its own and its first three
; plates with it, so nothing on this tube is above plate 11 any more and R3
; would be a nibble of zeroes written ten times a sweep. It comes back the
; moment the player's cell gets the rest of what is printed in it.

.PAGE
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
; turn the sampled matrix lines into control positions
; ============================================================================

.PAGE
; In:  FILE_INPUT holds one nibble per strobe line, written by the sweep.
; Out: FILE_STATE's lane, skill, fire and fire-previous nibbles.
input_scan:
        ; --- carry last sweep's fire state forward before overwriting it ---
        ; The missile launches on the press, not on the hold, so the edge has to
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
; redraw the plate table - the field and the launcher
; ============================================================================
;
; Rendering writes RAM only. Nothing here touches a port: the sweep is the only
; code that drives the tube, so a half-finished redraw can never reach the glass.
;
; The launcher is drawn from the lever position on every pass, in every game
; state. That is deliberate: the real unit leaves the launcher lit after the game
; ends, and it also means the lever keeps moving something on the tube whatever
; else has happened, which is what contract criterion V4 observes.

render_field:
        ; --- clear all three plate files ---
        ; The file number comes out of B, so the assembler's static RAM
        ; high-water mark cannot see these accesses - which is why RAM_TOP above
        ; declares the ceiling explicitly.
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

        ; --- the launcher, in whichever lane the lever selects ---
        ; There is no ground line to draw first: the playfield border, the lane
        ; dashes and the ruler are printed silkscreen, not phosphor. See the
        ; playfield geometry block.
        LXI FILE_STATE
        LYI NIB_LANE
        LAM
        AI LANEP_LAUNCH
        LYI GRID_LAUNCH         ; LYI does not disturb A
        CALL or_plate

        JMPL render_status      ; a jump, not a call: the tail returns for us

; ============================================================================
; one segment onto the plate table
; ============================================================================
;
; In:  A = a PAT_LANE index (an actor's group base plus its lane), Y = the grid
;      the segment hangs under. Out: nothing. Clobbers A, B, X; preserves Y.
;
; Every actor on the playfield is drawn through here, which is what keeps the
; atlas's plate numbers in one table instead of spread through four routines.
; The plate *file* has to be dispatched rather than computed because RAM is
; addressed by X and the file arrives in a register: A and B are both spoken for
; by the time the write happens (B holds the bit, X and Y are the address), so
; there is no register left to carry the file number into LXA. Three LXIs cost
; less than the shadow-pair juggling the alternative would need.
;
; The write ORs rather than overwrites: one grid's nibble can carry three jets,
; or a rocket alongside the battleship.

or_plate:
        P PAT_LANE              ; A <- the plate file, B <- the plate bit
        ALEI FILE_PLATE0
        BR op_file0
        ALEI FILE_PLATE1
        BR op_file1
        LXI FILE_PLATE2
        BR op_write
op_file1:
        LXI FILE_PLATE1
        BR op_write
op_file0:
        LXI FILE_PLATE0
op_write:
        LAM                     ; A <- what is already lit on that plate nibble
        OR                      ; A <- A | the segment's bit
        XMA
        RTN

; ============================================================================
; the status grid
; ============================================================================
;
; Grid 9 carries one segment: the lit SCORE label on plate 0. There is no lives
; display on this tube - owner-confirmed against his own CGL unit. The three
; white marks outside the right-hand border of the printed playfield are paint on
; the overlay, not phosphor, which is why the atlas has no segment for them
; (src/machine/tube/atlas.json: grid 9 holds `score_label` and nothing else).
; Damage is signalled by sound alone - launcher_hit's two- and three-beep
; warnings.
;
; This routine used to look NIB_HITS up in PAT_COLUMN and write a tally into
; plates 1-3 alongside the label. Those three addresses reach no phosphor, so the
; write was the ROM telling the hardware to light segments that do not exist -
; the same fault as the invented ground line. The label is a constant, so no
; lookup is needed to draw it.
;
; NIB_HITS itself is untouched: the count of destroyed launchers is real game
; state and drives the warnings and the loss. Only its display was phantom.

render_status:
        LAI PLATE_SC_LBL        ; the whole of grid 9's R0 nibble
        LXI FILE_PLATE0
        LYI GRID_STATUS
        XMA
        JMPL render_actors

; ============================================================================
; the squadron
; ============================================================================
;
; At most one jet flies in each lane, so the squadron is three nibbles: lane L's
; jet is FILE_JETS nibble L, holding the column it stands in plus one.
;
; It is not a rank in every lane, and it is not a block. A wave is still six jets
; (JET_COUNT) but they are released into free lanes a few at a time, each flying
; its own countdown, which is what the reference photograph shows -
; assets/reference/device-front-gameplay.jpg has two jets airborne, in different
; lanes, at different distances. See jet_release and jet_advance.

render_actors:
        LXI FILE_JETS
        LYI 0
ra_jet:
        LAM
        ALEI 0                  ; ST <- 1 when no jet is flying in this lane
        BR ra_next
        CALL draw_jet           ; preserves X and Y for the loop
ra_next:
        IY
        YNEI LANE_COUNT
        BR ra_jet
        JMPL render_bship

; ============================================================================
; one jet
; ============================================================================
;
; In:  X = FILE_JETS, Y = the lane, 0..2. Out: nothing. Preserves X and Y.
;
; The caller's pointers are parked in the shadow pair so the loop above can keep
; walking, which is also how the lane is recovered - LASPY reads it back. It is
; read twice: once to reach the jet's nibble, and once after `P` has taken the
; accumulator, because LANEP_JET is zero and the lane is therefore its own
; PAT_LANE index.

.PAGE
draw_jet:
        XSP                     ; park the loop's X/Y
        LASPY                   ; A <- the lane
        LYA
        LXI FILE_JETS
        LAM                     ; A <- the jet's column, plus one
        AI 15                   ; A <- the column it stands in
        ALEI COL_LAUNCH         ; ST <- 1 when it stands on the capture line
        BR dj_captured          ; the tube prints no jet in the player's cell
        P PAT_COLUMN            ; A <- the grid that column is strobed on
        LYA                     ; Y <- the grid
        LASPY                   ; A <- the lane, which is its own PAT_LANE index
        CALL or_plate
dj_captured:
        XSP                     ; give the loop its X/Y back
        RTN

; ============================================================================
; the battleship
; ============================================================================
;
; Three segments, one per lane, on grid 0's plates 12-14 - the far cell, which
; is where the gameplay video finds the ship and the only place it ever finds
; it. It has a segment per lane because the video finds it in all three, and it
; is stationary in whichever one it is lit in, so a crossing is segments
; lighting and going out rather than a sprite moving. NIB_BSLANE is that lane,
; and it is now what reaches the glass rather than a counter that showed nowhere.
;
; The ship has its cell to itself, so it takes that grid's first three plates
; rather than the high ones it needed while it shared the far jet column's grid.
; The plate bit is 1 << lane; the machine has no shift, and the three PAT_LANE
; slots a fifth group would need are the ones that keep the other four groups a
; single AI apart, so the bit is branched out here instead.

render_bship:
        LXI FILE_STATE
        LYI NIB_BSLANE
        LAM
        ALEI LANE_LAST          ; ST <- 0 when the nibble holds BS_NONE
        BR rb_draw
        JMPL render_rocket
rb_draw:
        LBI %0001               ; lane 0 -> plate 0, R0 bit 0
        ALEI LANE_TOP
        BR rb_write
        LBI %0010               ; lane 1 -> plate 1
        ALEI LANE_CENTRE
        BR rb_write
        LBI %0100               ; lane 2 -> plate 2
rb_write:
        LXI FILE_PLATE0
        LYI GRID_BSHIP
        LAM
        OR
        XMA
        JMPL render_rocket

; ============================================================================
; the jet rocket in flight
; ============================================================================

.PAGE
render_rocket:
        LXI FILE_STATE
        LYI NIB_RCOL
        LAM
        ALEI 0                  ; ST <- 1 when no rocket is in flight
        BR rr_done
        LYI NIB_RLANE
        LAM
        AI LANEP_ROCKET
        LXI FILE_TIME
        LYI NIB_SCRATCH
        XMA                     ; scratch <- the PAT_LANE index
        LXI FILE_STATE
        LYI NIB_RCOL
        LAM
        P PAT_COLUMN            ; A <- the grid that column is strobed on
        LXI FILE_TIME
        LYI NIB_SCRATCH2
        XMA                     ; scratch2 <- the grid
        LYI NIB_SCRATCH
        LBM                     ; B <- the PAT_LANE index
        LYI NIB_SCRATCH2
        LAM
        LYA                     ; Y <- the grid
        LAB
        CALL or_plate
rr_done:
        JMPL render_missile

; ============================================================================
; the player's missile
; ============================================================================
;
; The tube carries fifteen dart segments: one per lane in each of the five
; columns the shot crosses. So the missile is drawn where it actually is, and
; NIB_MCOL - which the tick chain has always advanced column by column for the
; hit tests - now reaches the glass. The atlas used to carry six segments on one
; grid and this routine drew the shot parked there for its whole flight;
; ATLAS-COORDINATES.md named that as the atlas's most likely omission and it was.
;
; The one column it is not drawn in is the battleship's. NIB_MCOL runs one past
; the flying zone so that missile_bship can test the ship, and the tube has no
; dart there - the video never catches one lit in that cell either. A shot in
; that column is in the air and about to hit or expire; it is simply not shown.

render_missile:
        LXI FILE_STATE
        LYI NIB_MCOL
        LAM
        ALEI 0                  ; ST <- 1 when no missile is in flight
        BR rs_done
        ALEI COL_MSL_LAST       ; ST <- 0 once it has run past the flying zone
        BR rs_draw
        JMPL render_burst
rs_draw:
        LYI NIB_MLANE
        LAM
        AI LANEP_MISSILE
        LXI FILE_TIME
        LYI NIB_SCRATCH
        XMA                     ; scratch <- the PAT_LANE index
        LXI FILE_STATE
        LYI NIB_MCOL
        LAM
        P PAT_COLUMN            ; A <- the grid that column is strobed on
        LXI FILE_TIME
        LYI NIB_SCRATCH2
        XMA                     ; scratch2 <- the grid
        LYI NIB_SCRATCH
        LBM                     ; B <- the PAT_LANE index
        LYI NIB_SCRATCH2
        LAM
        LYA                     ; Y <- the grid
        LAB
        CALL or_plate
rs_done:
        JMPL render_burst

; ============================================================================
; the burst
; ============================================================================
;
; One actor, two meanings, because the tube gives plates 9-11 of every playfield
; grid to whatever bursts in that cell: under grids 0-3 that is the cyan pair a
; jet leaves when the missile kills it, and under grid 5 it is the red starburst
; thrown up where the player's launcher is destroyed. Both are set the same way -
; a column, a lane and a countdown - so both are drawn here.
;
; NIB_KCOL holds the column plus one, so zero means nothing is bursting, the
; same convention the jets use for an empty lane. The battleship's column is
; skipped: the tube does carry a burst behind the ship, but it is a wider shape
; in that cell's own right and is not drawn yet.

render_burst:
        LXI FILE_STATE
        LYI NIB_KCOL
        LAM
        ALEI 0                  ; ST <- 1 when nothing is bursting
        BR rk_done
        MNEI COL_NO_BURST + 1   ; the nibble is the column plus one, so this is
                                ; the battleship's column: ST <- 0 there, 1
                                ; everywhere else
        BR rk_draw
rk_done:
        JMPL render_score
rk_draw:
        LYI NIB_KLANE
        LAM
        AI LANEP_BURST
        LXI FILE_TIME
        LYI NIB_SCRATCH
        XMA                     ; scratch <- the PAT_LANE index
        LXI FILE_STATE
        LYI NIB_KCOL
        LAM
        AI 15
        P PAT_COLUMN            ; A <- the grid that column is strobed on
        LXI FILE_TIME
        LYI NIB_SCRATCH2
        XMA                     ; scratch2 <- the grid
        LYI NIB_SCRATCH
        LBM                     ; B <- the PAT_LANE index
        LYI NIB_SCRATCH2
        LAM
        LYA                     ; Y <- the grid
        LAB
        CALL or_plate
        JMPL render_score

; ============================================================================
; the score digits
; ============================================================================
;
; Grids 6-8 are not playfield - nothing else on the tube hangs under them - so
; these lookups own their nibbles outright and no OR is needed here. Segments a-d
; are plates 0-3 (R0) and e,f,g plates 4-6 (R1), which is the atlas's own
; seven-segment order.
;
; A leading digit is dark while it and every digit above it is zero, so the tube
; carries a 1-3 digit number and never a leading zero. The units digit is not a
; leading digit and always lights: a score of nothing reads as a single `0`, which
; is what both photographs of the lit unit show
; (assets/reference/tube-closeup-score0.webp shows one `0`,
; tube-closeup-score10.webp shows `10` with the tens column lit). PRD v1 rule 6
; calls the readout "2-3 digit", which describes the field on the glass - three
; digit positions, two of them lit through most of a game; the photographs are
; what settle how a score under ten is drawn into it.
;
; The blank is an omitted write, not a write of zero - render_field has already
; cleared all three plate files, so a column nothing draws into stays dark for the
; whole sweep.

render_score:
        ; --- the units digit, which is never blanked ---
        LXI FILE_TIME
        LYI NIB_SC_U
        LAM
        P PAT_DIGIT             ; A <- segments a-d, B <- segments e-g
        LXI FILE_PLATE0
        LYI GRID_SC_U
        XMA
        LAB
        LXI FILE_PLATE1
        XMA

        ; --- the tens digit, blanked while it and the hundreds are both zero ---
        LXI FILE_TIME
        LYI NIB_SC_T
        LAM
        ALEI 0                  ; ST <- 1 while the tens digit is zero
        BR rs_tens_leading      ; a zero tens may still be a leading zero
rs_tens_show:
        P PAT_DIGIT
        LXI FILE_PLATE0
        LYI GRID_SC_T
        XMA
        LAB
        LXI FILE_PLATE1
        XMA
        BR rs_tens_done
rs_tens_leading:
        LYI NIB_SC_H            ; X is still FILE_TIME
        LAM
        ALEI 0                  ; ST <- 1 when the hundreds digit is zero as well
        BR rs_tens_done         ; under ten: leave the column dark
        LAI 0                   ; 100 and up: a zero tens is not a leading zero
        BR rs_tens_show
rs_tens_done:
        JMPL render_hundreds

; ============================================================================
; the hundreds, which is half a digit
; ============================================================================
;
; The tube's readout is two digit cells, not three: the left one carries the
; tens as a full seven-segment digit and the hundreds beside it as two strokes
; reading `1` (assets/reference/tube-teardown/score-block.jpg). The score caps
; at 199, so the hundreds is only ever 1 or nothing and one plate expresses it -
; there is no digit lookup here any more, and the five seven-segment addresses
; the atlas used to carry for it were phosphor the glass does not have.
;
; It ORs rather than overwrites because it shares grid 7's R1 nibble with the
; tens digit's e, f and g segments, which the block above has already written.
; This is the tail of the render chain, so its RTN returns to the sweep.

render_hundreds:
        LXI FILE_TIME
        LYI NIB_SC_H
        LAM
        ALEI 0                  ; ST <- 1 below one hundred: nothing to light
        BR rh_blank
        LXI FILE_PLATE1
        LYI GRID_SC_T
        LBI PLATE_SC_HUND
        LAM
        OR
        XMA
rh_blank:
        RTN

; ============================================================================
; one sweep's worth of game state
; ============================================================================
;
; The head of the tick chain. Every block below is entered with JMPL and leaves
; with JMPL, so the whole chain costs the single stack level `sweep` spent
; calling it, and the last block's RTN is the one that returns.

.PAGE
tick:   ; --- the sweep counter, which is the only clock the program has ---
        LXI FILE_TIME
        LYI NIB_TICK
        LAM
        AI 1
        XMA

        ; --- a finished game stops moving; only a power cycle restarts it ---
        ; PRD v1 rule 6 and the back label: "To start new game simply slide
        ; switch to 'off' and then to 'on' again." There is deliberately no
        ; restart path in this ROM.
        LXI FILE_STATE
        LYI NIB_STATE
        LAM
        ALEI ST_PLAY
        BR tk_playing
        RTN
tk_playing:
        JMPL tick_burst

; ============================================================================
; a burst goes out
; ============================================================================
;
; A burst is the one thing on this tube that is neither an object with a
; position nor a permanent readout: it is lit for a fixed number of sweeps and
; then it is not. It has no rule of its own beyond that - a jet-kill burst does
; not collide with anything and the player's own does not either.

tick_burst:
        LXI FILE_STATE
        LYI NIB_KCOL
        LAM
        ALEI 0                  ; ST <- 1 when nothing is bursting
        BR tk_burst_done
        LXI FILE_TIME
        LYI NIB_KSTEP
        LAM
        ALEI 0
        BR tk_burst_gone
        AI 15                   ; A - 1
        XMA
        BR tk_burst_done        ; unconditional: ST is 1 after the untaken BR
tk_burst_gone:
        LXI FILE_STATE
        LYI NIB_KCOL
        LAI 0
        XMA                     ; the glass goes dark again
tk_burst_done:
        JMPL tick_missile

; ============================================================================
; the player's missile advances
; ============================================================================

.PAGE
tick_missile:
        LXI FILE_STATE
        LYI NIB_MCOL
        LAM
        ALEI 0                  ; ST <- 1 when nothing is in flight
        BR tm_done

        ; --- one column every MISSILE_SWEEPS sweeps ---
        LXI FILE_TIME
        LYI NIB_MSTEP
        LAM
        ALEI 0
        BR tm_advance
        AI 15                   ; A - 1
        XMA
        BR tm_done              ; unconditional: ST is 1 after the untaken BR

tm_advance:
        LXI FILE_TIME
        LYI NIB_MSTEP
        LAI MISSILE_SWEEPS
        XMA
        LXI FILE_STATE
        LYI NIB_MCOL
        LAM
        AI 1                    ; the missile travels away from the player
        XMA
        LAM                     ; A <- the column it has just reached
        ALEI COL_BSHIP          ; still on the field?
        BR tm_hit_test
        LAI 0                   ; off the far end: the shot is spent
        XMA
tm_done:
        JMPL tick_jets
tm_hit_test:
        JMPL missile_hit

; ============================================================================
; did the missile reach anything
; ============================================================================
;
; One jet to test: the one flying down the lane the shot is in, if there is one.
; Its nibble is its column plus one, so the comparison is against the missile's
; column plus one - done the other way round, taking one off the jet, so that an
; empty lane (nibble zero) is rejected before the arithmetic.

.PAGE
missile_hit:
        LXI FILE_STATE
        LYI NIB_MLANE
        LAM
        LYA                     ; Y <- the lane the shot is flying down
        LXI FILE_JETS
        LAM
        ALEI 0                  ; ST <- 1 when no jet is flying in that lane
        BR mh_bship
        AI 15                   ; A <- the column that jet stands in
        LXI FILE_STATE
        LYI NIB_MCOL
        ANEM                    ; ST <- 1 when the shot has not reached it
        BR mh_bship
        LYI NIB_MLANE
        LAM
        LYA
        LXI FILE_JETS
        LAI 0
        XMA                     ; the jet is destroyed and its lane is free
        JMPL missile_kill
mh_bship:
        JMPL missile_bship

; ============================================================================
; or the battleship
; ============================================================================
;
; The tube has a battleship segment per lane, and NIB_BSLANE says which one is
; lit, so the shot has to be in that lane to reach it. This used to test the
; centre lane instead - not because the ship was there, but because the centre
; lane was the only one the tube could draw it in, and NIB_BSLANE showed nowhere
; on the glass. The player can now see which lane the ship is in, so that is the
; lane the shot has to be in. See render_bship.

missile_bship:
        LXI FILE_STATE
        LYI NIB_BSLANE
        LAM
        ALEI LANE_LAST          ; ST <- 0 when no crossing is in progress
        BR mb_lane
        JMPL tick_jets
mb_lane:
        LYI NIB_MLANE
        ANEM                    ; ST <- 1 when the shot is in another lane
        BR mb_none
        LAI COL_BSHIP
        LYI NIB_MCOL
        ANEM                    ; ST <- 1 when the missile is not in that column
        BR mb_none
        JMPL bship_kill
mb_none:
        JMPL tick_jets

; ============================================================================
; a jet is destroyed
; ============================================================================
;
; PRD v1 rule 4: jets are worth 3 / 2 / 1 by the distance band they are hit in,
; read off PAT_COLUMN's high nibble so the geometry lives in one table. The beep
; is the missile-fire beep: audio-reference.md records the owner's confirmation
; that a missile hitting something makes the same sound as firing it, and that
; there is no separate explosion.

missile_kill:
        ; --- the burst the dying jet leaves, where it was standing ---
        ; Set before the score, because add_score can run off into the win
        ; jingle and never come back to this block. The shot is still in the
        ; nibble that says where it got to, which is where the jet was.
        LXI FILE_STATE
        LYI NIB_MLANE
        LBM
        LYI NIB_MCOL
        LAM
        CALL start_burst

        LXI FILE_TIME
        LYI NIB_SCRATCH
        LAI 0
        XMA                     ; add_score's tens addend: jets never score ten
        LXI FILE_STATE
        LYI NIB_KILLS
        LAM
        AI 1
        XMA                     ; one fewer jet in this squadron

        ; The hit beep first, then the score. Scoring can reach 199 and take the
        ; win jingle with it, and the jingle has to follow the hit it was earned
        ; by rather than interrupt it.
        LAI SND_MISSILE
        LBI BURSTS_MISSILE
        CALL play_sound

        LXI FILE_STATE
        LYI NIB_MCOL
        LAM
        P PAT_COLUMN            ; B <- the scoring band for that column
        LAI 0
        XMA                     ; the shot is spent; B still holds the band
        LAB
        CALL add_score
        JMPL tick_jets

; ============================================================================
; the battleship is destroyed
; ============================================================================
;
; Ten points, per the printed ruler's "10" over the battleship zone. Ten is not a
; BCD digit, so it is added as a one in the tens place rather than as a ten in
; the units place - which is what add_score's scratch addend is for.

bship_kill:
        LXI FILE_STATE
        LYI NIB_BSLANE
        LAI BS_NONE
        XMA                     ; it leaves the zone
        LYI NIB_MCOL
        LAI 0
        XMA

        ; --- schedule the next crossing ---
        ; Inline rather than a jump to bship_wait: that block is the tail of the
        ; battleship's own turn and returns to tick_input, which from here would
        ; cost the jets and the rockets their turn on this sweep.
        LYI NIB_RAND
        LAM
        LXI FILE_TIME
        LYI NIB_BS_LO
        LMAIY
        LAI BSHIP_GAP_HI
        LMAIY

        LAI SND_MISSILE
        LBI BURSTS_MISSILE
        CALL play_sound

        ; Ten points, and the beep comes first for the same reason it does in
        ; missile_kill: this score can be the winning one.
        LXI FILE_TIME
        LYI NIB_SCRATCH
        LAI 1
        XMA                     ; tens addend: 10 points
        LAI 0                   ; units addend
        CALL add_score
        JMPL tick_jets

; ============================================================================
; the score, in BCD
; ============================================================================
;
; In:  A = the units addend (0..9), FILE_TIME[NIB_SCRATCH] = the tens addend.
; Out: nothing. May end the game through score_cap.
;
; Three BCD digits in RAM, added with AM/AMC and adjusted with DAA, which is what
; the family's decimal adjust is for: DAA turns a binary nibble sum into a
; decimal digit and leaves the decimal carry in the carry flag, so the three
; digits chain with AMC. Nothing between the adds writes carry (isa.ts flag rule
; 1 lists every instruction that does), so the chain is safe to read straight
; down.

add_score:
        LXI FILE_TIME
        LYI NIB_SC_U
        AM                      ; A <- addend + units
        DAA                     ; -> a decimal digit, carry <- decimal carry
        XMA

        LYI NIB_SCRATCH
        LAM                     ; A <- the tens addend
        LYI NIB_SC_T
        AMC                     ; A <- addend + tens + carry
        DAA
        XMA

        LAI 0
        LYI NIB_SC_H
        AMC
        DAA
        XMA

        JMPL score_cap

; ============================================================================
; 199 is the ceiling and the win
; ============================================================================
;
; PRD v1 rule 6 and R2: the player wins at 199 and the score caps there. The
; check is an explicit digit-by-digit compare rather than a subtraction, because
; the score is BCD and a binary compare of a BCD triple is only correct by
; accident.

.PAGE
score_cap:
        LXI FILE_TIME
        LYI NIB_SC_H
        LAM
        ALEI 1                  ; ST <- hundreds <= 1
        BR sc_have_h
        BR sc_win               ; 200 or more: cap it back to 199
sc_have_h:
        ALEI 0                  ; ST <- hundreds == 0
        BR sc_done              ; below 100: nothing to cap
        LYI NIB_SC_T
        LAM
        ALEI 8                  ; ST <- tens <= 8
        BR sc_done
        LYI NIB_SC_U
        LAM
        ALEI 8                  ; ST <- units <= 8
        BR sc_done
sc_win:
        LXI FILE_TIME
        LYI NIB_SC_U
        LAI 9
        LMAIY
        LAI 9
        LMAIY
        LAI 1
        XMA                     ; the readout is pinned at 199
        JMPL game_win
sc_done:
        RTN

; ============================================================================
; the squadron's turn
; ============================================================================
;
; A wave is six jets (JET_COUNT), and they are neither all in the air at once nor
; moved as one. Each sweep: release a jet if one is due and a lane is free, then
; give each airborne jet's own countdown a tick. PRD v1 rule 2's "step, pause,
; step" is that countdown, and its "as a squadron thins out, the survivors speed
; up" is speed_index, which every jet reloads from on every step. What the six of
; them add up to at any moment is the squadron - two or so jets, in different
; lanes at different distances, as in assets/reference/device-front-gameplay.jpg.

.PAGE
tick_jets:
        ; --- a wave shot down to the last jet is replaced ---
        LXI FILE_STATE
        LYI NIB_KILLS
        MNEI JET_COUNT          ; ST <- 0 when the last jet of the wave is down
        BR tj_release
        JMPL new_wave
tj_release:
        JMPL jet_release

; ============================================================================
; is another jet due
; ============================================================================
;
; In:  nothing. Out: nothing.
;
; The wave's six enter a few at a time on their own countdown. Once all six have
; been sent that countdown stops mattering: what is left of the wave is whatever
; is still flying.

jet_release:
        LXI FILE_JETS
        LYI NIB_J_SENT
        MNEI JET_COUNT          ; ST <- 0 when the whole wave has been sent
        BR jr_timer
        JMPL jet_advance
jr_timer:
        LXI FILE_TIME
        LYI NIB_ENTRY_LO
        CALL dec_timer          ; A <- 1 on the sweep the countdown reaches zero
        ALEI 0                  ; ST <- 1 while it is still running
        BR jr_done
        JMPL jet_enter
jr_done:
        JMPL jet_advance

; ============================================================================
; the gap to the jet after this one
; ============================================================================
;
; In:  nothing. Out: nothing.
;
; Twice the current step period, plus the sampled counter. Two periods is what
; keeps about two jets in the air at once, which is the formation the reference
; photograph shows; taking it from PAT_STEP rather than from a constant of its
; own means the field stays about that sparse at every skill setting and every
; rung of the thin-out ladder, instead of emptying out as the survivors speed up.
; The low nibble is NIB_RAND - the free-running counter as the player's last
; press left it, the machine's only randomness (PRD R3) - which is what stops the
; entries settling into a fixed diagonal.

jet_enter:
        CALL speed_index
        P PAT_STEP              ; A <- the period's low nibble, B <- its high
        REC
        ROTL                    ; A <- lo * 2; the carry belongs to the high half
        LAB
        ROTL                    ; A <- hi * 2 plus that carry
        LXI FILE_TIME
        LYI NIB_ENTRY_HI
        XMA
        LXI FILE_STATE
        LYI NIB_RAND
        LAM
        LXI FILE_TIME
        LYI NIB_ENTRY_LO
        XMA
        JMPL jet_room

; ============================================================================
; is there room for it
; ============================================================================
;
; In:  nothing. Out: nothing.
;
; The gap above is reloaded whether or not this jet gets in, so a full sky costs
; the wave a turn rather than queueing one up to arrive the moment a lane frees.
; AIRBORNE_MAX is the photograph's two.

.PAGE
jet_room:
        LXI FILE_JETS
        LYI NIB_J_LANE0
        LBI 0
jrm_lane:
        LAM
        ALEI 0                  ; ST <- 1 when this lane is empty
        BR jrm_next
        IB                      ; one more jet already in the air
jrm_next:
        IY
        YNEI LANE_COUNT
        BR jrm_lane
        LAB
        ALEI AIRBORNE_MAX - 1   ; ST <- 1 while the sky has room for another
        BR jrm_spawn
        JMPL jet_advance
jrm_spawn:
        JMPL jet_spawn

; ============================================================================
; and where it comes in
; ============================================================================
;
; In:  nothing. Out: nothing.
;
; A rotor picks the lane, so three consecutive entries land in three different
; lanes; where the rotor starts is the sampled counter, so which lane leads is
; not the same every wave. A lane that still holds a jet is skipped rather than
; queued: the field is allowed to stay sparse, and the wave simply takes longer
; to come out. The rotor moves on either way, so a busy lane cannot stall it.

.PAGE
jet_spawn:
        LXI FILE_JETS
        LYI NIB_J_ROTOR
        LAM
        LBA                     ; B <- the lane this entry tries
        AI 1
        ALEI LANE_LAST          ; ST <- 1 while the rotor is still on the field
        BR jsp_rotor
        LAI 0                   ; three lanes, so it wraps back to the top one
jsp_rotor:
        XMA                     ; left pointing at the lane after this one
        LAB
        LYA                     ; Y <- this entry's lane
        LAM
        ALEI 0                  ; ST <- 1 when that lane is empty
        BR jsp_place
        JMPL jet_advance        ; the lane is busy: nothing enters this time
jsp_place:
        LAI COL_JET_FAR + 1     ; a jet nibble is its column plus one, so that
        XMA                     ; zero can mean "no jet in this lane"
        LAB
        LYI NIB_J_WORK
        XMA                     ; jet_reload takes the lane in NIB_J_WORK
        LYI NIB_J_SENT
        LAM
        AI 1
        XMA                     ; one more of the wave's six is airborne
        CALL jet_reload         ; its step countdown starts from this sweep
        JMPL jet_advance

; ============================================================================
; a lane's step countdown
; ============================================================================
;
; In:  NIB_J_WORK = the lane. Out: nothing. Clobbers A, B, X, Y.
;
; Every jet reloads the same cadence - one squadron, one step period, the whole
; of PRD v1 rule 2's speed-up curve intact - but reloads it at the moment *it*
; stepped. Same period, different phase, which is the difference between a
; squadron and a block: the jets step one at a time.
;
; The pair is written in two passes because the cadence needs both A and B and
; the index needs A as well; the lane is read back from NIB_J_WORK each time
; rather than parked in a register that the lookup would take.

jet_reload:
        CALL speed_index
        P PAT_STEP              ; A <- sweeps low nibble, B <- high nibble
        LXI FILE_JETS
        LYI NIB_J_TEMP
        XMB                     ; temp <- the high nibble
        LBA                     ; B <- the low nibble
        LYI NIB_J_WORK
        LAM
        REC
        ROTL                    ; A <- lane * 2
        AI NIB_J_STEP           ; A <- this lane's countdown, low nibble
        LYA
        LAB
        XMA
        LYI NIB_J_TEMP
        LBM                     ; B <- the high nibble again
        LYI NIB_J_WORK
        LAM
        REC
        ROTL
        AI NIB_J_STEP + 1       ; A <- the same countdown's high nibble
        LYA
        LAB
        XMA
        RTN

; ============================================================================
; every jet takes its turn
; ============================================================================
;
; In:  nothing. Out: nothing.
;
; Three lanes, walked with the lane in RAM rather than in a register, so the walk
; is a JMPL loop and costs no stack. Two things are collected across the walk in
; NIB_J_FLAG: whether any jet stepped, so the march beep sounds once a sweep
; rather than once a jet, and whether any jet reached the G line.

jet_advance:
        LXI FILE_JETS
        LYI NIB_J_FLAG
        LAI 0
        XMA                     ; nothing has stepped or captured this sweep
        LYI NIB_J_WORK
        LAI 0
        XMA                     ; the walk starts at lane 0
        JMPL jet_lane

.PAGE
jet_lane:
        LXI FILE_JETS
        LYI NIB_J_WORK
        LAM
        LYA                     ; Y <- the lane; its jet shares that index
        LAM
        ALEI 0                  ; ST <- 1 when no jet is flying in this lane
        BR jl_next
        JMPL jet_lane_step
jl_next:
        JMPL jet_next

jet_lane_step:
        LXI FILE_JETS
        LYI NIB_J_WORK
        LAM
        REC
        ROTL                    ; A <- lane * 2
        AI NIB_J_STEP           ; A <- this lane's countdown, low nibble
        LYA
        CALL dec_timer          ; A <- 1 on the sweep the countdown reaches zero
        ALEI 0                  ; ST <- 1 while it is still running
        BR jls_next
        JMPL jet_move
jls_next:
        JMPL jet_next

; ============================================================================
; one jet steps
; ============================================================================
;
; In:  NIB_J_WORK = the lane. Out: nothing.
;
; The step happens first and the capture test second, so a jet that arrives on
; the G line is recognised on the sweep it arrives, not the one after.
;
; PRD v1 rule 6, as amended: reaching G costs a launcher rather than ending the
; game. The jet is taken off the field here, on the same two nibbles a jet
; shot down goes through in missile_hit - its lane nibble cleared and NIB_KILLS
; incremented. Both are load bearing. Leaving the jet standing would cost the
; player a second launcher on its next step, because a nibble of 1 fails the
; same ALEI 1 again; and leaving NIB_KILLS alone would strand the wave, because
; tick_jets renews a squadron on the kill count reaching JET_COUNT and only six
; are ever sent. A captured jet is one of the six that has left the field, so
; the count that decides the wave is over has to see it, whatever removed it.
;
; It scores nothing - only missile_kill reaches add_score - but it does move the
; survivors down a rung of the thin-out ladder, which speed_index reads from the
; same counter. A squadron that put a jet through the player's line has thinned
; by one, so that is the right answer rather than an artefact.
;
; Nothing is drawn differently: draw_jet already declines to draw a jet in
; column COL_LAUNCH, because the tube prints no aircraft in the player's cell.
; What the player sees at a capture is the red starburst launcher_down lights in
; that cell, which is the segment the tube does have for it.

.PAGE
jet_move:
        CALL jet_reload         ; this jet's next step, from this moment
        LXI FILE_JETS
        LYI NIB_J_FLAG
        SEM FLAG_STEPPED        ; one march beep will follow this sweep
        LYI NIB_J_WORK
        LAM
        LYA                     ; Y <- the lane
        LAM
        AI 15                   ; one column closer to the missile station
        XMA
        LAM
        ALEI 1                  ; ST <- 1 when the jet now stands on the G line
        BR jm_capture
        JMPL jet_next
jm_capture:
        LXI FILE_JETS
        LYI NIB_J_WORK
        LAM
        LYA                     ; Y <- the lane; its jet shares that index
        LAI 0
        XMA                     ; the jet has arrived and leaves the field
        LXI FILE_STATE
        LYI NIB_KILLS
        LAM
        AI 1
        XMA                     ; one fewer jet in this squadron
        LXI FILE_JETS
        LYI NIB_J_FLAG
        SEM FLAG_CAPTURED
        JMPL jet_next

jet_next:
        LXI FILE_JETS
        LYI NIB_J_WORK
        LAM
        AI 1
        XMA                     ; on to the next lane
        LAM
        ALEI LANE_LAST          ; ST <- 1 while there are lanes left to walk
        BR jn_lane
        JMPL jet_swept
jn_lane:
        JMPL jet_lane

; ============================================================================
; what the walk found
; ============================================================================
;
; In:  NIB_J_FLAG. Out: nothing.
;
; One march beep per sweep at most, however many jets stepped on it: the beep is
; the squadron's step, and audio-reference.md's jetMarch is one note, not a
; chord. A capture beats it - the warning beeps are what the player has to hear,
; and launcher_down owns the speaker for the rest of the sweep.
;
; One launcher per sweep at most, too, for the same reason and by the same
; mechanism: NIB_J_FLAG carries one capture bit however many jets set it. Two
; jets arriving on the same sweep is one event to a player - they land inside
; the same few milliseconds - and charging two launchers for it would make the
; cost of a capture depend on whether two lanes' countdowns happened to be in
; phase. Both jets still leave the field and both are still counted out of the
; wave; it is only the charge that is capped.

jet_swept:
        LXI FILE_JETS
        LYI NIB_J_FLAG
        TM FLAG_CAPTURED        ; ST <- 1 when a jet reached the G line
        BR js_capture
        LXI FILE_JETS
        LYI NIB_J_FLAG
        TM FLAG_STEPPED         ; ST <- 1 when a jet stepped this sweep
        BR js_march
        JMPL tick_rocket
js_march:
        LAI SND_MARCH
        LBI BURSTS_MARCH
        CALL play_sound
        JMPL tick_rocket
js_capture:
        JMPL launcher_down

; ============================================================================
; a fresh squadron
; ============================================================================

.PAGE
new_wave:
        ; --- the field is clear and none of the next six has been sent ---
        LXI FILE_JETS
        LYI NIB_J_LANE0
        LMIIY 0
        LMIIY 0
        LMIIY 0                 ; three empty lanes
        LYI NIB_J_SENT
        LAI 0
        XMA

        ; --- which lane the first of them tries, from the sampled counter ---
        LXI FILE_STATE
        LYI NIB_RAND
        LAM
nw_lane:
        ALEI LANE_LAST          ; ST <- 1 once the counter has come down to a lane
        BR nw_rotor
        AI 13                   ; less three, and round again
        BR nw_lane              ; unconditional: ST is 1 after the untaken BR
nw_rotor:
        LXI FILE_JETS
        LYI NIB_J_ROTOR
        XMA
        JMPL new_wave_count

; ============================================================================
; and its place on the speed ladder
; ============================================================================

new_wave_count:
        LXI FILE_STATE
        LYI NIB_KILLS
        LAI 0
        XMA
        LYI NIB_WAVE
        LAM
        ALEI WAVE_LAST - 1      ; the wave count saturates rather than wrapping:
                                ; a nibble that rolled over to zero would hand
                                ; the player back the slowest cadence
        BR nwc_bump
        JMPL tick_rocket
nwc_bump:
        AI 1
        XMA
        JMPL tick_rocket

; ============================================================================
; where the squadron's cadence comes from
; ============================================================================
;
; Out: A = an index into PAT_STEP, 0..15. Clobbers A, B, X, Y.
;
; One ladder of sixteen cadences. The skill dial picks the entry point
; (PAT_SKILL), each jet shot down this wave takes one step down it, and each
; cleared wave takes one more - which is PRD v1 rule 2's "as a squadron thins
; out, the survivors speed up; each cleared squadron respawns faster", expressed
; as a table walk. The bottom of the ladder is the floor: the sum saturates
; rather than wrapping, so the cadence can never reach zero.

speed_index:
        LXI FILE_STATE
        LYI NIB_SKILL
        LAM
        P PAT_SKILL             ; A <- this skill's entry point
        LYI NIB_KILLS
        AM
        TC                      ; ST <- carry: the sum left four bits
        BR si_floor
        LYI NIB_WAVE
        AM
        TC
        BR si_floor
        RTN
si_floor:
        LAI SPEED_LAST
        RTN

; ============================================================================
; a two-nibble countdown
; ============================================================================
;
; In:  X = the file, Y = the low nibble's index; the high nibble is at Y + 1.
; Out: A = 1 on the sweep the pair reaches zero, 0 otherwise. Clobbers X, Y, ST.
;
; The pair counts hi*16 + lo sweeps, which is the range a squadron cadence needs
; - forty-eight sweeps does not fit in a nibble. Reloading is the caller's job,
; because every caller reloads from a different table.

.PAGE
dec_timer:
        LAM
        ALEI 0                  ; ST <- 1 when the low nibble is spent
        BR dt_low_spent
        AI 15
        XMA
        LAI 0
        RTN
dt_low_spent:
        IY                      ; -> the high nibble
        LAM
        ALEI 0
        BR dt_fired
        AI 15
        XMA                     ; borrow from the high nibble
        DY
        LAI 15
        XMA                     ; and the low nibble wraps to fifteen
        LAI 0
        RTN
dt_fired:
        LAI 1
        RTN

; ============================================================================
; the jets shoot back
; ============================================================================

.PAGE
tick_rocket:
        LXI FILE_STATE
        LYI NIB_RCOL
        LAM
        ALEI 0                  ; ST <- 1 when no rocket is in flight
        BR tr_launch

        LXI FILE_TIME
        LYI NIB_RSTEP
        LAM
        ALEI 0
        BR tr_move
        AI 15
        XMA
        JMPL tick_bship
tr_move:
        JMPL rocket_move
tr_launch:
        JMPL rocket_launch

; ============================================================================
; a rocket travels down its lane
; ============================================================================

.PAGE
rocket_move:
        LXI FILE_TIME
        LYI NIB_RSTEP
        LAI ROCKET_SWEEPS
        XMA
        LXI FILE_STATE
        LYI NIB_RCOL
        LAM
        AI 15                   ; rockets travel toward the player
        XMA
        LAM
        ALEI COL_LAUNCH         ; ST <- 1 when it has reached the station
        BR rm_arrived
        JMPL tick_bship
rm_arrived:
        LXI FILE_STATE
        LYI NIB_RLANE
        LAM
        LYI NIB_LANE
        ANEM                    ; ST <- 1 when the launcher is in another lane
        BR rm_missed
        JMPL launcher_hit
rm_missed:
        LXI FILE_STATE
        LYI NIB_RCOL
        LAI 0
        XMA
        JMPL tick_bship

; ============================================================================
; deciding to launch one
; ============================================================================

rocket_launch:
        LXI FILE_TIME
        LYI NIB_ROCK_LO
        CALL dec_timer
        ALEI 0
        BR rl_done

        ; --- reload from the per-skill interval ---
        LXI FILE_STATE
        LYI NIB_SKILL
        LAM
        P PAT_ROCKET            ; A <- sweeps low nibble, B <- high nibble
        LXI FILE_TIME
        LYI NIB_ROCK_LO
        LMAIY
        LAB
        LMAIY
        JMPL rocket_fire
rl_done:
        JMPL tick_bship

; ============================================================================
; which jet fires it
; ============================================================================
;
; The lane comes from NIB_RAND - the free-running counter as it stood the last
; time the player pressed fire. That is the machine's only randomness: there is
; no generator, and a counter read at a moment a human chose is the standard way
; these ROMs get an unpredictable number. Values above the last lane fall back to
; the centre rather than being retried, because a retry loop on a nibble that is
; only re-sampled on a keypress would not terminate.

.PAGE
rocket_fire:
        LXI FILE_STATE
        LYI NIB_RAND
        LAM
        ALEI LANE_LAST
        BR rf_lane
        LAI LANE_CENTRE
rf_lane:
        LXI FILE_STATE
        LYI NIB_RLANE
        XMA                     ; the rocket's lane
        LAM
        LXI FILE_JETS
        LYA                     ; Y <- the jet flying in that lane
        LAM
        ALEI 0                  ; ST <- 1 when there is no jet there to fire
        BR rf_none
        AI 15                   ; A <- the column that jet stands in
        LXI FILE_STATE
        LYI NIB_RCOL
        XMA                     ; the rocket starts from the jet that fired it
        LXI FILE_TIME
        LYI NIB_RSTEP
        LAI ROCKET_SWEEPS
        XMA
rf_none:
        JMPL tick_bship

; ============================================================================
; a launcher is destroyed
; ============================================================================
;
; PRD v1 R6 and audio-reference.md, launcherHitWarning: two beeps on the first
; hit, three on the second, and on the third the full loss sound. All three are
; owner-confirmed.
;
; Two ways in, because the player has two ways to lose a launcher and they cost
; the same thing. `launcher_hit` is a rocket arriving at the station, and clears
; the rocket that arrived. `launcher_down` is the launcher being destroyed by
; whatever destroyed it, and is where jet_swept comes in when a jet reaches the
; G line. Splitting the label rather than clearing NIB_RCOL on both paths is
; deliberate: a capture is not a rocket, and zeroing that nibble from the
; capture path would delete a rocket still in flight down another lane.
;
; Both entries are reached by JMPL from the `tick` chain, so both stand two
; stack levels deep and the CALLs below can still reach note_half without
; wrapping the four-level stack.

launcher_hit:
        LXI FILE_STATE
        LYI NIB_RCOL
        LAI 0
        XMA                     ; the rocket is spent

launcher_down:
        ; --- the red starburst where the launcher stood ---
        ; The same three nibbles the jet-kill burst uses, on the capture line's
        ; own column, which is where the tube puts the player's destruction.
        LXI FILE_STATE
        LYI NIB_LANE
        LBM
        LAI COL_LAUNCH
        CALL start_burst

        LXI FILE_STATE
        LYI NIB_HITS
        LAM
        AI 1
        XMA
        LAM                     ; A <- launchers destroyed so far
        ALEI 1
        BR lh_two
        ALEI 2
        BR lh_three
        JMPL game_lost
lh_three:                       ; ahead of lh_two so that the BR above still
        JMPL warn_three         ; lands inside its own page
lh_two:
        LAI SND_WARN
        LBI BURSTS_WARN
        CALL play_sound
        CALL warn_gap
        LAI SND_WARN
        LBI BURSTS_WARN
        CALL play_sound
        JMPL tick_bship

; ============================================================================
; three beeps
; ============================================================================

warn_three:
        LAI SND_WARN
        LBI BURSTS_WARN
        CALL play_sound
        CALL warn_gap
        LAI SND_WARN
        LBI BURSTS_WARN
        CALL play_sound
        CALL warn_gap
        LAI SND_WARN
        LBI BURSTS_WARN
        CALL play_sound
        JMPL tick_bship

; ============================================================================
; light a burst
; ============================================================================
;
; In:  A = the column it stands in, B = the lane. Out: nothing.
; Clobbers A, B, X, Y.
;
; Both the burst a jet leaves and the burst the player leaves come through here,
; because on this tube they are the same three plates under different grids. The
; column is stored plus one so that zero can mean "nothing is bursting" without
; stealing column 0, which is the column the player's own destruction happens in.
;
; It calls nothing, which is what lets missile_kill and launcher_hit reach it on
; the same sweep they also reach play_sound: the stack is four deep and wraps
; silently, and both of those blocks already spend three levels.

start_burst:
        AI 1                    ; A <- the column, plus one
        LXI FILE_STATE
        LYI NIB_KCOL
        XMA
        LAB
        LYI NIB_KLANE
        XMA
        LXI FILE_TIME
        LYI NIB_KSTEP
        LAI BURST_SWEEPS
        XMA
        RTN

; ============================================================================
; the silence between two warning beeps
; ============================================================================
;
; In:  nothing. Out: nothing. Clobbers B; preserves X and Y through dwell's own
; shadow-pair discipline, which is why the counter can live in Y.
;
; Two dwells per pass so eleven passes land on 26.7 ms - inside the measured
; 25-28 ms gap (audio-reference.md, launcherHitWarning.gapMs). One dwell per pass
; would need nineteen, and the counter is a nibble.

.PAGE
warn_gap:
        LYI WARN_GAP
wg_pass:
        CAL dwell
        CAL dwell
        DY
        BR wg_pass
        RTN

; ============================================================================
; the battleship's turn
; ============================================================================

tick_bship:
        LXI FILE_STATE
        LYI NIB_BSLANE
        LAM
        ALEI LANE_LAST          ; ST <- 0 when the nibble holds BS_NONE
        BR tb_cross

        LXI FILE_TIME
        LYI NIB_BS_LO
        CALL dec_timer
        ALEI 0
        BR tb_done
        JMPL bship_enter
tb_cross:
        JMPL bship_move
tb_done:
        JMPL tick_input

; ============================================================================
; it enters the far zone
; ============================================================================
;
; PRD v1 rule 4: the crossing is "announced by a distinctive lower-pitch buzz".
; audio-reference.md turns "lower" into the rule that matters - the buzz must
; read below the jet march - and the sound table at the foot of this file shows
; the two pitches this ROM produces, 287 Hz against the march's 640 Hz.

bship_enter:
        LXI FILE_STATE
        LYI NIB_BSLANE
        LAI LANE_TOP
        XMA
        LXI FILE_TIME
        LYI NIB_BSTEP
        LAI BSHIP_SWEEPS
        XMA
        LAI SND_BSHIP
        LBI BURSTS_BSHIP
        CALL play_sound
        JMPL tick_input

; ============================================================================
; and crosses it
; ============================================================================

bship_move:
        LXI FILE_TIME
        LYI NIB_BSTEP
        LAM
        ALEI 0
        BR bm_step
        AI 15
        XMA
        JMPL tick_input
bm_step:
        LXI FILE_TIME
        LYI NIB_BSTEP
        LAI BSHIP_SWEEPS
        XMA
        LXI FILE_STATE
        LYI NIB_BSLANE
        LAM
        AI 1
        ALEI LANE_LAST          ; ST <- 1 while it is still inside the zone
        BR bm_store
        LAI BS_NONE
        XMA                     ; it has left the far side
        JMPL bship_wait
bm_store:
        XMA
        LAI SND_BSHIP
        LBI BURSTS_BSHIP
        CALL play_sound
        JMPL tick_input

; ============================================================================
; when the next crossing is due
; ============================================================================
;
; BSHIP_GAP_HI*16 sweeps plus the sampled counter, so successive crossings are
; 48-63 sweeps apart. See the provisional-cadence block: the interval is
; unmeasured, and T6 has not established that the real one is random at all.

bship_wait:
        LXI FILE_STATE
        LYI NIB_RAND
        LAM
        LXI FILE_TIME
        LYI NIB_BS_LO
        LMAIY
        LAI BSHIP_GAP_HI
        LMAIY
        JMPL tick_input

; ============================================================================
; what the fire button does
; ============================================================================
;
; The tail of the tick chain: its RTN is the one that returns to the sweep.
; One missile in flight at a time (PRD v1 R2), and the press edge - not the hold
; - is what launches it.

.PAGE
tick_input:
        ; --- a game that ended earlier in this very chain stops here ---
        ; tick tested NIB_STATE at the top of the sweep, but scoring can end the
        ; game halfway down: a hit that reaches 199 sets ST_WIN from inside
        ; add_score. Without this second test the rest of that one chain would
        ; still run and the player would get one more shot after winning.
        LXI FILE_STATE
        LYI NIB_STATE
        LAM
        ALEI ST_PLAY
        BR ti_playing
        RTN
ti_playing:
        LYI NIB_FIRE
        LAM
        ALEI 0
        BR ti_done              ; not pressed
        LYI NIB_FIRE_PREV
        LAM
        ALEI 0
        BR ti_press             ; pressed now, not last sweep: an edge
        BR ti_done              ; still held: no second missile
ti_press:
        ; --- the randomness source, sampled at a human input instant ---
        LAT                     ; A <- the free-running counter's low nibble
        LXI FILE_STATE
        LYI NIB_RAND
        XMA
        LYI NIB_MCOL
        LAM
        ALEI 0                  ; ST <- 1 when the tube is clear to fire
        BR ti_launch
        BR ti_done
ti_launch:
        JMPL fire_missile
ti_done:
        RTN

; ============================================================================
; launching one
; ============================================================================

fire_missile:
        LXI FILE_STATE
        LYI NIB_LANE
        LAM
        LYI NIB_MLANE
        XMA                     ; it leaves in the lane the lever is set to
        LYI NIB_MCOL
        LAI COL_MSL_START
        XMA
        LXI FILE_TIME
        LYI NIB_MSTEP
        LAI MISSILE_SWEEPS
        XMA
        LAI SND_MISSILE
        LBI BURSTS_MISSILE
        CALL play_sound
        RTN

; ============================================================================
; the end of the game
; ============================================================================
;
; Two ways out (PRD v1 rule 6, as amended): 199 points, or the third launcher
; gone. Nothing clears NIB_STATE - the power switch is the only reset the unit
; has.
;
; A jet reaching the G line used to be a third way out, and `game_capture` was
; a second label on this address. It is not an ending any more: a capture costs
; a launcher and goes through launcher_down like a rocket hit, so it reaches
; here only as the third one. That label is gone rather than kept as an alias,
; because the whole defect it caused was two names on one address reading as
; two rules while implementing one.
;
; What an ending looks like from tools/probe/machine-probe.ts, which is worth
; knowing before a long run gets read as a fault: the sweep goes on turning and
; `tick` returns at its first test, so the machine keeps refreshing a picture
; that no longer changes and never touches the speaker again. An unattended
; probe run therefore reports its last edge some seconds in and identical lit
; segments from there to the end of the run - which reads exactly like a delay
; loop that stopped terminating, and is not one. The distinction is held down by
; tools/probe/game-lifetime.test.ts.

game_lost:
        LXI FILE_STATE
        LYI NIB_STATE
        LAI ST_OVER
        XMA
        JMPL play_loss

; ============================================================================
; the loss sound
; ============================================================================
;
; Five stages, transcribed from audio-reference.md's gameOver envelope table:
; a 466 Hz transient, a collapse to 96 Hz, the 240 Hz rasp body, a drift down to
; 196 Hz and a 147 Hz decay. Those five stages sum to ~0.66 s of the measured
; ~1.13 s total; the remainder of the real sound is a decaying noise layer, and a
; single square-wave pin cannot produce noise. What is here is the tonal skeleton
; the measurement describes, not the whole recording.

play_loss:
        LAI SND_LOSS1
        LBI BURSTS_LOSS1
        CALL play_sound
        LAI SND_LOSS2
        LBI BURSTS_LOSS2
        CALL play_sound
        LAI SND_LOSS3
        LBI BURSTS_LOSS3
        CALL play_sound
        LAI SND_LOSS4
        LBI BURSTS_LOSS4
        CALL play_sound
        LAI SND_LOSS5
        LBI BURSTS_LOSS5
        CALL play_sound
        RTN

; ============================================================================
; the win jingle
; ============================================================================
;
; audio-reference.md's `win` transcription: the arpeggio 750, 940, 1240 played
; three times, resolving on a long 940. The three repeats are a loop rather than
; nine note entries, which is what fits the whole jingle in one page - and it has
; to be one page, because `BR gw_pass` closes the loop and BR cannot leave its
; own page.
;
; 1240 Hz is the measurement. 1244 Hz is the equal-tempered frequency of the note
; name D#6 that was attached to it afterwards, and audio-reference.md shows the
; substitution being caught: the observed second partial is 2480, which is
; 2 x 1240 and not 2 x 1244. SND_WIN3 targets 1240.

.PAGE
game_win:
        LXI FILE_STATE
        LYI NIB_STATE
        LAI ST_WIN
        XMA
        LXI FILE_SOUND
        LYI NIB_NOTE_LEFT
        LAI 2                   ; three passes of the arpeggio
        XMA
gw_pass:
        LAI SND_WIN1
        LBI BURSTS_WIN1
        CALL play_sound
        LAI SND_WIN2
        LBI BURSTS_WIN2
        CALL play_sound
        LAI SND_WIN3
        LBI BURSTS_WIN3
        CALL play_sound
        LXI FILE_SOUND
        LYI NIB_NOTE_LEFT
        LAM
        AI 15
        XMA
        TC                      ; ST <- carry: 1 until the counter borrowed
        BR gw_pass
        LAI SND_WIN2
        LBI BURSTS_WINEND       ; the sustained A#5 the jingle resolves on
        CALL play_sound
        RTN

; ============================================================================
; setting up a note
; ============================================================================
;
; In:  A = a sound identifier, B = bursts to play minus one.
; Out: nothing. Clobbers everything.
;
; Two pattern lookups fill the four consecutive nibbles note_loop and note_half
; read: the two halves of the delay count, the whole-delay repeat, and the
; periods per burst. The whole sound system is one pin toggled in a timed loop,
; so a "note" is nothing more than those four numbers.

play_sound:
        LXI FILE_SOUND
        LYI NIB_BURST_LEFT
        XMB                     ; the burst count, straight out of B
        LYI NIB_SND_ID
        XMA                     ; park the identifier: P clobbers A and B
        LAM
        P PAT_SND_A             ; A <- inner delay, B <- outer delay
        LYI NIB_HALF_IN
        LMAIY
        LAB
        LMAIY
        LYI NIB_SND_ID
        LAM
        P PAT_SND_B             ; A <- delay repeats, B <- periods per burst
        LYI NIB_HALF_REP
        LMAIY
        LAB
        LMAIY
        JMPL note_loop

; ============================================================================
; the note itself
; ============================================================================
;
; The whole sound system: one pin, toggled in a timed loop. The display is not
; swept while this runs, which is what a machine with one core and no sound
; hardware does - the tube holds its last state for as long as the note lasts.
;
; The period is (2 * note_half) + 13 machine cycles: the thirteen are this loop's
; own two port writes, two calls and RAM-held counter decrement. The counter has
; to live in RAM rather than in B because note_half needs B for its outer delay,
; and a delay routine that ate its caller's loop counter produced an endless tone
; once already.

.PAGE
note_loop:
nl_burst:
        LXI FILE_SOUND
        LYI NIB_PERIODS
        LAM
        LYI NIB_PERIOD_LEFT
        XMA
nl_period:
        SED D_SPEAKER           ; rising edge, timestamped here
        CALL note_half
        RED D_SPEAKER           ; falling edge
        CALL note_half
        LXI FILE_SOUND
        LYI NIB_PERIOD_LEFT
        LAM
        AI 15
        XMA
        TC
        BR nl_period
        LXI FILE_SOUND
        LYI NIB_BURST_LEFT
        LAM
        AI 15
        XMA
        TC
        BR nl_burst
        RTN

; ============================================================================
; half a period
; ============================================================================
;
; In:  FILE_SOUND's four pitch nibbles. Out: nothing. Clobbers A, B, X, Y.
;
; Three nested counters, which is what it takes to cover every band the unit
; produces from one routine: 1509 Hz for the missile blip down to 96 Hz for the
; collapse in the loss sound is a range of sixteen to one, and two nibbles cannot
; span it at usable resolution. The cost is
;
;   6 + repeats * (12 + outer * (2 * inner + 12))
;
; machine cycles, and the seven NOPs are what puts the "+ 12" there - they are a
; deliberate timing pad, not dead code. Removing them shortens the reachable
; half-period by a third and puts the battleship buzz above the jet march, which
; audio-reference.md records as an owner-confirmed ordering constraint.
;
; Edit the numbers in PAT_SND_A / PAT_SND_B, not the shape of this loop: the
; frequency table at the foot of the file is derived from the formula above.

.PAGE
note_half:
        LXI FILE_SOUND
        LYI NIB_HALF_REP
        LAM
        LYI NIB_REP_LEFT
        XMA
nh_rep:
        LXI FILE_SOUND
        LYI NIB_HALF_IN
        LAM
        LYI NIB_HALF_OUT
        LBM
nh_out: LYA
nh_in:  DY
        BR nh_in
        NOP                     ; timing pad - see the header of this page
        NOP
        NOP
        NOP
        NOP
        NOP
        NOP
        DB
        BR nh_out
        LXI FILE_SOUND
        LYI NIB_REP_LEFT
        LAM
        AI 15
        XMA
        TC
        BR nh_rep
        RTN

; ============================================================================
; reset
; ============================================================================

.PAGE
main:   ; --- clear every RAM file this program uses ---
        ; RAM comes up undefined on the real device (src/machine/cpu/memory.ts),
        ; so nothing may be read before it is written.
        LBI FILE_JETS           ; the highest file in use
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
        LYI NIB_BSLANE
        LAI BS_NONE
        XMA                     ; no crossing in progress
        JMPL main_timers

; The squadron needs nothing here. An empty sky is three zeroed jet nibbles and
; no jets sent, which is what the RAM clear above already left, and a zeroed
; entry countdown fires on the first tick - so the first jet of the first wave
; comes in on the first sweep, at the far column, in the lane the rotor starts
; on.

; ============================================================================
; the rest of reset
; ============================================================================

main_timers:
        LXI FILE_STATE
        LYI NIB_SKILL
        LAM
        P PAT_ROCKET
        LXI FILE_TIME
        LYI NIB_ROCK_LO
        LMAIY
        LAB
        LMAIY

        LXI FILE_TIME
        LYI NIB_BS_LO
        LAI 0
        LMAIY
        LAI BSHIP_GAP_HI
        LMAIY

        ; --- start the timer free running ---
        ; tick_input reads it when the player presses fire, and that sample is
        ; the game's only randomness. A counter started on first use has no
        ; phase to read, so it starts here.
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
; word splits low nibble -> A, high nibble -> B.

; --- Actor and lane -> where that segment lives -----------------------------
; A = the plate file (FILE_PLATE0/1/2, i.e. which of R0, R1, R2 carries it).
; B = the bit within that file. or_plate reads both.
;
; Four groups of three, indexed by LANEP_* + lane. Every address is the segment
; atlas's (src/machine/tube/atlas.json); the plate numbers in the comments are
; the atlas's plate indices, and file/bit is just plate/4 and 1 << (plate mod 4).
; The groups are not contiguous because a fourth slot each keeps the arithmetic
; to a single AI.
.PATTERN PAT_LANE
lane_plates:
        .DW $010                ;  0: jet, lane 0        - plate 0,  R0 bit 0
        .DW $020                ;  1: jet, lane 1        - plate 1,  R0 bit 1
        .DW $040                ;  2: jet, lane 2        - plate 2,  R0 bit 2
        .DW $000                ;  3: unused
        .DW $080                ;  4: rocket, lane 0     - plate 3,  R0 bit 3
        .DW $011                ;  5: rocket, lane 1     - plate 4,  R1 bit 0
        .DW $021                ;  6: rocket, lane 2     - plate 5,  R1 bit 1
        .DW $000                ;  7: unused
        .DW $041                ;  8: player, lane 0     - plate 6,  R1 bit 2
        .DW $081                ;  9: player, lane 1     - plate 7,  R1 bit 3
        .DW $012                ; 10: player, lane 2     - plate 8,  R2 bit 0
        .DW $000                ; 11: unused
        .DW $022                ; 12: burst, lane 0      - plate 9,  R2 bit 1
        .DW $042                ; 13: burst, lane 1      - plate 10, R2 bit 2
        .DW $082                ; 14: burst, lane 2      - plate 11, R2 bit 3
        .DW $000                ; 15: unused
; Groups 8 and 12 each serve two actors, because the tube gives the same plate
; the same *role* under every playfield grid and lets the grid say which segment
; that is: 6-8 are the missile dart under grids 0-4 and the launcher under grid
; 5, and 9-11 the jet-kill burst under grids 0-3 and the player's own
; destruction under grid 5. The battleship is not here - it is the only actor
; above plate 11, and render_bship writes its file directly.

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

; --- Column -> its display grid, and what a jet there is worth ---------------
; A = the display grid that column is strobed on. The game counts columns from
; the G line outwards and the tube numbers its grids from the far side inwards,
; so this is the whole of that translation: grid = 6 - column, one to one.
;
; It used to be grid = 5 - column with columns 5 and 6 both landing on grid 0,
; because the atlas gave the playfield six grids. Seven printed cell boxes and a
; two-cell score readout (assets/reference/tube-teardown/) freed the seventh, so
; the battleship's zone now has a grid of its own and nothing is collapsed.
; B = the scoring band, read by missile_kill. The printed ruler is 10 / 3 / 2 /
; 1 / G from the far side inwards; the battleship zone carries the 10 and is
; scored through add_score's tens addend, so its band here is zero.
;
; Column 0 is the capture line. Its grid is real - the launcher and the burst
; that marks its destruction hang there - but the tube prints no jet in that
; cell, so draw_jet stops short of it rather than driving an address the glass
; has nothing at.
.PATTERN PAT_COLUMN
column_plates:
        .DW $006                ; 0: grid 6, the G line - a jet here captures
        .DW $015                ; 1: grid 5, near band, 1 point
        .DW $014                ; 2: grid 4, near band, 1 point
        .DW $023                ; 3: grid 3, middle band, 2 points
        .DW $022                ; 4: grid 2, middle band, 2 points
        .DW $031                ; 5: grid 1, far band, 3 points
        .DW $000                ; 6: grid 0, the battleship zone
        .DW $000, $000, $000, $000, $000    ; 7-11:  unused
        .DW $000, $000, $000, $000          ; 12-15: unused

; --- Skill -> how often the jets fire back ----------------------------------
; Sweeps between rocket launches, as A = low nibble and B = high nibble.
; PROVISIONAL - no measurement, see docs/evidence/timing-analysis.md (T9).
; v1's per-tick fire chances gave mean intervals of ~556 / ~278 / ~167 ms, which
; at this ROM's ~74 sweeps per second are ~41 / ~21 / ~12 sweeps. Those means
; came from v1's tuning, not from the unit, and they were shorter than a rocket's
; own flight: at 7 sweeps per column (ROCKET_SWEEPS) a full-board flight is 42
; sweeps, so skill 3 launched a second rocket into a lane while the first was
; still in it and the lane never cleared. A player cannot dodge a lane that is
; permanently occupied, whatever the flight time is.
;
; The figures below are therefore derived from ROCKET_SWEEPS rather than from
; v1: each is longer than the 42-sweep flight, so at most one rocket per lane is
; ever airborne and the dodge window the flight time buys actually exists. The
; skill ordering and the spread are v1's; the floor under them is arithmetic.
; The counts moved with the sweep rate; the milliseconds they stand for did not.
.PATTERN PAT_ROCKET
rocket_interval:
        .DW $000                ; 0: unused - the dial reads 1..3
        .DW $045                ; skill 1: 69 sweeps, ~929 ms
        .DW $037                ; skill 2: 55 sweeps, ~740 ms
        .DW $02E                ; skill 3: 46 sweeps, ~619 ms
        .DW $000, $000, $000, $000
        .DW $000, $000, $000, $000
        .DW $000, $000, $000, $000

; --- Speed index -> the squadron's step cadence -----------------------------
; Sweeps between steps, as A = low nibble and B = high nibble. One ladder:
; PAT_SKILL picks the entry point, each kill and each cleared wave takes one step
; down it, and entry 15 is the floor.
;
; The **top of the ladder is measured**; everything below it is that measurement
; carried down the ladder's existing shape. docs/evidence/timing-analysis.md T1.
;
; Entry 0 is the slowest steady march the gameplay video shows: **2033 and
; 2050 ms**, at t=64.4 and t=90.2, each a jet crossing three columns with its two
; step intervals agreeing to 100 ms. 110 sweeps runs at 1995 ms of measured wall
; clock, 2% under it.
;
; **Wall clock, not `sweeps x 13.46 ms`.** `note_loop` stops sweeping the tube
; while a sound plays, so a step lands 40-60% longer than its nominal: entry 0 is
; 1481 ms nominal and 1995 ms in wall clock off the probe. The video measures wall
; clock, so the comparison has to be made there. The previous entry 0 was 55
; sweeps - 740 ms nominal, **1075 ms measured** - so the ladder was 1.9x too fast
; at its top, not 2.8x as the nominal figures alone would suggest.
;
; **Why this needs no knowledge of the skill dial.** Entry 0 *is* skill 1's entry
; point, the slowest cadence the ROM can produce at any dial position and any
; point in a game. The unit demonstrably marched at ~2040 ms. So the observed
; behaviour was outside the range this ladder could express at all, whatever the
; dial was set to - a refutation, not a mistuning.
;
; **The assumption, stated so it can be corrected.** Putting 2040 ms at entry 0
; assumes the session showing it was at **skill 1 and near the top of its ladder**.
; It was at score 42-45, so it had already made some progress, and skill 1's true
; entry is if anything slower than this. If that session was at skill 2 or 3
; instead, every entry here is still too fast and by a larger factor. When the
; dial is visible in a recording, that is the number to re-derive against.
;
; **The floor is a consequence, not a claim.** The other fifteen rungs are the
; previous ladder's shape scaled by the same factor - which comes out at almost
; exactly 2x, though it was derived from the top rung and not chosen as a
; doubling. Entry 15 lands at 30 sweeps, 652 ms measured. That is *unevidenced*
; rather than measured, and the distinction matters: the video's long session was
; still descending when it ended - 733 ms at score 164 and 900 ms at score 188,
; against a 199 cap - so it may never have reached bottom, and nothing in the
; footage says where bottom is. Note 652 ms is faster than the fastest step seen
; anywhere in 408 s (700 ms), so if it is wrong it is still wrong in the fast
; direction. T4 is what would settle it.
;
; **What the video refutes outright.** Entry 15 was previously derived from the
; 205 ms march-beep interval in gameplay-audio.m4a, on the premise that the beep
; fires once per squadron step. Over t=122-128 four consecutive column steps are
; timed at 1067-1200 ms in two lanes at once, while the 590-720 Hz band's own
; repetition period in that same window is 763 ms and its notes fall in the gaps
; between the steps. Clip-wide that band repeats at 700-800 ms and missile
; launches - directly observable as a cyan onset at column 1 - at 600-1000 ms, so
; it tracks how often the player fires. 205 ms never bounded the squadron rate.
;
; Whether the shape between the ends is right is still T2, and still unmeasured.
.PATTERN PAT_STEP
step_cadence:
        .DW 110, 104, 96, 90
        .DW 82, 78, 74, 68
        .DW 62, 56, 50, 46
        .DW 42, 36, 32, 30

; --- Skill -> where on that ladder a fresh squadron starts ------------------
.PATTERN PAT_SKILL
skill_base:
        .DW $000                ; 0: unused - the dial reads 1..3
        .DW $000                ; skill 1: 110 sweeps, 1995 ms measured wall clock
        .DW $004                ; skill 2: 82, 1528 ms
        .DW $009                ; skill 3: 56, 1159 ms
        .DW $000, $000, $000, $000
        .DW $000, $000, $000, $000
        .DW $000, $000, $000, $000

; ============================================================================
; The sound table
; ============================================================================
;
; A sound is four numbers. PAT_SND_A carries the half-period delay's inner count
; in its low nibble and its outer count in its high nibble; PAT_SND_B carries the
; whole-delay repeat count minus one in its low nibble and the periods per burst
; minus one in its high nibble. Bursts are passed to play_sound in B.
;
; The period of the square wave that comes out is, in machine cycles,
;
;   period = 25 + repeats * (24 + outer * (4 * inner + 24))
;
; where `repeats` and `outer` are the stored values plus one. At the 400 kHz
; oscillator the frequency is 400000 / period. Every entry below is the closest
; this loop can land to its target, and the target is cited.
;
; **Two ways this arithmetic gets misread, both of which say the battleship buzz
; is broken when it is not.** The buzz has been reported as unreachably high
; twice now, and each time the reasoning ran off the same two facts:
;
;   - `outer` is the stored value *plus one*, because DB leaves the loop only
;     after the counter borrows. Dropping the plus one on entry 2 gives 1309
;     cycles and 306 Hz - above the measured band, and wrong. The real figure is
;     1393 cycles and 287 Hz.
;   - `$0FF` is the largest PAT_SND_A entry, but PAT_SND_A is not the floor.
;     `rep` - PAT_SND_B's low nibble - multiplies the whole delay, which is how
;     the loss sound's collapse reaches 96 Hz on a *smaller* PAT_SND_A entry
;     than the buzz uses. Entry 2 stores rep 0; rep 1 would roughly double its
;     period to about 145 Hz, far below the band. There is a great deal of room
;     under this entry and no encoding change is needed to reach it.
;
; Neither is a matter of opinion. Drive the machine and reconstruct the tone
; from D14 and the buzz reads 287.2 Hz against a measured 230-300, with the
; march at 640.0 Hz against a measured 600-650 - the march being the calibration
; point that says the model behind these numbers is the right one.
; tools/probe/speaker-bands.test.ts asserts both, and separately asserts the
; buzz below the march, which audio-reference.md records as the stronger
; owner-confirmed constraint.
;
; One wrinkle, and it is real hardware behaviour rather than a defect: the period
; that straddles a burst boundary is **twelve cycles longer**, because note_loop
; has to reload the period counter and decrement the burst counter between
; bursts and the machine has no timer to hide that behind. A four-burst note
; therefore contains three slightly flat periods out of sixty-four. It matters
; for exactly one sound - the missile blip, whose band contract criterion V5
; asserts against - so that entry is chosen so that *both* its periods land
; inside 1480-1632 Hz: 257 cycles is 1556 Hz and 269 is 1487 Hz. Retuning it
; means re-checking the boundary period as well as the nominal one.
;
; | id | sound      | in | out | rep | per | period | Hz   | target (audio-reference.md) |
; |----|------------|----|-----|-----|-----|--------|------|-----------------------------|
; |  0 | missile    |  7 |   3 |   0 |  15 |    257 | 1556 | 1480-1632, centre 1520      |
; |  1 | jet march  | 12 |   7 |   0 |   7 |    625 |  640 | 600-650                     |
; |  2 | battleship | 15 |  15 |   0 |   7 |   1393 |  287 | 230-300, and below the march|
; |  3 | warning    | 13 |   9 |   0 |   4 |    809 |  494 | 455-545                     |
; |  4 | win 1      |  5 |  10 |   0 |  15 |    533 |  751 | 750 (measured fundamental)  |
; |  5 | win 2      | 13 |   4 |   0 |  15 |    429 |  932 | 940 (measured fundamental)  |
; |  6 | win 3      | 11 |   3 |   0 |  15 |    321 | 1246 | 1240 (not the 1244 label)   |
; |  7 | loss 1     | 14 |   9 |   0 |  11 |    849 |  471 | 455-545 opening transient   |
; |  8 | loss 2     | 12 |  13 |   3 |   3 |   4153 |   96 | 80-97 collapse              |
; |  9 | loss 3     | 14 |   9 |   1 |  10 |   1673 |  239 | 200-280 rasp body           |
; | 10 | loss 4     | 13 |  12 |   1 |  15 |   2049 |  195 | ~196 drifting down          |
; | 11 | loss 5     | 11 |  12 |   2 |  15 |   2749 |  146 | ~147 decay floor            |
;
; Note *lengths* are a mixture and are not all measured. A length here is how
; long one sound lasts; how often the game triggers it is the provisional-cadence
; block's business and is deliberately not decided here.
;
; A length is also not free of perceptual consequence. A burst of eight cycles is
; not a short tone, it is a click: pitch does not establish itself in under
; roughly twenty milliseconds, so a note shorter than that reaches the ear as a
; speaker pop whatever its period says. The march and the battleship buzz are the
; two sounds a player hears constantly, and at 12.5 ms and 28 ms they were
; exactly that - which is why the unit sounded like it was popping rather than
; playing, with both pitches sitting correctly inside their measured bands the
; whole time. Both are now at the ~70 ms the reference records for a march step.
;
;  - missile: 4 bursts of 16 periods = 42 ms. audio-reference.md measures ~20 ms;
;    contract criterion V5 requires under 150 ms. PROVISIONAL, and longer than the
;    measurement.
;  - jet march: 3 bursts of 15 periods = 70.4 ms, against the 70 ms recorded in
;    audio-reference.md as jetMarch.stepDurationMs. That figure is a v1
;    *synthesis* rather than a measurement, so it is a target and not a contract,
;    but it is the only duration the evidence carries and 12.5 ms was audibly
;    wrong against it.
;  - battleship: 2 bursts of 10 periods = 69.7 ms per lane step, three lane steps
;    per crossing. audio-reference.md calls the real buzz "sustained" and v1
;    synthesized one 380 ms note. Not a single 380 ms note, because note_loop
;    does not sweep the tube while it runs and freezing the display for the whole
;    crossing trades one visible defect for another; three ~70 ms buzzes read as
;    one sustained buzz only if they are close enough together, which is a
;    property of BSHIP_SWEEPS and not of this table. That is where this claim was
;    wrong until the crossing was re-sized - see the battleship's entry in the
;    provisional-cadence block. PROVISIONAL.
;  - warning beep: 1 burst of 5 periods = 10.1 ms, against a measured ~10 ms.
;    Short, but this one is the measurement.
;  - win: 9, 9 and 12 bursts of 16 periods = 192 / 154 / 154 ms against the
;    transcribed 200 / 150 / 150 ms, and 16 bursts = 274 ms for the resolution
;    against a transcribed 330 ms - the resolution is short because the burst
;    count is a nibble.
;  - loss: 1, 1, 4, 2 and 2 bursts = 25 / 42 / 184 / 164 / 220 ms against the
;    transcribed 25 / 45 / 180 / 170 / 240 ms.

.PATTERN PAT_SND_A
sound_pitch:
        .DW $037                ; 0  missile fire
        .DW $07C                ; 1  jet march
        .DW $0FF                ; 2  battleship buzz
        .DW $09D                ; 3  launcher-hit warning beep
        .DW $0A5                ; 4  win, 750 Hz
        .DW $04D                ; 5  win, 940 Hz
        .DW $03B                ; 6  win, 1240 Hz
        .DW $09E                ; 7  loss, opening transient
        .DW $0DC                ; 8  loss, collapse
        .DW $09E                ; 9  loss, rasp body
        .DW $0CD                ; 10 loss, drifting down
        .DW $0CB                ; 11 loss, decay floor
        .DW $000, $000, $000, $000

.PATTERN PAT_SND_B
sound_shape:
        .DW $0F0                ; 0  16 periods per burst
        .DW $0E0                ; 1  15
        .DW $090                ; 2  10
        .DW $040                ; 3   5
        .DW $0F0                ; 4  16
        .DW $0F0                ; 5  16
        .DW $0F0                ; 6  16
        .DW $0B0                ; 7  12
        .DW $033                ; 8   4 periods, delay repeated 4 times
        .DW $0A1                ; 9  11 periods, delay repeated twice
        .DW $0F1                ; 10 16 periods, delay repeated twice
        .DW $0F2                ; 11 16 periods, delay repeated three times
        .DW $000, $000, $000, $000

.END

