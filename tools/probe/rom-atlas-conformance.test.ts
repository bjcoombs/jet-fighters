// The ROM and the atlas describe the same tube, and this is what holds them to it.
//
// The instruction set has an equality that keeps it honest - `encode(decode(op))
// === op` for all 397 opcodes - and the display map has never had one. That
// absence has produced two phantom-segment bugs already: a ground line on plate
// 0 of every column, and a lives display on grid 9, both of them addresses the
// ROM drove into glass that has no phosphor there. Both were found by eye,
// months apart, and neither would have survived a check like this one.
//
// The check runs in both directions, because the two failures are different:
//
//   ROM -> atlas   The ROM lights an address the tube has no segment at. The
//                  write goes nowhere, and what the player sees is a sprite
//                  that never appears. This is the phantom-segment fault.
//   atlas -> ROM   The atlas defines a segment nothing ever lights. The tube
//                  carries phosphor the program cannot reach, which means
//                  either the atlas invented it or the ROM forgot it. The
//                  missile's five flight columns were exactly this until the
//                  ROM caught up with them.
//
// Both directions are read off the board's own observation surface over a set of
// scenarios chosen to exercise every actor: shots fired and missed, jets walked
// all the way to the capture line, the launcher destroyed, a battleship
// crossing, and a score climbing through both digit columns. Nothing here reads
// the ROM's RAM or its listing - a test that did would pass for a ROM that
// computed the right addresses and drove none of them.
//
// Node-side test: no DOM, no browser globals.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { assemble } from '../hmasm/assembler.js';
import { romImage } from '../hmasm/output.js';
import { Board } from '../../src/machine/board/board.js';
import { loadAtlas, getSegmentByAddress } from '../../src/machine/tube/atlas.js';

const LEVERS = ['up', 'centre', 'down'] as const;

/**
 * The scenarios, as a space to search rather than a list to run.
 *
 * Coverage needs rare conjunctions - a colon fired down the bottom lane is one
 * value in sixteen of the sampled counter, the launcher's own burst is lit for
 * about a dozen sweeps in a run of thousands - and there is no way to ask the
 * ROM for them directly, because nothing here writes game state.
 *
 * Hand-picked scenarios did work, and were the wrong shape. They were tuned
 * against one set of cadence constants, and `PAT_STEP` is explicitly
 * provisional: change how fast the squadron steps and the sweep a burst lands
 * on moves, so a fixture that stopped forty frames after the event it was
 * chosen for stops before it instead. That is a property of the fixture, not of
 * the ROM, and it made this file fail on a cadence change that was nothing to
 * do with the display map.
 *
 * So the scenarios are generated and searched in a fixed order, accumulating
 * coverage, and the search stops as soon as the atlas is covered. A cadence
 * change now means a different member of the space supplies the rare event
 * rather than the file going red. The order is deterministic, so a passing run
 * is reproducible; only how many of them are needed varies.
 */
interface Scenario {
  readonly what: string;
  readonly skill: string;
  readonly lever: (frame: number) => (typeof LEVERS)[number];
  readonly fire: (frame: number) => boolean;
  readonly frames: number;
}

const cycling = (dwell: number) => (frame: number) => LEVERS[Math.floor(frame / dwell) % 3]!;
const every = (period: number) => (frame: number) => frame % period === 0;

/**
 * The scenarios known to cover the atlas, tried first because they are quick.
 *
 * Each earns its place: the search below reports which ones contributed, and
 * these are the five that did. They are a cache of a previous search, not a
 * specification - if a cadence change stops one working, the space after them
 * supplies the missing event and the file stays green while getting slower.
 */
const KNOWN_GOOD: Scenario[] = [
  {
    what: 'one shot and then nothing: the squadron walks in and the launcher is destroyed',
    skill: '3',
    lever: () => 'centre',
    fire: (frame) => frame === 5,
    frames: 600,
  },
  {
    what: 'firing hard at the hardest setting, moving lanes every few sweeps',
    skill: '3',
    lever: cycling(7),
    fire: every(2),
    frames: 1500,
  },
  {
    what: 'firing rarely, so jets survive deep into the field and die there',
    skill: '2',
    lever: cycling(7),
    fire: every(13),
    frames: 1500,
  },
  {
    what: 'a long slow game that gets a colon fired down the bottom lane',
    skill: '1',
    lever: cycling(9),
    fire: every(13),
    frames: 1500,
  },
  {
    what: 'the lever dwelling, so the launcher is still there when a colon arrives',
    skill: '1',
    lever: cycling(40),
    fire: every(13),
    frames: 1500,
  },
];

