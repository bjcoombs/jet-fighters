// What a kill is worth, against the ruler silkscreened on the overlay.
//
// Paths in this file are relative to the repository root.
//
// ## The defect this exists to stop coming back
//
// The owner played the deployed build beside his own CGL unit and reported "the
// scoring seems wrong, see in the display the scores tallied should match the
// read outs so a battle ship is 10 for example, yet all hits are scoring at 1
// point". He was right: `SCORE_JET` was a flat 1 and every jet scored it,
// wherever it stood. The overlay prints a scoring ruler - `10 / 3 / 2 / 1 / G` -
// and nothing in the tree checked the ROM against it.
//
// Nothing checked it because the ruler had never been turned into a table of
// numbers. `src/machine/tube/layout.ts` had registered where the ink *is* -
// which tick each numeral's bracket drops on - and stopped there, explicitly:
// "Nothing about scoring itself changes - the ROM is untouched." This file is
// the other half, and the derivation from those tick positions to the table
// below is written out beside `SCORE_JET` in `asm/jetfighter.asm`.
//
// ## Why grid 5 is asserted but never aimed at
//
// A missile is placed on `GRID_COL_LAST` by `fire_missile` and `missile_step`
// decrements *before* it tests for a jet, so the first cell a missile can hit is
// grid 4. **A jet standing on grid 5 cannot be shot at all.** That is a property
// of the missile path, not of scoring, and it is not this file's to change -
// `missile_step` is being re-measured separately against the owner's report that
// the physical unit flies three missiles at once.
//
// So the per-column aimed kills below cover grids 1 to 4, which is every column
// a missile can reach, and grid 5 is carried by `RULER_POINTS` and by the
// whole-drive invariant instead. If the missile path later gains a grid-5 hit,
// the invariant scores it against the ruler on the first run without this file
// being touched. Asserting a value that cannot currently be produced is
// deliberate: the alternative is a table with a hole in it exactly where the
// next change to the missile will land.
//
// ## Why this reads RAM where `launcher-lives.test.ts` reads the glass
//
// The assertion is a *pairing* - this delta, for a kill in that column - and the
// column half of it has no independent representation on the tube. The burst is
// drawn in the cell the jet died in, so the glass does carry it, but reading the
// column back off the burst is `rom-atlas-conformance.test.ts`'s whole subject
// and re-deriving it here would make this file assert that suite's method rather
// than the ruler. `NIB_KCOL` is read instead, which `tick_burst` clears when the
// burst expires - so it is non-zero only while a burst is on the glass, and the
// only writers are `missile_kill` and `bship_kill`, each immediately before the
// scoring routine it falls into. The score itself is read the way the existing
// `it('scores')` in `tms1370-rom.test.ts` reads it.
//
// ## The torn read, which is real and had to be handled
//
// `add_score` writes `NIB_SC_U` and then, on a carry, `NIB_SC_T` four
// instructions later. A sample landing between the two sees the units digit
// already wrapped and the tens not yet bumped - 19 reads as 10 - and the next
// sample then reads +10. At a 5 ms sample that is about a 0.5% chance per
// scoring event, and it showed up as a `-9` in the first census run of this
// drive. `aimedDrive` steps `SETTLE_CYCLES` past the write before believing a
// change, which is why every delta below is a single number and not a pair.

import { beforeAll, describe, expect, it } from "vitest";
import { SWEEP_INSTRUCTIONS } from "../../src/machine/board/tms1370-cadence.js";
import { CYCLE_HZ } from "../../src/machine/cpu/tms1370/timing.js";
import { Tms1370Machine } from "./tms1370-probe.js";

/** `FILE_STATE`, `FILE_TIME` and `FILE_JETS`, from the RAM map in the ROM source. */
const FILE_STATE = 4;
const FILE_TIME = 5;
const FILE_JETS = 6;
const FILE_MISS = 7;
const NIB_RCOL = 7;
const NIB_RLANE = 8;
const NIB_BSLANE = 9;
const NIB_STATE = 11;
const NIB_KCOL = 14;
const NIB_SC_U = 10;
const NIB_SC_T = 11;
const NIB_SC_H = 12;

/**
 * The squadron: two `(row, column)` pairs at `FILE_JETS` 10-13.
 *
 * Written out in the same style as the nibbles above rather than read from the
 * assembled symbols, because this file deliberately keeps its RAM map local -
 * see the block comment on `FILE_STATE`.
 */
const NIB_P_BASE = 10;
const PLANE_STRIDE = 2;
const PLANE_COUNT = 2;

/** Every airborne plane's `(row, column)`. A column of 0 is an empty slot. */
function planesOf(ram: ArrayLike<number>): { row: number; column: number }[] {
  const planes: { row: number; column: number }[] = [];
  for (let slot = 0; slot < PLANE_COUNT; slot += 1) {
    const at = FILE_JETS * 16 + NIB_P_BASE + slot * PLANE_STRIDE;
    const column = ram[at + 1] as number;
    if (column !== 0) planes.push({ row: ram[at] as number, column });
  }
  return planes;
}

/**
 * Per lane, the deepest column a plane stands on in it - 0 for an empty lane.
 *
 * This is what every `ram[FILE_JETS * 16 + lane]` in this drive used to be, and
 * it is deliberately lossy in the one way the model allows: two planes can share
 * a row and only the deeper is reported. That is right for a *drive*, whose job
 * is to pick a lane to shoot down and should pick the urgent one; assertions
 * about the squadron read the pairs themselves.
 */
function deepestByLane(ram: ArrayLike<number>): number[] {
  const planes = planesOf(ram);
  return [0, 1, 2].map((lane) =>
    planes.reduce((deepest, plane) => (plane.row === lane ? Math.max(deepest, plane.column) : deepest), 0),
  );
}

/** A lane holding a plane on exactly `column`, or -1. Both slots are searched. */
function laneStandingOn(ram: ArrayLike<number>, column: number): number {
  return planesOf(ram).find((plane) => plane.column === column)?.row ?? -1;
}

