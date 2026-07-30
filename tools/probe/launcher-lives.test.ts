// Three launchers, and the three ways the player finds out he has lost one.
//
// Paths in this file are relative to the repository root.
//
// ## The defect this exists to stop coming back
//
// The owner played the deployed build beside his own CGL unit and reported "you
// seem to end the game after one loss, there's no three lives working". He was
// right, and the cause was one line: `game_capture` and `game_lost` were two
// labels on the same address. A jet reaching the G line therefore ran the loss
// sound and wrote ST_OVER without ever going near NIB_HITS, so the damage path
// - two beeps, three beeps, loss - existed and was correct and was reached only
// by rockets. Because a jet reaches the G line within seconds of power-on, that
// was how nearly every game ended, and the second and third launchers were
// never seen.
//
// ## Why the lever is parked, and why that is the interesting scenario
//
// A parked lever is the scenario the bug made impossible, and it is worth more
// than a test. `tools/probe/rom-atlas-conformance.test.ts` needs to drive rare
// events deliberately rather than wait for pacing to produce them, and the
// hardest of those is the player's own burst in a chosen lane. The deliberate
// way to reach it is to stand in one lane and wait to be destroyed - which could
// not work while a single capture ended the game, because a parked lever cannot
// cover the other two lanes and a jet reaches the G line within seconds. Being
// in the right lane when the shot arrived was therefore a coincidence rather
// than a choice. Standing still is now a strategy, and this file is the proof
// of the property that suite depends on.
//
// It is also contract criterion V7's rocket-lane check: three runs, one per
// lane, each of which must hear a launcher-hit warning. A build in which the
// rocket's lane is drawn from the player's own last keypress - v2's defect, PRD
// R5 forbids inheriting it - leaves two lanes permanently safe, and two of these
// three runs then hear nothing at all.
//
// ## Why this reads the tube and the speaker rather than the RAM
//
// There is no lives display on this tube - owner-confirmed against his unit,
// and the three marks outside the playfield border are paint on the overlay.
// Damage is signalled by sound alone: two beeps on the first hit, three on the
// second, the full loss sound on the third (audio-reference.md,
// launcherHitWarning; all three owner-confirmed). The beeps *are* the lives
// indicator, so counting them off R15 is not a proxy for the rule - it is the
// rule, observed where a player observes it. A test that read NIB_HITS would
// prove the ROM incremented a nibble and say nothing about whether the player
// is ever told.
//
// The same discipline separates the two ways a launcher is lost, and it needs
// no RAM either. Fire is never pressed in any run below, so no missile is ever
// on the glass and a jet can leave the field only by reaching the G line. A jet
// vanishing from the deepest jet cell is therefore a capture and can be nothing
// else, and counting those against the launcher losses says which mechanism took
// each one.
//
// ## What a warning looks like on this machine, which is not what it looked like
//
// Two measured facts collide differently here than they did on the v2 board, and
// the whole beep-counting method turns on it.
//
// Beeps inside one warning are separated by `warn_gap`, a measured 25-28 ms
// (audio-reference.md, launcherHitWarning.gapMs); the ROM's WARN_GAP pair lands
// at 27.3 ms. `BURST_GAP_CYCLES` is two sweeps, which on this machine is 1,778
// instructions - **30.5 ms, wider than the gap it used to be narrower than**. So
// a whole warning now arrives as a single sound rather than as two or three
// separate ones, and counting sounds would count every warning as one beep.
//
// What is counted instead is *pitch runs* inside a sound: `pitchesIn` breaks an
// edge stream into runs of like periods, and each 10 ms beep is one such run at
// 467 Hz while the 27 ms silence between two beeps breaks the run. Measured over
// the three runs below, the first warning yields a sound holding two 467 Hz runs
// and the second a sound holding three - the owner-confirmed counts, read the
// way the ROM produces them. The clustering by {@link WARNING_CLUSTER_CYCLES} is
// kept because it is what makes the count independent of which side of the split
// gap the ROM's beep spacing happens to fall on: beeps that arrive as separate
// sounds are gathered, beeps that arrive as one sound are counted within it, and
// both regimes give the same answer.
//
// ## Telling the loss sound from the battleship
//
// The loss sound opens on the same pitch as a warning beep - audio-reference.md
// records them as the same note - so pitch alone cannot tell the third hit from
// the first. What follows it is a collapse into 80-97 Hz, and *that* band is not
// exclusive either: the battleship's buzz sits at 79-111 Hz and runs for the
// whole four seconds of a crossing. So the loss sound is identified by the shape
// the measurement gives it - a collapse **and** a decay floor at ~147 Hz - which
// the buzz, being one sustained rate, does not have. See {@link DECAY_FLOOR_HZ}.
//
// That conjunction is also why this file no longer excises the buzz's edges
// before splitting sounds, as the v2 file did. The excision worked by neighbour
// gaps, and on this machine the buzz's half-period (median 288 instructions) is
// *shorter* than the loss sound's own collapse note (318), so any threshold that
// removed the buzz would remove the collapse with it if a game ever ended during
// a crossing. Identifying the loss by shape removes the need for the threshold,
// and removes a way for a real ending to be filtered out of the evidence.
//
// Node-side test: no DOM, no browser globals.

import { describe, it, expect } from 'vitest';
import {
  BURST_GAP_CYCLES,
  CAPTURE_WINDOW_CYCLES,
  SWEEP_INSTRUCTIONS,
  WARNING_CLUSTER_CYCLES,
} from '../../src/machine/board/tms1370-cadence.js';
import { CYCLE_HZ } from '../../src/machine/cpu/tms1370/timing.js';
import { Tms1370Machine, assembleGame, type SegmentDuty, type SpeakerEdge } from './tms1370-probe.js';

