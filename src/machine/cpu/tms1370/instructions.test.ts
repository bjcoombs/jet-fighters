// Per-opcode semantics for the standard TMS1100 instruction set, by TMS1000-family
// mnemonic.
//
// Semantics come from TI's Table 3 (S3 section 3.2) as transcribed in
// docs/research/tms1370-architecture.md section 5, cross-checked there against
// MAME with no disagreement on any mnemonic present in both. The opcodes in the
// microinstruction-defined half of the map are the **standard set**: confirming
// MP2110's own decode needs tms1100_common2_micro.pla, which this project has
// not obtained, and contract V13 is recorded undriven for that reason. No test
// here asserts a PLA decode was read.

import { beforeEach, describe, expect, it } from 'vitest';

import { Tms1370Cpu, type Tms1370CpuOptions } from './cpu.js';
import { encodeInstruction, Mnemonic } from './isa.js';
import { Tms1370Rom } from './memory.js';
import { Tms1370OutputPla } from './opla.js';
import { RESET_CHAPTER, RESET_PAGE, pcForOrdinal } from './registers.js';

/** Assemble words onto the reset page at their LFSR offsets, and build a core. */
function coreRunning(words: number[], options: Omit<Tms1370CpuOptions, 'rom'> = {}): Tms1370Cpu {
  const rom = new Tms1370Rom();
  words.forEach((word, ordinal) => {
    rom.writeAt(RESET_CHAPTER, RESET_PAGE, pcForOrdinal(ordinal), word);
  });
  return new Tms1370Cpu({ ...options, rom });
}

/** A core holding one instruction, ready to step. */
function coreFor(mnemonic: Mnemonic, value?: number, options?: Omit<Tms1370CpuOptions, 'rom'>) {
  return coreRunning([encodeInstruction(mnemonic, value)], options);
}

describe('register transfer', () => {
  it('TAY moves A into Y', () => {
    const cpu = coreFor(Mnemonic.TAY);
    cpu.registers.a = 0b1011;
    cpu.step();
    expect(cpu.registers.y).toBe(0b1011);
  });

  it('TYA moves Y into A', () => {
    const cpu = coreFor(Mnemonic.TYA);
    cpu.registers.y = 0b0110;
    cpu.step();
    expect(cpu.registers.a).toBe(0b0110);
  });

  it('CLA clears A', () => {
    const cpu = coreFor(Mnemonic.CLA);
    cpu.registers.a = 0xf;
    cpu.step();
    expect(cpu.registers.a).toBe(0);
  });

  it('TCY loads Y with a constant', () => {
    const cpu = coreFor(Mnemonic.TCY, 9);
    cpu.step();
    expect(cpu.registers.y).toBe(9);
  });
});

describe('register to memory', () => {
  it('TAM writes A to M(X:Y)', () => {
    const cpu = coreFor(Mnemonic.TAM);
    cpu.registers.x = 5;
    cpu.registers.y = 3;
    cpu.registers.a = 7;
    cpu.step();
    expect(cpu.ram.read(5, 3)).toBe(7);
  });

  it('TAMZA writes A to M and then clears A', () => {
    const cpu = coreFor(Mnemonic.TAMZA);
    cpu.registers.a = 0xc;
    cpu.step();
    expect(cpu.ram.read(0, 0)).toBe(0xc);
    expect(cpu.registers.a).toBe(0);
  });

  it('TAMIYC writes A to M, increments Y, and reports the carry in status', () => {
    const cpu = coreFor(Mnemonic.TAMIYC);
    cpu.registers.y = 15;
    cpu.registers.a = 2;
    cpu.step();
    expect(cpu.ram.read(0, 15)).toBe(2);
    expect(cpu.registers.y).toBe(0);
    expect(cpu.registers.status).toBe(1);
  });

  it('TAMDYN writes A to M, decrements Y, and clears status on the borrow', () => {
    const cpu = coreFor(Mnemonic.TAMDYN);
    cpu.registers.y = 0;
    cpu.registers.a = 2;
    cpu.step();
    expect(cpu.ram.read(0, 0)).toBe(2);
    expect(cpu.registers.y).toBe(15);
    expect(cpu.registers.status).toBe(0);
  });

  it('TCMIY writes a constant to M and increments Y without touching status', () => {
    // Unlike IYC, TCMIY carries no status microinstruction: the wrap is silent.
    const cpu = coreFor(Mnemonic.TCMIY, 0xd);
    cpu.registers.y = 15;
    cpu.step();
    expect(cpu.ram.read(0, 15)).toBe(0xd);
    expect(cpu.registers.y).toBe(0);
    expect(cpu.registers.status).toBe(1);
  });
});

