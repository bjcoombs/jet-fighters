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

import { Tms1370Machine } from '../tms1370-probe.js';
const FILE_STATE = 4, FILE_TIME = 5, FILE_JETS = 6, CYCLE_HZ = 58333, DODGE = 4;
const at = (f: number, n: number, r: Uint8Array) => r[f * 16 + n];

for (const skill of [1, 2, 3]) {
  const m = new Tms1370Machine();
  m.setContacts({ skill, lane: 0, fire: false });
  let wanted = 1, over = 0, steps = 0, releases = 0;
  let prevJets = [0, 0, 0];
  let prevM = { col: 0, lane: -1 };
  let crossings = 0, sameCell = 0, flights = 0;
  for (let i = 0; i < 20 * 400 && over === 0; i++) {
    const ram = m.ram;
    const jets = [0, 1, 2].map((l) => at(FILE_JETS, l, ram));
    const mcol = at(FILE_STATE, 5, ram), mlane = at(FILE_STATE, 6, ram);
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
      const pref = jets.indexOf(wanted); wanted = (wanted % 5) + 1;
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