/** `NIB_BSLANE` when no crossing is in progress. */
const BS_NONE = 15;

/** The squadron's march countdown, and the far end of the field. */
const NIB_STEP_LO = 13;
const NIB_STEP_HI = 14;
const GRID_COL_LAST = 5;

/**
 * Sweeps a shot spends crossing one column: `MISSILE_HI * 16 + MISSILE_LO + 1`.
 * The low nibble reloads to 15 and is spent first, so it is 32 and not 16 - the
 * same correction the march and the battleship pairs carry.
 */
const MISSILE_COLUMN_SWEEPS = 32;

/**
 * Sweeps the boat spends in one lane: `BSHIP_STEP_HI * 16 + BSHIP_STEP_LO + 1`,
 * which is 4 * 16 + 0 + 1. Three of them is the 3.9 s crossing measured in
 * `asm/jetfighter.asm`'s battleship header.
 *
 * Stated in sweeps rather than as the 1.29 s it currently comes to, for the
 * reason CLAUDE.md gives about horizons in tests of a machine whose sweep moves:
 * the lead window is a count of sweeps in the ROM, so a cadence change should
 * move the seconds and leave this alone.
 */
const BOAT_LANE_STEP_SWEEPS = 65;

/** Seconds of emulated time, as the cycle count the probe takes. */
const seconds = (value: number): number => Math.round(value * CYCLE_HZ);

/**
 * The sample interval, 5 ms, matching `parkedGame` in `tms1370-rom.test.ts`.
 * A burst stands for `BURST_SWEEPS`, which is far longer, so no kill can fall
 * between two samples.
 */
const SAMPLE_CYCLES = Math.round(CYCLE_HZ / 200);

/** Cycles to let a score write finish before the new value is believed. */
const SETTLE_CYCLES = 600;

/**
 * **The printed ruler, as points per jet column.**
 *
 * Grid 1 is the far end beside the horizon and grid 5 the cell before the G
 * line, so this reads farther-is-more, as PRD v1 R4 says it should. Grids 4 and
 * 5 are a *clamp*, not a reading: the ruler names no value past `1`, the ink is
 * monotone, and a kill worth nothing is not a reading anyone has proposed - so
 * the last named band extends to G. The derivation from tick positions to these
 * numbers is beside `SCORE_JET` in `asm/jetfighter.asm`.
 */
const RULER_POINTS: Readonly<Record<number, number>> = {
  1: 3,
  2: 2,
  3: 1,
  4: 1,
  5: 1,
};

/** The battleship's own tick, on grid 0. Shipped in #116 and not this file's subject. */
const BOAT_POINTS = 10;

/** Every value the ruler names. A delta outside this set is the ROM inventing one. */
const RULER_VALUES = new Set([1, 2, 3, BOAT_POINTS]);

/** The winning score, and the value `as_cap` truncates a bigger one back to. */
const WIN_SCORE = 199;

/** One scoring event: the cell the burst stood in, and what the score moved by. */
interface Kill {
  /** The grid the burst stands on: 0 the battleship, 1-5 the jet columns. */
  readonly grid: number;
  readonly delta: number;
  /** The score before and after, which is what makes the 199 cap recognisable. */
  readonly from: number;
  readonly to: number;
}

/**
 * The grid the player's shot in `lane` stands on, and 0 for no shot in that lane.
 *
 * **The only thing in this file that knows where missile state lives.** The
 * column now lives in `FILE_MISS`, one nibble per lane, with the lane implied by
 * which nibble holds it - the rank the owner describes
 * (`docs/evidence/owner-entity-model.md`). There is no lane indirection left to
 * do: nibble `lane` is lane `lane`'s column. The ROM still fires one shot at a
 * time, so at most one lane answers non-zero today, but that is the firing
 * guard's doing and not this map's. The nibble numbers are from the RAM map at
 * the head of `asm/jetfighter.asm`.
 */
function missileCol(ram: Uint8Array, lane: number): number {
  const NIB_MC = 0;
  return ram[FILE_MISS * 16 + NIB_MC + lane] as number;
}

/**
 * True while the player has a shot anywhere on the playfield.
 *
 * The three gates below are all "is the barrel free?", and with one missile that
 * is the same question as "is this lane free?". It is deliberately still the
 * whole-playfield question: these drives are instruments, and their measurement
 * of a player - 58 scoring events, and boat kills rare enough that the hunt has
 * to play 27 games to be sure of one - is of a player who fires one shot at a
 * time. Loosening them to fire per lane changes what is being measured, so it
 * belongs in the task that gives the ROM a rank to fire, not in the one that
 * moves the address.
 */
function missileInFlight(ram: Uint8Array): boolean {
  return [0, 1, 2].some((lane) => missileCol(ram, lane) !== 0);
}

/** The three BCD nibbles as one number. */
function scoreOf(ram: Uint8Array): number {
  return (
    (ram[FILE_TIME * 16 + NIB_SC_H] as number) * 100 +
    (ram[FILE_TIME * 16 + NIB_SC_T] as number) * 10 +
    (ram[FILE_TIME * 16 + NIB_SC_U] as number)
  );
}

/**
 * How a drive picks its target each time it is ready to fire.
 *
 * `roundRobin` walks a preferred column so a long drive covers the field;
 * `only` waits for a jet standing on one named column and shoots nothing else,
 * which is how a single column's value is measured on its own.
 */
type Aim =
  | { readonly kind: "roundRobin" }
  | { readonly kind: "only"; readonly column: number };

/**
 * Play the game, aiming, and record every scoring event with the cell it came
 * from.
 *
 * The lever and the fire button are the only things touched; nothing is poked
 * into RAM to set a scenario up. The lever is moved one sample before the fire
 * edge because the ROM reads the lever and the button in the same sweep and
 * `tick_fire` is edge triggered on the button.
 */
/**
 * How close a jet has to be before the drive steps out of its lane.
 *
 * Grid 5 is the cell in front of the launcher and grid 4 the one before it, so
 * four is "arriving next step or the one after". Lower would dodge shadows and
 * cost aiming time; higher would step aside too late to matter.
 */