describe('memory to register', () => {
  it('TMA moves M into A', () => {
    const cpu = coreFor(Mnemonic.TMA);
    cpu.registers.x = 2;
    cpu.registers.y = 4;
    cpu.ram.write(2, 4, 0xe);
    cpu.step();
    expect(cpu.registers.a).toBe(0xe);
  });

  it('TMY moves M into Y', () => {
    const cpu = coreFor(Mnemonic.TMY);
    cpu.ram.write(0, 0, 6);
    cpu.step();
    expect(cpu.registers.y).toBe(6);
  });

  it('XMA exchanges M and A', () => {
    const cpu = coreFor(Mnemonic.XMA);
    cpu.registers.a = 3;
    cpu.ram.write(0, 0, 0xa);
    cpu.step();
    expect(cpu.registers.a).toBe(0xa);
    expect(cpu.ram.read(0, 0)).toBe(3);
  });
});

describe('arithmetic', () => {
  it('AMAAC adds M to A and reports the carry', () => {
    const cpu = coreFor(Mnemonic.AMAAC);
    cpu.registers.a = 9;
    cpu.ram.write(0, 0, 8);
    cpu.step();
    expect(cpu.registers.a).toBe(1);
    expect(cpu.registers.status).toBe(1);
  });

  it('AMAAC leaves status clear when the sum fits', () => {
    const cpu = coreFor(Mnemonic.AMAAC);
    cpu.registers.a = 2;
    cpu.ram.write(0, 0, 3);
    cpu.step();
    expect(cpu.registers.a).toBe(5);
    expect(cpu.registers.status).toBe(0);
  });

  it('SAMAN subtracts A from M, setting status when A <= M', () => {
    const cpu = coreFor(Mnemonic.SAMAN);
    cpu.registers.a = 4;
    cpu.ram.write(0, 0, 9);
    cpu.step();
    expect(cpu.registers.a).toBe(5);
    expect(cpu.registers.status).toBe(1);
  });

  it('SAMAN clears status on a borrow', () => {
    const cpu = coreFor(Mnemonic.SAMAN);
    cpu.registers.a = 9;
    cpu.ram.write(0, 0, 4);
    cpu.step();
    expect(cpu.registers.a).toBe(0xb);
    expect(cpu.registers.status).toBe(0);
  });

  it('IMAC increments M into A', () => {
    const cpu = coreFor(Mnemonic.IMAC);
    cpu.ram.write(0, 0, 15);
    cpu.step();
    expect(cpu.registers.a).toBe(0);
    expect(cpu.registers.status).toBe(1);
  });

  it('DMAN decrements M into A', () => {
    const cpu = coreFor(Mnemonic.DMAN);
    cpu.ram.write(0, 0, 5);
    cpu.step();
    expect(cpu.registers.a).toBe(4);
    expect(cpu.registers.status).toBe(1);
  });

  it('DMAN clears status when M was already zero', () => {
    const cpu = coreFor(Mnemonic.DMAN);
    cpu.ram.write(0, 0, 0);
    cpu.step();
    expect(cpu.registers.a).toBe(15);
    expect(cpu.registers.status).toBe(0);
  });

  it('IYC increments Y and reports the wrap', () => {
    const cpu = coreFor(Mnemonic.IYC);
    cpu.registers.y = 15;
    cpu.step();
    expect(cpu.registers.y).toBe(0);
    expect(cpu.registers.status).toBe(1);
  });

  it('DYN decrements Y and clears status on the borrow', () => {
    const cpu = coreFor(Mnemonic.DYN);
    cpu.registers.y = 0;
    cpu.step();
    expect(cpu.registers.y).toBe(15);
    expect(cpu.registers.status).toBe(0);
  });

  it('CPAIZ complements and increments A, setting status only when A was zero', () => {
    const zero = coreFor(Mnemonic.CPAIZ);
    zero.registers.a = 0;
    zero.step();
    expect(zero.registers.a).toBe(0);
    expect(zero.registers.status).toBe(1);

    const three = coreFor(Mnemonic.CPAIZ);
    three.registers.a = 3;
    three.step();
    expect(three.registers.a).toBe(13);
    expect(three.registers.status).toBe(0);
  });

  it('AnAAC covers every addend 1-15 exactly once', () => {
    // Research doc section 5: opcodes 0x70-0x7E add the bit-reversed operand
    // plus one, so the fifteen non-zero addends appear once each in scrambled
    // order. TI names A1AAC "IAC" and A15AAC "DAN"; there is no A0AAC.
    const addends = new Set<number>();
    for (let addend = 1; addend <= 15; addend += 1) {
      const cpu = coreFor(Mnemonic.ANAAC, addend);
      cpu.registers.a = 0;
      cpu.step();
      expect(cpu.registers.a).toBe(addend);
      addends.add(addend);
    }
    expect(addends.size).toBe(15);
  });

  it('IAC is A1AAC at 0x70 and DAN is A15AAC at 0x77', () => {
    expect(encodeInstruction(Mnemonic.ANAAC, 1)).toBe(0x70);
    expect(encodeInstruction(Mnemonic.ANAAC, 15)).toBe(0x77);

    const increment = coreFor(Mnemonic.ANAAC, 1);
    increment.registers.a = 15;
    increment.step();
    expect(increment.registers.a).toBe(0);
    expect(increment.registers.status).toBe(1);

    // Adding 15 is subtracting 1 in four bits - the family's decrement.
    const decrement = coreFor(Mnemonic.ANAAC, 15);
    decrement.registers.a = 5;
    decrement.step();
    expect(decrement.registers.a).toBe(4);
    expect(decrement.registers.status).toBe(1);
  });
});

