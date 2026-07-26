// One test per instruction the architecture defines, plus the cross-cutting
// behaviour the game program depends on: carry propagation through a BCD chain,
// the four-level stack under a fifth call, illegal opcodes, and cycle counts.
//
// Every test runs its instruction through the real fetch-decode-execute path
// rather than calling a handler directly, so an encoding that decodes to the
// wrong instruction fails here as loudly as a wrong result would.
//
// `run()` records which mnemonic each test exercised; the last describe asserts
// that the set covers `ISA` exactly, so an instruction added without a test
// fails the suite instead of quietly shipping untested.

import { describe, it, expect } from 'vitest';
import { HMCS44CPU } from './cpu.js';
import { encode, encodeLong } from './decoder.js';
import { InstructionType } from './instruction.js';
import { ISA, isaEntryFor } from './isa.js';
import { RAM_FILE_SIZE, ROM_PROGRAM_SIZE, ROM_SIZE, romAddress } from './memory.js';
import { STACK_DEPTH } from './registers.js';
import { R_PORT_COUNT } from './ports.js';
import { TIMER_MODULUS } from './timer.js';

/** Mnemonics exercised so far, checked for completeness at the end of the file. */
const exercised = new Set<InstructionType>();

interface RunOptions {
  /** Operand for a one-word instruction. */
  readonly operand?: number;
  /** Target for a two-word instruction; makes the program two words. */
  readonly target?: number;
  /** Address to assemble the instruction at, and to start the PC from. */
  readonly at?: number;
  /** Seed the ROM image - the only way to reach the pattern region. */
  readonly rom?: (image: Uint16Array) => void;
  /** Seed machine state after RAM is cleared and before the instruction runs. */
  readonly before?: (cpu: HMCS44CPU) => void;
}

/**
 * Assemble one instruction, run it, and return the machine.
 *
 * RAM is cleared first: the power-on fill is deliberately junk (memory.ts), and
 * a test asserting on a nibble it never wrote should be asserting on a known
 * value.
 */
function run(type: InstructionType, options: RunOptions = {}): HMCS44CPU {
  exercised.add(type);

  const at = options.at ?? 0;
  const words =
    options.target === undefined
      ? [encode(type, options.operand ?? 0)]
      : [...encodeLong(type, options.target)];

  const image = new Uint16Array(ROM_SIZE);
  words.forEach((word, index) => {
    image[at + index] = word;
  });
  options.rom?.(image);

  const cpu = new HMCS44CPU(image);
  cpu.memory.clearRam();
  cpu.registers.pc = at;
  options.before?.(cpu);
  cpu.step();
  return cpu;
}

/** Point the RAM pointers at `file`:`digit` and put `value` there. */
function withRam(file: number, digit: number, value: number) {
  return (cpu: HMCS44CPU) => {
    cpu.registers.x = file;
    cpu.registers.y = digit;
    cpu.memory.writeRam(file * RAM_FILE_SIZE + digit, value);
  };
}

describe('instructions - control', () => {
  it('NOP changes nothing but the program counter', () => {
    const cpu = run(InstructionType.NOP, { before: (c) => (c.registers.a = 5) });
    expect(cpu.registers.a).toBe(5);
    expect(cpu.registers.carry).toBe(false);
    expect(cpu.registers.status).toBe(1);
    expect(cpu.registers.pc).toBe(1);
  });

  it('SBY stops the CPU clock without halting the core', () => {
    const cpu = run(InstructionType.SBY);
    expect(cpu.standby).toBe(true);
    expect(cpu.running).toBe(true);
  });

  it('STOP halts the oscillator', () => {
    const cpu = run(InstructionType.STOP);
    expect(cpu.running).toBe(false);
    expect(cpu.step()).toBe(0);
  });
});

