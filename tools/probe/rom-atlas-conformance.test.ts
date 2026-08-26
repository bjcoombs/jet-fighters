// The ROM and the atlas describe the same tube, and this is what holds them to it.
//
// Paths in this file are relative to the repository root.
//
// The instruction set has an equality that keeps it honest - `encode(decode(op))
// === op` over the whole opcode space - and the display map has never had one.
// That absence has produced two phantom-segment bugs already: a ground line on
// plate 0 of every column, and a lives display on a grid the tube does not have,
// both of them addresses the ROM drove into glass that has no phosphor there.
// Both were found by eye, months apart, and neither would have survived a check
// like this one.
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
// Both directions are read off the machine's own observation surface over a set
// of scenarios chosen to exercise every actor: shots fired and missed, jets
// walked all the way to the capture line, the launcher destroyed, a battleship
// crossing shot down and a battleship crossing let past, and a score climbing
// through all three digit columns. Nothing here reads the ROM's RAM or its
// listing - a test that did would pass for a ROM that computed the right
// addresses and drove none of them.
//
// ## What the address surface is, on this machine
//
// `Tms1370Machine.litCells` - the (grid, plate) pairs the ROM drove, recorded at
// the instant a grid line rose against the plate mask standing at the time. That
// is one layer below the duty accumulator the v2 suite read: a duty is what the
// *tube* did with a drive, and this direction of the check is about what the
// *program* addressed. The nine grids come out of the four sweep passes and the
// twelve plates out of the O port's low eight plus R11-R14, so an address that
// reaches the bus at all reaches this set, whatever the sweep made of it
// afterwards.
//
// Node-side test: no DOM, no browser globals.

import { beforeAll, describe, it, expect } from 'vitest';
import { CAPTURE_WINDOW_CYCLES } from '../../src/machine/board/tms1370-cadence.js';
import { Tms1370Machine, assembleGame, planesOf, squadronMap } from './tms1370-probe.js';
import { loadAtlas, getSegmentByAddress } from '../../src/machine/tube/atlas.js';

/** The three lever detents, as the lane nibble the K matrix returns. */
const LANES = [0, 1, 2] as const;

type Lane = (typeof LANES)[number];

/**
 * The scenarios, as a space to search rather than a list to run.
 *
 * Coverage needs rare conjunctions - the battleship shot down in its second lane
 * is one crossing in several, the launcher's own burst is lit for fifteen sweeps
 * in a run of thousands - and there is no way to ask the ROM for them directly,
 * because nothing here writes game state.
 *
 * Hand-picked scenarios did work, and were the wrong shape. They were tuned
 * against one set of cadence constants, and several of those are explicitly
 * provisional: change how fast the squadron steps and the sweep a burst lands on
 * moves, so a fixture that stopped forty sweeps after the event it was chosen
 * for stops before it instead. That is a property of the fixture, not of the
 * ROM, and it made this file fail on a cadence change that was nothing to do
 * with the display map.
 *
 * So the scenarios are generated and searched in a fixed order, accumulating
 * coverage, and the search stops as soon as the atlas is covered. A cadence
 * change now means a different member of the space supplies the rare event
 * rather than the file going red. The order is deterministic, so a passing run
 * is reproducible; only how many of them are needed varies.
 */
interface Scenario {
  readonly what: string;
  /** Skill dial position, 1 to 3. */
  readonly skill: 1 | 2 | 3;
  /**
   * Where to put the lever this sweep.
   *
   * **The machine is passed so a scenario can play competently rather than
   * open-loop.** Every scenario here was a pure function of the sweep number,
   * which was sufficient while a capture only cost a launcher in the lever's own
   * lane: the player kept that lane clear by firing and the game ran for as long
   * as the scenario asked. With the settled rule - a capture costs a launcher in
   * any lane, `open-questions.md` section 6 - an open-loop lever cannot defend
   * the other two, so a game ends in 19-37 s and the rare conjunctions this
   * search needs stop arriving.
   *
   * A longer `sweeps` does not help, because the *game* ends rather than the
   * clock. The scenario has to aim.
   *
   * **This costs no reproducibility, and that is a property of this machine
   * rather than a judgement.** The objection to a closed-loop scenario is that
   * it makes a run depend on state and so on chance. **v3 has no chance in it:**
   * `NIB_RAND` does not exist, `rocket_fire` and `jet_enter` both take their
   * lane from a plain round robin that nothing on the input path touches, and
   * the same drive run twice produces an identical lane sequence. A scenario
   * reading machine state is therefore exactly as reproducible as one reading
   * only the sweep number.
   *
   * That was not true of v2, where `NIB_RAND` sampled the free-running timer on
   * the sweep the player pressed fire, so the objection is worth answering here
   * rather than re-litigating.
   */
  readonly lever: (sweep: number, machine: Tms1370Machine) => Lane;
  readonly fire: (sweep: number) => boolean;
  /** Sweeps to play. A sweep is the tube's frame period on this machine. */
  readonly sweeps: number;
}