describe('compare', () => {
  it('ALEM sets status when A <= M', () => {
    for (const [a, m, expected] of [
      [3, 5, 1],
      [5, 5, 1],
      [6, 5, 0],
      [0, 0, 1],
      [15, 0, 0],
    ] as const) {
      const cpu = coreFor(Mnemonic.ALEM);
      cpu.registers.a = a;
      cpu.ram.write(0, 0, m);
      cpu.step();
      expect(cpu.registers.status, `ALEM A=${a} M=${m}`).toBe(expected);
      expect(cpu.registers.a, 'ALEM does not write A').toBe(a);
    }
  });

  it('MNEA sets status when M differs from A', () => {
    const same = coreFor(Mnemonic.MNEA);
    same.registers.a = 6;
    same.ram.write(0, 0, 6);
    same.step();
    expect(same.registers.status).toBe(0);

    const differs = coreFor(Mnemonic.MNEA);
    differs.registers.a = 6;
    differs.ram.write(0, 0, 7);
    differs.step();
    expect(differs.registers.status).toBe(1);
  });

  it('MNEZ sets status when M is non-zero', () => {
    const zero = coreFor(Mnemonic.MNEZ);
    zero.step();
    expect(zero.registers.status).toBe(0);

    const nonZero = coreFor(Mnemonic.MNEZ);
    nonZero.ram.write(0, 0, 1);
    nonZero.step();
    expect(nonZero.registers.status).toBe(1);
  });

  it('YNEC sets status when Y differs from the constant', () => {
    const equal = coreFor(Mnemonic.YNEC, 4);
    equal.registers.y = 4;
    equal.step();
    expect(equal.registers.status).toBe(0);

    const differs = coreFor(Mnemonic.YNEC, 4);
    differs.registers.y = 5;
    differs.step();
    expect(differs.registers.status).toBe(1);
  });

  it('YNEA compares Y with A and loads the status latch', () => {
    // The only instruction that loads the status latch, and therefore the only
    // way the fifth bit of the O register index is ever set.
    const differs = coreFor(Mnemonic.YNEA);
    differs.registers.y = 1;
    differs.registers.a = 2;
    differs.step();
    expect(differs.registers.status).toBe(1);
    expect(differs.registers.statusLatch).toBe(1);

    const equal = coreFor(Mnemonic.YNEA);
    equal.registers.y = 2;
    equal.registers.a = 2;
    equal.registers.statusLatch = 1;
    equal.step();
    expect(equal.registers.status).toBe(0);
    expect(equal.registers.statusLatch).toBe(0);
  });
});

