import { describe, it, expect } from 'vitest';

import {
  GRID_COUNT,
  K1,
  K2,
  K4,
  K8,
  K_STROBED_MASK,
  K_UNSTROBED_MASK,
  O_PLATE_COUNT,
  PLATE_COUNT,
  PLATE_MASK,
  R_GRID_FIRST,
  R_GRID_LAST,
  R_GRID_MASK,
  R_PIN_COUNT,
  R_PLATE_COUNT,
  R_PLATE_FIRST,
  R_PLATE_LAST,
  R_PLATE_MASK,
  R_PLATE_SHIFT,
  R_SPEAKER,
  R_STROBE_FIRST,
  R_STROBE_LAST,
  STROBE_COLUMN_COUNT,
  STROBED_CONTACT_LATENCY_READS,
  Tms1370Ports,
  UNSTROBED_CONTACT_LATENCY_READS,
  type KInputSource,
} from './ports.js';

/** A K source that reports what it was asked, so a test can see the wiring. */
class SpyInputs implements KInputSource {
  readonly columnsRead: number[] = [];
  unstrobedReads = 0;

  constructor(
    private readonly columns: readonly number[] = [0, 0],
    private unstrobed = 0,
  ) {}

  readColumn(column: number): number {
    this.columnsRead.push(column);
    return this.columns[column] ?? 0;
  }

  readUnstrobed(): number {
    this.unstrobedReads += 1;
    return this.unstrobed;
  }

  press(lines: number): void {
    this.unstrobed = lines;
  }
}

describe('the TMS1370 pin budget', () => {
  it('accounts for every one of the 16 R pins exactly once', () => {
    // The claim docs/research/tms1370-io.md section 1 rests on: "16 R + 8 O,
    // nothing spare. That the allocation is exactly full is itself evidence the
    // reading is right." A split that left a pin unexplained, or gave one to two
    // roles, fails here - and the board carries no second IC to take up slack.
    const roles = [R_GRID_MASK, 0x0600, R_PLATE_MASK, 0x8000];
    let union = 0;
    for (const role of roles) {
      expect(union & role, 'two roles claim the same pin').toBe(0);
      union |= role;
    }
    expect(union).toBe(0xffff);
    expect(R_PIN_COUNT).toBe(16);
  });

  it('scans nine grids on R0-R8, not the v2 machine\'s ten', () => {
    expect(R_GRID_FIRST).toBe(0);
    expect(R_GRID_LAST).toBe(8);
    expect(GRID_COUNT).toBe(9);
    expect(R_GRID_MASK).toBe(0x01ff);
  });

  it('drives twelve plates: eight from the O port and four from R11-R14', () => {
    expect(O_PLATE_COUNT).toBe(8);
    expect(R_PLATE_FIRST).toBe(11);
    expect(R_PLATE_LAST).toBe(14);
    expect(R_PLATE_COUNT).toBe(4);
    expect(PLATE_COUNT).toBe(12);
    expect(PLATE_MASK).toBe(0x0fff);
    // MAME writes the high four as `data >> 3 & 0xf00`; the 3 is this.
    expect(R_PLATE_SHIFT).toBe(3);
  });

  it('puts the speaker on R15 and the strobe columns on R9 and R10', () => {
    expect(R_SPEAKER).toBe(15);
    expect(R_STROBE_FIRST).toBe(9);
    expect(R_STROBE_LAST).toBe(10);
    expect(STROBE_COLUMN_COUNT).toBe(2);
  });
});

describe('Tms1370Ports - reset and R latches', () => {
  it('comes up with every latch clear: dark tube, speaker at rest', () => {
    const ports = new Tms1370Ports();
    expect(ports.r).toBe(0);
    expect(ports.o).toBe(0);
    expect(ports.readGrids()).toBe(0);
    expect(ports.readPlates()).toBe(0);
    expect(ports.readInputMux()).toBe(0);
    expect(ports.readSpeaker()).toBe(0);
  });

  it('sets and resets one R line at a time, as SETR and RSTR do', () => {
    const ports = new Tms1370Ports();
    ports.setR(3);
    ports.setR(7);
    expect(ports.r).toBe((1 << 3) | (1 << 7));
    ports.resetR(3);
    expect(ports.r).toBe(1 << 7);
    expect(ports.readR(7)).toBe(1);
    expect(ports.readR(3)).toBe(0);
  });

  it('rejects an R index off the end of the port', () => {
    const ports = new Tms1370Ports();
    expect(() => ports.setR(R_PIN_COUNT)).toThrow(RangeError);
    expect(() => ports.resetR(-1)).toThrow(RangeError);
    expect(() => ports.readR(1.5)).toThrow(RangeError);
  });

  it('reports every pin that moved, and only those', () => {
    const ports = new Tms1370Ports();
    const seen: [number, number][] = [];
    ports.onRChange = (pin, value) => seen.push([pin, value]);
    ports.setR(2);
    ports.setR(2);
    ports.resetR(2);
    expect(seen).toEqual([
      [2, 1],
      [2, 0],
    ]);
  });

  it('separates R lines driven from grids driven', () => {
    // The distinction that did not exist on the v2 machine, where the grids had
    // a port to themselves. Here the speaker, both strobe columns and the grids
    // are bits of one latch, so a caller asking "which grids" must not be handed
    // R9, R10 or R15.
    const ports = new Tms1370Ports();
    ports.setR(0);
    ports.setR(9);
    ports.setR(15);
    expect(ports.r).toBe(0x8201);
    expect(ports.readGrids()).toBe(0x0001);
    expect(ports.readSpeaker()).toBe(1);
    expect(ports.readInputMux()).toBe(0b01);
  });
});

