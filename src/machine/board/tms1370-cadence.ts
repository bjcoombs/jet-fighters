// The horizons a TMS1370 probe measures against, all six derived from one rate.
//
// Paths in this file are relative to the repository root.
//
// PRD R5 names six cycle constants that have to be re-derived for this machine,
// and `docs/contract/v3.contract.md` criterion V14 says how: **no occurrence of
// any of them may be a numeric literal unless the same file also defines the
// sweep length it derives from.** That is the whole reason this module exists
// rather than each probe suite carrying its own figure. Under v2 they were
// literals - `BURST_GAP_CYCLES = 8000`, `CAPTURE_WINDOW_CYCLES = 600_000` - in
// four different files, and they all silently meant "at 400 kHz". At the
// TMS1370's instruction rate every one of them is wrong by a factor of seven,
// and nothing about a literal says so.
//
// So the sweep length is defined here, once, measured rather than counted, and
// every horizon below is a multiple of it or of {@link CYCLE_HZ}.
//
// ## Everything here inherits one provisional figure
//
// `CYCLE_HZ` is MAME's fitted RC-oscillator approximation divided by the
// architectural divide-by-six, and it carries MAME's own stated +/-50 kHz. So a
// horizon below is a *duration* stated in cycles at the midpoint rate, and the
// same wall-clock event costs between 0.86x and 1.14x of it on real silicon.
// `CYCLE_HZ_MIN` and `CYCLE_HZ_MAX` are exported from `timing.ts` for exactly
// this, and every horizon here is set with enough margin to survive the spread
// rather than tuned to the midpoint - which is what V10 means by "58 kHz
// appears nowhere as a threshold".
//
// Pure data: no DOM, no timers, no state.

import { CYCLE_HZ } from '../cpu/tms1370/timing.js';
import { STROBES_PER_SWEEP } from './o-pla.js';

/**
 * Instruction cycles one display sweep costs, with nothing on the tube.
 *
 * **Measured, not counted.** `tools/probe/tms1370-probe.ts` runs
 * `asm/jetfighter.asm` on the core and reports the cycles between successive
 * strobes of grid 0 in the near pass; this is the median of that over 30 s of
 * emulated time with no input. The ROM has no dwell loop at all - a grid is lit
 * for the work `strobe` does while it is lit - so the sweep period *is* the
 * program's cost, and that cost depends on what is on the glass: the buzz ticks
 * in every strobe while the battleship is up and the R-plate walk only visits
 * grids that want a line.
 *
 * The same source states the figure at `SWEEP_INSTRUCTIONS_LO`/`_HI`, spelled
 * as two nibbles because the assembler's operands are four bits wide.
 * `tools/probe/tms1370-timing.test.ts` asserts the two agree, so the ROM cannot
 * drift from this module without a test going red.
 */
export const SWEEP_INSTRUCTIONS = 889;

/**
 * Sweeps a second, at the midpoint instruction rate.
 *
 * Not tuned to `docs/evidence/vfd-appearance.md`'s 70.6-72.5 Hz interval, and
 * that is a decision rather than a miss: the oscillator's stated spread puts
 * this same sweep anywhere from 56.2 to 75.0 Hz, a range that contains the
 * video's interval whole. Tuning the instruction count so the *midpoint* landed
 * at 71.5 Hz would be tuning to the one number the contract says must appear
 * nowhere as a threshold. Measuring the oscillator is what pins the refresh.
 */
export const SWEEP_HZ = CYCLE_HZ / SWEEP_INSTRUCTIONS;

/** Instruction cycles one grid strobe gets: a sweep, split 24 ways. */
export const STROBE_CYCLES = SWEEP_INSTRUCTIONS / STROBES_PER_SWEEP;

/**
 * Silence that separates one sound from the next, in cycles.
 *
 * Two sweeps. A sound is built by `note`, which does not strobe the grids, so
 * the gap between two notes of one phrase is the handful of instructions
 * between the calls - far less than a sweep - while the gap to the *next* event
 * the game makes is at least the sweep it went back to drawing. Two sweeps
 * therefore splits events without splitting phrases, and it moves with the
 * sweep rather than being a figure of its own.
 */
export const BURST_GAP_CYCLES = Math.round(2 * SWEEP_INSTRUCTIONS);

/**
 * How long after a launcher is lost the machine is still expected to sound.
 *
 * The loss sound is 660 ms of tone and the warning cluster that precedes a
 * non-final hit is under 100 ms, so ten seconds is a wide window around the
 * event rather than a measurement of it. Stated in cycles because that is what
 * the probe counts.
 */
export const CAPTURE_WINDOW_CYCLES = Math.round(10 * CYCLE_HZ);

/**
 * The span a launcher-hit warning's beeps fall inside, in cycles.
 *
 * Three beeps of ~10 ms with ~27 ms gaps is 110 ms; half a second is four times
 * that, which is enough margin for the oscillator's spread and still far short
 * of the next game event.
 */
export const WARNING_CLUSTER_CYCLES = Math.round(0.5 * CYCLE_HZ);

/**
 * The slice a driving harness advances the machine by between input decisions.
 *
 * A fifth of a sweep: short enough that an injected contact is never missed by
 * a whole strobe pass, long enough that a minute of emulated time is not a
 * million round trips.
 */
export const PLAYER_SLICE_CYCLES = Math.round(SWEEP_INSTRUCTIONS / 5);

/**
 * The step a harness takes when it wants strobe-level resolution.
 *
 * One strobe. Below this a caller is sampling inside a single grid's dwell,
 * which tells it about `strobe` rather than about the game.
 */
export const STEP_CYCLES = Math.round(STROBE_CYCLES);

/**
 * How long the display may go unrefreshed before it counts as blanked.
 *
 * Three sweeps. One sweep is the refresh; two is a sweep that ran long because
 * the game had more to do; three means the sweep loop is not running at all,
 * which on this machine means a sound is playing or the program has stopped.
 */
export const REFRESH_TIMEOUT_CYCLES = Math.round(3 * SWEEP_INSTRUCTIONS);

/**
 * The battleship's buzz repetition rate, as the ROM clocks it.
 *
 * `BUZZ_DIV = 8` O strobes between speaker edges, so a full period is sixteen
 * strobes. Derived from the sweep rather than from a count of dwells per sweep,
 * which is what V14 asks: the v2 figure embedded ten grid dwells and there are
 * nine grids here, drawn in twenty-four strobes.
 */
export const BUZZ_STROBE_DIVIDER = 8;

/** Buzz repetition rate in hertz, at the midpoint rate and an idle sweep. */
export const BUZZ_NOMINAL_HZ =
  (STROBES_PER_SWEEP * SWEEP_HZ) / (2 * BUZZ_STROBE_DIVIDER);