describe('instructions - arithmetic on A', () => {
  it('AM adds M to A', () => {
    const cpu = run(InstructionType.AM, {
      before: (c) => {
        withRam(1, 2, 5)(c);
        c.registers.a = 3;
      },
    });
    expect(cpu.registers.a).toBe(8);
    expect(cpu.registers.carry).toBe(false);
  });

  it('AM carries out of bit 3', () => {
    const cpu = run(InstructionType.AM, {
      before: (c) => {
        withRam(0, 0, 0x0f)(c);
        c.registers.a = 2;
      },
    });
    expect(cpu.registers.a).toBe(1);
    expect(cpu.registers.carry).toBe(true);
  });

  it('AMC adds M and the carry to A', () => {
    const cpu = run(InstructionType.AMC, {
      before: (c) => {
        withRam(0, 3, 4)(c);
        c.registers.a = 3;
        c.registers.carry = true;
      },
    });
    expect(cpu.registers.a).toBe(8);
    expect(cpu.registers.carry).toBe(false);
  });

  it('SMC subtracts A from M, leaving the carry set when it did not borrow', () => {
    const cpu = run(InstructionType.SMC, {
      before: (c) => {
        withRam(0, 1, 9)(c);
        c.registers.a = 4;
        c.registers.carry = true;
      },
    });
    expect(cpu.registers.a).toBe(5);
    expect(cpu.registers.carry).toBe(true);
  });

  it('SMC clears the carry when the subtraction borrows', () => {
    const cpu = run(InstructionType.SMC, {
      before: (c) => {
        withRam(0, 1, 2)(c);
        c.registers.a = 5;
        c.registers.carry = true;
      },
    });
    expect(cpu.registers.a).toBe(0x0d);
    expect(cpu.registers.carry).toBe(false);
  });

  it('AI adds an immediate to A', () => {
    const cpu = run(InstructionType.AI, { operand: 6, before: (c) => (c.registers.a = 4) });
    expect(cpu.registers.a).toBe(0x0a);
    expect(cpu.registers.carry).toBe(false);
  });

  it('DAA corrects A after an addition', () => {
    const cpu = run(InstructionType.DAA, { before: (c) => (c.registers.a = 0x0f) });
    expect(cpu.registers.a).toBe(5);
    expect(cpu.registers.carry).toBe(true);
  });

  it('DAS corrects A after a subtraction that borrowed', () => {
    const cpu = run(InstructionType.DAS, {
      before: (c) => {
        c.registers.a = 0x0e;
        c.registers.carry = false;
      },
    });
    expect(cpu.registers.a).toBe(8);
    expect(cpu.registers.carry).toBe(false);
  });

  it('NEGA negates A and leaves the carry alone', () => {
    const cpu = run(InstructionType.NEGA, {
      before: (c) => {
        c.registers.a = 3;
        c.registers.carry = true;
      },
    });
    expect(cpu.registers.a).toBe(0x0d);
    expect(cpu.registers.carry).toBe(true);
  });

  it('COMB complements B', () => {
    const cpu = run(InstructionType.COMB, { before: (c) => (c.registers.b = 0b1010) });
    expect(cpu.registers.b).toBe(0b0101);
  });

  it('OR ors B into A', () => {
    const cpu = run(InstructionType.OR, {
      before: (c) => {
        c.registers.a = 0b1100;
        c.registers.b = 0b1010;
      },
    });
    expect(cpu.registers.a).toBe(0b1110);
    expect(cpu.registers.b).toBe(0b1010);
  });

  it('ROTR rotates A right through the carry', () => {
    const cpu = run(InstructionType.ROTR, {
      before: (c) => {
        c.registers.a = 0b0011;
        c.registers.carry = true;
      },
    });
    expect(cpu.registers.a).toBe(0b1001);
    expect(cpu.registers.carry).toBe(true);
  });

  it('ROTL rotates A left through the carry', () => {
    const cpu = run(InstructionType.ROTL, {
      before: (c) => {
        c.registers.a = 0b1001;
        c.registers.carry = false;
      },
    });
    expect(cpu.registers.a).toBe(0b0010);
    expect(cpu.registers.carry).toBe(true);
  });

  it('SEC sets the carry', () => {
    expect(run(InstructionType.SEC).registers.carry).toBe(true);
  });

  it('REC clears the carry', () => {
    const cpu = run(InstructionType.REC, { before: (c) => (c.registers.carry = true) });
    expect(cpu.registers.carry).toBe(false);
  });

  it('TC copies the carry into the status flag', () => {
    expect(run(InstructionType.TC).registers.status).toBe(0);
    expect(
      run(InstructionType.TC, { before: (c) => (c.registers.carry = true) }).registers.status,
    ).toBe(1);
  });
});

