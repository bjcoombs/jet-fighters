// Three launchers, and the three ways the player finds out he has lost one.
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
// ## Why this reads the speaker rather than the RAM
//
// There is no lives display on this tube - owner-confirmed against his unit,
// and the three marks outside the playfield border are paint on the overlay.
// Damage is signalled by sound alone: two beeps on the first hit, three on the
// second, the full loss sound on the third (audio-reference.md,
// launcherHitWarning; all three owner-confirmed). The beeps *are* the lives
// indicator, so counting them off D14 is not a proxy for the rule - it is the
// rule, observed where a player observes it. A test that read NIB_HITS would
// prove the ROM incremented a nibble and say nothing about whether the player
// is ever told.
//
// ## What makes a warning distinguishable from anything else the ROM plays
//
// Beeps inside one warning are separated by `warn_gap`, a measured 25-28 ms
// (audio-reference.md, launcherHitWarning.gapMs). That gap is wider than the
// 20 ms BURST_GAP_CYCLES that speaker-bands.test.ts uses to split sounds, so
// each beep arrives here as its own sound and a warning has to be reassembled
// by clustering. WARNING_CLUSTER_CYCLES is the reassembly window: well above
// the gap between two beeps of one warning, and far below the gap between two
// separate hits, which are whole game events apart.
//
// The loss sound opens on the same pitch as a warning beep - audio-reference.md
// records them as the same note - so pitch alone cannot tell the third hit from
// the first. What separates them is the collapse to 96 Hz that follows: nothing
// else this ROM plays goes near that band, so a sound containing one is the
// loss sound and no other sound is.
//
// Node-side test: no DOM, no browser globals.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { assemble } from '../hmasm/assembler.js';
import { romImage } from '../hmasm/output.js';
import { Board } from '../../src/machine/board/board.js';
import type { SpeakerEdge } from '../../src/machine/board/speaker.js';
import { CYCLE_HZ } from '../../src/machine/cpu/cpu.js';

const ASM_PATH = resolve(import.meta.dirname, '..', '..', 'asm', 'jetfighter.asm');

/** Assemble the game ROM once and share the image across the runs below. */
const ROM = romImage(assemble(readFileSync(ASM_PATH, 'utf8'), ASM_PATH));

/**
 * Silence that separates two sounds, in machine cycles - 20 ms.
 *
 * The same constant, for the same reasons, as speaker-bands.test.ts: above the
 * 5.2 ms half-period of the slowest note the ROM plays and below the ~27 ms gap
 * between two beeps of one warning.
 */
const BURST_GAP_CYCLES = 8_000;

/**
 * How far apart two beeps may be and still belong to the same warning, in
 * machine cycles - 200 ms.
 *
 * `warn_gap` is 26.7 ms, so this is seven times the gap it has to bridge. The
 * nearest thing it must *not* bridge is two separate launcher losses, which are
 * separated by a jet crossing the field - over a second at the fastest cadence
 * in PAT_STEP, and several at the slowest.
 */
const WARNING_CLUSTER_CYCLES = 80_000;

/** How far two consecutive periods may differ and still count as one note. */
const RUN_TOLERANCE = 0.06;

/** Periods a run needs before it is a note rather than a transition artefact. */
const MIN_RUN_PERIODS = 3;

/** launcherHitWarning.dominantHzRange, which the loss opening shares. */
const WARNING_HZ = { min: 455, max: 545 } as const;

/** gameOver's collapse stage - the band no other sound in this ROM enters. */
const COLLAPSE_HZ = { min: 80, max: 97 } as const;

/**
 * Emulated seconds to run for.
 *
 * Long enough for an unattended machine to lose all three launchers with room
 * to spare - it takes about eleven seconds at the provisional cadences - and
 * short enough to stay well inside the Vitest timeout below.
 */
const HORIZON_S = 30;

/** Wall-clock allowance: thirty emulated seconds is several real ones. */
const LONG_RUN_TIMEOUT_MS = 60_000;

/** One gap-separated stretch of speaker activity, and the pitches inside it. */
interface Sound {
  readonly atCycle: number;
  readonly hz: readonly number[];
}

/** Every sound an unattended machine makes, in order, out to the horizon. */
function unattendedSounds(): Sound[] {
  const board = new Board(ROM);
  const edges: SpeakerEdge[] = [];
  // Drained as it goes: the speaker buffer is finite, and a run this long would
  // otherwise discard edges and make a sounding machine look silent.
  const target = Math.round(HORIZON_S * CYCLE_HZ);
  while (board.cycles < target) {
    board.step(100_000);
    edges.push(...board.takeSpeakerEdges());
  }
  return soundsIn(edges);
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
    atCycle: inSound[0]!.cycle,
    hz: pitchesIn(inSound.filter((edge) => edge.level === 1).map((edge) => edge.cycle)),
  }));
}