const DODGE_DEPTH = 4;

/** The lane the battleship enters on, and the lane a shot must be led into. */
/**
 * How long to hold the fire contact closed.
 *
 * **Not cosmetic.** The K matrix is read once per sweep, so a press shorter than
 * a sweep can open and close entirely between two reads and never be seen. The
 * first version of the hunt below pressed for one `SAMPLE_CYCLES` slice - 5 ms
 * against a 13.7 ms sweep - and launched a missile on 0 of 24 attempts. It
 * reported "no battleship was shot down", which was true, and which had nothing
 * to do with the scoring ruler it was asserting on.
 */
const FIRE_HOLD_CYCLES = SAMPLE_CYCLES * 10;

const BOAT_TOP_LANE = 0;
const BOAT_LEAD_LANE = 2;

/**
 * How long after the boat reaches the top lane each crossing's shot is fired,
 * in `SAMPLE_CYCLES` slices, cycled through across crossings.
 *
 * **The lead is a window in time, and this samples it instead of betting on one
 * point in it.** The boat holds the top lane for about 1.29 s and a shot needs
 * about 3.0 s to reach the horizon, so whether a shot connects depends on where
 * inside that dwell it was released. The hunt used to fire the instant it saw
 * the boat arrive - one point, sampled 27 times - which made the whole
 * assertion a bet that this one reaction time lands inside the window.
 *
 * It is a bet the sweep length settles, because the drive observes the arrival
 * on a 5 ms sample while the game advances the boat and the shot on sweeps. Ten
 * instructions added anywhere in the sweep re-phase the two against each other
 * and move the release point within the window. Measured by padding the sweep
 * on an otherwise unmodified ROM, the old drive scored kills at 889 and 894
 * instructions and none at 890, 891, 892, 893, 895, 896 or 897 - and firing the
 * same instant across twice as many games still scored none, which is what says
 * this is a misplaced release rather than too few samples.
 *
 * **The offsets have to cover the whole dwell, and the first version of this did
 * not.** Sixteen written-out offsets at 60 ms spacing reached 0.9 s of the
 * 1.29 s dwell, leaving the last 30% of the window unsampled - a narrower bet
 * than firing on arrival, but the same kind of bet. It held from 889 to 897 and
 * then went red when task 4 landed the missile rank at 898: the hunt still got
 * its shots away, and not one of them connected.
 *
 * So the offsets are derived from the dwell rather than written out - every
 * release point from arrival to the end of it, at half the old spacing. A
 * cadence change now moves *which* offsets fall in the lead window, and there is
 * no longer any part of the window it can move them all out of.
 */
const LEAD_DELAY_STEP_SAMPLES = 6;
const BOAT_TOP_DWELL_SAMPLES = Math.round(
  (BOAT_LANE_STEP_SWEEPS * SWEEP_INSTRUCTIONS) / SAMPLE_CYCLES,
);
const LEAD_DELAY_SAMPLES = Array.from(
  { length: Math.ceil(BOAT_TOP_DWELL_SAMPLES / LEAD_DELAY_STEP_SAMPLES) },
  (_unused, index) => index * LEAD_DELAY_STEP_SAMPLES,
);

/**
 * Hunt the battleship across several games, one shot per crossing, led by two.
 *
 * Separate from the census drive because a boat kill is a low-probability event
 * that has to be sought rather than encountered: see the comment on the
 * assertion that uses this, which also explains how the release point is walked
 * across the lead window rather than fixed.
 *
 * `tools/probe/drives/battleship-lead.ts` is the same strategy as a standalone
 * instrument. **Its recorded figure of 3 kills in 27 crossings no longer
 * reproduces** - it scores none on an unmodified `main` as well as here, so it
 * drifted before this change rather than because of it, and it fires at the one
 * fixed release point this function stopped relying on. It is not run by
 * `npm test`; correcting it is tracked separately.
 */
