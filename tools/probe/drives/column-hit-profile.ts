// Where do kills actually land when you aim at one column? Fires only at planes
// standing in the chosen column and records the column each kill scored in.
//
// Written against the ROM with the missile at its measured 500 ms a column, and
// **rebased onto the two-plane model** - see the note on `planeRowOn` below for
// what it was reading before and why the numbers underneath it were gone.
//
// It is the evidence for two findings, and **both survive the rebase**:
//
//   - The launch cell is hit-tested. Aiming only at grid 5 takes **53 kills in
//     76 shots, all but one at grid 5**, where it took none before the
//     `missile_step` reorder.
//   - Aiming at grid 1 lands every kill one cell later - **6 shots, 5 kills, all
//     at grid 2** - because the shot cannot arrive before the plane has marched
//     on. Grid 1 is also the rarest cell to be offered a shot at, which is why
//     the sample is small: a plane there is one march step from the G line.
//
// Those are re-derived numbers. The ones first quoted for these findings -
// "27 kills in 40 shots", "20 shots, 20 kills" - were taken against the lane
// rank and this drive cannot produce them. Re-read rather than trust.
//
// Paths in this file are relative to the repository root.

import { Tms1370Machine, assembleGame, planesOf, squadronMap } from '../tms1370-probe.js';
const FILE_STATE = 4, FILE_MISS = 7, CYCLE_HZ = 58333, DODGE = 4;
const at = (f: number, n: number, r: Uint8Array) => r[f * 16 + n];
// The shot's column lives in FILE_MISS, one nibble per lane. This drive only
// asks "is a shot up", which is now a question about the whole rank.
const shotCol = (r: Uint8Array) =>
  Math.max(...[0, 1, 2].map((l) => at(FILE_MISS, l, r) as number));
// **This drive used to read `ram[FILE_JETS * 16 + lane]`**, the lane rank, where
// the nibble was the column and a lane held at most one jet. The rank is gone -
// the squadron is two (row, column) pairs and those nibbles are free - so the
// read returned 0 for every lane, `jets.indexOf(target)` never matched, and the
// drive fired **0 shots at every column**. It printed "no kills" five times and
// looked like a finding.
const SQUADRON = squadronMap(assembleGame());
/** The row holding a plane on exactly `column`, or -1. Both slots are searched. */
const planeRowOn = (r: Uint8Array, column: number) =>
  planesOf(r, SQUADRON).find((plane) => plane.column === column)?.row ?? -1;
/** Per row, the deepest column a plane stands on in it - 0 for an empty row. */
const deepestByRow = (r: Uint8Array) => {
  const planes = planesOf(r, SQUADRON);
  return [0, 1, 2].map((row) =>
    planes.reduce((deep, p) => (p.row === row ? Math.max(deep, p.column) : deep), 0),
  );
};
for (const target of [1, 2, 3, 4, 5]) {
  const m = new Tms1370Machine();
  m.setContacts({ skill: 1, lane: 0, fire: false });
  const byGrid = new Map<number, number>();
  let prevScore = 0, shots = 0;
  for (let i = 0; i < 20 * 300; i++) {
    const ram = m.ram;
    const rows = deepestByRow(ram);
    const mcol = shotCol(ram);
    if (mcol !== 0) {
      const rl = at(FILE_STATE, 7, ram) !== 0 ? at(FILE_STATE, 8, ram) : -1;
      const safe = [0, 1, 2].find((l) => (rows[l] as number) < DODGE && l !== rl);
      if (safe !== undefined) m.setContacts({ lane: safe, fire: false });
    } else {
      const lane = planeRowOn(ram, target);
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
