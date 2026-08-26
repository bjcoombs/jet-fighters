// Can a plane enter onto a cell a missile is already standing in, and survive?
//
// `missile-rank.test.ts` counts coincidences between a shot and a jet on the
// same column in the same row, and asserts the shot never walks away from one.
// Once `jet_enter` could place a plane at column 2 as well as column 1 - the
// last two cells a missile passes through on its way to the horizon - that
// assertion started failing about once in twenty-four coincidences.
//
// This isolates why. For every coincidence it records whether the jet was
// already standing there in the previous frame or **appeared in this one**, so
// a pass-through caused by a spawn can be told from a pass-through caused by a
// collision test that missed.
//
// Paths in this file are relative to the repository root.

import { Tms1370Machine, assembleGame, slotsOf, type Plane } from '../tms1370-probe.js';
import { CYCLE_HZ } from '../../../src/machine/cpu/tms1370/timing.js';

const ASM = assembleGame();
const symbol = (name: string): number => {
  const found = ASM.symbols.find((definition) => definition.name === name);
  if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
  return found.value;
};

const SQUADRON = {
  base: symbol('FILE_JETS') * 16 + symbol('NIB_P_BASE'),
  stride: symbol('PLANE_STRIDE'),
  count: symbol('PLANE_COUNT'),
};
const FILE_MISS = symbol('FILE_MISS');
const NIB_MC = symbol('NIB_MC');
const STATE = symbol('FILE_STATE') * 16 + symbol('NIB_STATE');
const KILLS = symbol('FILE_STATE') * 16 + symbol('NIB_KILLS');

const SAMPLE_CYCLES = Math.round(CYCLE_HZ / 200);
const DRIVE_SECONDS = 90;
const BLOCKS = [50, 60, 70] as const;

interface Frame {
  readonly shots: readonly number[];
  readonly planes: readonly Plane[];
  readonly kills: number;
}

let coincidences = 0;
let passedAfterSpawn = 0;
let passedWithSettledJet = 0;
let freshByMarch = 0;
let freshBySpawn = 0;

for (const block of BLOCKS) {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 1, lane: 0, fire: false });
  const frames: Frame[] = [];
  const until = DRIVE_SECONDS * CYCLE_HZ;
  for (let tick = 0; machine.cycles < until; tick += 1) {
    const within = tick % block;
    machine.setContacts({
      lane: (Math.floor(tick / block) % 3) as 0 | 1 | 2,
      fire: within >= block / 2 && within < block / 2 + 5,
    });
    machine.step(SAMPLE_CYCLES);
    const ram = machine.ram;
    if ((ram[STATE] as number) !== 0) break;
    frames.push({
      shots: [0, 1, 2].map((lane) => ram[FILE_MISS * 16 + NIB_MC + lane] as number),
      planes: slotsOf(ram, SQUADRON).filter((plane) => plane.column !== 0),
      kills: ram[KILLS] as number,
    });
  }

  // A coincidence: a shot and a jet on the same row and column. Resolve it when
  // the shot's column next changes.
  const open: ({ column: number; fresh: boolean } | undefined)[] = [undefined, undefined, undefined];
  for (let i = 1; i < frames.length; i += 1) {
    const previous = frames[i - 1] as Frame;
    const current = frames[i] as Frame;
    for (let lane = 0; lane < 3; lane += 1) {
      const shot = current.shots[lane] as number;
      const pending = open[lane];
      if (pending !== undefined && shot !== pending.column) {
        const killed = shot === 0 && current.kills !== previous.kills;
        if (!killed && shot !== 0 && shot < pending.column) {
          if (pending.fresh) passedAfterSpawn += 1;
          else passedWithSettledJet += 1;
        }
        open[lane] = undefined;
      }
      if (shot === 0 || open[lane] !== undefined) continue;
      const here = current.planes.some((plane) => plane.row === lane && plane.column === shot);
      if (!here) continue;
      // Was that same jet standing on that same cell in the previous frame?
      const settled = previous.planes.some((plane) => plane.row === lane && plane.column === shot);
      if (!settled) {
        // It arrived this frame. A march would have moved it from one grid
        // further out in the same row; anything else is a spawn.
        const marched = previous.planes.some(
          (plane) => plane.row === lane && plane.column === shot - 1,
        );
        if (marched) freshByMarch += 1;
        else freshBySpawn += 1;
      }
      coincidences += 1;
      open[lane] = { column: shot, fresh: !settled };
    }
  }
}

console.log(`coincidences: ${coincidences}`);
console.log(`shots that walked away, jet already settled on the cell: ${passedWithSettledJet}`);
console.log(`shots that walked away, jet arrived on the cell that frame: ${passedAfterSpawn}`);
console.log(`fresh coincidences by march: ${freshByMarch}, by spawn: ${freshBySpawn}`);