function boatHunt(): { attempts: number; kills: Kill[]; used: number[] } {
  const used: number[] = [];
  const kills: Kill[] = [];
  let attempts = 0;
  // Advances across games, so successive crossings take successive offsets and
  // the whole hunt walks the lead window rather than each game repeating it.
  let crossingIndex = 0;
  for (const skill of [1, 2, 3] as const) {
    for (const seed of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const machine = new Tms1370Machine();
      machine.setContacts({ skill, lane: seed, fire: false });
      let score = scoreOf(machine.ram);
      let firedThisCrossing = false;
      // -1 while the boat is anywhere but the top lane; counts samples of the
      // dwell once it arrives.
      let sinceTop = -1;
      let leadDelay = 0;
      while (machine.cycles < seconds(300)) {
        machine.step(SAMPLE_CYCLES);
        let ram = machine.ram;
        if ((ram[FILE_STATE * 16 + NIB_STATE] as number) !== 0) break;
        const seen = scoreOf(ram);
        if (seen !== score) {
          machine.step(SETTLE_CYCLES);
          ram = machine.ram;
          const settled = scoreOf(ram);
          const grid = (ram[FILE_STATE * 16 + NIB_KCOL] as number) - 1;
          if (grid === 0)
            kills.push({
              grid,
              delta: settled - score,
              from: score,
              to: settled,
            });
          score = settled;
        }
        const boat = ram[FILE_STATE * 16 + NIB_BSLANE] as number;
        if (boat !== BOAT_TOP_LANE) {
          firedThisCrossing = false;
          sinceTop = -1;
          // ## Between crossings the hunt has to defend, or it never sees a
          // ## second one
          //
          // This drive used to do nothing at all while no boat was in the top
          // lane, which was survivable while `jm_capture` let a jet crossing the
          // G line outside the lever's lane through for nothing. With the
          // settled rule - a capture costs a launcher in any lane - a player who
          // only ever shoots at boats loses all three launchers in twenty to
          // thirty seconds and sees one or two crossings in a whole game.
          //
          // So between crossings it kills the deepest jet, aiming a sweep ahead
          // of the fire because the ROM samples lever and button together and
          // `tick_fire` is edge triggered.
          //
          // **It holds fire for the whole of a crossing rather than only at the
          // top lane.** A shot takes 3.0 s to reach the horizon and the top lane
          // is held for 1.29 s of a 3.9 s crossing, so a missile launched at a
          // jet mid-crossing is still in flight when the lead window opens and
          // the one-shot gate blocks the shot that matters. Defending only while
          // `BS_NONE` keeps the barrel free for the boat.
          if (boat === BS_NONE) {
            const byLane = deepestByLane(ram);
            let deepest = -1;
            let target = 0;
            for (const candidate of [0, 1, 2]) {
              const grid = byLane[candidate] as number;
              if (grid > deepest) {
                deepest = grid;
                target = candidate;
              }
            }
            if (deepest > 0 && !missileInFlight(ram)) {
              machine.setContacts({ lane: target });
              machine.step(SAMPLE_CYCLES);
              machine.setContacts({ fire: true });
              machine.step(FIRE_HOLD_CYCLES);
              machine.setContacts({ fire: false });
            }
          }
          continue;
        }
        // First sample of this crossing's dwell: take the next lead offset.
        if (sinceTop < 0) {
          leadDelay = LEAD_DELAY_SAMPLES[
            crossingIndex % LEAD_DELAY_SAMPLES.length
          ] as number;
          used.push(crossingIndex % LEAD_DELAY_SAMPLES.length);
          crossingIndex += 1;
          sinceTop = 0;
        } else {
          sinceTop += 1;
        }
        if (firedThisCrossing || missileInFlight(ram)) continue;
        if (sinceTop < leadDelay) continue;
        // **Do not fire into a lane a jet is standing in.** `missile_step` tests
        // the cell before the shot leaves it, so a jet anywhere down the lead
        // lane takes the shot and scores as a jet - the shot never reaches the
        // horizon and the crossing is spent. Measured, that is how most led
        // shots died: 23 attempts produced 5 arrivals at the horizon.
        //
        // Waiting for the lane to clear is the same led shot, taken when it can
        // survive to the boat's row. It raises the hit rate rather than lowering
        // the bar, and it is what a player who has learned the lead does - which
        // is the player this drive is meant to be.
        if ((deepestByLane(ram)[BOAT_LEAD_LANE] as number) !== 0) continue;
        // **Aim a sweep before the fire edge**, the same as the defending shot
        // above and for the same reason: the ROM samples the lever and the
        // button in one pass, so a lever moved in the same call as the press can
        // arrive after `tick_fire` has already read the button, and the shot
        // goes down whatever lane the lever was in before. This shot used to set
        // both together, which left it firing down the *defending* shot's lane
        // whenever the two fell in the same sweep - the drive's own header
        // states the rule that the boat shot was not following.
        machine.setContacts({ lane: BOAT_LEAD_LANE });
        machine.step(SAMPLE_CYCLES);
        machine.setContacts({ fire: true });
        machine.step(FIRE_HOLD_CYCLES);
        machine.setContacts({ fire: false });
        firedThisCrossing = true;
        attempts += 1;
      }
    }
  }
  return { attempts, kills, used };
}

const ST_OVER = 1;
const ST_WIN = 2;

/**
 * How a drive stopped. **Reported so it can be asserted on**, because a drive
 * that ran out of clock and a drive that played a game to its end produce the
 * same `Kill[]` and mean different things: the first says "this is what fitted
 * in the window", the second says "this is the whole game". Section 12 of
 * docs/evidence/open-questions.md is the list of what happens when that
 * distinction is left implicit.
 */
type Ending = "lost" | "won" | "clock";

interface Drive {
  kills: Kill[];
  ended: Ending;
}

/**
 * Cycles from power-on to the first plane of the game, **measured on a machine
 * here rather than written down**.
 *
 * The whole of {@link primeEntropy} has to fit inside this, and the figure is a
 * product of the ROM's entry countdown, the sweep length and the cost of the
 * power-on clear - three things that have all moved during this project. Reading
 * it off a fresh machine costs about sixty sweeps once per file and cannot go
 * stale; a literal here would be the bet `CLAUDE.md` warns about, pointing the
 * other way. Today it comes to 54,850 cycles, a little under 62 sweeps.
 */
const FIRST_RELEASE_CYCLES = (() => {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 1, lane: 0, fire: false });
  const ceiling = seconds(5);
  while (machine.cycles < ceiling) {
    machine.step(SWEEP_INSTRUCTIONS);
    if (planesOf(machine.ram).length > 0) return machine.cycles;
  }
  throw new Error(
    "no plane was released in the first five seconds of a game, so primeEntropy has no window to prime in",
  );
})();

/**
 * Sweeps the contact is held closed for one priming press, and sweeps it is open
 * again before the next.
 *
 * `if_down` reads the contact once a sweep and stirs `NIB_ENT` on the *rising
 * edge*, so a press has to be seen closed on one sweep and open on an earlier
 * one. Two sweeps each way is the smallest that does not depend on where the
 * press falls within a sweep. The gap then cycles 2-3-4-5 so the presses land at
 * different points of `NIB_TICK`, which wraps every sixteen sweeps: pressing at a
 * fixed period is the latch trap `entropy-nibble.test.ts` documents, one level
 * up.
 */
const PRIME_HOLD_SWEEPS = 2;
const primeGapSweeps = (press: number): number => 2 + (press % 4);

/**
 * Presses fire `priming` times before the drive starts playing, which is the
 * only knob that gives this file a *different game* to sample.
 *
 * `NIB_ENT` is stirred by the fire contact and by nothing else, and `jet_enter`
 * draws both halves of an entry position from it, so a run of presses before
 * play begins leaves the squadron entering somewhere else for the rest of the
 * game. Every other lever available here is absorbed: the drive is reactive, so
 * a delayed start or a different resting lane shifts its decisions and the
 * machine's cadences by the same amount and the game comes out identical - both
 * were tried, and both produced twelve byte-identical runs.
 *
 * **The whole sequence has to finish before the first plane is released, and it
 * did not.** The earlier schedule held for 3,000 cycles and lengthened the gap by
 * one sample per press, which at `priming = 11` came to 58,696 cycles against a
 * first release at {@link FIRST_RELEASE_CYCLES}. So the longest-primed games
 * began with a plane already airborne and marched, and one of them could have had
 * a priming shot kill it - which makes priming a knob on the squadron as well as
 * on the entropy, and the twelve games no longer twelve samples of one variable.
 * Held in sweeps and bounded here instead, and the bound is checked rather than
 * asserted in a comment.
 */