describe('instructions - counters, which land in ST', () => {
  it('IB increments B, holding ST at 1 until it wraps', () => {
    const stepped = run(InstructionType.IB, { before: (c) => (c.registers.b = 5) });
    expect(stepped.registers.b).toBe(6);
    expect(stepped.registers.status).toBe(1);

    const wrapped = run(InstructionType.IB, { before: (c) => (c.registers.b = 0x0f) });
    expect(wrapped.registers.b).toBe(0);
    expect(wrapped.registers.status).toBe(0);
  });

  it('DB decrements B, holding ST at 1 until it wraps', () => {
    const stepped = run(InstructionType.DB, { before: (c) => (c.registers.b = 5) });
    expect(stepped.registers.b).toBe(4);
    expect(stepped.registers.status).toBe(1);

    const wrapped = run(InstructionType.DB, { before: (c) => (c.registers.b = 0) });
    expect(wrapped.registers.b).toBe(0x0f);
    expect(wrapped.registers.status).toBe(0);
  });

  it('IY increments Y, holding ST at 1 until it wraps', () => {
    const stepped = run(InstructionType.IY, { before: (c) => (c.registers.y = 5) });
    expect(stepped.registers.y).toBe(6);
    expect(stepped.registers.status).toBe(1);

    const wrapped = run(InstructionType.IY, { before: (c) => (c.registers.y = 0x0f) });
    expect(wrapped.registers.y).toBe(0);
    expect(wrapped.registers.status).toBe(0);
  });

  it('DY decrements Y, holding ST at 1 until it wraps', () => {
    const stepped = run(InstructionType.DY, { before: (c) => (c.registers.y = 5) });
    expect(stepped.registers.y).toBe(4);
    expect(stepped.registers.status).toBe(1);

    const wrapped = run(InstructionType.DY, { before: (c) => (c.registers.y = 0) });
    expect(wrapped.registers.y).toBe(0x0f);
    expect(wrapped.registers.status).toBe(0);
  });

  it('AYY adds A to Y', () => {
    const cpu = run(InstructionType.AYY, {
      before: (c) => {
        c.registers.y = 5;
        c.registers.a = 3;
      },
    });
    expect(cpu.registers.y).toBe(8);
    expect(cpu.registers.status).toBe(1);

    const wrapped = run(InstructionType.AYY, {
      before: (c) => {
        c.registers.y = 0x0f;
        c.registers.a = 2;
      },
    });
    expect(wrapped.registers.y).toBe(1);
    expect(wrapped.registers.status).toBe(0);
  });

  it('SYY subtracts A from Y', () => {
    const cpu = run(InstructionType.SYY, {
      before: (c) => {
        c.registers.y = 9;
        c.registers.a = 4;
      },
    });
    expect(cpu.registers.y).toBe(5);
    expect(cpu.registers.status).toBe(1);

    const borrowed = run(InstructionType.SYY, {
      before: (c) => {
        c.registers.y = 1;
        c.registers.a = 3;
      },
    });
    expect(borrowed.registers.y).toBe(0x0e);
    expect(borrowed.registers.status).toBe(0);
  });

  it('leaves the top two bits of the six-bit Y register alone', () => {
    const cpu = run(InstructionType.IY, { before: (c) => (c.registers.y = 0x25) });
    expect(cpu.registers.y).toBe(0x26);
  });
});

describe('instructions - comparisons', () => {
  it('ALEM sets ST when A is at most M', () => {
    const below = run(InstructionType.ALEM, {
      before: (c) => {
        withRam(0, 0, 9)(c);
        c.registers.a = 4;
      },
    });
    expect(below.registers.status).toBe(1);

    const above = run(InstructionType.ALEM, {
      before: (c) => {
        withRam(0, 0, 2)(c);
        c.registers.a = 4;
      },
    });
    expect(above.registers.status).toBe(0);
  });

  it('ALEI sets ST when A is at most the immediate', () => {
    expect(
      run(InstructionType.ALEI, { operand: 5, before: (c) => (c.registers.a = 5) }).registers
        .status,
    ).toBe(1);
    expect(
      run(InstructionType.ALEI, { operand: 5, before: (c) => (c.registers.a = 6) }).registers
        .status,
    ).toBe(0);
  });

  it('BLEM sets ST when B is at most M', () => {
    const cpu = run(InstructionType.BLEM, {
      before: (c) => {
        withRam(2, 1, 7)(c);
        c.registers.b = 7;
      },
    });
    expect(cpu.registers.status).toBe(1);
  });

  it('ANEM sets ST when A differs from M', () => {
    const differs = run(InstructionType.ANEM, {
      before: (c) => {
        withRam(0, 0, 3)(c);
        c.registers.a = 4;
      },
    });
    expect(differs.registers.status).toBe(1);

    const matches = run(InstructionType.ANEM, {
      before: (c) => {
        withRam(0, 0, 4)(c);
        c.registers.a = 4;
      },
    });
    expect(matches.registers.status).toBe(0);
  });

  it('BNEM sets ST when B differs from M', () => {
    const cpu = run(InstructionType.BNEM, {
      before: (c) => {
        withRam(0, 0, 3)(c);
        c.registers.b = 3;
      },
    });
    expect(cpu.registers.status).toBe(0);
  });

  it('YNEA sets ST when Y differs from A', () => {
    const cpu = run(InstructionType.YNEA, {
      before: (c) => {
        c.registers.y = 6;
        c.registers.a = 6;
      },
    });
    expect(cpu.registers.status).toBe(0);
  });

  it('YNEI sets ST when Y differs from the immediate', () => {
    expect(
      run(InstructionType.YNEI, { operand: 3, before: (c) => (c.registers.y = 4) }).registers
        .status,
    ).toBe(1);
    expect(
      run(InstructionType.YNEI, { operand: 3, before: (c) => (c.registers.y = 3) }).registers
        .status,
    ).toBe(0);
  });

  it('MNEI sets ST when M differs from the immediate', () => {
    const cpu = run(InstructionType.MNEI, { operand: 7, before: withRam(1, 1, 7) });
    expect(cpu.registers.status).toBe(0);
  });
});