describe('bit addressing', () => {
  it('SBIT sets one bit of the addressed nibble', () => {
    for (let bit = 0; bit < 4; bit += 1) {
      const cpu = coreFor(Mnemonic.SBIT, bit);
      cpu.step();
      expect(cpu.ram.read(0, 0)).toBe(1 << bit);
    }
  });

  it('RBIT resets one bit of the addressed nibble', () => {
    for (let bit = 0; bit < 4; bit += 1) {
      const cpu = coreFor(Mnemonic.RBIT, bit);
      cpu.ram.write(0, 0, 0xf);
      cpu.step();
      expect(cpu.ram.read(0, 0)).toBe(0xf & ~(1 << bit));
    }
  });

  it('TBIT tests one bit into status', () => {
    for (let bit = 0; bit < 4; bit += 1) {
      const set = coreFor(Mnemonic.TBIT, bit);
      set.ram.write(0, 0, 1 << bit);
      set.step();
      expect(set.registers.status).toBe(1);

      const clear = coreFor(Mnemonic.TBIT, bit);
      clear.ram.write(0, 0, 0xf & ~(1 << bit));
      clear.step();
      expect(clear.registers.status).toBe(0);
    }
  });
});

describe('RAM file addressing', () => {
  it('LDX loads all eight file numbers', () => {
    for (let file = 0; file < 8; file += 1) {
      const cpu = coreFor(Mnemonic.LDX, file);
      cpu.step();
      expect(cpu.registers.x).toBe(file);
    }
  });

  it('COMX complements only the MSB of X, not the whole register', () => {
    // This is the single most load-bearing difference from the TMS1000, where
    // COMX complements all of X (research doc section 5). Getting it wrong moves
    // a display sweep four RAM files sideways.
    for (const [before, after] of [
      [0b000, 0b100],
      [0b100, 0b000],
      [0b011, 0b111],
      [0b111, 0b011],
      [0b101, 0b001],
    ] as const) {
      const cpu = coreFor(Mnemonic.COMX);
      cpu.registers.x = before;
      cpu.step();
      expect(cpu.registers.x, `COMX ${before.toString(2)}`).toBe(after);
    }
  });
});

describe('input', () => {
  it('TKA reads the K port into A', () => {
    const cpu = coreFor(Mnemonic.TKA, undefined, { pins: { readK: () => 0b1010 } });
    cpu.step();
    expect(cpu.registers.a).toBe(0b1010);
  });

  it('KNEZ sets status when any K line is closed', () => {
    const open = coreFor(Mnemonic.KNEZ, undefined, { pins: { readK: () => 0 } });
    open.step();
    expect(open.registers.status).toBe(0);

    const closed = coreFor(Mnemonic.KNEZ, undefined, { pins: { readK: () => 0b0100 } });
    closed.step();
    expect(closed.registers.status).toBe(1);
  });

  it('reads K as open when nothing is wired to the pins', () => {
    const cpu = coreFor(Mnemonic.TKA);
    cpu.step();
    expect(cpu.registers.a).toBe(0);
  });
});

