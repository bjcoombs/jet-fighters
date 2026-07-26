// HMCS44 (Hitachi HD38800) timer, prescaler and interrupt-flag block.
//
// Sources. PRD R1 lists "timer/prescaler, external interrupt line" as part of
// the core and fixes the oscillator at ~400 kHz; the instruction set names the
// timer loads, the flag set/reset pairs and the flag tests. What our source
// material does *not* settle is the counter width, the prescaler ratio ladder,
// which edge the event counter counts, or the interrupt vector addresses. This
// module therefore implements a stated model and says so at each point rather
// than inventing databook precision:
//
// - The counter is 4 bits, because the instructions that load it (LTI, LTA) and
//   read it back (LAT) move a nibble.
// - The prescaler divides machine cycles by 2^select, select 0-15, so LTI/LPI
//   can span 1 cycle to 32768 cycles per tick. The ladder is this repo's.
// - In counter mode (CF set by SECF) the counter is clocked by falling edges on
//   INT0 instead of by the prescaler. Falling is the choice; our material does
//   not name the edge.
// - Interrupt *requests* are modelled as flags the ROM tests (TIF0, TIF1, TTF)
//   and as the condition that ends standby. Automatic vectoring is deliberately
//   absent: the vector addresses are not in our source material, and the game
//   program is a polled master loop (PRD R3), so inventing entry points would
//   add unverifiable behaviour the ROM never uses.
//
// Pure state only: no DOM, no timers, no Web APIs. Nothing here has its own
// clock - `tick()` is driven by executed machine cycles from cpu.ts.

import { NIBBLE_MASK } from './registers.js';

/** The timer/counter is four bits wide, like every other data path on the chip. */
export const TIMER_MASK = NIBBLE_MASK;

/** Counter value the timer wraps at. */
export const TIMER_MODULUS = TIMER_MASK + 1;

/** Prescaler divide-ratio selectors LPI accepts: 0-15. */
export const PRESCALER_SELECT_COUNT = 16;

/** Prescaler ratio at reset: one timer tick per machine cycle. */
export const DEFAULT_PRESCALER_SELECT = 0;

/** The two external interrupt lines, INT0 and INT1. */
export const INTERRUPT_LINE_COUNT = 2;

/**
 * Machine cycles per timer tick for a divide-ratio selector.
 *
 * A 2^n ladder over the 4-bit selector: 1 cycle to 32768 cycles per tick, which
 * at the documented ~400 kHz oscillator spans 2.5 us to 82 ms per tick and so
 * covers everything from a sound-frequency toggle to a game-second timeout.
 */
export function prescalerDivider(select: number): number {
  return 1 << (select & TIMER_MASK);
}

/** Immutable snapshot of the timer block, for tests and debug UIs. */
export interface TimerSnapshot {
  /** 4-bit timer/counter. */
  readonly counter: number;
  /** Prescaler divide-ratio selector, 0-15. */
  readonly prescalerSelect: number;
  /** Machine cycles accumulated toward the next tick. */
  readonly prescalerCount: number;
  /** Timer overflow flag TF. */
  readonly timerFlag: boolean;
  /** Counter mode flag CF: true when the timer counts INT0 edges. */
  readonly counterMode: boolean;
  /** Master interrupt enable IE. */
  readonly interruptEnabled: boolean;
  /** Interrupt request flags IF0 and IF1. */
  readonly interruptFlags: readonly boolean[];
  /** Observed level of the INT0 and INT1 pins. */
  readonly interruptLines: readonly number[];
  /** Timer overflows since reset. */
  readonly overflows: number;
}

/**
 * The timer/counter, its prescaler, and the interrupt flags.
 *
 * Advanced only by `tick()`, which cpu.ts calls with the cycles an instruction
 * cost, so the timer keeps emulated time with the CPU and keeps running while
 * the CPU is in standby - which is the whole point of SBY.
 */
export class Timer {
  private _counter = 0;
  private _prescalerSelect = DEFAULT_PRESCALER_SELECT;
  private _prescalerCount = 0;
  private _timerFlag = false;
  private _counterMode = false;
  private _interruptEnabled = false;
  private readonly _interruptFlags = [false, false];
  private readonly _interruptLines = [1, 1];
  private _overflows = 0;

  constructor() {
    this.reset();
  }

  /** 4-bit timer/counter, as LAT reads it. */
  get counter(): number {
    return this._counter;
  }

  /** Prescaler divide-ratio selector, as LPI sets it. */
  get prescalerSelect(): number {
    return this._prescalerSelect;
  }

  /** Machine cycles per timer tick at the current selector. */
  get prescalerDivider(): number {
    return prescalerDivider(this._prescalerSelect);
  }

  /** Timer overflow flag TF, as TTF tests it. */
  get timerFlag(): boolean {
    return this._timerFlag;
  }

  /** Counter mode flag CF: true when INT0 edges clock the counter. */
  get counterMode(): boolean {
    return this._counterMode;
  }

  /** Master interrupt enable IE. */
  get interruptEnabled(): boolean {
    return this._interruptEnabled;
  }