describe('instructions - loads and exchanges', () => {
  it('LAB copies B into A', () => {
    expect(run(InstructionType.LAB, { before: (c) => (c.registers.b = 9) }).registers.a).toBe(9);
  });

  it('LBA copies A into B', () => {
    expect(run(InstructionType.LBA, { before: (c) => (c.registers.a = 9) }).registers.b).toBe(9);
  });

  it('LAY copies Y into A', () => {
    expect(run(InstructionType.LAY, { before: (c) => (c.registers.y = 0x0c) }).registers.a).toBe(
      0x0c,
    );
  });

  it('LASPX copies SPX into A', () => {
    expect(run(InstructionType.LASPX, { before: (c) => (c.registers.spx = 6) }).registers.a).toBe(
      6,
    );
  });

  it('LASPY copies SPY into A', () => {
    expect(run(InstructionType.LASPY, { before: (c) => (c.registers.spy = 7) }).registers.a).toBe(
      7,
    );
  });

  it('LAM loads M into A', () => {
    expect(run(InstructionType.LAM, { before: withRam(3, 4, 0x0b) }).registers.a).toBe(0x0b);
  });

  it('LBM loads M into B', () => {
    expect(run(InstructionType.LBM, { before: withRam(3, 4, 0x0b) }).registers.b).toBe(0x0b);
  });

  it('LAI loads an immediate into A', () => {
    for (let immediate = 0; immediate <= 0x0f; immediate += 1) {
      expect(run(InstructionType.LAI, { operand: immediate }).registers.a).toBe(immediate);
    }
  });

  it('LBI loads an immediate into B', () => {
    expect(run(InstructionType.LBI, { operand: 0x0d }).registers.b).toBe(0x0d);
  });

  it('LXA copies A into X', () => {
    expect(run(InstructionType.LXA, { before: (c) => (c.registers.a = 9) }).registers.x).toBe(9);
  });

  it('LYA copies A into Y', () => {
    expect(run(InstructionType.LYA, { before: (c) => (c.registers.a = 9) }).registers.y).toBe(9);
  });

  it('LXI loads an immediate into X', () => {
    expect(run(InstructionType.LXI, { operand: 9 }).registers.x).toBe(9);
  });

  it('LYI loads an immediate into Y', () => {
    expect(run(InstructionType.LYI, { operand: 9 }).registers.y).toBe(9);
  });

  it('XMA exchanges A with M', () => {
    const cpu = run(InstructionType.XMA, {
      before: (c) => {
        withRam(1, 5, 0x0c)(c);
        c.registers.a = 3;
      },
    });
    expect(cpu.registers.a).toBe(0x0c);
    expect(cpu.memory.readRam(RAM_FILE_SIZE + 5)).toBe(3);
  });

  it('XMB exchanges B with M', () => {
    const cpu = run(InstructionType.XMB, {
      before: (c) => {
        withRam(1, 5, 0x0c)(c);
        c.registers.b = 3;
      },
    });
    expect(cpu.registers.b).toBe(0x0c);
    expect(cpu.memory.readRam(RAM_FILE_SIZE + 5)).toBe(3);
  });

  it('XSP exchanges both pointers with their shadows', () => {
    const cpu = run(InstructionType.XSP, {
      before: (c) => {
        c.registers.x = 1;
        c.registers.y = 2;
        c.registers.spx = 3;
        c.registers.spy = 4;
      },
    });
    expect([cpu.registers.x, cpu.registers.y]).toEqual([3, 4]);
    expect([cpu.registers.spx, cpu.registers.spy]).toEqual([1, 2]);
  });

  it('TM tests one bit of M', () => {
    for (let bit = 0; bit < 4; bit += 1) {
      expect(
        run(InstructionType.TM, { operand: bit, before: withRam(0, 0, 1 << bit) }).registers
          .status,
      ).toBe(1);
      expect(
        run(InstructionType.TM, { operand: bit, before: withRam(0, 0, ~(1 << bit)) }).registers
          .status,
      ).toBe(0);
    }
  });

  it('P reads a pattern word into A and B', () => {
    const cpu = run(InstructionType.P, {
      operand: 2,
      rom: (image) => {
        image[ROM_PROGRAM_SIZE + (2 << 4) + 5] = 0x3c7;
      },
      before: (c) => (c.registers.a = 5),
    });
    expect(cpu.registers.a).toBe(0x7);
    expect(cpu.registers.b).toBe(0xc);
  });

  it('P indexes each of its eight tables separately', () => {
    for (let table = 0; table < 8; table += 1) {
      const cpu = run(InstructionType.P, {
        operand: table,
        rom: (image) => {
          image[ROM_PROGRAM_SIZE + (table << 4)] = table;
        },
      });
      expect(cpu.registers.a).toBe(table);
    }
  });
});

