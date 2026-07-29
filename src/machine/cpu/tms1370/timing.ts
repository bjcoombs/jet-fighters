// TMS1370 timing constants: oscillator frequency, the divide-by-six, and the
// instruction rate derived from them.
//
// Both named constants below are PROVISIONAL, and each carries its own reason.
// Full provenance, the four-step non-circular measurement route, and what
// would replace either figure live in docs/research/mp2110-timing-measurement.md
// (PRD R6, contract V10) - read that before changing either one.
//
// Everything downstream (src/machine/cpu/tms1370/'s execution engine,
// asm/jetfighter.asm's cadence constants, tools/probe/'s timing assertions)
// must import CYCLE_HZ from here rather than restating a cycles-per-second
// figure, so that refining OSCILLATOR_HZ or CLOCK_DIVIDER moves every
// consumer at once instead of drifting out of step with a copy.

/**
 * MAME's fitted RC-oscillator approximation for the TMS1370, in hertz.
 *
 * `docs/research/tms1370-architecture.md` §6 cites the driver source
 * verbatim: `TMS1370(config, m_maincpu, 350000); // approximation - RC osc.
 * R=47K, C=47pF` (S2 `hh_tms1k.cpp:7093`). MAME's own driver header states the
 * spread this carries: **+/-50 kHz, unit to unit**, and attributes part of it
 * to component ageing (S2 `hh_tms1k.cpp:19-24`). See
 * {@link OSCILLATOR_SPREAD_HZ} for that figure as a named constant, and never
 * collapse the two into a single "58 kHz" threshold - the contract (V10)
 * requires the midpoint not appear anywhere as one. Nothing about this figure
 * has been measured on the owner's own unit; it is MAME's estimate for the
 * model, not this chip.
 */
export const OSCILLATOR_HZ = 350_000;

/**
 * The stated spread on {@link OSCILLATOR_HZ}, in hertz, unit to unit.
 *
 * `tms1370-architecture.md` §6: "±50 kHz on 350 kHz is ±14%" (MAME's driver
 * header, `hh_tms1k.cpp:19-24`). Kept as its own constant so the oscillator's
 * range - {@link OSCILLATOR_HZ_MIN} to {@link OSCILLATOR_HZ_MAX} - is always
 * computed from the same two numbers this comment cites, never retyped.
 */
export const OSCILLATOR_SPREAD_HZ = 50_000;

/** The low end of the oscillator's stated range: {@link OSCILLATOR_HZ} minus {@link OSCILLATOR_SPREAD_HZ}. */
export const OSCILLATOR_HZ_MIN = OSCILLATOR_HZ - OSCILLATOR_SPREAD_HZ;

/** The high end of the oscillator's stated range: {@link OSCILLATOR_HZ} plus {@link OSCILLATOR_SPREAD_HZ}. */
export const OSCILLATOR_HZ_MAX = OSCILLATOR_HZ + OSCILLATOR_SPREAD_HZ;

/**
 * Oscillator pulses per instruction cycle. Every TMS1100/1300-family
 * instruction executes in exactly one instruction cycle.
 *
 * `tms1370-architecture.md` §6 calls this the one figure "confirmed three
 * independent ways": TI's prose (S3 §2.8, verbatim "Six oscillator pulses
 * constitute one instruction cycle"), TI's electrical table (S3 §4 - the
 * 15 µs min / 60 µs max instruction cycle time is exactly six of the 2.5 µs
 * min / 10 µs max clock cycle time), and MAME's running code (S1 -
 * `execute_run` advances a 6-state subcycle counter,
 * `tms1k_base.cpp:734-743`). Unlike {@link OSCILLATOR_HZ} this is not an
 * estimate: it is architectural and does not move when the oscillator
 * measurement is refined, which is why it is a separate constant rather than
 * folded into one fused cycles-per-second figure.
 */
export const CLOCK_DIVIDER = 6;

/**
 * Instruction cycles per second of emulated time, derived from
 * {@link OSCILLATOR_HZ} and {@link CLOCK_DIVIDER}.
 *
 * Always computed, never a literal - see the module comment for why. Inherits
 * {@link OSCILLATOR_HZ}'s provisional status: this is MAME's estimate for the
 * model divided by an architectural constant, not a measurement of the
 * owner's unit. docs/research/mp2110-timing-measurement.md records the route
 * that replaces it with one.
 */
export const CYCLE_HZ = OSCILLATOR_HZ / CLOCK_DIVIDER;

/** {@link CYCLE_HZ} at the low end of the oscillator's stated range. */
export const CYCLE_HZ_MIN = OSCILLATOR_HZ_MIN / CLOCK_DIVIDER;

/** {@link CYCLE_HZ} at the high end of the oscillator's stated range. */
export const CYCLE_HZ_MAX = OSCILLATOR_HZ_MAX / CLOCK_DIVIDER;
