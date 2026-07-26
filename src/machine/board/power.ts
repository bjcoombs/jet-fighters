// The power switch - the only reset path this machine has.
//
// Sources: 4 x AA cells feed a DC-DC converter for the filament and the -24 to
// -30 V grid/anode bias, and the switch cuts the battery outright. There is no
// reset line and no reset button: RAM contents die with the supply, and that IS
// the reset - docs/prd/jet-fighters-v2.md (Technical Context, R4).
//
// Powering on therefore has two distinct steps, and this module keeps them
// distinct because the ROM depends on the difference. The supply arriving leaves
// PMOS RAM in an undefined state (memory.ts fills it with a deliberately
// non-zero pattern rather than pretending it is zeroed), and the game program's
// own power-on routine is what clears it. `powerOn()` performs both because the
// board owns the whole transition, and `powerOnUncleared()` stops after the
// first so a test - or a ROM being verified against real power-on behaviour -
// can observe the undefined window.
//
// Pure state only: no DOM, no timers, no Web APIs. Nothing here has its own
// clock - the switch is thrown by the caller, not by elapsed time.

import type { HMCS44CPU } from '../cpu/cpu.js';
import type { Display } from './display.js';
import type { Speaker } from './speaker.js';

/** Position of the power switch. */
export type PowerState = 'on' | 'off';

/** What the switch controls. Structural, so tests can pass fakes. */
export interface PoweredMachine {
  readonly cpu: HMCS44CPU;
  readonly display: Display;
  readonly speaker: Speaker;
}

/**
 * The case's power switch.
 *
 * Off: the CPU halts where it stands, RAM is invalidated, the tube goes dark and
 * the speaker falls silent. Nothing is preserved - there is no standby state and
 * no saved score, which is why the real unit's high score dies with the battery.
 *
 * On: the core resets, RAM comes up undefined and is then cleared, and the tube
 * and speaker start from blank. Cycle counting restarts at 0, which is why the
 * display and speaker are told to clear rather than merely to blank: their cycle
 * accounting has to rewind with the CPU's.
 */
export class PowerSwitch {
  private _state: PowerState;

  /**
   * @param machine the CPU, display and speaker the switch feeds.
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
   * Throw the switch on: core reset, RAM undefined then cleared, tube blank.
   *
   * Throwing it on while it is already on is a full restart, because that is
   * what the switch does - there is nothing else it could mean.
   */
  on(): void {
    this.powerOnUncleared();
    this.machine.cpu.memory.clearRam();
  }

  /**
   * Power on and stop before the RAM clear.
   *
   * The state a real device is in for the few milliseconds between the supply
   * settling and the ROM's clear loop finishing: RAM holds the undefined
   * power-on pattern. Exposed so that window is observable rather than a
   * side effect nothing can inspect.
   */
  powerOnUncleared(): void {
    const { cpu, display, speaker } = this.machine;
    // `reset()` already leaves the core running - the supply arriving is what
    // starts it, and there is no run/halt control on the case.
    cpu.reset();
    display.clear();
    speaker.reset();
    this._state = 'on';
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
    cpu.stop();
    cpu.memory.powerOff();
    display.clear();
    speaker.reset();
    this._state = 'off';
  }
}