/** The space searched when the five above stop being enough. */
function scenarioSpace(): Scenario[] {
  const fallback: Scenario[] = [];
  for (const dwell of [7, 9, 11, 25, 40, 60]) {
    for (const period of [2, 3, 13]) {
      for (const skill of ['3', '2', '1']) {
        fallback.push({
          what: `dwell ${dwell}, fire every ${period}, skill ${skill}`,
          skill,
          lever: cycling(dwell),
          fire: every(period),
          frames: 1500,
        });
      }
    }
  }
  return [...KNOWN_GOOD, ...fallback];
}

/**
 * Addresses the atlas defines that this ROM cannot reach. **There are none.**
 *
 * There was one, and the seventh grid dissolved it rather than fixing it.
 * `NIB_RCOL` spends zero on "no rocket in flight", so the ROM cannot express a
 * colon standing in column 0 - and while the atlas gave the playfield six grids,
 * column 0 was the G-line cell and the atlas put a colon there, so the tube
 * carried a segment the program could not light. The teardown photographs show
 * no colon printed in the player's own cell at all: the attackers' shot is
 * drawn in the five jet cells and nowhere else. The sentinel and the glass
 * agree, and the exception that used to live here is gone.
 *
 * Kept as an empty pair rather than deleted so that the next real gap has an
 * obvious place to be written down, with its reason, instead of being tolerated
 * by loosening an assertion.
 */
const ROM_CANNOT_REACH = {
  /**
   * The jet-kill burst in cell 5, the cell nearest the player.
   *
   * A newly visible bug rather than a missing sprite, and the seventh grid is
   * what made it visible. `tick_missile` advances the shot and *then* tests
   * what it reached, so the column it is launched into - cell 5 - is never hit
   * tested at all. Fire at a jet standing directly in front of the launcher and
   * the shot appears in its cell, leaves, and misses it.
   *
   * The tube has the burst printed there: the teardown photographs show the
   * same pair of white bursts in all five jet cells. Fixing it means testing
   * before advancing as well as after, which is a change to the hit chain
   * rather than to the display, so it is not folded into the map change.
   */
  grids: new Map([['burst', [5]]]),
  plates: new Map<string, number[]>(),
} as const;

/** The segment family an id belongs to, e.g. `jet_lane2_col4` -> `jet`. */
function familyOf(id: string): string {
  return id.replace(/_?(lane|col|digit)[0-9a-g]+/g, '').replace(/_seg[a-g]/, '');
}

interface Coverage {
  /** `grid-plate` for every address driven that the atlas has no segment at. */
  readonly unmapped: string[];
  /** Per family, the grids it was ever lit under. */
  readonly grids: Map<string, Set<number>>;
  /** Per family, the plates it was ever lit on. */
  readonly plates: Map<string, Set<number>>;
  /** How many of the scenario space were needed. Reported, not asserted. */
  readonly scenariosRun: number;
}

