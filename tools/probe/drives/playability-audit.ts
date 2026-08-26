// Is it a game? Win time, the skill spread, jet steps per release, launchers
// lost - and the crossing test: can a shot and a jet swap cells without ever
// being tested in the same one?
//
// Written against the ROM at the head of the branch that corrected the missile
// to its measured 500 ms a column and made `missile_step` test both the cell a
// shot leaves and the cell it arrives in. The four numbers it prints are the
// ones quoted for that change: 58 s to 292 s of win time, and jet steps per
// release from 0.07 to 2.17.
//
// The drive aims at the frontmost jet when no shot is in flight and steps out of
// a threatened lane while one is. That is deliberate and load-bearing: a drive
// that aims without dodging parks the lever in the lane it just fired at, which
// is where a capture lands, and dies faster than one that taps blindly.

import { Tms1370Machine, assembleGame, planesOf, squadronMap } from '../tms1370-probe.js';
const FILE_STATE = 4, FILE_TIME = 5, FILE_MISS = 7, CYCLE_HZ = 58333, DODGE = 4;
const at = (f: number, n: number, r: Uint8Array) => r[f * 16 + n];
// The shot's column lives in FILE_MISS, one nibble per lane, so the lane is the
// nibble holding it rather than a nibble of its own. One shot at a time still,
// so at most one lane answers - and -1 means no shot, as `prevM.lane` expects.
const shotLane = (r: Uint8Array) =>
  [0, 1, 2].find((l) => at(FILE_MISS, l, r) !== 0) ?? -1;
// **This drive used to read `ram[FILE_JETS * 16 + lane]`**, the lane rank, where
// the nibble was the column and a lane held at most one jet. The rank is gone -
// the squadron is two (row, column) pairs and those nibbles are free - so every
// read returned 0: `steps` and `releases` printed 0 on all three skills and the
// crossing test, which is this drive's whole subject, compared zeroes. The four
// numbers in the header were taken before that and are not re-derivable from the
// version that printed them.
//
// `deepestByRow` is the replacement and it is lossy in the one way the model
// allows: two planes can share a row and only the deeper is reported. That is
// right for a drive, whose job is to pick a row to shoot at and should pick the
// urgent one. It is not right for an assertion about the squadron, and nothing
// here makes one.
const SQUADRON = squadronMap(assembleGame());
const deepestByRow = (r: Uint8Array) => {
  const planes = planesOf(r, SQUADRON);
  return [0, 1, 2].map((row) =>
    planes.reduce((deep, p) => (p.row === row ? Math.max(deep, p.column) : deep), 0),
  );
};
/** The row holding a plane on exactly `column`, or -1. Both slots are searched. */
const planeRowOn = (r: Uint8Array, column: number) =>
  planesOf(r, SQUADRON).find((plane) => plane.column === column)?.row ?? -1;

for (const skill of [1, 2, 3]) {
  const m = new Tms1370Machine();
  m.setContacts({ skill, lane: 0, fire: false });
  let wanted = 1, over = 0, steps = 0, releases = 0;
  let prevJets = [0, 0, 0];
  let prevM = { col: 0, lane: -1 };
  let crossings = 0, sameCell = 0, flights = 0;
  for (let i = 0; i < 20 * 400 && over === 0; i++) {
    const ram = m.ram;
    const jets = deepestByRow(ram);
    const mlane = shotLane(ram);
    const mcol = mlane >= 0 ? (at(FILE_MISS, mlane, ram) as number) : 0;
    // march steps and releases
    jets.forEach((g, l) => {
      const p = prevJets[l] as number;
      if (p !== 0 && g === p + 1) steps++;
      if (p === 0 && g === 1) releases++;
    });
    // crossing: shot and jet in the same lane swap order without sharing a cell
    if (mcol !== 0 && prevM.col !== 0 && mlane === prevM.lane) {
      const j = jets[mlane] as number, pj = prevJets[mlane] as number;
      if (j !== 0 && pj !== 0) {
        if (mcol === j) sameCell++;
        else if ((prevM.col > pj && mcol < j) || (prevM.col < pj && mcol > j)) crossings++;
      }
    }
    if (mcol !== 0 && prevM.col === 0) flights++;
    prevJets = jets; prevM = { col: mcol, lane: mlane };
    // competent play: aim when free, dodge while the shot flies
    if (mcol !== 0) {
      const rl = at(FILE_STATE, 7, ram) !== 0 ? at(FILE_STATE, 8, ram) : -1;
      const safe = [0, 1, 2].find((l) => (jets[l] as number) < DODGE && l !== rl);
      if (safe !== undefined) m.setContacts({ lane: safe, fire: false });
    } else {
      const pref = planeRowOn(ram, wanted); wanted = (wanted % 5) + 1;
      const boat = at(FILE_STATE, 9, ram);
      const lane = pref >= 0 ? pref : boat !== 15 ? boat : jets.findIndex((g) => g !== 0);
      if (lane >= 0) m.setContacts({ lane, fire: true });
    }
    m.step(CYCLE_HZ / 20);
    m.setContacts({ fire: false });
    if (at(FILE_STATE, 11, m.ram) !== 0) over = m.cycles;
  }
  const r = m.ram, st = at(FILE_STATE, 11, r);
  const score = at(FILE_TIME, 12, r) * 100 + at(FILE_TIME, 11, r) * 10 + at(FILE_TIME, 10, r);
  console.log(`skill ${skill}: ${st === 2 ? 'WIN' : st === 1 ? 'game over' : 'alive'} ` +
    `${over ? (over / CYCLE_HZ).toFixed(1) + 's' : '400s+'}  score ${score}  lives lost ${at(FILE_STATE, 10, r)}  ` +
    `steps ${steps} / releases ${releases}  |  flights ${flights}, same-cell ${sameCell}, CROSSINGS ${crossings}`);
}