  /** Timer overflows since reset. */
  get overflows(): number {
    return this._overflows;
  }

  /**
   * Power-on state: counter cleared, prescaler at one cycle per tick, every flag
   * clear, both interrupt lines idle high.
   *
   * The lines rest at 1 to match ports.ts, where an undriven open-drain pin
   * floats high; an interrupt is therefore a fall to 0.
   */
  reset(): void {
    this._counter = 0;
    this._prescalerSelect = DEFAULT_PRESCALER_SELECT;
    this._prescalerCount = 0;
    this._timerFlag = false;
    this._counterMode = false;
    this._interruptEnabled = false;
    this._interruptFlags[0] = false;
    this._interruptFlags[1] = false;
    this._interruptLines[0] = 1;
    this._interruptLines[1] = 1;
    this._overflows = 0;
  }

  /** Load the counter (LTI, LTA). Resets the prescaler so the next tick is full. */
  load(value: number): void {
    this._counter = value & TIMER_MASK;
    this._prescalerCount = 0;
  }

  /** Select the prescaler divide ratio (LPI). */
  setPrescalerSelect(select: number): void {
    this._prescalerSelect = select & TIMER_MASK;
    this._prescalerCount = 0;
  }

  /** Set or clear the timer overflow flag (SETF, RETF). */
  setTimerFlag(value: boolean): void {
    this._timerFlag = value;
  }

  /** Select timer mode or event-counter mode (RECF, SECF). */
  setCounterMode(value: boolean): void {
    this._counterMode = value;
    this._prescalerCount = 0;
  }

  /** Set or clear the master interrupt enable (SEIE, REIE). */
  setInterruptEnabled(value: boolean): void {
    this._interruptEnabled = value;
  }

  /** Read an interrupt request flag (TIF0, TIF1). */
  interruptFlag(line: number): boolean {
    return this._interruptFlags[assertLine(line)] ?? false;
  }

  /** Set or clear an interrupt request flag (SEIF0/1, REIF0/1). */
  setInterruptFlag(line: number, value: boolean): void {
    this._interruptFlags[assertLine(line)] = value;
  }

  /** Observed level of an interrupt pin (TI0, TI1). */
  interruptLine(line: number): number {
    return this._interruptLines[assertLine(line)] ?? 1;
  }

  /**
   * Drive an interrupt pin from the board.
   *
   * A falling edge raises that line's request flag, and on INT0 in counter mode
   * it also clocks the counter - the two roles the pin has.
   */
  setInterruptLine(line: number, level: number): void {
    const index = assertLine(line);
    const next = level ? 1 : 0;
    const previous = this._interruptLines[index] ?? 1;
    this._interruptLines[index] = next;
    if (previous === 1 && next === 0) {
      this._interruptFlags[index] = true;
      if (index === 0 && this._counterMode) {
        this.count();
      }
    }
  }

  /**
   * Advance the prescaler by executed machine cycles.
   *
   * A no-op in counter mode: there the counter is clocked by INT0 edges, not by
   * the passage of time. Costs are accumulated exactly, so a long `run()` and
   * many short `step()`s produce the same counter value.
   */
  tick(cycles: number): void {
    if (this._counterMode || cycles <= 0) {
      return;
    }
    const divider = this.prescalerDivider;
    this._prescalerCount += cycles;
    while (this._prescalerCount >= divider) {
      this._prescalerCount -= divider;
      this.count();
    }
  }

  /**
   * Advance the counter one step, setting TF on the wrap past 15.
   *
   * TF is sticky: only RETF clears it. A ROM that polls TTF therefore cannot
   * miss an overflow that happened between two polls.
   */
  count(): void {
    this._counter = (this._counter + 1) & TIMER_MASK;
    if (this._counter === 0) {
      this._timerFlag = true;
      this._overflows += 1;
    }
  }

  /**
   * True when something the timer block owns is asking for attention.
   *
   * This is what ends standby (SBY): a timer overflow or either interrupt
   * request. It deliberately does not consult IE, so the ROM can use SBY as a
   * timed wait without enabling interrupts - a stated choice, since our source
   * material does not settle whether a masked request releases standby.
   */
  get pending(): boolean {
    return this._timerFlag || this._interruptFlags[0] === true || this._interruptFlags[1] === true;
  }

  /** Immutable snapshot for tests, `CPUState`, and future debug tooling. */
  snapshot(): TimerSnapshot {
    return {
      counter: this._counter,
      prescalerSelect: this._prescalerSelect,
      prescalerCount: this._prescalerCount,
      timerFlag: this._timerFlag,
      counterMode: this._counterMode,
      interruptEnabled: this._interruptEnabled,
      interruptFlags: [...this._interruptFlags],
      interruptLines: [...this._interruptLines],
      overflows: this._overflows,
    };
  }
}

function assertLine(line: number): number {
  if (!Number.isInteger(line) || line < 0 || line >= INTERRUPT_LINE_COUNT) {
    throw new RangeError(
      `Interrupt line out of range: ${line} (expected 0..${INTERRUPT_LINE_COUNT - 1})`,
    );
  }
  return line;
}