describe('output', () => {
  it('SETR sets the R output selected by Y, and RSTR resets it', () => {
    const set = coreRunning([encodeInstruction(Mnemonic.SETR)]);
    set.registers.y = 9;
    set.step();
    expect(set.registers.getR(9)).toBe(true);
    expect(set.r).toBe(1 << 9);

    const reset = coreRunning([encodeInstruction(Mnemonic.RSTR)]);
    reset.registers.y = 9;
    reset.registers.setR(9, true);
    reset.step();
    expect(reset.registers.getR(9)).toBe(false);
  });

  it('reports each R latch change to the pins', () => {
    const writes: Array<[number, boolean]> = [];
    const cpu = coreRunning([encodeInstruction(Mnemonic.SETR)], {
      pins: { writeR: (index, on) => writes.push([index, on]) },
    });
    writes.length = 0;
    cpu.registers.y = 15;
    cpu.step();
    expect(writes).toEqual([[15, true]]);
  });

  it('drops a SETR issued with X >= 4, which addresses an R line that does not exist', () => {
    // MAME's TMS1100-family override computes index = BIT(X,2) << 4 | Y, and TI
    // states the programmer must keep X below four (research doc section 3). On
    // a 16-output part the index that produces is out of range, so the write
    // goes nowhere rather than wrapping onto a real output. The assembler is the
    // right place to make the mistake impossible; this is what the core does
    // meanwhile.
    const cpu = coreRunning([encodeInstruction(Mnemonic.SETR)]);
    cpu.registers.x = 4;
    cpu.registers.y = 3;
    cpu.step();
    expect(cpu.r).toBe(0);
  });

  it('TDO writes the O register with the status_latch:accumulator index', () => {
    const pla = new Tms1370OutputPla(Array.from({ length: 32 }, (_unused, i) => (i * 5) & 0xff));
    const cpu = coreRunning([encodeInstruction(Mnemonic.TDO)], { outputPla: pla });
    cpu.registers.a = 0b0110;
    cpu.registers.statusLatch = 1;
    cpu.step();
    expect(cpu.oIndex).toBe(0b10110);
    expect(cpu.oLines).toBe(pla.decode(0b10110));
  });

  it('clears O with TDO at A = 0 and the latch clear, because there is no CLO', () => {
    const pla = new Tms1370OutputPla(Array.from({ length: 32 }, (_unused, i) => (i === 0 ? 0 : 0xff)));
    const cpu = coreRunning(
      [encodeInstruction(Mnemonic.TDO), encodeInstruction(Mnemonic.CLA), encodeInstruction(Mnemonic.TDO)],
      { outputPla: pla },
    );
    cpu.registers.a = 5;
    cpu.step();
    expect(cpu.oLines).toBe(0xff);
    cpu.step();
    cpu.step();
    expect(cpu.oIndex).toBe(0);
    expect(cpu.oLines).toBe(0);
  });
});

describe('ROM addressing', () => {
  it('LDP loads the page buffer without moving the page', () => {
    const cpu = coreFor(Mnemonic.LDP, 6);
    const page = cpu.registers.pa;
    cpu.step();
    expect(cpu.registers.pb).toBe(6);
    expect(cpu.registers.pa).toBe(page);
  });

  it('COMC complements the chapter buffer without moving the chapter', () => {
    const cpu = coreRunning([encodeInstruction(Mnemonic.COMC), encodeInstruction(Mnemonic.COMC)]);
    expect(cpu.registers.cb).toBe(0);
    cpu.step();
    expect(cpu.registers.cb).toBe(1);
    expect(cpu.registers.ca).toBe(0);
    cpu.step();
    expect(cpu.registers.cb).toBe(0);
  });
});

describe('instruction cost', () => {
  let cpu: Tms1370Cpu;

  beforeEach(() => {
    cpu = coreRunning(
      Array.from({ length: 8 }, () => encodeInstruction(Mnemonic.CLA)),
    );
  });

  it('costs exactly one instruction cycle, whatever the instruction', () => {
    // "All instructions are executed in one instruction cycle" (S3 section 2.8).
    // There is no multi-cycle instruction and no multi-word instruction on this
    // core, so this holds across the whole map rather than per row.
    expect(cpu.step()).toBe(1);
    expect(cpu.cycles).toBe(1);
    expect(cpu.run(4)).toBe(4);
    expect(cpu.cycles).toBe(5);
  });
});