/**
 * Where the squadron lives, from the assembled program's own symbols.
 *
 * **This replaces a `JETS_FILE = 6` that had stopped meaning anything.** It was
 * read as `ram[JETS_FILE * 16 + lane]` - the lane rank, one nibble per lane,
 * the nibble being the column. The rank was deleted when the squadron became
 * two `(row, column)` pairs at nibbles 10-13, and the ROM's own map now says of
 * nibbles 0-2 that they "are free... nothing reads them now". So {@link guarding}
 * was reading three nibbles that are always zero, and the coverage search stayed
 * green because a lever that never moves is still a lever.
 */
const SQUADRON = squadronMap(assembleGame());
/** `FILE_STATE`, and the jets' rocket within it. */
const STATE_FILE = 4;
const ROCKET_COLUMN = 7;
const ROCKET_LANE = 8;
/** `NIB_BSLANE` within `FILE_STATE`: the boat's lane, or `BS_NONE` (15). */
const BSHIP_LANE = 9;

const cycling =
  (dwell: number) =>
  (sweep: number): Lane =>
    LANES[Math.floor(sweep / dwell) % 3]!;
const every = (period: number) => (sweep: number) => sweep % period === 0;

/**
 * Sweeps the long game plays, for the hundreds column.
 *
 * **Measured**: the score first reaches three digits at sweep 5177 of the
 * scenario below, which is the earliest any member of this space reaches it. A
 * third again of that is the margin, and the search's own design is what makes
 * the margin safe to keep small - if a scoring change moves the event past this,
 * the space after the cache supplies it and the file gets slower rather than
 * red.
 */
const HUNDREDS_COLUMN_SWEEPS = Math.round(5177 * 1.35);

/**
 * Sweeps every other scenario plays.
 *
 * Long enough for the battleship's opening crossing - 528 sweeps to the onset
 * and three 65-sweep lane steps of descent - and for the squadron to take all
 * three launchers on any skill setting. Everything but the hundreds column is
 * reached inside it.
 */
const SCENARIO_SWEEPS = 1500;

/**
 * The scenarios known to cover the atlas, tried first because they are quick.
 *
 * Each earns its place: the search below reports which ones contributed, and
 * these are the six that did. They are a cache of a previous search, not a
 * specification - if a cadence change stops one working, the space after them
 * supplies the missing event and the file stays green while getting slower.
 *
 * The v2 cache had two members whose whole job was to keep the lever *out* of
 * the battleship's lane, because a steadily-firing player shot the boat down in
 * its first lane every time and `battleship_lane2` was a segment no scenario
 * reached. That is no longer a coverage problem and the helper is gone with it:
 * this ROM's crossing is a 3.9 s descent through three 65-sweep lane steps, so a
 * scenario that lets one crossing past sees all three lanes. What is rare now is
 * the *burst* - the boat killed in a given lane - and that comes of playing more
 * crossings rather than of dodging one.
 */
/**
 * A lever that defends: it stands in the lane of whichever jet is deepest, so
 * the next shot goes at the jet closest to the G line.
 *
 * This is what a player does, and since the settled capture rule it is what any
 * scenario needing more than about thirty seconds of game has to do. It reads
 * the squadron, which is the same latitude the other drives in `tools/probe/`
 * take to decide where to aim - the lever still reaches the game only by
 * closing a contact on the K matrix.
 */
/**
 * Sweeps between re-reads of the game state.
 *
 * `Tms1370Machine.ram` builds a fresh 128-nibble image per call, and this search
 * plays thousands of sweeps across many scenarios - re-reading every sweep made
 * the whole suite slow enough to time other files out under Vitest's parallel
 * run. The squadron steps every 144 sweeps at skill 1, so a decision that is at
 * most eight sweeps stale is the same decision.
 */
const GUARD_REFRESH_SWEEPS = 1;

let guardCacheSweep = -1;
let guardCacheLane: Lane = 0;