describe('Tms1370Ports - the display matrix', () => {
  it('assembles twelve plates from the O port and R11-R14', () => {
    const ports = new Tms1370Ports();
    ports.writeO(0b1010_0101);
    expect(ports.readPlates()).toBe(0b0000_1010_0101);
    ports.setR(11);
    ports.setR(14);
    expect(ports.readPlates()).toBe(0b1001_1010_0101);
    ports.resetR(11);
    expect(ports.readPlates()).toBe(0b1000_1010_0101);
  });

  it('keeps the O port and the R plates independent, as two writes do', () => {
    const ports = new Tms1370Ports();
    ports.setR(R_PLATE_FIRST);
    expect(ports.readPlates()).toBe(1 << O_PLATE_COUNT);
    ports.writeO(0xff);
    // Writing O does not disturb the high four - MAME's
    // `m_plate = (m_plate & ~0xff) | data`.
    expect(ports.readPlates()).toBe(PLATE_MASK & ((1 << O_PLATE_COUNT) | 0xff));
  });

  it('reports an O change once per distinct pattern', () => {
    const ports = new Tms1370Ports();
    const seen: number[] = [];
    ports.onOChange = (pattern) => seen.push(pattern);
    ports.writeO(0x0f);
    ports.writeO(0x0f);
    ports.writeO(0x00);
    expect(seen).toEqual([0x0f, 0x00]);
  });

  it('never lets a grid line reach the plate bus, or the reverse', () => {
    const ports = new Tms1370Ports();
    for (let grid = 0; grid < GRID_COUNT; grid += 1) {
      ports.setR(grid);
    }
    expect(ports.readPlates()).toBe(0);
    ports.reset();
    for (let pin = R_PLATE_FIRST; pin <= R_PLATE_LAST; pin += 1) {
      ports.setR(pin);
    }
    expect(ports.readGrids()).toBe(0);
  });
});

describe('Tms1370Ports - the input strobe columns', () => {
  it('reads a contact back only while its own column is driven', () => {
    const inputs = new SpyInputs([K2, K4]);
    const ports = new Tms1370Ports();

    expect(ports.readK(inputs)).toBe(0);

    ports.setR(R_STROBE_FIRST);
    expect(ports.readK(inputs)).toBe(K2);

    ports.resetR(R_STROBE_FIRST);
    ports.setR(R_STROBE_LAST);
    expect(ports.readK(inputs)).toBe(K4);
  });

  it('wired-ORs both columns when both are up, which is why the ROM must not', () => {
    // `read_inputs` in hh_tms1k.cpp is a plain OR over the selected columns. The
    // hardware does not object to both being up - it superimposes them - so the
    // model must not object either. What it must do is make the state visible.
    const inputs = new SpyInputs([K1, K4]);
    const ports = new Tms1370Ports();
    ports.setR(R_STROBE_FIRST);
    ports.setR(R_STROBE_LAST);

    expect(ports.hasSuperimposedStrobe()).toBe(true);
    expect(ports.strobeColumnsDriven()).toBe(2);
    // Skill 1 and lever-down come back on one nibble and cannot be told apart.
    expect(ports.readK(inputs)).toBe(K1 | K4);
  });

  it('drives at most one strobe column on any cycle of a well-formed sweep', () => {
    // Contract V7's first conjunct. The sweep below is the shape a TMS1370 scan
    // loop has to take: nine grid dwells, then each input column raised on its
    // own with the other explicitly dropped first. Checked on every transition,
    // not only at the end of each dwell - a loop that raised R10 before dropping
    // R9 would satisfy an end-of-dwell check and still superimpose.
    const ports = new Tms1370Ports();
    const inputs = new SpyInputs([K2, K2]);
    let worstColumnsDriven = 0;
    const observe = (): void => {
      worstColumnsDriven = Math.max(worstColumnsDriven, ports.strobeColumnsDriven());
    };
    ports.onRChange = observe;

    for (let sweep = 0; sweep < 3; sweep += 1) {
      for (let grid = 0; grid < GRID_COUNT; grid += 1) {
        ports.setR(grid);
        observe();
        ports.resetR(grid);
        observe();
      }
      for (let column = 0; column < STROBE_COLUMN_COUNT; column += 1) {
        for (let other = 0; other < STROBE_COLUMN_COUNT; other += 1) {
          if (other !== column) ports.resetR(R_STROBE_FIRST + other);
        }
        ports.setR(R_STROBE_FIRST + column);
        observe();
        ports.readK(inputs);
        ports.resetR(R_STROBE_FIRST + column);
        observe();
      }
    }

    expect(worstColumnsDriven).toBeLessThanOrEqual(1);
    expect(ports.hasSuperimposedStrobe()).toBe(false);
  });

  it('consults each driven column once and no undriven one', () => {
    const inputs = new SpyInputs([K1, K2]);
    const ports = new Tms1370Ports();
    ports.setR(R_STROBE_LAST);
    ports.readK(inputs);
    expect(inputs.columnsRead).toEqual([1]);
    expect(inputs.unstrobedReads).toBe(1);
  });
});