/**
 * The sustained pitches inside one sound.
 *
 * Rising edges are turned into periods, the periods broken into runs of like
 * periods, and each run long enough to be a note reported at its median - the
 * same method speaker-bands.test.ts uses, and for the same reason: one figure
 * for a whole sound averages a march step running into a battleship buzz and
 * reports a pitch belonging to neither.
 */
function pitchesIn(rising: readonly number[]): number[] {
  const periods = rising.slice(1).map((cycle, index) => cycle - rising[index]!);
  const pitches: number[] = [];
  let current: number[] = [];
  const close = (): void => {
    if (current.length >= MIN_RUN_PERIODS) {
      const sorted = [...current].sort((left, right) => left - right);
      pitches.push(CYCLE_HZ / sorted[Math.floor(sorted.length / 2)]!);
    }
    current = [];
  };
  for (const period of periods) {
    const previous = current[current.length - 1];
    if (previous !== undefined && Math.abs(period - previous) / previous >= RUN_TOLERANCE) {
      close();
    }
    current.push(period);
  }
  close();
  return pitches;
}

/** Does this sound hold a note in the given band? */
function holds(sound: Sound, band: { min: number; max: number }): boolean {
  return sound.hz.some((hz) => hz >= band.min && hz <= band.max);
}

/** The loss sound: the only one that collapses to 96 Hz. */
function isLoss(sound: Sound): boolean {
  return holds(sound, COLLAPSE_HZ);
}

/** A single warning beep: warning-pitched, and not the loss sound opening. */
function isBeep(sound: Sound): boolean {
  return holds(sound, WARNING_HZ) && !isLoss(sound);
}

/**
 * The warnings in a run: beeps gathered into the hits they announce.
 *
 * @returns one entry per launcher lost to a warning, holding how many beeps it
 *   was announced by and when it happened.
 */
function warningsIn(sounds: readonly Sound[]): { beeps: number; atCycle: number }[] {
  const warnings: { beeps: number; atCycle: number }[] = [];
  let last = -Infinity;
  for (const sound of sounds.filter(isBeep)) {
    const previous = warnings[warnings.length - 1];
    if (previous !== undefined && sound.atCycle - last <= WARNING_CLUSTER_CYCLES) {
      warnings[warnings.length - 1] = { ...previous, beeps: previous.beeps + 1 };
    } else {
      warnings.push({ beeps: 1, atCycle: sound.atCycle });
    }
    last = sound.atCycle;
  }
  return warnings;
}

const sounds = unattendedSounds();
const warnings = warningsIn(sounds);
const losses = sounds.filter(isLoss);

describe('a game survives three launchers being lost, and ends on the third', () => {
  it(
    'announces exactly two launchers before it ends, at two beeps then three',
    () => {
      // The assertion the reported defect fails. On the ROM that ended a game
      // at the first capture this list is empty: the machine went straight to
      // the loss sound and the warnings were never reached at all.
      expect(warnings.map((warning) => warning.beeps)).toEqual([2, 3]);
    },
    LONG_RUN_TIMEOUT_MS,
  );

  it('plays the loss sound exactly once, and only after both warnings', () => {
    expect(losses).toHaveLength(1);
    const loss = losses[0]!;
    for (const warning of warnings) {
      expect(warning.atCycle).toBeLessThan(loss.atCycle);
    }
  });

  it('keeps playing after each of the first two launchers is lost', () => {
    // The half of the rule the beep count cannot carry. A ROM that sounded two
    // beeps and *then* stopped would satisfy the count and still be the bug the
    // owner reported, so what has to be shown is that the game went on: the
    // machine kept making game noises - the march and the battleship buzz -
    // after each warning, and they are game noises because the game is the only
    // thing that produces them.
    for (const warning of warnings) {
      const after = sounds.filter(
        (sound) => sound.atCycle > warning.atCycle + WARNING_CLUSTER_CYCLES && !isLoss(sound),
      );
      expect(after.length, `sounds after the ${warning.beeps}-beep warning`).toBeGreaterThan(0);
    }
  });

  it('ends the game on the third, and never sounds a fourth warning', () => {
    // Nothing after the loss sound: the endings are terminal and the power
    // switch is the only reset, so a fourth warning would mean the game went on
    // playing past its own ending.
    const loss = losses[0]!;
    expect(sounds.filter((sound) => sound.atCycle > loss.atCycle)).toEqual([]);
  });
});