describe('instructions - stores', () => {
  it('LMAIY stores A and post-increments Y', () => {
    const cpu = run(InstructionType.LMAIY, {
      before: (c) => {
        withRam(1, 3, 0)(c);
        c.registers.a = 6;
      },
    });
    expect(cpu.memory.readRam(RAM_FILE_SIZE + 3)).toBe(6);
    expect(cpu.registers.y).toBe(4);
    expect(cpu.registers.status).toBe(1);
  });

  it('LMADY stores A and post-decrements Y', () => {
    const cpu = run(InstructionType.LMADY, {
      before: (c) => {
        withRam(1, 3, 0)(c);
        c.registers.a = 6;
      },
    });
    expect(cpu.memory.readRam(RAM_FILE_SIZE + 3)).toBe(6);
    expect(cpu.registers.y).toBe(2);
  });

  it('LMIIY stores an immediate and post-increments Y', () => {
    const cpu = run(InstructionType.LMIIY, {
      operand: 0x0e,
      before: withRam(0, 0, 0),
    });
    expect(cpu.memory.readRam(0)).toBe(0x0e);
    expect(cpu.registers.y).toBe(1);
  });

  it('SEM sets one bit of M', () => {
    for (let bit = 0; bit < 4; bit += 1) {
      const cpu = run(InstructionType.SEM, { operand: bit, before: withRam(0, 0, 0) });
      expect(cpu.memory.readRam(0)).toBe(1 << bit);
    }
  });

  it('REM clears one bit of M', () => {
    for (let bit = 0; bit < 4; bit += 1) {
      const cpu = run(InstructionType.REM, { operand: bit, before: withRam(0, 0, 0x0f) });
      expect(cpu.memory.readRam(0)).toBe(0x0f & ~(1 << bit));
    }
  });
});

describe('instructions - control transfer', () => {
  it('BR branches within the page it sits in', () => {
    const cpu = run(InstructionType.BR, { operand: 7, at: romAddress(3, 0) });
    expect(cpu.registers.pc).toBe(romAddress(3, 7));
  });

  it('BR is skipped when ST is clear, and restores ST', () => {
    const cpu = run(InstructionType.BR, { operand: 7, before: (c) => (c.registers.status = 0) });
    expect(cpu.registers.pc).toBe(1);
    expect(cpu.registers.status).toBe(1);
  });

  it('CAL calls into page 0 and pushes the return address', () => {
    const cpu = run(InstructionType.CAL, { operand: 9, at: romAddress(2, 4) });
    expect(cpu.registers.pc).toBe(9);
    expect(cpu.registers.stackPointer).toBe(1);
    expect(cpu.getState().registers.stack[0]).toBe(romAddress(2, 5));
  });

  it('JMPL jumps anywhere in the program region', () => {
    expect(run(InstructionType.JMPL, { target: 0x6c1 }).registers.pc).toBe(0x6c1);
  });

  it('CALL calls anywhere in the program region', () => {
    const cpu = run(InstructionType.CALL, { target: 0x6c1 });
    expect(cpu.registers.pc).toBe(0x6c1);
    expect(cpu.getState().registers.stack[0]).toBe(2);
  });

  it('TBR branches to an offset computed from A and B', () => {
    const cpu = run(InstructionType.TBR, {
      at: romAddress(5, 0),
      before: (c) => {
        c.registers.a = 3;
        c.registers.b = 1;
      },
    });
    expect(cpu.registers.pc).toBe(romAddress(5, 0x13));
  });

  it('TBR reaches the low half of the page from A alone', () => {
    const cpu = run(InstructionType.TBR, { before: (c) => (c.registers.a = 6) });
    expect(cpu.registers.pc).toBe(6);
  });

  it('RTN returns through the stack', () => {
    const cpu = run(InstructionType.RTN, { before: (c) => c.registers.push(0x123) });
    expect(cpu.registers.pc).toBe(0x123);
    expect(cpu.registers.stackPointer).toBe(0);
  });

  it('RTNI returns and re-enables interrupts', () => {
    const cpu = run(InstructionType.RTNI, {
      before: (c) => {
        c.registers.push(0x123);
        c.timer.setInterruptEnabled(false);
      },
    });
    expect(cpu.registers.pc).toBe(0x123);
    expect(cpu.timer.interruptEnabled).toBe(true);
  });
});

