// Where do kills actually land when you aim at one column? Fires only at jets
// standing in the chosen column and records the column each kill scored in.
//
// Written against the ROM with the missile at its measured 500 ms a column. It
// is the evidence for two findings: that the launch cell is hit-tested (grid 5
// takes 27 kills in 40 shots, where it took none before the reorder), and that
// aiming at grid 1 lands every kill one cell later - 20 shots, 20 kills, all at
// grid 2 - because the shot cannot arrive before the jet has marched on.

import { Tms1370Machine } from '../tms1370-probe.js';
const FILE_STATE = 4, FILE_JETS = 6, FILE_MISS = 7, CYCLE_HZ = 58333, DODGE = 4;
const at = (f: number, n: number, r: Uint8Array) => r[f * 16 + n];
// The shot's column lives in FILE_MISS, one nibble per lane. This drive only
// asks "is a shot up", which is now a question about the whole rank.
const shotCol = (r: Uint8Array) =>
  Math.max(...[0, 1, 2].map((l) => at(FILE_MISS, l, r) as number));
for (const target of [1, 2, 3, 4, 5]) {
  const m = new Tms1370Machine();
  m.setContacts({ skill: 1, lane: 0, fire: false });
  const byGrid = new Map<number, number>();
  let prevScore = 0, shots = 0;
  for (let i = 0; i < 20 * 300; i++) {
    const ram = m.ram;
    const jets = [0, 1, 2].map((l) => at(FILE_JETS, l, ram));
    const mcol = shotCol(ram);
    if (mcol !== 0) {
      const rl = at(FILE_STATE, 7, ram) !== 0 ? at(FILE_STATE, 8, ram) : -1;
      const safe = [0, 1, 2].find((l) => (jets[l] as number) < DODGE && l !== rl);
      if (safe !== undefined) m.setContacts({ lane: safe, fire: false });
    } else {
      const lane = jets.indexOf(target);
      if (lane >= 0) { m.setContacts({ lane, fire: true }); shots++; }
    }
    m.step(CYCLE_HZ / 20);
    m.setContacts({ fire: false });
    const r2 = m.ram;
    const sc = at(5, 12, r2) * 100 + at(5, 11, r2) * 10 + at(5, 10, r2);
    if (sc !== prevScore) { const g = at(FILE_STATE, 14, r2) - 1; byGrid.set(g, (byGrid.get(g) ?? 0) + 1); prevScore = sc; }
    if (at(FILE_STATE, 11, r2) !== 0) break;
  }
  const hits = [...byGrid].sort((a,b)=>a[0]-b[0]).map(([g,n])=>`g${g}:${n}`).join(' ');
  console.log(`aiming only at grid ${target}: ${shots} shots -> ${hits || 'no kills'}`);
}