/**
 * Where `NIB_HITS` lives, read from the assembly rather than written here.
 *
 * Used only to segment the beeps by which launcher they announce - see
 * {@link Game.hits}.
 */
const HITS_ADDRESS = (() => {
  const asm = assembleGame();
  const value = (name: string): number => {
    const found = asm.symbols.find((definition) => definition.name === name);
    if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
    return found.value;
  };
  return value('FILE_STATE') * 16 + value('NIB_HITS');
})();

/** Where the jets' rocket records the column it is on. Zero means none in flight. */
const ROCKET_COLUMN_ADDRESS = (() => {
  const asm = assembleGame();
  const value = (name: string): number => {
    const found = asm.symbols.find((definition) => definition.name === name);
    if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
    return found.value;
  };
  return value('FILE_STATE') * 16 + value('NIB_RCOL');
})();

/** Where `NIB_BSLANE` lives, and the value meaning no crossing is in progress. */
const BSLANE_ADDRESS = (() => {
  const asm = assembleGame();
  const value = (name: string): number => {
    const found = asm.symbols.find((definition) => definition.name === name);
    if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
    return found.value;
  };
  return value('FILE_STATE') * 16 + value('NIB_BSLANE');
})();

const BS_NONE = (() => {
  const asm = assembleGame();
  const found = asm.symbols.find((definition) => definition.name === 'BS_NONE');
  if (found === undefined) throw new Error('asm/jetfighter.asm no longer defines BS_NONE');
  return found.value;
})();

/** Where `NIB_STATE` lives: ST_PLAY until the game ends, then ST_OVER or ST_WIN. */
const STATE_ADDRESS = (() => {
  const asm = assembleGame();
  const value = (name: string): number => {
    const found = asm.symbols.find((definition) => definition.name === name);
    if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
    return found.value;
  };
  return value('FILE_STATE') * 16 + value('NIB_STATE');
})();

/** How far two consecutive periods may differ and still count as one note. */
const RUN_TOLERANCE = 0.06;

/** Periods a run needs before it is a note rather than a transition artefact. */
const MIN_RUN_PERIODS = 3;

/** launcherHitWarning.dominantHzRange, which the loss opening shares. */
const WARNING_HZ = { min: 455, max: 545 } as const;

/** gameOver's collapse stage - the band the loss sound falls into. */
const COLLAPSE_HZ = { min: 80, max: 97 } as const;

/**
 * The pitch the loss sound decays to - gameOver.decayFloorHz, ~147 Hz.
 *
 * Needed because the collapse band above **does not identify the loss sound on
 * its own**. The battleship buzz is measured at 79-111 Hz, which contains 80-97
 * whole, so a crossing that happened to hold a steady enough rate would read as
 * a loss: the game would appear to end twice, and any warning beeps inside the
 * crossing would be discarded as part of the ending. The loss sound is
 * identified by the *shape* the measurement gives it - a collapse and then a
 * decay floor - which the buzz, being one sustained rate, does not have.
 *
 * The band is audio-reference.md's `gameOver.decayFloorHz` of ~147 Hz opened to
 * the 130-175 the v1 test bound used; the ROM's own SND_LOSS5 lands at 144 Hz
 * and this machine sounds it at a measured 144.
 */
const DECAY_FLOOR_HZ = { min: 130, max: 175 } as const;

/**
 * The deepest cell a jet is ever drawn in: distance column 1, on grid 5.
 *
 * Column N is grid 6 - N, and column 0 is the G line itself, where the tube
 * prints no aircraft - the player's cell carries the launcher and its burst
 * instead. So grid 5 is the last place a jet is seen, and a jet disappearing
 * from it has either been shot or has arrived.
 */
const GRID_DEEPEST_JET = 5;

/** The nearest playfield cell a jet or a missile dart is drawn in. */
const GRID_NEAREST_PLAYFIELD = 1;

/** Plates 0-2 of a playfield grid: the jet in lane 0, 1, 2 of that column. */
const PLATE_JET = [0, 1, 2];

/**
 * Plates 6-8: the missile dart under grids 1-5, the launcher under grid 6.
 *
 * The grid decides which, which is why the search below is bounded to the
 * playfield - the launcher is lit on grid 6 for the whole game and reading it
 * as a shot would make every run look as though fire had been pressed.
 */
const PLATE_DART = [6, 7, 8];