const guarding = (sweep: number, machine: Tms1370Machine): Lane => {
  if (guardCacheSweep >= 0 && sweep - guardCacheSweep < GUARD_REFRESH_SWEEPS) {
    return guardCacheLane;
  }
  guardCacheSweep = sweep;
  const ram = machine.ram;
  const rocketColumn = ram[STATE_FILE * 16 + ROCKET_COLUMN] as number;
  const rocketLane = ram[STATE_FILE * 16 + ROCKET_LANE] as number;
  // A row can hold two planes, so "how deep is this row" is a maximum over the
  // planes standing in it and not a nibble. An empty row scores 0, which is the
  // same value an empty slot's column carries.
  const planes = planesOf(ram, SQUADRON);
  let best = -1;
  let lane: Lane = 0;
  for (const candidate of LANES) {
    // A rocket takes the launcher only if it arrives in the launcher's lane, so
    // standing anywhere else is the whole defence - `rm_arrived` compares the
    // two lanes and nothing else. Guarding a jet is not worth a launcher.
    if (rocketColumn !== 0 && candidate === rocketLane) continue;
    const grid = planes.reduce(
      (deepest, plane) => (plane.row === candidate ? Math.max(deepest, plane.column) : deepest),
      0,
    );
    if (grid > best) {
      best = grid;
      lane = candidate;
    }
  }
  guardCacheLane = lane;
  return lane;
};

/**
 * A lever that hunts the battleship: it stands in the boat's own lane.
 *
 * **Added because the rank made the incidental boat kill stop happening.** The
 * comment on {@link KNOWN_GOOD} records that the burst "comes of playing more
 * crossings rather than of dodging one" - a steadily-firing player used to shoot
 * the boat down by accident often enough that `battleship_burst` needed no
 * scenario of its own. That stopped being true when the missile rank landed:
 * the shared step timer now free-runs rather than starting when a shot is fired,
 * so the delay between pressing fire and the shot's first step is anywhere in a
 * 32-sweep window instead of a fixed 32. A mechanical `fire every N` pattern
 * therefore no longer lands on the boat at a repeatable phase, and the whole
 * fallback grid - 43 scenarios, every dwell and period in the space - converged
 * on `battleship_burst:plate:6` as the single cell it could not cover.
 *
 * The fix is to aim rather than to spray, which is what a player does and what
 * `scoring-ruler.test.ts`'s own boat hunt already does for the same reason. The
 * lever reads `NIB_BSLANE` and stands there for the whole descent, so a shot
 * fired at any point during a crossing travels down the boat's lane.
 *
 * Reading RAM to decide where to aim is the same latitude {@link guarding} and
 * every other drive in `tools/probe/` takes - the lever still reaches the game
 * only by closing a contact on the K matrix, never by writing state.
 *
 * Falls back to {@link guarding} between crossings, because a scenario that
 * cannot defend loses its launchers long before the next boat arrives.
 */
const huntingBoat = (sweep: number, machine: Tms1370Machine): Lane => {
  const lane = machine.ram[STATE_FILE * 16 + BSHIP_LANE] as number;
  // BS_NONE (15) when no crossing is in progress; otherwise the boat's lane.
  if (lane < LANES.length) {
    return lane as Lane;
  }
  return guarding(sweep, machine);
};

const KNOWN_GOOD: Scenario[] = [
  {
    what: "hunting the battleship: the lever stands in the boat's lane for the whole descent, so a shot fired during a crossing goes down it - the burst the fallback grid cannot reach since the rank made the step timer free-running",
    skill: 1,
    lever: (sweep, machine) => huntingBoat(sweep, machine),
    fire: every(3),
    sweeps: SCENARIO_SWEEPS,
  },
  {
    what: 'a defended game: the lever guards whichever jet is deepest and steps out of a live rocket lane, so the squadron is held off long enough to reach a three-digit score',
    skill: 2,
    lever: (sweep, machine) => guarding(sweep, machine),
    fire: every(2),
    sweeps: HUNDREDS_COLUMN_SWEEPS,
  },
  {
    what: 'one shot and then nothing: the squadron walks in, the launcher is destroyed, and a whole battleship crossing goes by unshot',
    skill: 3,
    lever: () => 1,
    fire: (sweep) => sweep === 5,
    sweeps: 900,
  },
  {
    what: 'firing hard at the hardest setting, moving lanes every few sweeps',
    skill: 3,
    lever: cycling(7),
    fire: every(2),
    sweeps: SCENARIO_SWEEPS,
  },
  {
    what: 'firing rarely, so jets survive deep into the field and die there',
    skill: 2,
    lever: cycling(7),
    fire: every(13),
    sweeps: SCENARIO_SWEEPS,
  },
  {
    what: 'a long slow game that gets a colon fired down the bottom lane',
    skill: 1,
    lever: cycling(9),
    fire: every(13),
    sweeps: SCENARIO_SWEEPS,
  },
  {
    what: 'the lever dwelling, so the launcher is still there when a colon arrives',
    skill: 1,
    lever: cycling(40),
    fire: every(13),
    sweeps: SCENARIO_SWEEPS,
  },
  {
    what: 'a long hard game, for a score that reaches the hundreds column',
    skill: 1,
    lever: cycling(9),
    fire: every(2),
    sweeps: HUNDREDS_COLUMN_SWEEPS,
  },
];

