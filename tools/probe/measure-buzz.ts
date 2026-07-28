// Scratch measurement harness: sweep rate, buzz pitch, crossing and gap length,
// and the worst-case display blank during an arrival. Not a test; deleted before
// the PR. Run: npx vite-node tools/probe/measure-buzz.ts
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { assemble } from '../hmasm/assembler.js';
import { romImage } from '../hmasm/output.js';
import { Board } from '../../src/machine/board/board.js';
import { CYCLE_HZ } from '../../src/machine/cpu/cpu.js';

const path = process.env.ASM ?? resolve(import.meta.dirname, '..', '..', 'asm', 'jetfighter.asm');
const asm = assemble(readFileSync(path, 'utf8'), path);
const sym = (n: string): number => {
  const f = asm.symbols.find((d) => d.name === n);
  if (!f) throw new Error(`no symbol ${n}`);
  return f.value;
};
const BSLANE = sym('FILE_STATE') * 16 + sym('NIB_BSLANE');
const BS_NONE = sym('BS_NONE');
const STATE = sym('FILE_STATE') * 16 + sym('NIB_STATE');
const BS_LO = sym('FILE_TIME') * 16 + sym('NIB_BS_LO');
const BS_HI = sym('FILE_TIME') * 16 + sym('NIB_BS_HI');


const board = new Board(romImage(asm));

const LEVER = ['up', 'centre', 'down'];
const NO_FIRE = process.env.NO_FIRE === '1';
let slice = 0;

type Edge = { cycle: number; level: number };
const edges: Edge[] = [];

// grid-on samples: cycle -> whether any grid was lit
const dark: Array<[number, number]> = []; // [startCycle, endCycle] of dark runs
let darkStart: number | null = null;

const laneLog: Array<{ cycle: number; lane: number }> = [];
const stateLog: Array<{ cycle: number; st: number }> = [];
let lastState = -1;
let lastLane = -1;

const TOTAL_CYCLES = Math.round(CYCLE_HZ * 90);
const STEP = 200;
while (board.cycles < TOTAL_CYCLES) {
  board.step(STEP);
  slice += 1;
  const lane = board.cpu.memory.readRam(BSLANE);
  const crossing = lane !== BS_NONE;
  board.setControl('lever', LEVER[Math.floor(slice / 2) % 3] as string);
  // Hold fire while the boat is up AND while its countdown is nearly out, so a
  // missile already in flight cannot shoot it down. Reading RAM is allowed; a
  // probe may look at the tube, it may not write game state.
  const due = board.cpu.memory.readRam(BS_HI) * 16 + board.cpu.memory.readRam(BS_LO);
  const nearlyDue = !crossing && due < 6;
  board.setControl('fire', !NO_FIRE && !crossing && !nearlyDue && slice % 2 === 0 ? 'down' : 'up');

  const st = board.cpu.memory.readRam(STATE);
  if (st !== lastState) { stateLog.push({ cycle: board.cycles, st }); lastState = st; }
  if (lane !== lastLane) {
    if (lastLane !== -1) laneLog.push({ cycle: board.cycles, lane });
    lastLane = lane;
  }
  for (const e of board.speaker.edges) edges.push({ cycle: e.cycle, level: e.level });
  board.speaker.clear();
  const lit = board.display.gridMask !== 0;
  if (!lit && darkStart === null) darkStart = board.cycles;
  if (lit && darkStart !== null) {
    dark.push([darkStart, board.cycles]);
    darkStart = null;
  }
}

const ms = (c: number): number => (c / CYCLE_HZ) * 1000;
console.log('lane transitions:', laneLog.map((e) => `${(ms(e.cycle)/1000).toFixed(2)}s->${e.lane}`).join('  '));
console.log('total speaker edges:', edges.length);
console.log('state transitions:', stateLog.map((e) => `${(ms(e.cycle)/1000).toFixed(2)}s->${e.st}`).join('  '));