/**
 * The latest a parked-lever game ends, in seconds of emulated time.
 *
 * **Re-measured on this machine** after the capture rule was settled, by running
 * each of the three lanes to silence: the last speaker edge falls at **24.5 s**
 * with the lever in lane 1, **36.4 s** in lane 0 and **36.9 s** in lane 2. The
 * lanes differ because the squadron's entries and the rocket's lane rotation are
 * not symmetric about the lever, not because one lane is played better - nobody
 * is playing.
 *
 * The figure this replaces was **45.4 s**, taken while `jm_capture` still let a
 * jet crossing any lane but the lever's through for nothing. Removing that
 * condition - `open-questions.md` section 6, the rule the owner settled - makes
 * every lane lethal, so all three endings came in. Lane 1 is shortest because it
 * loses a launcher to a rocket as well as to two captures; lanes 0 and 2 lose all
 * three to captures.
 *
 * Loss spacing with the settled rule: **11.6 and 12.4 s** in lane 0, **11.7 and
 * 12.7 s** in lane 2, **5.7 and 6.4 s** in lane 1. The spacing is what the wave
 * retreat was changed for and it is intact.
 *
 * **Unchased observation, recorded because the middle lane is where a player
 * naturally sits.** Lane 1 ends a third sooner than either neighbour and at
 * roughly half the spacing, because it is the only lane in these runs reached by
 * both threats: lanes 0 and 2 lose all three launchers to captures, lane 1 loses
 * two and one to a rocket. Whether the centre is *systematically* more lethal or
 * these three runs simply caught a rotor that served lane 1 is not established -
 * `rocket_fire`'s rotor does reach all three lanes, so a longer sample would
 * settle it. Nobody has taken that sample.
 *
 * It is named and measured for the reason CLAUDE.md gives: a literal horizon in
 * a test about a machine that stops is a bet on when it stops, and the v2 figure
 * this replaces moved three times in one day. Every run below is a multiple of
 * this, so a cadence change moves one number.
 *
 * It has moved twice more since, both times because a rule changed and not
 * because it was fitted. Restoring the capture rule shortened every lane, since
 * the two that used to let most of the squadron past for nothing stopped doing
 * so. The wave retreating on a capture then lengthened them again, because the
 * next capture has to cross the whole field rather than arrive on the next march
 * step. The two land it near where it began, which is arithmetic rather than a
 * sign that nothing happened: what the rules were changed for is the *spacing*
 * between the three losses, and that went from 2.7 s to 12.7-13.4 s.
 */
const PARKED_GAME_END_S = 36.9;

/**
 * Emulated seconds each run below is driven for.
 *
 * Two fifths again as long as the latest of the three endings: 60.5 s against a
 * 43.2 s ending, so every run carries 17.3 s past the last edge it is meant to
 * observe and cannot quietly stop short of it, which is exactly how the v2
 * horizon failed. Short enough that three of them stay cheap.
 *
 * The factor is 1.4 rather than 1.5 because 1.4 is what the measurement asks
 * for: the slack it buys is two fifths of a whole parked game, far wider than
 * the spread between the three lanes' endings (24.6 s, 36.3 s, 43.2 s), and
 * widening it further would buy wall-clock time rather than evidence.
 */
const HORIZON_S = PARKED_GAME_END_S * 1.4;

/**
 * The ceiling `runSweeps` is given when it waits for one sweep to complete.
 *
 * Not a measurement of anything: it is the "the sweep is not coming" escape. The
 * ROM stops sweeping for the whole of every sound, so a caller waiting on a
 * sweep during the 0.67 s loss envelope must not spin for ever, and the outer
 * loop below is happy to be handed a partial slice - it samples the tube and the
 * speaker either way. {@link CAPTURE_WINDOW_CYCLES} is the named horizon that
 * already bounds a launcher-loss event, and every sound this ROM plays is an
 * order of magnitude inside it.
 */
const SWEEP_CEILING_CYCLES = CAPTURE_WINDOW_CYCLES;

/**
 * How far *before* a launcher loss a departure may be seen, in cycles.
 *
 * Essentially zero: the tube can only report the jet gone after the ROM has
 * removed it, so a departure that preceded the sound would mean the two were
 * not the same event. One sweep of slack, for the sampling boundary, which is
 * what {@link SWEEP_INSTRUCTIONS} is.
 */
const CAPTURE_LEAD_CYCLES = SWEEP_INSTRUCTIONS;

/** Wall-clock allowance: three full games is several real seconds. */
const LONG_RUN_TIMEOUT_MS = 60_000;

/** The three lanes the lever's detents select, and what the case calls each. */
const LEVERS = [
  { detent: 'up', lane: 0 },
  { detent: 'centre', lane: 1 },
  { detent: 'down', lane: 2 },
] as const;

/** One gap-separated stretch of speaker activity, and the pitches inside it. */
/** One sustained pitch inside a sound, and where it started. */
interface PitchRun {
  readonly hz: number;
  readonly atCycle: number;
}

interface Sound {
  readonly atCycle: number;
  readonly runs: readonly PitchRun[];
}

/** The warning-band runs in a sound - one per beep, each with its own cycle. */
function warningRunsIn(sound: Sound): PitchRun[] {
  if (isLoss(sound)) {
    return [];
  }
  return sound.runs.filter((run) => run.hz >= WARNING_HZ.min && run.hz <= WARNING_HZ.max);
}

/** What one game, played by standing still, produced. */
interface Game {
  /** Every sound the speaker made, in order. */
  readonly sounds: readonly Sound[];
  /** The cycle of each sweep on which a jet left the deepest jet cell. */
  readonly departures: readonly number[];
  /**
   * The cycle of each sweep on which the jets' rocket was spent.
   *
   * Recorded so a launcher loss can be attributed to a rocket **positively**,
   * by the rocket's own nibble, rather than inferred from the absence of a
   * capture near it. Inference by absence was safe while a capture only cost a
   * launcher in the lever's own lane; once a capture costs one in any lane -
   * `open-questions.md` section 6 - departures became frequent enough that a
   * genuine rocket loss almost always has one nearby by coincidence, and the
   * rocket path read as untested when it was merely misattributed.
   */
  readonly rocketArrivals: readonly number[];
  /** Whether a missile dart was ever lit anywhere on the playfield. */
  readonly everFired: boolean;
  /**
   * The cycle of each launcher loss, read from `NIB_HITS` incrementing.
   *
   * The one place this file reads RAM, and it reads it to *segment* the evidence
   * rather than to supply it: the beeps are still counted off R15, because the
   * beeps are the lives indicator and a test that counted `NIB_HITS` would prove
   * the ROM incremented a nibble and say nothing about whether the player is ever
   * told. What the nibble supplies is which beeps announce which launcher.
   *
   * Clustering by silence used to do that job and cannot any more. Two launchers
   * can be lost inside half a second - a jet crossing the G line and a rocket
   * arriving in the same window - and the two warnings then arrive as one run of
   * five beeps rather than as a two and a three. The ROM is right in that case
   * and sounded both signals; the observer was merging them.
   */
  readonly hits: readonly number[];
  /** Cycle the ending first became visible in `NIB_STATE`, or 0 if it did not. */
  readonly endedAt: number;
  /** Cycle of the last R15 edge in the whole run. */
  readonly lastEdgeAt: number;
  /** Whether the run ended in `ST_WIN` rather than by losing three launchers. */
  readonly won?: boolean;
}

