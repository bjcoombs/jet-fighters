import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRESCALER_SELECT,
  INTERRUPT_LINE_COUNT,
  prescalerDivider,
  PRESCALER_SELECT_COUNT,
  Timer,
  TIMER_MASK,
  TIMER_MODULUS,
} from './timer.js';

describe('Timer - reset state', () => {
  it('comes up cleared, at one cycle per tick, with both lines idle high', () => {
    const timer = new Timer();
    const state = timer.snapshot();

    expect(state.counter).toBe(0);
    expect(state.prescalerSelect).toBe(DEFAULT_PRESCALER_SELECT);
    expect(state.timerFlag).toBe(false);
    expect(state.counterMode).toBe(false);
    expect(state.interruptEnabled).toBe(false);
    expect(state.interruptFlags).toEqual([false, false]);
    expect(state.interruptLines).toEqual([1, 1]);
    expect(timer.prescalerDivider).toBe(1);
  });

  it('returns to that state from anywhere', () => {
    const timer = new Timer();
    timer.setPrescalerSelect(7);
    timer.setCounterMode(true);
    timer.setInterruptEnabled(true);
    timer.setInterruptFlag(1, true);
    timer.load(9);

    timer.reset();

    expect(timer.snapshot()).toEqual(new Timer().snapshot());
  });
});

describe('Timer - counting', () => {
  it('counts one machine cycle per tick at the default ratio', () => {
    const timer = new Timer();
    timer.tick(5);
    expect(timer.counter).toBe(5);
  });

  it('divides by 2^select', () => {
    for (let select = 0; select < PRESCALER_SELECT_COUNT; select += 1) {
      expect(prescalerDivider(select)).toBe(2 ** select);

      const timer = new Timer();
      timer.setPrescalerSelect(select);
      timer.tick(prescalerDivider(select) * 3);
      expect(timer.counter).toBe(3);
    }
  });

  it('keeps the remainder between ticks', () => {
    const timer = new Timer();
    timer.setPrescalerSelect(3); // eight cycles per tick
    timer.tick(5);
    expect(timer.counter).toBe(0);
    timer.tick(3);
    expect(timer.counter).toBe(1);
    expect(timer.snapshot().prescalerCount).toBe(0);
  });

  it('reaches the same counter in one long tick as in many short ones', () => {
    const longRun = new Timer();
    const shortRuns = new Timer();
    longRun.setPrescalerSelect(2);
    shortRuns.setPrescalerSelect(2);

    longRun.tick(100);
    for (let cycle = 0; cycle < 100; cycle += 1) {
      shortRuns.tick(1);
    }

    expect(shortRuns.snapshot()).toEqual(longRun.snapshot());
  });

  it('ignores a zero or negative cycle count', () => {
    const timer = new Timer();
    timer.tick(0);
    timer.tick(-4);
    expect(timer.counter).toBe(0);
  });

  it('wraps at sixteen and sets the timer flag', () => {
    const timer = new Timer();
    timer.tick(TIMER_MODULUS - 1);
    expect(timer.counter).toBe(TIMER_MASK);
    expect(timer.timerFlag).toBe(false);

    timer.tick(1);
    expect(timer.counter).toBe(0);
    expect(timer.timerFlag).toBe(true);
    expect(timer.overflows).toBe(1);
  });

  it('keeps the timer flag until it is explicitly reset', () => {
    const timer = new Timer();
    timer.tick(TIMER_MODULUS * 3);
    expect(timer.timerFlag).toBe(true);
    expect(timer.overflows).toBe(3);

    timer.setTimerFlag(false);
    expect(timer.timerFlag).toBe(false);

    timer.tick(TIMER_MODULUS);
    expect(timer.timerFlag).toBe(true);
  });

  it('loads the counter and restarts the prescaler', () => {
    const timer = new Timer();
    timer.setPrescalerSelect(4);
    timer.tick(8); // half way to the next tick
    timer.load(0x0e);

    expect(timer.counter).toBe(0x0e);
    expect(timer.snapshot().prescalerCount).toBe(0);

    timer.tick(prescalerDivider(4) * 2);
    expect(timer.counter).toBe(0);
    expect(timer.timerFlag).toBe(true);
  });

  it('masks a load to four bits', () => {
    const timer = new Timer();
    timer.load(0xff);
    expect(timer.counter).toBe(TIMER_MASK);
  });
});