describe('instructions - ports', () => {
  it('SED releases a D pin', () => {
    expect(run(InstructionType.SED, { operand: 9 }).ports.readD(9)).toBe(1);
  });

  it('RED pulls a D pin down', () => {
    const cpu = run(InstructionType.RED, { operand: 9, before: (c) => c.ports.writeD(9, 1) });
    expect(cpu.ports.readD(9)).toBe(0);
  });

  it('TD reads a D pin into ST', () => {
    expect(run(InstructionType.TD, { operand: 15 }).registers.status).toBe(0);
    expect(
      run(InstructionType.TD, { operand: 15, before: (c) => c.ports.writeD(15, 1) }).registers
        .status,
    ).toBe(1);
  });

  it('SEDY releases the D pin Y names', () => {
    const cpu = run(InstructionType.SEDY, { before: (c) => (c.registers.y = 4) });
    expect(cpu.ports.readD(4)).toBe(1);
    expect(cpu.ports.readGrids()).toBe(1 << 4);
  });

  it('REDY pulls down the D pin Y names', () => {
    const cpu = run(InstructionType.REDY, {
      before: (c) => {
        c.registers.y = 4;
        c.ports.writeD(4, 1);
      },
    });
    expect(cpu.ports.readD(4)).toBe(0);
  });

  it('TDY reads the D pin Y names into ST', () => {
    const cpu = run(InstructionType.TDY, {
      before: (c) => {
        c.registers.y = 15;
        c.ports.writeD(15, 1);
      },
    });
    expect(cpu.registers.status).toBe(1);
  });

  it('LAR reads an R port into A', () => {
    const cpu = run(InstructionType.LAR, {
      operand: 2,
      before: (c) => c.ports.writeRNibble(2, 0x0b),
    });
    expect(cpu.registers.a).toBe(0x0b);
  });

  it('LBR reads an R port into B', () => {
    const cpu = run(InstructionType.LBR, {
      operand: 3,
      before: (c) => c.ports.writeRNibble(3, 0x06),
    });
    expect(cpu.registers.b).toBe(0x06);
  });

  it('LRA writes A to an R port', () => {
    for (let port = 0; port < R_PORT_COUNT; port += 1) {
      const cpu = run(InstructionType.LRA, {
        operand: port,
        before: (c) => (c.registers.a = 0x0d),
      });
      expect(cpu.ports.readRNibble(port)).toBe(0x0d);
    }
  });

  it('LRB writes B to an R port', () => {
    const cpu = run(InstructionType.LRB, { operand: 1, before: (c) => (c.registers.b = 0x0a) });
    expect(cpu.ports.readRNibble(1)).toBe(0x0a);
  });

  it('XAMR exchanges A with the resolved R port state', () => {
    const cpu = run(InstructionType.XAMR, {
      operand: 4,
      before: (c) => {
        c.ports.writeRNibble(4, 0x09);
        c.registers.a = 0x06;
      },
    });
    expect(cpu.registers.a).toBe(0x09);
    expect(cpu.ports.readRNibble(4)).toBe(0x06);
  });

  it('reports a port write through onDChange, as the board watches it', () => {
    const strobes: Array<[number, number]> = [];
    run(InstructionType.SEDY, {
      before: (c) => {
        c.registers.y = 6;
        c.ports.onDChange = (pin, value) => strobes.push([pin, value]);
      },
    });
    expect(strobes).toEqual([[6, 1]]);
  });
});

describe('instructions - timer, prescaler and interrupt flags', () => {
  // The prescaler keeps running while an instruction executes, and its reset
  // ratio is one tick per machine cycle, so these load tests slow it down first
  // to observe the loaded value rather than the value plus that tick. The tick
  // itself is asserted separately, at the end of this block.
  it('LTI loads the timer from an immediate', () => {
    const cpu = run(InstructionType.LTI, {
      operand: 0x0c,
      before: (c) => c.timer.setPrescalerSelect(6),
    });
    expect(cpu.timer.counter).toBe(0x0c);
  });

  it('LTA loads the timer from A', () => {
    const cpu = run(InstructionType.LTA, {
      before: (c) => {
        c.registers.a = 0x07;
        c.timer.setPrescalerSelect(6);
      },
    });
    expect(cpu.timer.counter).toBe(0x07);
  });

  it('LAT reads the timer into A', () => {
    const cpu = run(InstructionType.LAT, { before: (c) => c.timer.load(0x0b) });
    expect(cpu.registers.a).toBe(0x0b);
  });

  it('LPI selects the prescaler divide ratio', () => {
    const cpu = run(InstructionType.LPI, { operand: 6 });
    expect(cpu.timer.prescalerSelect).toBe(6);
    expect(cpu.timer.prescalerDivider).toBe(64);
  });

  it('TTF tests the timer overflow flag', () => {
    expect(run(InstructionType.TTF).registers.status).toBe(0);
    expect(
      run(InstructionType.TTF, { before: (c) => c.timer.setTimerFlag(true) }).registers.status,
    ).toBe(1);
  });

  it('SETF and RETF set and clear the timer flag', () => {
    expect(run(InstructionType.SETF).timer.timerFlag).toBe(true);
    expect(
      run(InstructionType.RETF, { before: (c) => c.timer.setTimerFlag(true) }).timer.timerFlag,
    ).toBe(false);
  });

  it('SECF and RECF select counter mode and timer mode', () => {
    expect(run(InstructionType.SECF).timer.counterMode).toBe(true);
    expect(
      run(InstructionType.RECF, { before: (c) => c.timer.setCounterMode(true) }).timer.counterMode,
    ).toBe(false);
  });

  it('SEIE and REIE set and clear the master interrupt enable', () => {
    expect(run(InstructionType.SEIE).timer.interruptEnabled).toBe(true);
    expect(
      run(InstructionType.REIE, { before: (c) => c.timer.setInterruptEnabled(true) }).timer
        .interruptEnabled,
    ).toBe(false);
  });

  it('SEIF0 and REIF0 set and clear the INT0 request flag', () => {
    expect(run(InstructionType.SEIF0).timer.interruptFlag(0)).toBe(true);
    expect(
      run(InstructionType.REIF0, { before: (c) => c.timer.setInterruptFlag(0, true) }).timer
        .interruptFlag(0),
    ).toBe(false);
  });

  it('SEIF1 and REIF1 set and clear the INT1 request flag', () => {
    expect(run(InstructionType.SEIF1).timer.interruptFlag(1)).toBe(true);
    expect(
      run(InstructionType.REIF1, { before: (c) => c.timer.setInterruptFlag(1, true) }).timer
        .interruptFlag(1),
    ).toBe(false);
  });

  it('TI0 and TI1 read the interrupt pin levels into ST', () => {
    expect(run(InstructionType.TI0).registers.status).toBe(1);
    expect(
      run(InstructionType.TI0, { before: (c) => c.setInterruptLine(0, 0) }).registers.status,
    ).toBe(0);
    expect(run(InstructionType.TI1).registers.status).toBe(1);
    expect(
      run(InstructionType.TI1, { before: (c) => c.setInterruptLine(1, 0) }).registers.status,
    ).toBe(0);
  });

  it('TIF0 and TIF1 read the request flags into ST', () => {
    expect(run(InstructionType.TIF0).registers.status).toBe(0);
    expect(
      run(InstructionType.TIF0, { before: (c) => c.setInterruptLine(0, 0) }).registers.status,
    ).toBe(1);
    expect(run(InstructionType.TIF1).registers.status).toBe(0);
    expect(
      run(InstructionType.TIF1, { before: (c) => c.timer.setInterruptFlag(1, true) }).registers
        .status,
    ).toBe(1);
  });

  it('advances the timer by the cycles an instruction cost', () => {
    const image = new Uint16Array(ROM_SIZE);
    image[0] = encode(InstructionType.NOP);
    image[1] = encodeLong(InstructionType.JMPL, 4)[0];
    image[2] = encodeLong(InstructionType.JMPL, 4)[1];
    const cpu = new HMCS44CPU(image);

    cpu.step();
    expect(cpu.timer.counter).toBe(1);

    cpu.step();
    expect(cpu.timer.counter).toBe(3); // the long jump cost two
  });
});