function primeEntropy(machine: Tms1370Machine, priming: number): void {
  for (let press = 0; press < priming; press += 1) {
    machine.setContacts({ fire: true });
    machine.step(PRIME_HOLD_SWEEPS * SWEEP_INSTRUCTIONS);
    machine.setContacts({ fire: false });
    machine.step(primeGapSweeps(press) * SWEEP_INSTRUCTIONS);
  }
  if (machine.cycles > FIRST_RELEASE_CYCLES) {
    throw new Error(
      `priming ${priming} times took ${machine.cycles} cycles, past the first release at ` +
        `${FIRST_RELEASE_CYCLES} - the primed games no longer vary only the entropy`,
    );
  }
  if (planesOf(machine.ram).length > 0) {
    throw new Error(
      `priming ${priming} times left a plane airborne before the drive started`,
    );
  }
}

function aimedDrive(forSeconds: number, aim: Aim, skill = 1, priming = 0): Drive {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill, lane: 0, fire: false });
  primeEntropy(machine, priming);

  const kills: Kill[] = [];
  let ended: Ending = "clock";
  let score = -1;
  let releaseFireAt = -1;
  let pressFireAt = -1;
  let wanted = 1;
  // **After the priming, not from power-on.** `forSeconds` is how long the drive
  // plays; measured from cycle zero it would be the priming *plus* the play, so
  // a longer priming would quietly buy a shorter game and the twelve runs below
  // would differ in their length as well as in their entropy.
  const until = machine.cycles + seconds(forSeconds);

  while (machine.cycles < until) {
    machine.step(SAMPLE_CYCLES);
    let ram = machine.ram;

    // A game that has ended stops scoring, so there is nothing left to measure.
    const state = ram[FILE_STATE * 16 + NIB_STATE] as number;
    if (state !== 0) {
      ended = state === ST_WIN ? "won" : state === ST_OVER ? "lost" : "clock";
      break;
    }

    const jetsNow = deepestByLane(ram);

    const seen = scoreOf(ram);
    if (score < 0) {
      score = seen;
    } else if (seen !== score) {
      machine.step(SETTLE_CYCLES);
      ram = machine.ram;
      const settled = scoreOf(ram);
      kills.push({
        grid: (ram[FILE_STATE * 16 + NIB_KCOL] as number) - 1,
        delta: settled - score,
        from: score,
        to: settled,
      });
      score = settled;
    }

    if (releaseFireAt > 0 && machine.cycles >= releaseFireAt) {
      machine.setContacts({ fire: false });
      releaseFireAt = -1;
    }
    if (releaseFireAt > 0) continue;
    // One missile at a time, so there is no point pressing fire while one flies
    // - but there is every point in moving the lever, and leaving it parked is
    // what made this drive suicidal once the missile flew at its measured speed.
    //
    // The lever aims *and* defends: a jet crossing the G line costs a launcher
    // only in the lane the lever is standing in, so parking it on the lane just
    // fired at is standing exactly where the capture lands. At 28 ms a column
    // the shot was gone before that mattered. At 500 ms it is in flight for two
    // and a half seconds, and the drive died with 15 scoring events where it
    // used to reach 58 - the same at 240 s, 480 s and 720 s, because it was
    // dying rather than running out of clock.
    //
    // So while a shot flies, step out of the way of anything about to arrive.
    // This is not making the drive good at the game; it is stopping it standing
    // still in front of the one thing that can end the run.
    if (missileInFlight(ram)) {
      const inbound = deepestByLane(ram);
      const rocketLane =
        (ram[FILE_STATE * 16 + NIB_RCOL] as number) !== 0
          ? (ram[FILE_STATE * 16 + NIB_RLANE] as number)
          : -1;
      const safe = [0, 1, 2].find(
        (lane) =>
          (inbound[lane] as number) < DODGE_DEPTH && lane !== rocketLane,
      );
      if (safe !== undefined) machine.setContacts({ lane: safe });
      continue;
    }

    if (pressFireAt > 0 && machine.cycles >= pressFireAt) {
      machine.setContacts({ fire: true });
      releaseFireAt = machine.cycles + 3_000;
      pressFireAt = -1;
      continue;
    }

    const jets = jetsNow;
    let lane: number;
    if (aim.kind === "only") {
      // **Only fire when the shot can still arrive before the jet steps away.**
      //
      // A shot advances a column every `MISSILE_HI * 16 + MISSILE_LO + 1` = 32
      // sweeps, so reaching grid `C` from the launcher costs `(5 - C) * 32`.
      // The squadron's own countdown says how long that jet will stay put. A
      // drive that fires whenever it *sees* a jet on the column spends shots
      // that arrive after it has moved, and the kill then lands one column in
      // and is filtered out - so the column reads as unreachable when it is
      // merely badly aimed.
      //
      // This is the same lead the boat needs below, for the same reason.
      //
      // It did not matter at `STEP_HI_MAX` 9, where the march period was 2438 ms
      // against a 1951 ms flight to grid 1 - firing on sight left 487 ms of
      // slack. At 8 the slack is 244 ms, and the drive has to aim.
      const marchLeft =
        (ram[FILE_TIME * 16 + NIB_STEP_HI] as number) * 16 +
        (ram[FILE_TIME * 16 + NIB_STEP_LO] as number) +
        1;
      const flight = (GRID_COL_LAST - aim.column) * MISSILE_COLUMN_SWEEPS;
      lane = marchLeft > flight ? laneStandingOn(ram, aim.column) : -1;
    } else {
      // Preferred column first so the drive covers the field, then the boat
      // when it is crossing - it has to be shot at deliberately or the census
      // never sees a ten - and any jet at all rather than waste the sweep.
      const preferred = laneStandingOn(ram, wanted);
      wanted = (wanted % 5) + 1;
      const boat = ram[FILE_STATE * 16 + NIB_BSLANE] as number;
      if (preferred >= 0) lane = preferred;
      // **The boat has to be led.** It descends one lane per 1.29 s and a shot
      // needs 3.0 s to reach the horizon, so a shot aimed where the boat *is*
      // arrives more than two lanes late and the census never sees a ten. Firing
      // at the top lane plus two is the nearest whole lane to the 2.3 the
      // arithmetic asks for, and it only exists while the boat is at the top -
      // once it has descended there is no lane left to lead into.
      //
      // The boat is deliberately *not* a target here. It can only be hit by
      // leading it two lanes from the top lane, which is a hunt rather than an
      // opportunistic shot: `boatHunt` below does that separately.
      else if (boat !== BS_NONE) lane = boat;
      else lane = jets.findIndex((grid) => grid !== 0);
    }
    if (lane < 0) continue;

    machine.setContacts({ lane });
    pressFireAt = machine.cycles + SAMPLE_CYCLES;
  }
  return { kills, ended };
}