describe('Timer - counter mode', () => {
  it('stops counting machine cycles once CF is set', () => {
    const timer = new Timer();
    timer.setCounterMode(true);
    timer.tick(1000);
    expect(timer.counter).toBe(0);
  });

  it('counts falling edges on INT0 instead', () => {
    const timer = new Timer();
    timer.setCounterMode(true);

    timer.setInterruptLine(0, 0);
    timer.setInterruptLine(0, 1);
    timer.setInterruptLine(0, 0);

    expect(timer.counter).toBe(2);
  });

  it('counts an edge only on the fall, not on the level', () => {
    const timer = new Timer();
    timer.setCounterMode(true);
    timer.setInterruptLine(0, 0);
    timer.setInterruptLine(0, 0);
    expect(timer.counter).toBe(1);
  });

  it('does not count INT1 edges', () => {
    const timer = new Timer();
    timer.setCounterMode(true);
    timer.setInterruptLine(1, 0);
    expect(timer.counter).toBe(0);
  });

  it('resumes prescaler counting when CF is cleared', () => {
    const timer = new Timer();
    timer.setCounterMode(true);
    timer.tick(10);
    timer.setCounterMode(false);
    timer.tick(10);
    expect(timer.counter).toBe(10);
  });
});

describe('Timer - interrupt flags and lines', () => {
  it('raises a request flag on a falling edge', () => {
    const timer = new Timer();
    timer.setInterruptLine(0, 0);

    expect(timer.interruptFlag(0)).toBe(true);
    expect(timer.interruptLine(0)).toBe(0);
    expect(timer.interruptFlag(1)).toBe(false);
  });

  it('leaves the flag raised when the line goes back high', () => {
    const timer = new Timer();
    timer.setInterruptLine(1, 0);
    timer.setInterruptLine(1, 1);

    expect(timer.interruptLine(1)).toBe(1);
    expect(timer.interruptFlag(1)).toBe(true);
  });

  it('reads back the level of a line held low', () => {
    const timer = new Timer();
    timer.setInterruptLine(0, 0);
    timer.setInterruptFlag(0, false);
    expect(timer.interruptLine(0)).toBe(0);
    expect(timer.interruptFlag(0)).toBe(false);
  });

  it('carries the master enable independently of the flags', () => {
    const timer = new Timer();
    timer.setInterruptEnabled(true);
    expect(timer.interruptEnabled).toBe(true);
    expect(timer.interruptFlag(0)).toBe(false);
  });

  it('rejects a line the device does not have', () => {
    const timer = new Timer();
    for (const line of [-1, INTERRUPT_LINE_COUNT, 1.5]) {
      expect(() => timer.interruptFlag(line)).toThrow(RangeError);
      expect(() => timer.setInterruptLine(line, 0)).toThrow(RangeError);
    }
  });
});

describe('Timer - pending', () => {
  it('is quiet at reset', () => {
    expect(new Timer().pending).toBe(false);
  });

  it('reports a timer overflow', () => {
    const timer = new Timer();
    timer.tick(TIMER_MODULUS);
    expect(timer.pending).toBe(true);
  });

  it('reports an interrupt request on either line', () => {
    for (let line = 0; line < INTERRUPT_LINE_COUNT; line += 1) {
      const timer = new Timer();
      timer.setInterruptLine(line, 0);
      expect(timer.pending).toBe(true);
    }
  });

  it('does not consult the master enable', () => {
    const timer = new Timer();
    timer.setInterruptEnabled(false);
    timer.setInterruptFlag(0, true);
    expect(timer.pending).toBe(true);
  });

  it('goes quiet again once the flags are cleared', () => {
    const timer = new Timer();
    timer.tick(TIMER_MODULUS);
    timer.setInterruptLine(0, 0);

    timer.setTimerFlag(false);
    timer.setInterruptFlag(0, false);

    expect(timer.pending).toBe(false);
  });
});