describe('cross-cutting - carry propagation', () => {
  it('carries a BCD score across three digits with AMC and DAA', () => {
    // RAM file 0 holds 199 least-significant first; add 1 and expect 200.
    const program = [
      encode(InstructionType.LXI, 0),
      encode(InstructionType.LYI, 0),
      encode(InstructionType.SEC), // carry in the +1
      // digit 0
      encode(InstructionType.LAI, 0),
      encode(InstructionType.AMC),
      encode(InstructionType.DAA),
      encode(InstructionType.LMAIY),
      // digit 1 - LMAIY moved Y on, but it also rewrote ST; the adds do not
      // consult ST, so the chain is carry-only.
      encode(InstructionType.LAI, 0),
      encode(InstructionType.AMC),
      encode(InstructionType.DAA),
      encode(InstructionType.LMAIY),
      // digit 2
      encode(InstructionType.LAI, 0),
      encode(InstructionType.AMC),
      encode(InstructionType.DAA),
      encode(InstructionType.LMAIY),
    ];
    const image = new Uint16Array(ROM_SIZE);
    program.forEach((word, index) => {
      image[index] = word;
    });
    const cpu = new HMCS44CPU(image);
    cpu.memory.clearRam();
    [9, 9, 1].forEach((digit, index) => cpu.memory.writeRam(index, digit));

    for (let index = 0; index < program.length; index += 1) {
      cpu.step();
    }

    expect([cpu.memory.readRam(0), cpu.memory.readRam(1), cpu.memory.readRam(2)]).toEqual([
      0, 0, 2,
    ]);
    expect(cpu.registers.carry).toBe(false);
  });

  it('borrows across two digits with SMC and DAS', () => {
    // 20 - 1 = 19, least-significant digit first.
    const program = [
      encode(InstructionType.LXI, 0),
      encode(InstructionType.LYI, 0),
      encode(InstructionType.SEC), // no borrow in
      encode(InstructionType.LAI, 1),
      encode(InstructionType.SMC),
      encode(InstructionType.DAS),
      encode(InstructionType.LMAIY),
      encode(InstructionType.LAI, 0),
      encode(InstructionType.SMC),
      encode(InstructionType.DAS),
      encode(InstructionType.LMAIY),
    ];
    const image = new Uint16Array(ROM_SIZE);
    program.forEach((word, index) => {
      image[index] = word;
    });
    const cpu = new HMCS44CPU(image);
    cpu.memory.clearRam();
    cpu.memory.writeRam(0, 0);
    cpu.memory.writeRam(1, 2);

    for (let index = 0; index < program.length; index += 1) {
      cpu.step();
    }

    expect([cpu.memory.readRam(0), cpu.memory.readRam(1)]).toEqual([9, 1]);
  });
});