/** The space searched when the six above stop being enough. */
function scenarioSpace(): Scenario[] {
  const fallback: Scenario[] = [];
  for (const dwell of [7, 9, 11, 25, 40, 60]) {
    for (const period of [2, 3, 13]) {
      for (const skill of [3, 2, 1] as const) {
        fallback.push({
          what: `dwell ${dwell}, fire every ${period}, skill ${skill}`,
          skill,
          lever: cycling(dwell),
          fire: every(period),
          // The fallback plays the long game's length rather than the short
          // one's: it is only reached once the cache has stopped delivering, and
          // the events it is then being asked for are the late ones.
          sweeps: HUNDREDS_COLUMN_SWEEPS,
        });
      }
    }
  }
  return [...KNOWN_GOOD, ...fallback];
}

/**
 * Addresses the atlas defines that this ROM cannot reach.
 *
 * Two, both of them bugs in the game program with a line each here rather than
 * gaps in the glass, and both commissioned separately. They are named one line
 * at a time so that the day someone fixes one they delete a line rather than
 * loosen an assertion.
 *
 * The v2 machine had three whole *families* in this list - the printed sea, the
 * battleship's burst and the capture burst - and this ROM draws all three, which
 * is why the first map below is now empty. It is kept as an empty map rather
 * than deleted so that the next real gap has an obvious place to be written
 * down, with its reason, instead of being tolerated by loosening an assertion.
 */
const ROM_CANNOT_REACH = {
  /**
   * Families the ROM cannot light at all, because it has no concept of them.
   *
   * **There are none.** Every family in `src/machine/tube/atlas.json` is drawn
   * by `asm/jetfighter.asm`: the printed sea is the far pass's grid-0 mask, the
   * capture burst is the far pass's grid-6 mask, and the battleship's burst is
   * the pair pass's grid-0 mask.
   */
  families: new Map<string, string>(),
  /**
   * Addresses inside an otherwise driven family that the ROM cannot reach.
   *
   * **There are none.** This list carried one for as long as `missile_step`
   * advanced the shot and *then* tested what it reached, which left the column
   * the missile is launched into - grid 5, the cell in front of the launcher -
   * written, drawn and left again without ever being hit tested. A jet standing
   * there could not be shot, so its burst could not be printed, so
   * `burst` under grid 5 was unreachable and was excluded here.
   *
   * The ROM tests before it steps now, and the address is reachable. Removed on
   * the measurement rather than on the reasoning: aimed shots at a jet standing
   * alone in its lane take it **14 times in 25 at grid 5**, against 0 in 12
   * before, matching the 12 to 15 in 25 every other column returns; and a drive
   * that kills in that cell lights `5:9`, `5:10` and `5:11` - all three lanes of
   * the family - where it previously lit none of them.
   */
  grids: new Map<string, number[]>(),
  /**
   * The battleship's burst in the third lane, which is plate 8.
   *
   * Plate 8 is R11 and is outside the output PLA entirely, so a family's third
   * lane is drawn by the R-plate walk rather than by an O mask. `rd_missile` and
   * `rd_launcher` both branch on exactly that - `TBIT1 1`, then `rd_ms_plate8` /
   * `rd_ln_plate8` naming `RPL_R11` - and `rd_burst` does not: on grid 0 it
   * takes the pair-family arm unconditionally and asks `lane_bit` for a subset
   * bit, which for lane 2 is 4. The pair group holds two plates, so subset 4 is
   * off the end of its four-slot run and the index leaves the 32-slot table.
   *
   * The failure is benign rather than a phantom - the index resolves dark, so
   * the boat's burst in its third lane draws nothing at all and the strict
   * direction of this file stays green. Confirmed on the running machine: a
   * drive that parks the lever in lane 2 and fires sparsely kills the boat in
   * its third lane (`NIB_KLANE` = 2, `NIB_KCOL` = 1, the crossing ending early)
   * and lights no grid-0 pair plate over the whole run.
   *
   * A bug in the render step rather than in the display map, and it belongs with
   * whoever owns that page.
   */
  plates: new Map([['battleship_burst', [8]]]),
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

/**
 * Play one scenario and hand back every (grid, plate) it drove.
 *
 * A sweep at a time, because a sweep is this machine's frame period and the
 * lever cannot usefully move faster than the program reads it. The ceiling on
 * `runSweeps` is not a nicety: the ROM stops sweeping for the whole of every
 * sound, so a caller waiting on a sweep needs a bound - and if the bound is ever
 * actually reached the machine has stopped drawing, which leaves nothing further
 * to observe, so the drive ends there.
 */
function play(scenario: Scenario): ReadonlySet<string> {
  guardCacheSweep = -1;
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: scenario.skill });
  for (let sweep = 0; sweep < scenario.sweeps; sweep += 1) {
    machine.setContacts({ lane: scenario.lever(sweep, machine), fire: scenario.fire(sweep) });
    if (machine.runSweeps(1, CAPTURE_WINDOW_CYCLES) >= CAPTURE_WINDOW_CYCLES) {
      break;
    }
  }
  return machine.litCells;
}