/** `ST_WIN`, from the ROM rather than written here. */
const ST_WIN = (() => {
  const asm = assembleGame();
  const found = asm.symbols.find((definition) => definition.name === 'ST_WIN');
  if (found === undefined) throw new Error('asm/jetfighter.asm no longer defines ST_WIN');
  return found.value;
})();

/**
 * Park the lever in one lane, never touch fire, and watch.
 *
 * Advanced a sweep at a time because the tube is the second observation surface
 * here and it only means anything on a completed sweep. The speaker is drained
 * every sweep so that the edge stream this returns is the whole run in order.
 *
 * The frame read is `getFrame()` - the last sweep the tube *completed* - and not
 * `getLitSegments()`, which applies the blanking rule. That matters: a sound
 * parks the sweep, so an observed frame taken during one is legitimately empty,
 * and an empty frame here would read as every jet on the glass departing at
 * once. What is being asked is what the ROM last drew, not what a viewer would
 * see at this instant.
 */
function standStill(lane: number): Game {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 1, lane });
  const edges: SpeakerEdge[] = [];
  const departures: number[] = [];
  const rocketArrivals: number[] = [];
  let previousRocketColumn = 0;
  const hits: number[] = [];
  let seenHits = 0;
  let endedAt = 0;
  let everFired = false;
  let wasDeep = false;
  const target = Math.round(HORIZON_S * CYCLE_HZ);
  while (machine.cycles < target) {
    machine.runSweeps(1, SWEEP_CEILING_CYCLES);
    edges.push(...machine.takeSpeakerEdges());
    const lit: readonly SegmentDuty[] = machine
      .getFrame()
      .segments.filter((segment) => segment.duty > 0);
    const isDeep = lit.some(
      (segment) => segment.grid === GRID_DEEPEST_JET && PLATE_JET.includes(segment.plate),
    );
    if (
      lit.some(
        (segment) =>
          segment.grid >= GRID_NEAREST_PLAYFIELD &&
          segment.grid <= GRID_DEEPEST_JET &&
          PLATE_DART.includes(segment.plate),
      )
    ) {
      everFired = true;
    }
    if (wasDeep && !isDeep) {
      departures.push(machine.cycles);
    }
    // The rocket's own nibble going back to zero is the shot being spent, which
    // is the only moment it can take a launcher.
    const rocketColumn = machine.ram[ROCKET_COLUMN_ADDRESS] as number;
    if (previousRocketColumn !== 0 && rocketColumn === 0) {
      rocketArrivals.push(machine.cycles);
    }
    previousRocketColumn = rocketColumn;
    wasDeep = isDeep;
    const nowHits = machine.ram[HITS_ADDRESS] as number;
    if (nowHits > seenHits) {
      hits.push(machine.cycles);
      seenHits = nowHits;
    }
    if (endedAt === 0 && (machine.ram[STATE_ADDRESS] as number) !== 0) {
      endedAt = machine.cycles;
    }
  }
  return {
    sounds: soundsIn(edges),
    departures,
    rocketArrivals,
    everFired,
    hits,
    endedAt,
    lastEdgeAt: edges[edges.length - 1]?.cycle ?? 0,
  };
}

/**
 * The latest a game ends when the fire button is actually being worked.
 *
 * **Measured on this machine**, the same way and on the same drive the test
 * below uses: lane 1 ends at 161.4 s and lane 2 at 166.6 s, both by losing the
 * third launcher, and **lane 0 ends at 247.0 s by winning**.
 *
 * It is now *longer* than the parked figure, where it used to be shorter, and the
 * reversal is the point of the change that caused it. On the 28 ms missile a
 * tapping player bought almost nothing - the shot crossed the field faster than
 * the squadron could enter it, so all it did was cost the sweeps each fire blip
 * blanked, and the played game ended sooner than the idle one. At the measured
 * 500 ms a column the shot is a real defence: it clears one lane at a time and
 * takes 2.5 s to do it, so tapping fire keeps the player alive noticeably longer
 * than standing still without keeping him alive indefinitely.
 */
const PLAYED_GAME_END_S = 247.0;

/**
 * Park the lever, tap fire, and watch - the drive {@link standStill} refuses.
 *
 * The fire cadence is a tap every eight sweeps rather than a held button,
 * because firing is edge triggered: `tick_fire` reads `NIB_FIREP` first, so a
 * button left down launches one missile and no more, and a drive that held it
 * would be testing the same passive machine under another name.
 */
