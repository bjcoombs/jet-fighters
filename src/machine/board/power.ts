// The power switch - the only reset path this machine has.
//
// Sources: 4 x AA cells feed a DC-DC converter for the filament and the -24 to
// -30 V grid/anode bias, and the switch cuts the battery outright. There is no
// reset line and no reset button: RAM contents die with the supply, and that IS
// the reset - docs/prd/jet-fighters-v2.md (Technical Context, R4), a fact about
// the case rather than about the chip inside it, and unchanged by the v3
// rebuild.
//
// The supply arriving leaves the 128x4 PMOS RAM in an undefined state, and the
// game program's own power-on routine is what clears it. This module models that
// literally: {@link PowerSwitch.on} installs the undefined pattern and does not
// clear it. Clearing 128 nibbles costs real instruction time before the first
// display sweep, and hiding that cost would hide a power-on garbage flash the
// hardware actually has - which is what contract V2's paired RAM assertions
// exist to catch.
//
// The core itself has no halt. There is no STOP instruction on this family and
// no run/halt control on the case, so "the machine is stopped" is a fact about
// the switch and lives here; `Board.step` reads it and executes nothing while
// the switch is off.
//
// Pure state only: no DOM, no timers, no Web APIs. Nothing here has its own
// clock - the switch is thrown by the caller, not by elapsed time.

import type { Tms1370Cpu } from '../cpu/tms1370/cpu.js';
import type { Display } from './display.js';
import type { Speaker } from './speaker.js';

/**
 * The nibble every RAM cell holds when the supply arrives.
 *
 * Deliberately not zero. Power-up contents are not established by any source
 * read for this project (docs/research/tms1370-architecture.md section 3), so
 * the honest model is arbitrary contents the program has to clear - and a fill
 * of zero would let a ROM that forgot to clear RAM pass anyway.
 */
export const RAM_POWER_ON_FILL = 0x0a;

/** Position of the power switch. */
export type PowerState = 'on' | 'off';

/** What the switch controls. Structural, so tests can pass fakes. */
export interface PoweredMachine {
  readonly cpu: Tms1370Cpu;
  readonly display: Display;
  readonly speaker: Speaker;
  /**
   * Called after the switch has moved, before control returns to the caller.
   *
   * The board uses it to re-read the case contacts: a reset clears every R
   * latch, so which strobe column is up changes under the input matrix and the
   * board's cached view of the K lines has to move with it.
   */
  readonly onPowerChange?: (state: PowerState) => void;
}

/**
 * The case's power switch.
 *
 * Off: the core stops where it stands, RAM is invalidated, the tube goes dark
 * and the speaker falls silent. Nothing is preserved - there is no retained
 * state and no saved score, which is why the real unit's high score dies with
 * the battery.
 *
 * On: the core resets, RAM comes up undefined, and the tube and speaker start
 * from blank. Cycle counting restarts at 0, which is why the display and speaker
 * are told to clear rather than merely to blank: their cycle accounting has to
 * rewind with the core's.
 */
export class PowerSwitch {
  private _state: PowerState;

  /**
   * @param machine the core, display and speaker the switch feeds.
   * @param initial the position the switch starts in. Defaults to `off`, so a
   *   board is dark until something throws it - the machine does not power
   *   itself on.
   */
  constructor(
    private readonly machine: PoweredMachine,
    initial: PowerState = 'off',
  ) {
    this._state = 'off';
    this.applyOff();
    if (initial === 'on') {
      this.on();
    }
  }

  /** Position of the switch. */
  get state(): PowerState {
    return this._state;
  }

  /** True while the machine is powered. */
  get isOn(): boolean {
    return this._state === 'on';
  }

  /**
   * Throw the switch on: core reset, RAM undefined, tube blank.
   *
   * Throwing it on while it is already on is a full restart, because that is
   * what the switch does - there is nothing else it could mean.
   *
   * RAM is left holding {@link RAM_POWER_ON_FILL}. The ROM's own clear routine
   * is what zeroes it, and it runs on emulated instruction time like every other
   * part of the program.
   */
  on(): void {
    const { cpu, display, speaker } = this.machine;
    cpu.ram.powerOn(RAM_POWER_ON_FILL);
    // `reset()` leaves the core ready to execute - the supply arriving is what
    // starts it, and there is no run/halt control on the case. It does not touch
    // RAM, which is the whole reason the fill above is applied first.
    cpu.reset();
    display.clear();
    speaker.reset();
    this._state = 'on';
    this.machine.onPowerChange?.('on');
  }

  /** Throw the switch off: everything stops, RAM dies, the tube goes dark. */
  off(): void {
    this.applyOff();
  }

  /** Off then on - the restart the player performs to begin a new game. */
  cycle(): void {
    this.off();
    this.on();
  }

  private applyOff(): void {
    const { cpu, display, speaker } = this.machine;
    cpu.ram.powerOn(RAM_POWER_ON_FILL);
    display.clear();
    speaker.reset();
    this._state = 'off';
    this.machine.onPowerChange?.('off');
  }
}