/** Play scenarios in order until the atlas is covered, or the space runs out. */
function sweepScenarios(): Coverage {
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
    if (ROM_CANNOT_REACH.families.has(family)) continue;
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
    for (const cell of play(scenario)) {
      const [grid, plate] = cell.split(':').map(Number) as [number, number];
      const segment = getSegmentByAddress(grid, plate);
      if (segment === undefined) {
        unmapped.add(`${grid}-${plate}`);
        continue;
      }
      const family = familyOf(segment.id);
      record(grids, family, grid);
      record(plates, family, plate);
      wanted.delete(`${family}:grid:${grid}`);
      wanted.delete(`${family}:plate:${plate}`);
    }
  }
  return { unmapped: [...unmapped].sort(), grids, plates, scenariosRun };
}

const atlas = loadAtlas();
const atlasSegments = atlas.segments;
/**
 * Budget for the coverage search, in wall-clock milliseconds.
 *
 * **The search runs in a hook rather than at module scope so that this bound
 * applies to it.** Evaluated at import time it is outside every per-test
 * timeout, and a search that slows down does not fail - it starves whatever
 * Vitest is running in parallel, so four unrelated files time out and look
 * broken while this one stays green. That happened here: a badly-playing lever
 * took the search from 49 s to 246 s and took `render-fidelity`, `launcher-lives`
 * and `tms1370-rom` down with it, none of which had anything wrong.
 *
 * A slow test does not fail, it makes other tests fail. Bounded here, this file
 * names itself instead.
 */
const SEARCH_BUDGET_MS = 240_000;

let coverage: Coverage;

beforeAll(() => {
  coverage = sweepScenarios();
}, SEARCH_BUDGET_MS);

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
    [...defined]
      .filter(([family]) => !ROM_CANNOT_REACH.families.has(family))
      .map(([family, values]) => {
        const gap = gaps.get(family) ?? [];
        return [family, values.filter((value) => !gap.includes(value))];
      }),
  );
}

const ATLAS_GRIDS = reachable(atlasBy((grid) => grid), ROM_CANNOT_REACH.grids);
const ATLAS_PLATES = reachable(atlasBy((_grid, plate) => plate), ROM_CANNOT_REACH.plates);

const driven = (into: Map<string, Set<number>>, family: string): number[] =>
  [...(into.get(family) ?? [])].sort((a, b) => a - b);

// The two directions are separate blocks on purpose. They are not equally
// strong and should not share an exception mechanism: the first admits none and
// never will, because a violation is a phantom-segment bug. The second has
// known exceptions, and a mechanism that exists will eventually be used to
// silence something real - so it lives next to the assertions it applies to,
// enumerated by name with a reason each, and nowhere near the strict one.
describe('the ROM drives no address the tube has no segment at', () => {
  it('drives no address the tube has no segment at', () => {
    // The phantom-segment direction, and the one that has actually bitten. Not
    // "few" and not "only the known ones": none. Every address that reaches the
    // bus over every scenario must resolve to a segment.
    expect(coverage.unmapped).toEqual([]);
  });
});

describe('the ROM lights every segment the tube has, except where it is named', () => {
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
    // all three get drawn. On this tube a family's third lane is plate 8, 10 or
    // 11 - R11 to R14, outside the output PLA - so this is also the check that
    // the R-plate walk draws what the O passes cannot express.
    for (const [family, expected] of ATLAS_PLATES) {
      expect(driven(coverage.plates, family), family).toEqual(expected);
    }
  });
});