function playingOn(lane: number): Game {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 1, lane });
  const edges: SpeakerEdge[] = [];
  const hits: number[] = [];
  let seenHits = 0;
  let endedAt = 0;
  let everFired = false;
  const target = Math.round(PLAYED_GAME_END_S * 1.4 * CYCLE_HZ);
  for (let sweep = 0; machine.cycles < target; sweep += 1) {
    machine.setContacts({ fire: sweep % 16 < 8 });
    machine.runSweeps(1, SWEEP_CEILING_CYCLES);
    edges.push(...machine.takeSpeakerEdges());
    if (
      machine
        .getFrame()
        .segments.some(
          (segment) =>
            segment.duty > 0 &&
            segment.grid >= GRID_NEAREST_PLAYFIELD &&
            segment.grid <= GRID_DEEPEST_JET &&
            PLATE_DART.includes(segment.plate),
        )
    ) {
      everFired = true;
    }
    const nowHits = machine.ram[HITS_ADDRESS] as number;
    if (nowHits > seenHits) {
      hits.push(machine.cycles);
      seenHits = nowHits;
    }
    if (endedAt === 0 && (machine.ram[STATE_ADDRESS] as number) !== 0) {
      endedAt = machine.cycles;
    }
  }
  return {
    sounds: soundsIn(edges),
    departures: [],
    rocketArrivals: [],
    everFired,
    hits,
    endedAt,
    lastEdgeAt: edges[edges.length - 1]?.cycle ?? 0,
    won: (machine.ram[STATE_ADDRESS] as number) === ST_WIN,
  };
}

/** Split an edge stream into sounds, each reduced to the pitches it holds. */
function soundsIn(edges: readonly SpeakerEdge[]): Sound[] {
  const groups: SpeakerEdge[][] = [];
  let group: SpeakerEdge[] = [];
  for (const edge of edges) {
    const previous = group[group.length - 1];
    if (previous !== undefined && edge.cycle - previous.cycle > BURST_GAP_CYCLES) {
      groups.push(group);
      group = [];
    }
    group.push(edge);
  }
  if (group.length > 0) {
    groups.push(group);
  }
  return groups.map((inSound) => ({
    atCycle: (inSound[0] as SpeakerEdge).cycle,
    runs: pitchesIn(inSound.filter((edge) => edge.level === 1).map((edge) => edge.cycle)),
  }));
}

/**
 * The sustained pitches inside one sound, in the order they were sounded.
 *
 * Rising edges are turned into periods, the periods broken into runs of like
 * periods, and each run long enough to be a note reported at its median - the
 * same method speaker-bands.test.ts uses, and for the same reason: one figure
 * for a whole sound averages a march step running into a battleship buzz and
 * reports a pitch belonging to neither.
 *
 * On this machine it does a second job the v2 file did not need it for. Because
 * the split gap is now wider than the gap between two beeps of one warning, the
 * runs this returns are how the beeps are counted at all - each 10 ms beep is
 * one run, and the silence between two of them breaks it. The buzz's own edges
 * are clocked off the display sweep and are not evenly spaced, so they form no
 * run of {@link MIN_RUN_PERIODS} like periods and contribute no pitch, which is
 * why a four-second crossing reports only the march steps inside it.
 */
function pitchesIn(rising: readonly number[]): PitchRun[] {
  const periods = rising.slice(1).map((cycle, index) => cycle - (rising[index] as number));
  const runs: PitchRun[] = [];
  let current: number[] = [];
  let startedAt = rising[0] ?? 0;
  const close = (endIndex: number): void => {
    if (current.length >= MIN_RUN_PERIODS) {
      const sorted = [...current].sort((left, right) => left - right);
      runs.push({
        hz: CYCLE_HZ / (sorted[Math.floor(sorted.length / 2)] as number),
        atCycle: startedAt,
      });
    }
    current = [];
    startedAt = rising[endIndex] ?? startedAt;
  };
  periods.forEach((period, index) => {
    const previous = current[current.length - 1];
    if (previous !== undefined && Math.abs(period - previous) / previous >= RUN_TOLERANCE) {
      close(index);
    }
    current.push(period);
  });
  close(periods.length);
  return runs;
}

/** Does this sound hold a note in the given band? */
function holds(sound: Sound, band: { min: number; max: number }): boolean {
  return sound.runs.some((run) => run.hz >= band.min && run.hz <= band.max);
}

/** The loss sound: it collapses into 80-97 Hz *and* decays to ~147. See DECAY_FLOOR_HZ. */
function isLoss(sound: Sound): boolean {
  return holds(sound, COLLAPSE_HZ) && holds(sound, DECAY_FLOOR_HZ);
}

/**
 * The warnings in a game: beeps gathered into the hits they announce.
 *
 * @returns one entry per launcher announced by beeps, holding how many beeps
 *   announced it and when it happened.
 */
function warningsIn(game: Game): { beeps: number; atCycle: number }[] {
  const counts = game.hits.map((atCycle) => ({ beeps: 0, atCycle }));
  const beeps = game.sounds.flatMap((sound) => warningRunsIn(sound));
  for (const beep of beeps) {
    // Each beep belongs to the first launcher lost at or after it, and the
    // direction is the ROM's rather than a convention: `launcher_down`
    // increments NIB_HITS and *then* sounds, and `note` parks the sweep for the
    // whole of what it plays - so the sweep on which the increment is first
    // visible is the one that ends after the beeps it announced. The recorded
    // cycle therefore trails its own warning, and attributing backwards drops
    // the first warning of every game.
    const owner = game.hits.findIndex((atCycle) => atCycle >= beep.atCycle);
    const index = owner >= 0 ? owner : game.hits.length - 1;
    if (index >= 0) (counts[index] as { beeps: number }).beeps += 1;
  }
  return counts.filter((hit) => hit.beeps > 0);
}

/** Every moment a launcher was lost: the two warned ones, then the loss sound. */
function launcherLosses(game: Game): number[] {
  return [
    ...warningsIn(game).map((warning) => warning.atCycle),
    ...lossesIn(game).map((sound) => sound.atCycle),
  ];
}