describe('cross-cutting - the four-level stack', () => {
  it('overwrites the oldest return address on a fifth call', () => {
    const image = new Uint16Array(ROM_SIZE);
    // Five nested calls, each at the entry point of the last.
    const entries = [4, 8, 12, 16, 20];
    image[0] = encode(InstructionType.CAL, entries[0]);
    entries.forEach((entry, index) => {
      const next = entries[index + 1];
      image[entry] = next === undefined ? encode(InstructionType.NOP) : encode(InstructionType.CAL, next);
    });
    const cpu = new HMCS44CPU(image);

    for (let call = 0; call < STACK_DEPTH; call += 1) {
      cpu.step();
    }
    const depth = cpu.registers.stackPointer;
    expect(depth).toBe(STACK_DEPTH);
    expect(cpu.getState().registers.stackOverflows).toBe(0);

    cpu.step(); // the fifth call

    expect(cpu.registers.stackPointer).toBe(STACK_DEPTH);
    expect(cpu.getState().registers.stackOverflows).toBe(1);
    // The stack is four registers deep on the hardware, so it wrapped rather
    // than grew: the oldest return address is gone.
    expect(cpu.getState().registers.stack).toHaveLength(STACK_DEPTH);
    expect(cpu.getState().registers.stack).not.toContain(1);
  });

  it('returns through four levels and counts an underflow past them', () => {
    const image = new Uint16Array(ROM_SIZE);
    image[0] = encode(InstructionType.RTN);
    const cpu = new HMCS44CPU(image);
    for (let level = 0; level < STACK_DEPTH; level += 1) {
      cpu.registers.push(0x100 + level);
    }

    for (let level = 0; level < STACK_DEPTH; level += 1) {
      cpu.registers.pc = 0;
      cpu.step();
      expect(cpu.registers.pc).toBe(0x100 + (STACK_DEPTH - 1 - level));
    }

    cpu.registers.pc = 0;
    cpu.step();
    expect(cpu.getState().registers.stackUnderflows).toBe(1);
  });
});

describe('cross-cutting - illegal opcodes and out-of-range access', () => {
  it('counts an unassigned pattern and carries on', () => {
    const image = new Uint16Array(ROM_SIZE);
    image[0] = 0x3ff;
    image[1] = encode(InstructionType.LAI, 4);
    const cpu = new HMCS44CPU(image);

    expect(() => {
      cpu.step();
      cpu.step();
    }).not.toThrow();
    expect(cpu.illegalOpcodes).toBe(1);
    expect(cpu.registers.a).toBe(4);
  });

  it('counts an operand naming hardware the device does not implement', () => {
    // R port 5 - the device has R0-R4 - is a pattern in the map with no valid
    // encoding, so it is illegal rather than a clamped LAR.
    const image = new Uint16Array(ROM_SIZE);
    image[0] = isaEntryFor(InstructionType.LAR).match | R_PORT_COUNT;
    const cpu = new HMCS44CPU(image);
    cpu.step();

    expect(cpu.illegalOpcodes).toBe(1);
    expect(cpu.registers.a).toBe(0);
  });

  it('surfaces a RAM access outside the 160 implemented nibbles', () => {
    // X selects one of ten files; 10-15 are files the HD38800 does not have and
    // memory.ts refuses to invent contents for.
    const image = new Uint16Array(ROM_SIZE);
    image[0] = encode(InstructionType.LXI, 10);
    image[1] = encode(InstructionType.LAM);
    const cpu = new HMCS44CPU(image);
    cpu.step();

    expect(() => cpu.step()).toThrow(RangeError);
  });
});

describe('cross-cutting - cycle counts', () => {
  it('charges every instruction the cost the ISA table states', () => {
    for (const spec of ISA) {
      const words =
        spec.words === 1 ? [encode(spec.type)] : [...encodeLong(spec.type, romAddress(4, 0))];
      const image = new Uint16Array(ROM_SIZE);
      words.forEach((word, index) => {
        image[index] = word;
      });
      const cpu = new HMCS44CPU(image);
      cpu.memory.clearRam();

      expect(cpu.step(), `${spec.type} cost`).toBe(spec.cycles);
      expect(cpu.cycles, `${spec.type} accumulated cost`).toBe(spec.cycles);
    }
  });

  it('charges the pattern read two cycles and everything else its word count', () => {
    const patternCost = ISA.filter((spec) => spec.cycles !== spec.words).map((spec) => spec.type);
    expect(patternCost).toEqual([InstructionType.P]);
  });

  it('reaches the documented oscillator rate over a run of NOPs', () => {
    const image = new Uint16Array(ROM_SIZE);
    const cpu = new HMCS44CPU(image); // a zero-filled ROM is 2048 NOPs
    cpu.run(TIMER_MODULUS);
    expect(cpu.cycles).toBe(TIMER_MODULUS);
    expect(cpu.timer.overflows).toBe(1);
  });
});

describe('coverage', () => {
  it('exercises every instruction the architecture defines', () => {
    const missing = ISA.map((spec) => spec.type).filter((type) => !exercised.has(type));
    expect(missing).toEqual([]);
  });
});