/**
 * Four minutes of emulated play - a **ceiling that is never reached**, not a
 * horizon on when the machine stops.
 *
 * The project rule is that a machine-stop horizon must be a multiple of a named
 * measured constant, `UNATTENDED_SILENCE_S` being the worked example, because a
 * literal there is a bet on when the machine stops and that figure has moved
 * three times. This is deliberately *not* that kind of number, and the
 * difference is measured rather than asserted: drives of **300, 360, 480, 600
 * and 900 s all stop at the same 127 events and the same final score of 197**,
 * because the run ends when the game is decided and not when the clock runs out.
 * Three times the value changes no result, so there is no bet here to lose.
 *
 * **Re-measured when the squadron became two positioned planes.** It was 240 s,
 * against a drive that stopped at 58 events with the third launcher gone. Two
 * planes are two attackers where the lane rank could put three up, so the same
 * defending drive now survives to *win*: 127 events, score 197, and the ending
 * arrives at about 300 s rather than inside 240. The old ceiling stopped being
 * long enough for the run to be decided at all, which is precisely the failure
 * the assertion below exists to report, and it reported it.
 *
 * Deriving it from `UNATTENDED_SILENCE_S` would also be a false dependency in
 * the other direction: that constant measures when an *unattended* machine
 * falls silent, at 24.6 s, and every drive here is attended and plays. Tying an
 * attended ceiling to an unattended measurement would make the number look
 * derived while coupling it to a quantity it does not depend on.
 */
const CENSUS_SECONDS = 360;

/** The same kind of ceiling: long enough for tens of kills at any reachable column. */
const COLUMN_SECONDS = 120;

/** Grids a missile can reach today - see the header, and `UNREACHABLE` below. */
const REACHABLE = [1, 2, 3, 4] as const;

/**
 * The grid a missile cannot reach, which is asserted rather than skipped.
 *
 * Leaving grid 5 out of {@link REACHABLE} and saying nothing else about it would
 * be a hole in the table exactly where the next change to the missile lands. The
 * test below instead asserts *both* shapes: while the launch cell goes untested
 * by `missile_step`, it pins that no jet can be killed there at all, and the
 * moment that stops being true it starts checking grid 5 against the ruler. So
 * it can never pass by finding zero kills and shrugging.
 */
const UNREACHABLE = 5;

/**
 * A **wall-clock harness budget**, not an emulated horizon - the one number here
 * that is in real milliseconds.
 *
 * A drive that runs a whole squadron down costs seconds of wall clock and CI's
 * runner is several times slower than a developer's. The first version of this
 * file had no explicit timeout, passed locally, and failed CI on Vitest's 5 s
 * default at 5.4 s.
 *
 * This one cannot be expressed as a multiple of a measured emulated constant
 * and should not be: the ratio between emulated seconds and wall-clock
 * milliseconds is host speed, so a "derived" value would encode the speed of
 * whichever machine wrote it. It is a generous ceiling on the harness, sized so
 * that a slow runner does not fail a test that a fast one passes.
 */
const DRIVE_TIMEOUT_MS = 90_000;

/**
 * Entropy primings the aimed-column drive plays a game at, one game each.
 *
 * Sized at twelve because grid 1 - the only column that needs more than the
 * first game - converts six of them, so the row is not resting on one shot. See
 * the test that uses it.
 */
const PRIMINGS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

/**
 * Kills on the aimed column that are enough to stop playing further games.
 *
 * More than one, so the ruler check below has more than a single sample to read,
 * and low enough that grids 2, 3 and 4 stop after their first game.
 */
const KILLS_WANTED = 3;

/**
 * The same ceiling for `boatHunt`, which is far the longest drive here.
 *
 * The hunt plays 27 games of 300 emulated seconds - it has to, because a boat
 * kill is rare enough that fewer games leave the assertion resting on chance
 * again - and measures 23 s on an idle developer machine. The note on
 * `DRIVE_TIMEOUT_MS` records this file going from 4.4 s locally to 15.3 s on
 * CI, so a runner several times slower puts this drive past the 60 s that
 * covers the others.
 *
 * Sized against that ratio with room to spare, for the reason the note above
 * gives: it is a ceiling on the harness, not a horizon on the machine, and
 * nothing about the ROM is asserted by it.
 */
const HUNT_TIMEOUT_MS = 180_000;