/** The loss sounds in a game. There must be exactly one. */
function lossesIn(game: Game): Sound[] {
  return game.sounds.filter(isLoss);
}

/**
 * The three parked-lever games, driven on first use rather than at import.
 *
 * **Not a style preference.** This was `new Map(LEVERS.map(...))` at module
 * scope, which runs three full games - up to 63 s of emulated time each - while
 * Vitest is still collecting the file, where no `it` timeout reaches them and
 * only the default hook budget applies. CodeRabbit found the same shape in
 * `scoring-ruler.test.ts` after #121 merged, and it had already turned that
 * suite red once: a 5.4 s drive against a five-second default.
 *
 * Driving on first access moves the cost inside whichever test asks for it, and
 * every test that does carries {@link LONG_RUN_TIMEOUT_MS}. Memoised, so the
 * three games are still driven once between them rather than once per assertion.
 */
const driven = new Map<number, Game>();

function gameFor(lane: number): Game {
  const already = driven.get(lane);
  if (already !== undefined) {
    return already;
  }
  const fresh = standStill(lane);
  driven.set(lane, fresh);
  return fresh;
}

describe('standing still costs three launchers, and the third ends the game', () => {
  for (const { detent, lane } of LEVERS) {
    describe(`lever parked in lane ${lane} (${detent})`, () => {
      const game = (): Game => gameFor(lane);

      it(
        'announces exactly two launchers before it ends, at two beeps then three',
        () => {
          // The assertion the reported defect fails. On the ROM that ended a
          // game at the first capture this list is empty for the two lanes
          // whose launchers are taken by jets: the machine went straight to the
          // loss sound and the warnings were never reached at all.
          expect(warningsIn(game()).map((warning) => warning.beeps)).toEqual([2, 3]);
        },
        LONG_RUN_TIMEOUT_MS,
      );

      it('plays the loss sound exactly once, and only after both warnings', () => {
        const losses = lossesIn(game());
        expect(losses).toHaveLength(1);
        for (const warning of warningsIn(game())) {
          expect(warning.atCycle).toBeLessThan((losses[0] as Sound).atCycle);
        }
      });

      it('keeps playing after each of the first two launchers is lost', () => {
        // The half of the rule the beep count cannot carry. A ROM that sounded
        // two beeps and *then* stopped would satisfy the count and still be the
        // bug the owner reported, so what has to be shown is that the game went
        // on: the machine kept making game noises - the march, the battleship
        // buzz - after each warning, and they are game noises because the game
        // is the only thing that produces them.
        for (const warning of warningsIn(game())) {
          const after = game().sounds.filter(
            (sound) => sound.atCycle > warning.atCycle + WARNING_CLUSTER_CYCLES && !isLoss(sound),
          );
          expect(after.length, `sounds after the ${warning.beeps}-beep warning`).toBeGreaterThan(0);
        }
      });

      it('ends the game on the third, and sounds nothing afterwards', () => {
        // The endings are terminal and the power switch is the only reset, so
        // anything after the loss sound would mean the game went on playing
        // past its own ending.
        const loss = lossesIn(game())[0] as Sound;
        expect(game().sounds.filter((sound) => sound.atCycle > loss.atCycle)).toEqual([]);
      });

      it('never fires, so nothing here is the player defending himself', () => {
        expect(game().everFired).toBe(false);
      });
    });
  }
});

describe('the game is losable while it is being played', () => {
  // ## The assertion this file did not have
  //
  // Everything above drives a machine nobody is touching, and one of them says
  // so in as many words: `everFired` is asserted false, so that no loss can be
  // mistaken for the player defending himself. That is right for those tests and
  // it left the whole death path specified over a passive machine - which is
  // exactly how a build shipped in which **a player who taps fire cannot lose a
  // launcher at all**.
  //
  // The mechanism was not in the loss rules. `jm_capture` used to charge a
  // capture only when the jet crossed in the lever's own lane; the player's
  // missile sweeps that lane end to end in about 150 ms with unlimited ammo; and
  // `rf_look` will not launch a rocket from a lane with no jet in it. So tapping
  // fire emptied the one lane that could hurt him and closed both loss paths at
  // once. Measured on that ROM: 0 to 1 launchers lost in 90 s of play, against
  // game over in 24-43 s for the same machine left alone. Every suite was green.
  //
  // The rule is now PRD v1 R6 and v3 PRD line 280 - a capture costs a launcher
  // in any lane - and this is the assertion that holds it there. It is
  // deliberately not a claim about *how long* a played game lasts, which is a
  // difficulty question and not a rules one. It claims only that playing does
  // not make the machine immortal.
  // ## The premise changed under this, and the change is asserted rather than
  // ## scoped away
  //
  // This was three identical assertions: with fire worked, every lever position
  // loses all three launchers. That was true when it was written. It is not now.
  // Testing both the cell the shot leaves and the cell it arrives in made a
  // tapping player enough more lethal that **lane 0 wins** - one launcher lost
  // at 160.7 s, then 199 points at 247.0 s - while lanes 1 and 2 still lose all
  // three, at 161.4 s and 166.6 s.
  //
  // **The assertion stopped terminating for the reason it was built around**,
  // which is the hazard `open-questions.md` §11a describes, arriving here by way
  // of a fix in this same branch. The wrong response is to narrow the claim to
  // the two lanes that still lose, because that buries the most interesting
  // behaviour in the file as an absence. Lane 0's win is pinned below as its own
  // fact, so that if the balance ever moves back a test says so.
  //
  // Whether a blind tapping player *should* be able to win from one lane is a
  // rules question and is with the owner. This file's job is to say what the
  // machine does.
  for (const { detent, lane } of LEVERS.filter((lever) => lever.lane !== 0)) {
    it(
      `still loses all three launchers with the fire button worked, lever ${detent}`,
      () => {
        const game = playingOn(lane);
        expect(game.everFired, `${detent}: the drive never actually fired`).toBe(true);
        expect(game.won, `${detent}: the game was won, not lost`).toBe(false);
        expect(warningsIn(game).map((warning) => warning.beeps), detent).toEqual([2, 3]);
        expect(lossesIn(game), detent).toHaveLength(1);
      },
      LONG_RUN_TIMEOUT_MS,
    );
  }

  it(
    'is won from the top lane by tapping fire alone, which is a rule and not a bug here',
    () => {
      // Pinned deliberately. A blind tapping player who never moves the lever
      // reaches 199 from lane 0 - one launcher lost on the way. It is asserted
      // because it is surprising, because the owner's original report was that
      // he could not die, and because a test that merely stayed silent about it
      // would let the balance drift back without anyone noticing.
      const game = playingOn(0);
      expect(game.everFired, 'the drive never actually fired').toBe(true);
      expect(game.won, 'lane 0 no longer wins by tapping alone').toBe(true);
      expect(game.hits.length, 'lane 0 lost a different number of launchers').toBe(1);
    },
    LONG_RUN_TIMEOUT_MS,
  );
});