describe('Tms1370Ports - K8, the line no column selects', () => {
  it('reads the fire contact while both strobe columns are low', () => {
    // Contract V7's second conjunct, and the whole practical content of "K8 is
    // unstrobed": `read_k()` ORs the button in unconditionally. A build routing
    // fire through R9 or R10 returns 0 here, because neither column is up.
    const inputs = new SpyInputs([K1, K1]);
    inputs.press(K8);
    const ports = new Tms1370Ports();

    expect(ports.readInputMux()).toBe(0);
    expect(ports.readK(inputs)).toBe(K8);
    expect(inputs.columnsRead, 'no column was consulted').toEqual([]);
  });

  it('reads the fire contact under either column as well as under neither', () => {
    const inputs = new SpyInputs([K1, K4]);
    inputs.press(K8);
    const ports = new Tms1370Ports();

    ports.setR(R_STROBE_FIRST);
    expect(ports.readK(inputs)).toBe(K8 | K1);
    ports.resetR(R_STROBE_FIRST);
    ports.setR(R_STROBE_LAST);
    expect(ports.readK(inputs)).toBe(K8 | K4);
  });

  it('costs one K read to see fire and up to one per column to see the rest', () => {
    // Not a timing constant - a count of K reads, which is what the difference
    // between a strobed and an unstrobed contact actually is on this chip.
    expect(UNSTROBED_CONTACT_LATENCY_READS).toBe(1);
    expect(STROBED_CONTACT_LATENCY_READS).toBe(STROBE_COLUMN_COUNT);
    expect(STROBED_CONTACT_LATENCY_READS).toBeGreaterThan(UNSTROBED_CONTACT_LATENCY_READS);

    // Driven rather than asserted from the constants: a contact on column 1 is
    // invisible on the read that selects column 0, and fire is visible on both.
    const inputs = new SpyInputs([0, K4]);
    inputs.press(K8);
    const ports = new Tms1370Ports();
    const reads: number[] = [];
    for (let column = 0; column < STROBE_COLUMN_COUNT; column += 1) {
      ports.writeR(0);
      ports.setR(R_STROBE_FIRST + column);
      reads.push(ports.readK(inputs));
    }
    expect(reads.filter((k) => (k & K8) !== 0)).toHaveLength(STROBE_COLUMN_COUNT);
    expect(reads.filter((k) => (k & K4) !== 0)).toHaveLength(1);
  });

  it('keeps K8 out of the strobed lines and the strobed lines out of K8', () => {
    expect(K_UNSTROBED_MASK).toBe(K8);
    expect(K_STROBED_MASK).toBe(K1 | K2 | K4);
    expect(K_STROBED_MASK & K_UNSTROBED_MASK).toBe(0);

    // A source that wrongly offers K8 on a column cannot smuggle it through, and
    // one that wrongly offers K1 unstrobed cannot either.
    const ports = new Tms1370Ports();
    ports.setR(R_STROBE_FIRST);
    expect(ports.readK(new SpyInputs([K8 | K1, 0]))).toBe(K1);
    expect(ports.readK(new SpyInputs([0, 0], K1 | K8))).toBe(K8);
  });
});

describe('Tms1370Ports - snapshot', () => {
  it('reports the whole observable port state', () => {
    const ports = new Tms1370Ports();
    ports.setR(4);
    ports.setR(12);
    ports.setR(R_STROBE_LAST);
    ports.setR(R_SPEAKER);
    ports.writeO(0x3c);

    expect(ports.snapshot()).toEqual({
      r: (1 << 4) | (1 << 12) | (1 << 10) | (1 << 15),
      o: 0x3c,
      grids: 1 << 4,
      plates: (1 << 9) | 0x3c,
      inputMux: 0b10,
      speaker: 1,
    });
  });

  it('clears every latch on reset', () => {
    const ports = new Tms1370Ports();
    ports.writeR(0xffff);
    ports.writeO(0xff);
    ports.reset();
    expect(ports.snapshot()).toEqual({
      r: 0,
      o: 0,
      grids: 0,
      plates: 0,
      inputMux: 0,
      speaker: 0,
    });
  });
});