/** Play scenarios in order until the atlas is covered, or the space runs out. */
function sweepScenarios(): Coverage {
  const path = resolve(import.meta.dirname, '..', '..', 'asm', 'jetfighter.asm');
  const image = romImage(assemble(readFileSync(path, 'utf8'), path));
  const unmapped = new Set<string>();
  const grids = new Map<string, Set<number>>();
  const plates = new Map<string, Set<number>>();
  const record = (into: Map<string, Set<number>>, key: string, value: number): void => {
    const set = into.get(key) ?? new Set<number>();
    set.add(value);
    into.set(key, set);
  };
  // What the search is trying to reach, and it is exactly what the tests below
  // assert: every family under every grid and on every plate the atlas gives
  // it, less the gaps the ROM provably cannot reach. Keeping the two in step
  // matters - a stop condition stricter than the assertions never becomes true,
  // so the search runs the whole space every time and takes minutes to agree
  // with a result it had in seconds.
  const wanted = new Set<string>();
  for (const segment of atlasSegments) {
    const family = familyOf(segment.id);
    if (!ROM_CANNOT_REACH.grids.get(family)?.includes(segment.grid)) {
      wanted.add(`${family}:grid:${segment.grid}`);
    }
    if (!ROM_CANNOT_REACH.plates.get(family)?.includes(segment.plate)) {
      wanted.add(`${family}:plate:${segment.plate}`);
    }
  }
  let scenariosRun = 0;
  for (const scenario of scenarioSpace()) {
    if (wanted.size === 0) break;
    scenariosRun += 1;
    const board = new Board(image);
    board.setControl('skill', scenario.skill);
    for (let frame = 0; frame < scenario.frames; frame += 1) {
      board.setControl('lever', scenario.lever(frame));
      board.setFire(scenario.fire(frame));
      board.runFrames(1);
      for (const lit of board.getLitSegments()) {
        if (lit.duty <= 0) continue;
        const segment = getSegmentByAddress(lit.grid, lit.plate);
        if (segment === undefined) {
          unmapped.add(`${lit.grid}-${lit.plate}`);
          continue;
        }
        const family = familyOf(segment.id);
        record(grids, family, lit.grid);
        record(plates, family, lit.plate);
        wanted.delete(`${family}:grid:${lit.grid}`);
        wanted.delete(`${family}:plate:${lit.plate}`);
      }
    }
  }
  return { unmapped: [...unmapped].sort(), grids, plates, scenariosRun };
}

const atlas = loadAtlas();
const atlasSegments = atlas.segments;
const coverage = sweepScenarios();

/** Per family, the grids and plates the atlas actually defines it on. */
function atlasBy(pick: (grid: number, plate: number) => number): Map<string, number[]> {
  const out = new Map<string, Set<number>>();
  for (const segment of atlas.segments) {
    const key = familyOf(segment.id);
    const set = out.get(key) ?? new Set<number>();
    set.add(pick(segment.grid, segment.plate));
    out.set(key, set);
  }
  return new Map([...out].map(([key, set]) => [key, [...set].sort((a, b) => a - b)]));
}

/** What the ROM must reach: everything the atlas defines, less the known gaps. */
function reachable(
  defined: Map<string, number[]>,
  gaps: ReadonlyMap<string, readonly number[]>,
): Map<string, number[]> {
  return new Map(
    [...defined].map(([family, values]) => {
      const gap = gaps.get(family) ?? [];
      return [family, values.filter((value) => !gap.includes(value))];
    }),
  );
}

const ATLAS_GRIDS = reachable(atlasBy((grid) => grid), ROM_CANNOT_REACH.grids);
const ATLAS_PLATES = reachable(atlasBy((_grid, plate) => plate), ROM_CANNOT_REACH.plates);

const driven = (into: Map<string, Set<number>>, family: string): number[] =>
  [...(into.get(family) ?? [])].sort((a, b) => a - b);

describe('the ROM drives the tube the atlas describes', () => {
  it('drives no address the tube has no segment at', () => {
    // The phantom-segment direction, and the one that has actually bitten. Not
    // "few" and not "only the known ones": none. Every address that reaches the
    // bus over every scenario must resolve to a segment.
    expect(coverage.unmapped).toEqual([]);
  });

  it('lights every family the atlas defines', () => {
    // Nothing on this tube is inert. A family in the atlas that no scenario ever
    // lights is either phosphor the atlas invented or a sprite the ROM forgot -
    // the missile's flight columns were the second of those until the ROM was
    // moved onto them.
    expect([...coverage.grids.keys()].sort()).toEqual([...ATLAS_GRIDS.keys()].sort());
  });

  it('lights each family under every grid the atlas gives it, and no other', () => {
    // The column direction: a family drawn in five columns has to be seen in all
    // five. This is what would have caught the missile parked beside the
    // launcher for its whole flight while its column counter advanced out of
    // sight, and it is an equality rather than a floor - a sprite drawn in a
    // column the atlas does not give it fails just as loudly.
    for (const [family, expected] of ATLAS_GRIDS) {
      expect(driven(coverage.grids, family), family).toEqual(expected);
    }
  });

  it('lights each family on every plate the atlas gives it, and no other', () => {
    // The lane direction, by the same argument: three lanes of a family means
    // all three get drawn.
    for (const [family, expected] of ATLAS_PLATES) {
      expect(driven(coverage.plates, family), family).toEqual(expected);
    }
  });
});