describe('which mechanism took each launcher, read off the tube', () => {
  // Fire is never pressed, so no missile exists and a jet can leave the field
  // only by reaching the G line. Counting jets that vanish from the deepest jet
  // cell therefore separates the two ways a launcher is lost without reading a
  // nibble of RAM.

  it(
    'matches every jet that reached the G line to a launcher lost at that moment',
    () => {
      // The v2 form of this asserted three captures in the centre and bottom
      // lanes and none in the top one. That was never a rule - the comment on
      // its companion said so. The split written here afterwards, "lane 0 takes
      // all three by capture, lane 2 takes one, and lane 1 takes none at all",
      // was not a rule either and was not even a fact: it was read off a tube
      // that was drawing the squadron in the wrong lane, so arrivals in the
      // lever's own lane went unseen. Read from `NIB_HITS` and the rocket's own
      // nibble, the parked-lever split is three captures in lane 0 and two
      // captures and one rocket in each of lanes 1 and 2.
      //
      // What survives all of that is the claim that was actually being made,
      // stated the way round that holds for every lane: a jet reaching the G
      // line always costs a launcher, so no departure may be unaccounted for.
      //
      // The arrival never *precedes* the sound, because the tube cannot report a
      // jet gone before the ROM has removed it, and it lags by the length of the
      // sound that blanked the sweep - measured at 0.10 s and 0.40 s behind a
      // warning and 0.69 s behind the 0.67 s loss envelope.
      let captures = 0;
      for (const { detent, lane } of LEVERS) {
        const game = gameFor(lane);
        captures += game.departures.length;
        for (const departure of game.departures) {
          const cause = launcherLosses(game).find(
            (loss) =>
              departure - loss >= -CAPTURE_LEAD_CYCLES &&
              departure - loss <= CAPTURE_WINDOW_CYCLES,
          );
          expect(
            cause,
            `${detent}: a launcher lost at the moment of the capture at ${departure}`,
          ).toBeDefined();
        }
      }
      // And not vacuously: at least one lane has to lose a launcher this way, or
      // the capture path is not being exercised at all and the loop above is
      // asserting over an empty list three times.
      expect(captures, 'no jet reached the G line in any lane').toBeGreaterThan(0);
    },
    LONG_RUN_TIMEOUT_MS,
  );

  it('takes launchers by rocket too, and the ladder does not care which took which', () => {
    // The negative control for the test above: the three-launcher rule belongs
    // to the launcher rather than to the capture path, so it has to hold over
    // losses that no jet reaching the G line can explain.
    //
    // ## What this used to look for, and why it was never there
    //
    // It used to require a whole *lever lane* in which no jet ever reached the G
    // line, and it found one: lane 1, the centre detent. There was never such a
    // lane. `departures` counts jets vanishing from the deepest jet cell as the
    // tube shows it, and the ROM was drawing the squadron offset by the lever's
    // own lane - `rd_jets` left `NIB_RBIT` uninitialised - so with the lever
    // parked in lane 1 a jet arriving in lane 1 was drawn in lane 2 or, once the
    // bitmap overflowed the near group, not drawn at all. No departure was
    // visible, so the lane looked rocket-only. Read from `NIB_HITS` and the
    // rocket's own nibble instead, the parked-lever split is three captures in
    // lane 0 and *two captures and one rocket* in each of lanes 1 and 2.
    //
    // So the property is restated as the one that was actually being claimed and
    // is true of this machine: some launcher, in some lane, is taken by
    // something that is not a capture, and the warning ladder runs identically
    // in every lane regardless of which mechanism took which launcher. That is
    // strictly more than the old form asserted - the ladder is now checked in
    // all three lanes rather than in the one that happened to be rocket-only.
    // **Attributed positively, by the rocket's own nibble.**
    //
    // This used to read "a loss with no departure near it", which was safe only
    // while a capture cost a launcher in the lever's own lane alone. Once a
    // capture costs one in *any* lane - `open-questions.md` section 6, the rule
    // the owner settled - departures became frequent enough that a genuine
    // rocket loss almost always has one within the window by coincidence, and
    // every lane read as capture-only. The rocket path was being exercised the
    // whole time and this assertion could not see it.
    //
    // `rocketArrivals` records the sweep on which `NIB_RCOL` returned to zero,
    // which is the shot being spent and the only moment it can take a launcher.
    // Measured with the settled rule: lanes 0 and 2 lose three launchers to
    // captures, lane 1 loses two and one to a rocket, at every skill.
    const byRocket = LEVERS.flatMap(({ detent, lane }) => {
      const game = gameFor(lane);
      return launcherLosses(game)
        .filter((loss) =>
          game.rocketArrivals.some(
            (arrival) => loss - arrival >= 0 && loss - arrival <= CAPTURE_WINDOW_CYCLES,
          ),
        )
        .map((atCycle) => `${detent} at ${atCycle}`);
    });
    expect(
      byRocket.length,
      'every launcher in every lane was taken by a capture, so the rocket path is untested',
    ).toBeGreaterThan(0);
    for (const { detent, lane } of LEVERS) {
      const game = gameFor(lane);
      expect(warningsIn(game).map((warning) => warning.beeps), detent).toEqual([2, 3]);
      expect(lossesIn(game), detent).toHaveLength(1);
    }
  });
});