// --- crossings ---
const arrivals = laneLog.filter((e, i) => e.lane !== BS_NONE && (i === 0 || laneLog[i - 1]!.lane === BS_NONE));
const departures = laneLog.filter((e, i) => e.lane === BS_NONE && i > 0 && laneLog[i - 1]!.lane !== BS_NONE);
console.log('arrivals at (s):', arrivals.map((a) => (ms(a.cycle) / 1000).toFixed(2)).join(', '));
for (let i = 0; i < Math.min(arrivals.length, departures.length); i++) {
  console.log(`  crossing ${i}: ${(ms(departures[i]!.cycle - arrivals[i]!.cycle) / 1000).toFixed(2)} s`);
}
for (let i = 1; i < arrivals.length; i++) {
  console.log(`  onset->onset ${i}: ${(ms(arrivals[i]!.cycle - arrivals[i - 1]!.cycle) / 1000).toFixed(2)} s`);
}
for (const d of departures) {
  console.log(`  scheduled gap at ${(ms(d.cycle)/1000).toFixed(2)}s: countdown reloaded, see below`);
}
for (let i = 0; i < departures.length && i + 1 < arrivals.length; i++) {
  console.log(`  gap ${i} (leave->next onset): ${(ms(arrivals[i + 1]!.cycle - departures[i]!.cycle) / 1000).toFixed(2)} s`);
}

// --- buzz pitch during the first crossing ---
if (arrivals.length && departures.length) {
  const a = arrivals[0]!.cycle;
  const d = departures[0]!.cycle;
  const inCrossing = edges.filter((e) => e.cycle >= a && e.cycle <= d);
  const rising = inCrossing.filter((e) => e.level === 1).map((e) => e.cycle);
  const periods: number[] = [];
  for (let i = 1; i < rising.length; i++) periods.push(rising[i]! - rising[i - 1]!);
  periods.sort((x, y) => x - y);
  const med = periods[Math.floor(periods.length / 2)] ?? 0;
  console.log(`buzz: ${inCrossing.length} edges in crossing 0, median period ${med} cycles = ${(CYCLE_HZ / med).toFixed(1)} Hz`);
  console.log(`      period spread: min ${periods[0]} max ${periods[periods.length - 1]} cycles`);
  const all = inCrossing.map((e) => e.cycle);
  let maxSilence = 0;
  for (let i = 1; i < all.length; i++) maxSilence = Math.max(maxSilence, all[i]! - all[i - 1]!);
  console.log(`      longest silence inside the crossing: ${ms(maxSilence).toFixed(1)} ms (edge to edge)`);
  const buzzHz = periods.filter((c) => c > 2000).map((c) => CYCLE_HZ / c);
  console.log(`      buzz-only periods: n=${buzzHz.length}, ${Math.min(...buzzHz).toFixed(1)}-${Math.max(...buzzHz).toFixed(1)} Hz`);
  // Dark runs that OVERLAP the window, clipped to it. A note started from
  // `tick` begins its blank in the inter-sweep gap a few hundred cycles before
  // the lane nibble changes, so a `start >= arrival` filter misses the very
  // blank this change is about.
  const clip = (from: number, to: number): number[] =>
    dark.filter(([s2, e2]) => e2 > from && s2 < to).map(([s2, e2]) => Math.min(e2, to) - Math.max(s2, from));
  const inside = clip(a, d);
  const worst = inside.reduce((m, v) => Math.max(m, v), 0);
  console.log(`worst display blank inside crossing 0: ${ms(worst).toFixed(1)} ms over ${inside.length} dark runs`);
  const atArrival = clip(a, a + CYCLE_HZ * 0.6);
  console.log(`  worst blank in the 600 ms AFTER arrival: ${ms(atArrival.reduce((m, v) => Math.max(m, v), 0)).toFixed(1)} ms`);
  const darkTotal = inside.reduce((m, v) => m + v, 0);
  console.log(`  tube dark for ${(100 * darkTotal / (d - a)).toFixed(1)}% of the crossing`);
}
const worstAll = dark.reduce((m, [s, e]) => Math.max(m, e - s), 0);
console.log(`worst display blank over the whole ${(ms(board.cycles) / 1000).toFixed(0)} s run: ${ms(worstAll).toFixed(1)} ms`);
const over = stateLog.find((e) => e.st !== 0);
if (over) {
  const after = edges.filter((e) => e.cycle > over.cycle);
  console.log(`edges after game over (${(ms(over.cycle)/1000).toFixed(2)}s): ${after.length}`);
  if (after.length) {
    console.log(`  first ${(ms(after[0]!.cycle)/1000).toFixed(2)}s  last ${(ms(after[after.length-1]!.cycle)/1000).toFixed(2)}s`);
  }
  console.log(`  BSLANE at end: ${board.cpu.memory.readRam(BSLANE)} (BS_NONE=${BS_NONE}), NIB_BUZZ at end: ${board.cpu.memory.readRam(sym('FILE_SOUND')*16+sym('NIB_BUZZ'))}`);
}
console.log(`frames: ${board.display.frameCount}, mean sweep ${(ms(board.cycles) / board.display.frameCount).toFixed(2)} ms`);