/**
 * A drive's scoring events, split at the winning add.
 *
 * **This is not an exclusion for a known bug**, and the split is written out
 * here rather than folded into an assertion so that it cannot quietly become
 * one. 199 is a win and the ROM caps at it: `as_cap` writes 1-9-9 flat when the
 * hundreds digit reaches two, so a `+3` landing on 198 moves the score by 1 and
 * not by 3. That is PRD v1 rule 6, not a scoring defect.
 *
 * Whether any given drive gets there is a property of pacing, not of scoring,
 * and it is not stable enough to assert on: paying jets three times what they
 * used to took the census drive to 199 against one base and to a game over on
 * 198 against the next one, with only the march-countdown fix of #117 in
 * between. So the cap is *handled* unconditionally and *asserted* in whichever
 * of the two shapes the drive actually produced - see the guard test, which has
 * something to say either way rather than falling silent when no win happens.
 */
function untilTheWin(kills: readonly Kill[]): {
  scored: readonly Kill[];
  capped: Kill | undefined;
} {
  const at = kills.findIndex((kill) => kill.to === WIN_SCORE);
  if (at < 0) return { scored: kills, capped: undefined };
  return { scored: kills.slice(0, at), capped: kills[at] as Kill };
}

describe("the printed ruler", () => {
  // The census runs in a hook rather than in the describe body so that it is
  // covered by DRIVE_TIMEOUT_MS. Evaluated inline it runs during collection,
  // where the per-test timeout does not reach it and the default hook budget of
  // 10 s would be the only thing bounding a drive that costs seconds on CI -
  // which is the shape of the failure this suite already had once.
  let drive: readonly Kill[];
  let census: readonly Kill[];
  let capped: Kill | undefined;
  let ending: Ending;

  beforeAll(() => {
    const run = aimedDrive(CENSUS_SECONDS, { kind: "roundRobin" });
    drive = run.kills;
    ending = run.ended;
    ({ scored: census, capped } = untilTheWin(drive));
  }, DRIVE_TIMEOUT_MS);

  // **A precondition for everything below, not a result.** Every assertion in
  // this suite reads the census as a complete game. If the drive stopped because
  // `CENSUS_SECONDS` ran out, it is instead a window onto a game still in
  // progress, and claims about what the ruler paid over a game become claims
  // about what it paid over four minutes - which would still pass, and would
  // mean something else.
  //
  // Only "not the clock" is pinned. Which *game* ending it reaches is pacing and
  // is documented as unstable on `untilTheWin` above: the same drive has both
  // won and lost across changes that did not touch scoring at all.
  it("ends by playing the game out, not by running out of clock", () => {
    expect(ending).not.toBe("clock");
  });

  it("truncates nothing, or truncates exactly the winning add", () => {
    // Both branches assert something about the *drive*, which is the thing that
    // can change. An earlier version asserted `census` equals `drive` on the
    // no-win branch, and that was tautological - `untilTheWin` returns the same
    // array when it finds nothing to split on, so it restated the split rather
    // than testing the run. What is worth pinning instead is that the drive
    // genuinely ended short of the win, which is a measured fact about the game
    // and not a restatement of the search that produced the branch.
    if (capped === undefined) {
      const last = drive.at(-1) as Kill;
      expect(last.to).toBeLessThan(WIN_SCORE);
      expect(drive.every((kill) => kill.to < WIN_SCORE)).toBe(true);
      return;
    }
    expect(capped).toBe(drive.at(-1));
    expect(capped.to).toBe(WIN_SCORE);
    expect(census.length).toBe(drive.length - 1);
    // The truncation may only ever shorten an add that would have overshot.
    const full =
      capped.grid === 0 ? BOAT_POINTS : (RULER_POINTS[capped.grid] as number);
    expect(capped.from + full).toBeGreaterThanOrEqual(WIN_SCORE);
    expect(capped.delta).toBeLessThanOrEqual(full);
  });

  it("scores enough to be worth reading", () => {
    // Not the assertion - the guard on it. Every test below is vacuously true
    // over an empty drive, and a drive that stops scoring is exactly what a
    // regression in the missile or the march would produce.
    //
    // The threshold is a non-vacuity floor and deliberately not a tight fit to
    // what the drive currently produces, which is 58 events and is a pacing
    // figure: it was a different number one merge ago and will be again. A
    // floor that tracks the drive turns every pacing change into a red main.
    expect(census.length).toBeGreaterThan(20);
    expect(new Set(census.map((kill) => kill.grid)).size).toBeGreaterThan(1);
  });

  it("pays a jet exactly the ruler value for the column it died in", () => {
    const wrong = census
      .filter((kill) => kill.grid !== 0)
      .filter((kill) => kill.delta !== RULER_POINTS[kill.grid]);
    expect(
      wrong.map(
        (kill) =>
          `grid ${kill.grid} scored +${kill.delta}, ruler says +${RULER_POINTS[kill.grid]}`,
      ),
    ).toEqual([]);
  });

  it("never scores a value the ruler does not name", () => {
    const unnamed = [...new Set(census.map((kill) => kill.delta))].filter(
      (delta) => !RULER_VALUES.has(delta),
    );
    expect(unnamed).toEqual([]);
  });

  // Twenty-seven 300 s games, so it needs `HUNT_TIMEOUT_MS` rather than the 5 s
  // default: it cost 4.4 s locally and 15.3 s on CI when it played nine.
  it(
    "still pays the battleship its ten",
    () => {
      // `score_bship` is untouched by the distance work. This is the guard that
      // says so from the outside.
      // **Driven separately, because the census cannot reliably reach a boat.**
      // The battleship has to be led by two lanes - it descends one lane per
      // 1.29 s and a shot needs 3.0 s to reach the horizon - and it can only be led
      // from the top lane, which it holds for 1.29 s of a 3.9 s crossing.
      //
      // The census sees roughly ten such windows before the drive wins, so it
      // expects about one kill with wide variance, and it measured zero. That is
      // not the ruler failing to pay ten; it is a general-purpose drive being
      // asked to land a low-probability shot a fixed number of times. Hunting the
      // boat across several games is what the claim actually needs.
      //
      // ## Earnable, and rare. Both, or the record is misleading.
      //
      // Most led shots still miss. "The boat must be led" invites the reading
      // that leading works, and it mostly does not: a player who has learned the
      // lead still walks away from most crossings with nothing. The ten points
      // are earnable *and* rare, which is a different claim from earnable, and
      // it is the one the machine supports.
      //
      // It is also why this assertion tolerates a miss rather than expecting a
      // hit per crossing. A drive that could not miss would pass on something
      // other than the mechanic - the same condition the dodging rotor drive is
      // held to.
      //
      // ## Why the hunt is sized and aimed the way it is
      //
      // **A rare event asserted once is an assertion about phase, not about the
      // mechanic.** The hunt used to fire the instant it saw the boat reach the
      // top lane, once per crossing, over nine games. That is one release point
      // sampled 27 times, and whether that point falls inside the lead window is
      // settled by how the drive's 5 ms sampling happens to sit against a sweep
      // the game counts in instructions. Padding an otherwise unmodified ROM to
      // move the sweep showed it plainly: kills at 889 and 894 instructions and
      // none at 890, 891, 892, 893, 895, 896 or 897. Doubling the games at a
      // losing cadence still scored none, which is what says the release point
      // was misplaced rather than merely under-sampled.
      //
      // Three things fix that, and none of them lowers the bar:
      //   - `LEAD_DELAY_SAMPLES` walks the release across the dwell, so a
      //     cadence change moves which offsets land in the window instead of
      //     moving the drive out of it;
      //   - the shot aims a sweep before its fire edge, which the drive's own
      //     header always required and this one shot was not doing;
      //   - it waits for the lead lane to be clear, so the shot can survive to
      //     the boat's row instead of being eaten by a jet on the way.
      //
      // Sized at 27 games because 18 still failed at one cadence in the padding
      // sweep. With all three, 893 through 898 pass - the range tasks 4-6 will
      // move the sweep through as the rank lands.
      const boat = boatHunt();
      // **The coverage the offsets claim has to be coverage the hunt performs.**
      // One offset is taken per crossing, wrapping, so a hunt with fewer
      // crossings than offsets would sample a prefix of the dwell and leave the
      // late window untried - which is the fault the list was widened to fix,
      // reappearing one level up. Measured: 119 crossings across the 27 games
      // against 33 offsets, so every offset is taken about three times.
      expect(
        [...new Set(boat.used)].sort((left, right) => left - right),
        "the hunt never reached some lead offset, so part of the dwell is untried",
      ).toEqual(LEAD_DELAY_SAMPLES.map((_unused, index) => index));
      expect(
        boat.attempts,
        "the hunt never got a shot into the lead window",
      ).toBeGreaterThan(10);
      expect(
        boat.kills.length,
        "no battleship was shot down in any game",
      ).toBeGreaterThan(0);
      for (const kill of boat.kills) {
        expect(kill.delta, "a battleship paid something other than ten").toBe(
          BOAT_POINTS,
        );
      }
    },
    HUNT_TIMEOUT_MS,
  );

  it.each(REACHABLE)(
    "pays the ruler value for an aimed kill on grid %i",
    (column) => {
      // **Grid 1 is one shot a game at best, and until this pooled it was one
      // shot a *run*.** The window is arithmetic: a shot takes
      // `(5 - 1) * 32` = 128 sweeps to reach the far column, and the jet
      // standing there has `NIB_STEP_HI * 16 + NIB_STEP_LO + 1` sweeps before it
      // marches away - at most 144, and only at zero kills on skill 1. So the
      // drive can fire at grid 1 only inside the fifteen sweeps after a
      // countdown reload, which in practice means the moment a capture retreats
      // a survivor to grid 1 and reloads the march together.
      //
      // Measured, on this ROM and on the one before it: a single game offers
      // that shot exactly *once* and fires it at a march remainder of 143 of
      // 144, the best there is. Whether it converts is then a matter of a sweep
      // or two of phase - the ROM before this one converted its one shot and
      // this one missed it, on the same margin. That is
      // `docs/evidence/open-questions.md` section 11a: an assertion passing
      // because its input was barely produced.
      //
      // So the input is made reliable rather than the bar lowered. Twelve games
      // are played with different entropy primings; six of them land a grid-1
      // kill where one game landed a coin flip. The other columns reach their
      // quota on the first game and pay for none of it.
      const kills: Kill[] = [];
      for (const priming of PRIMINGS) {
        kills.push(
          ...untilTheWin(aimedDrive(COLUMN_SECONDS, { kind: "only", column }, 1, priming).kills)
            .scored,
        );
        if (kills.filter((kill) => kill.grid === column).length >= KILLS_WANTED) break;
      }
      const here = kills.filter((kill) => kill.grid === column);
      expect(
        here.length,
        `no jet was killed on grid ${column} in ${PRIMINGS.length} primed games`,
      ).toBeGreaterThan(0);
      expect([...new Set(here.map((kill) => kill.delta))]).toEqual([
        RULER_POINTS[column],
      ]);
    },
    DRIVE_TIMEOUT_MS,
  );

  it(
    "either cannot kill on grid 5 at all, or pays the ruler value there too",
    () => {
      // Both branches assert, and the branch taken is a statement about the
      // missile rather than about scoring.
      //
      // Today `fire_missile` writes the launch cell and `missile_step`
      // decrements before it hit-tests, so grid 5 is drawn and never tested and
      // the count must be exactly zero - a jet standing on the cell before the G
      // line is unshootable. When that is reordered the count goes non-zero and
      // this test starts checking grid 5's ruler value on the first run, with no
      // window in which the row is unasserted. It cannot pass by finding no
      // kills unless finding no kills is itself the current, stated truth.
      const kills = untilTheWin(
        aimedDrive(COLUMN_SECONDS, { kind: "only", column: UNREACHABLE }).kills,
      ).scored;
      const here = kills.filter((kill) => kill.grid === UNREACHABLE);
      if (here.length === 0) {
        // Not a skip: the assertion is that the cell is unreachable, and a
        // single kill here is a change in the missile that must be noticed.
        expect(here).toEqual([]);
        return;
      }
      expect([...new Set(here.map((kill) => kill.delta))]).toEqual([
        RULER_POINTS[UNREACHABLE],
      ]);
    },
    DRIVE_TIMEOUT_MS,
  );
});