describe('an ending during a battleship crossing stops the buzz', () => {
  // ## The defect, and why every existing assertion was blind to it
  //
  // The battleship's buzz is the one sound not played by `note`: `strobe` ticks
  // `NIB_BUZZ` on every O strobe and toggles R15 off it, which is what lets the
  // tube keep scanning through a four-second crossing. It is stopped by
  // `bs_leave` when the crossing runs down. But from the sweep an ending is
  // written, `tick` takes its `tk_ended` arm straight to `render` and **never
  // reaches `tick_bship` again** - so a crossing in progress never runs down,
  // and the buzz ticks for as long as the machine is left switched on.
  // Measured before the fix: **9032 speaker edges after the game was over.**
  //
  // `ends the game on the third, and sounds nothing afterwards` reads
  // gap-separated *sounds* and passed throughout. The stranded buzz begins
  // inside the loss envelope and ticks about every 10 ms, well inside
  // `BURST_GAP_CYCLES`, so the grouper never starts a new sound: the buzz *is*
  // the loss sound as far as it can tell, and "no sound after the loss" is true
  // of a machine that never stops making the loss sound. This one reads raw
  // edges instead and is deliberately independent of the grouping.
  //
  // ## Why this drive and not a parked lane
  //
  // The defect needs the ending to land inside a crossing, and none of the three
  // parked-lever games does - they end at 27.1, 36.6 and 45.4 s, all between
  // crossings. An assertion over those would be armed and never fire, which is
  // the failure this suite has already shipped once. Skill 3 in lane 0 ends at
  // 30.8 s with `NIB_BSLANE` still naming a lane, and the guard below fails
  // loudly if that ever stops being true rather than passing quietly.
  // Driven on first use, not at collection time - see `gameFor` above for why a
  // drive in a `describe` body escapes every timeout in the file.
  let driven: { endedAt: number; bshipLaneAtEnd: number; lastEdgeAt: number } | undefined;
  const game = (): { endedAt: number; bshipLaneAtEnd: number; lastEdgeAt: number } => {
    if (driven !== undefined) {
      return driven;
    }
    const machine = new Tms1370Machine();
    machine.setContacts({ skill: 3, lane: 0 });
    const edges: SpeakerEdge[] = [];
    let endedAt = 0;
    let bshipLaneAtEnd = 0;
    const target = Math.round(PARKED_GAME_END_S * 1.4 * CYCLE_HZ);
    while (machine.cycles < target) {
      machine.runSweeps(1, SWEEP_CEILING_CYCLES);
      edges.push(...machine.takeSpeakerEdges());
      if (endedAt === 0 && (machine.ram[STATE_ADDRESS] as number) !== 0) {
        endedAt = machine.cycles;
        bshipLaneAtEnd = machine.ram[BSLANE_ADDRESS] as number;
      }
    }
    driven = { endedAt, bshipLaneAtEnd, lastEdgeAt: edges[edges.length - 1]?.cycle ?? 0 };
    return driven;
  };

  it('ends the game while the boat is still crossing, or this proves nothing', () => {
    expect(game().endedAt, 'the game never ended in this window').toBeGreaterThan(0);
    expect(game().bshipLaneAtEnd, 'the ending did not land inside a crossing').not.toBe(BS_NONE);
  }, LONG_RUN_TIMEOUT_MS);

  it('leaves the speaker alone once the ending is on the glass', () => {
    // **Zero, and zero is the principled bound rather than a strict-sounding
    // one.** `game_lost` writes NIB_STATE and then plays the whole envelope with
    // the sweep parked, so the sweep on which the ending first becomes visible
    // has already finished the last edge of it - measured at 8 to 9 ms before,
    // on every lane. Nothing can emit after that point except something still
    // running when it should not be, which is the defect.
    //
    // An earlier form of this allowed one sweep of slack "for the sampling
    // boundary", and that slack was load-bearing in the wrong direction: a
    // variant that cleared the buzz from `tick`'s ended arm rather than from the
    // two endings themselves leaves the crossing ticking for the one sweep
    // between them, and **passed** - 2 edges, the last at +13 ms, inside a
    // ~15 ms sweep. The tolerance was hiding a real difference in the ROM, so it
    // is gone.
    expect(
      game().lastEdgeAt - game().endedAt,
      'the speaker was still moving after the game ended',
    ).toBeLessThanOrEqual(0);
  }, LONG_RUN_TIMEOUT_MS);
});
