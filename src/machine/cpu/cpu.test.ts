import { describe, it, expect } from 'vitest';
import { CYCLE_HZ, HMCS44CPU, OSCILLATOR_HZ } from './cpu.js';
import { encode, encodeLong } from './decoder.js';
import { InstructionType } from './instruction.js';
import {
  RAM_POWER_ON_FILL,
  RAM_SIZE,
  ROM_PROGRAM_SIZE,
  ROM_SIZE,
  romAddress,
} from './memory.js';
import { PC_SIZE, STACK_DEPTH } from './registers.js';

/** A ROM image holding `words` at `start`, zero (NOP) everywhere else. */
function rom(words: number[], start = 0): Uint16Array {
  const image = new Uint16Array(ROM_SIZE);
  words.forEach((word, index) => {
    image[start + index] = word;
  });
  return image;
}

/** A CPU running the given program from address 0. */
function cpuRunning(words: number[], start = 0): HMCS44CPU {
  return new HMCS44CPU(rom(words, start));
}

/** Run `count` instructions. */
function steps(cpu: HMCS44CPU, count: number): void {
  for (let i = 0; i < count; i += 1) {
    cpu.step();
  }
}

describe('HMCS44CPU - construction', () => {
  it('accepts a full 2176-word image', () => {
    const cpu = new HMCS44CPU(new Uint16Array(ROM_SIZE));
    expect(cpu.memory.romSize).toBe(ROM_SIZE);
  });

  it('accepts a program-region-only image and zero-fills the pattern region', () => {
    const image = new Uint16Array(ROM_PROGRAM_SIZE);
    image[0] = encode(InstructionType.LAI, 6);
    const cpu = new HMCS44CPU(image);

    expect(cpu.memory.readRom(0)).toBe(encode(InstructionType.LAI, 6));
    expect(cpu.memory.readRom(ROM_SIZE - 1)).toBe(0);
    cpu.step();
    expect(cpu.registers.a).toBe(6);
  });

  it('rejects an image that is neither size', () => {
    expect(() => new HMCS44CPU(new Uint16Array(100))).toThrow(RangeError);
  });
});

describe('HMCS44CPU - reset', () => {
  it('puts the program counter at 0 and clears the registers', () => {
    const cpu = cpuRunning([encode(InstructionType.LAI, 9), encode(InstructionType.LBI, 3)]);
    steps(cpu, 2);
    expect(cpu.registers.a).toBe(9);

    cpu.reset();

    const state = cpu.getState().registers;
    expect(state.pc).toBe(0);
    expect(state.a).toBe(0);
    expect(state.b).toBe(0);
    expect(state.x).toBe(0);
    expect(state.y).toBe(0);
    expect(state.carry).toBe(false);
    expect(state.stackPointer).toBe(0);
  });

  it('clears the cycle counter and restarts a halted core', () => {
    const cpu = cpuRunning([encode(InstructionType.STOP)]);
    cpu.step();
    expect(cpu.running).toBe(false);
    expect(cpu.cycles).toBe(1);

    cpu.reset();

    expect(cpu.running).toBe(true);
    expect(cpu.cycles).toBe(0);
  });

  it('returns RAM to the undefined power-on fill, not to zeroes', () => {
    const cpu = cpuRunning([]);
    cpu.memory.clearRam();
    cpu.reset();
    expect(cpu.memory.readRam(0)).toBe(RAM_POWER_ON_FILL);
    expect(cpu.getState().memory.ramCleared).toBe(false);
  });

  it('quietens the ports', () => {
    const cpu = cpuRunning([encode(InstructionType.SED, 4)]);
    cpu.step();
    expect(cpu.ports.readD(4)).toBe(1);

    cpu.reset();

    expect(cpu.ports.readDPort()).toBe(0);
    expect(cpu.ports.readRPort()).toBe(0);
  });

  it('clears the illegal and unimplemented counters', () => {
    const cpu = cpuRunning([0x3ff, encode(InstructionType.DAA)]);
    steps(cpu, 2);
    expect(cpu.illegalOpcodes).toBe(1);
    expect(cpu.unimplementedOpcodes).toBe(1);

    cpu.reset();

    expect(cpu.illegalOpcodes).toBe(0);
    expect(cpu.unimplementedOpcodes).toBe(0);
  });
});

describe('HMCS44CPU - fetch and the program counter', () => {
  it('fetches from the address the program counter names', () => {
    const cpu = cpuRunning([encode(InstructionType.LAI, 9)], 0x100);
    cpu.registers.pc = 0x100;
    cpu.step();
    expect(cpu.registers.a).toBe(9);
    expect(cpu.registers.pc).toBe(0x101);
  });

  it('advances one word per one-word instruction', () => {
    const cpu = cpuRunning([
      encode(InstructionType.NOP),
      encode(InstructionType.NOP),
      encode(InstructionType.NOP),
    ]);
    steps(cpu, 3);
    expect(cpu.registers.pc).toBe(3);
  });

  it('advances two words for a two-word instruction', () => {
    const [first, second] = encodeLong(InstructionType.JMPL, 0x123);
    const cpu = cpuRunning([
      encode(InstructionType.LAI, 5),
      encode(InstructionType.ALEI, 0), // 5 <= 0 is false, so the jump is skipped
      first,
      second,
    ]);
    steps(cpu, 3);
    expect(cpu.registers.pc).toBe(4);
  });

  it('wraps at 2048 rather than running into the pattern region', () => {
    const cpu = cpuRunning([encode(InstructionType.NOP)], PC_SIZE - 1);
    cpu.registers.pc = PC_SIZE - 1;
    cpu.step();
    expect(cpu.registers.pc).toBe(0);
  });

  it('does not fetch while halted', () => {
    const cpu = cpuRunning([encode(InstructionType.STOP), encode(InstructionType.LAI, 7)]);
    cpu.step();
    const pc = cpu.registers.pc;

    expect(cpu.step()).toBe(0);
    expect(cpu.registers.pc).toBe(pc);
    expect(cpu.registers.a).toBe(0);
  });
});

describe('HMCS44CPU - cycle accounting', () => {
  it('charges one cycle for a one-word instruction', () => {
    const cpu = cpuRunning([encode(InstructionType.NOP)]);
    expect(cpu.step()).toBe(1);
    expect(cpu.cycles).toBe(1);
  });

  it('charges two cycles for a two-word instruction', () => {
    const [first, second] = encodeLong(InstructionType.CALL, 0x40);
    const cpu = cpuRunning([first, second]);
    expect(cpu.step()).toBe(2);
    expect(cpu.cycles).toBe(2);
  });

  it('accumulates the real cost of a mixed run', () => {
    const [first, second] = encodeLong(InstructionType.JMPL, 8);
    const cpu = cpuRunning([encode(InstructionType.NOP), encode(InstructionType.LAI, 1)]);
    cpu.memory.writeRam(0, 0); // touching RAM must not affect the cycle count
    steps(cpu, 2);
    expect(cpu.cycles).toBe(2);

    const jumper = cpuRunning([first, second, encode(InstructionType.NOP)]);
    steps(jumper, 2);
    expect(jumper.cycles).toBe(3);
  });

  it('charges one cycle for an unassigned opcode', () => {
    const cpu = cpuRunning([0x3ff]);
    expect(cpu.step()).toBe(1);
  });

  it('runs at least the requested cycle budget', () => {
    const cpu = cpuRunning(new Array<number>(20).fill(encode(InstructionType.NOP)));
    expect(cpu.run(10)).toBe(10);
    expect(cpu.cycles).toBe(10);
  });

  it('stops the budget short when the core halts', () => {
    const cpu = cpuRunning([encode(InstructionType.NOP), encode(InstructionType.STOP)]);
    expect(cpu.run(100)).toBe(2);
    expect(cpu.running).toBe(false);
  });
});

describe('HMCS44CPU - clock', () => {
  it('reports the documented 400 kHz oscillator', () => {
    const cpu = cpuRunning([]);
    expect(OSCILLATOR_HZ).toBe(400_000);
    expect(cpu.getCyclesPerSecond()).toBe(CYCLE_HZ);
  });

  it('converts elapsed cycles to seconds of emulated time', () => {
    const cpu = cpuRunning(new Array<number>(100).fill(encode(InstructionType.NOP)));
    expect(cpu.getElapsedTime()).toBe(0);
    cpu.run(CYCLE_HZ / 1000);
    expect(cpu.getElapsedTime()).toBeCloseTo(0.001, 9);
  });

  it('advances emulated time only by executed cycles', () => {
    const cpu = cpuRunning([encode(InstructionType.STOP)]);
    cpu.step();
    const elapsed = cpu.getElapsedTime();
    steps(cpu, 10);
    expect(cpu.getElapsedTime()).toBe(elapsed);
  });
});

describe('HMCS44CPU - execute: loads and stores', () => {
  it('loads an immediate into A and B', () => {
    const cpu = cpuRunning([encode(InstructionType.LAI, 0x0f), encode(InstructionType.LBI, 0x0a)]);
    steps(cpu, 2);
    expect(cpu.registers.a).toBe(0x0f);
    expect(cpu.registers.b).toBe(0x0a);
  });

  it('moves between A and B', () => {
    const cpu = cpuRunning([encode(InstructionType.LAI, 6), encode(InstructionType.LBA)]);
    steps(cpu, 2);
    expect(cpu.registers.b).toBe(6);
  });

  it('loads the RAM nibble the pointers select', () => {
    const cpu = cpuRunning([
      encode(InstructionType.LXI, 2),
      encode(InstructionType.LYI, 3),
      encode(InstructionType.LAM),
    ]);
    cpu.memory.clearRam();
    cpu.memory.writeRam(2 * 16 + 3, 0x0c);
    steps(cpu, 3);
    expect(cpu.registers.a).toBe(0x0c);
  });

  it('stores A to RAM and post-increments Y', () => {
    const cpu = cpuRunning([
      encode(InstructionType.LXI, 1),
      encode(InstructionType.LYI, 0),
      encode(InstructionType.LAI, 7),
      encode(InstructionType.LMAIY),
      encode(InstructionType.LMAIY),
    ]);
    cpu.memory.clearRam();
    steps(cpu, 5);
    expect(cpu.memory.readRam(16)).toBe(7);
    expect(cpu.memory.readRam(17)).toBe(7);
    expect(cpu.registers.y).toBe(2);
  });

  it('walks Y up and down', () => {
    const cpu = cpuRunning([
      encode(InstructionType.LYI, 5),
      encode(InstructionType.IY),
      encode(InstructionType.IY),
      encode(InstructionType.DY),
    ]);
    steps(cpu, 4);
    expect(cpu.registers.y).toBe(6);
  });
});

describe('HMCS44CPU - execute: ALU and status', () => {
  it('adds an immediate to A', () => {
    const cpu = cpuRunning([encode(InstructionType.LAI, 3), encode(InstructionType.AI, 4)]);
    steps(cpu, 2);
    expect(cpu.registers.a).toBe(7);
    expect(cpu.registers.carry).toBe(false);
  });

  it('sets the carry flag on overflow out of bit 3', () => {
    const cpu = cpuRunning([encode(InstructionType.LAI, 0x0f), encode(InstructionType.AI, 1)]);
    steps(cpu, 2);
    expect(cpu.registers.a).toBe(0);
    expect(cpu.registers.carry).toBe(true);
  });

  it('adds the selected RAM nibble to A', () => {
    const cpu = cpuRunning([
      encode(InstructionType.LXI, 0),
      encode(InstructionType.LYI, 4),
      encode(InstructionType.LAI, 2),
      encode(InstructionType.AM),
    ]);
    cpu.memory.clearRam();
    cpu.memory.writeRam(4, 5);
    steps(cpu, 4);
    expect(cpu.registers.a).toBe(7);
  });

  it('sets and clears the carry flag explicitly', () => {
    const cpu = cpuRunning([encode(InstructionType.SEC), encode(InstructionType.REC)]);
    cpu.step();
    expect(cpu.registers.carry).toBe(true);
    cpu.step();
    expect(cpu.registers.carry).toBe(false);
  });

  it('copies the carry flag into the status flag', () => {
    const cpu = cpuRunning([encode(InstructionType.SEC), encode(InstructionType.TC)]);
    steps(cpu, 2);
    expect(cpu.registers.status).toBe(1);
  });

  it('sets the status flag from a comparison', () => {
    const taken = cpuRunning([encode(InstructionType.LAI, 3), encode(InstructionType.ALEI, 5)]);
    steps(taken, 2);
    expect(taken.registers.status).toBe(1);

    const missed = cpuRunning([encode(InstructionType.LAI, 9), encode(InstructionType.ALEI, 5)]);
    steps(missed, 2);
    expect(missed.registers.status).toBe(0);
  });
});

describe('HMCS44CPU - execute: ports', () => {
  it('releases and pulls down a D pin', () => {
    const cpu = cpuRunning([encode(InstructionType.SED, 9), encode(InstructionType.RED, 9)]);
    cpu.step();
    expect(cpu.ports.readD(9)).toBe(1);
    cpu.step();
    expect(cpu.ports.readD(9)).toBe(0);
  });

  it('reads a D pin into the status flag', () => {
    const cpu = cpuRunning([encode(InstructionType.SED, 15), encode(InstructionType.TD, 15)]);
    steps(cpu, 2);
    expect(cpu.registers.status).toBe(1);
  });

  it('writes A to a 4-bit R port', () => {
    const cpu = cpuRunning([encode(InstructionType.LAI, 0x0d), encode(InstructionType.LRA, 2)]);
    steps(cpu, 2);
    expect(cpu.ports.readRNibble(2)).toBe(0x0d);
  });

  it('reports a grid strobe through the port model', () => {
    const cpu = cpuRunning([encode(InstructionType.SED, 3)]);
    const strobes: number[] = [];
    cpu.ports.onDChange = (pin, value) => {
      if (value === 1) {
        strobes.push(pin);
      }
    };
    cpu.step();
    expect(strobes).toEqual([3]);
    expect(cpu.ports.readGrids()).toBe(1 << 3);
  });
});

describe('HMCS44CPU - execute: control transfer', () => {
  it('takes an in-page branch when the status flag is set', () => {
    const cpu = cpuRunning([0x200 | 10]);
    cpu.step();
    expect(cpu.registers.pc).toBe(10);
  });

  it('skips the branch when the status flag is clear, then restores it', () => {
    const cpu = cpuRunning([
      encode(InstructionType.LAI, 9),
      encode(InstructionType.ALEI, 5), // false, so ST goes to 0
      0x200 | 10,
    ]);
    steps(cpu, 3);
    expect(cpu.registers.pc).toBe(3);
    expect(cpu.registers.status).toBe(1);
  });

  it('branches within the page the branch instruction itself sits in', () => {
    // The branch is the last word of page 0, so the program counter has already
    // moved into page 1 by the time it executes. The target is page 0 all the same.
    const cpu = cpuRunning([0x200 | 5], 31);
    cpu.registers.pc = 31;
    cpu.step();
    expect(cpu.registers.pc).toBe(5);
  });

  it('branches within a later page', () => {
    const cpu = cpuRunning([0x200 | 7], romAddress(3, 0));
    cpu.registers.pc = romAddress(3, 0);
    cpu.step();
    expect(cpu.registers.pc).toBe(romAddress(3, 7));
  });

  it('calls a page-0 subroutine and returns through the stack', () => {
    const image = rom([0x220 | 4, encode(InstructionType.LBI, 2)]);
    image[4] = encode(InstructionType.LAI, 7);
    image[5] = encode(InstructionType.RTN);
    const cpu = new HMCS44CPU(image);

    cpu.step();
    expect(cpu.registers.pc).toBe(4);
    expect(cpu.registers.stackPointer).toBe(1);

    steps(cpu, 2);
    expect(cpu.registers.a).toBe(7);
    expect(cpu.registers.pc).toBe(1);
    expect(cpu.registers.stackPointer).toBe(0);
  });

  it('nests calls to the full stack depth and unwinds them', () => {
    const image = rom([0x220 | 8]);
    image[8] = 0x220 | 12;
    image[12] = 0x220 | 16;
    image[16] = 0x220 | 20;
    for (const address of [20, 17, 13, 9]) {
      image[address] = encode(InstructionType.RTN);
    }
    const cpu = new HMCS44CPU(image);

    steps(cpu, STACK_DEPTH);
    expect(cpu.registers.stackPointer).toBe(STACK_DEPTH);
    expect(cpu.registers.pc).toBe(20);

    steps(cpu, STACK_DEPTH);
    expect(cpu.registers.stackPointer).toBe(0);
    expect(cpu.registers.pc).toBe(1);
    expect(cpu.getState().registers.stackOverflows).toBe(0);
  });

  it('jumps anywhere in the program region with a two-word jump', () => {
    const [first, second] = encodeLong(InstructionType.JMPL, 0x7c3);
    const cpu = cpuRunning([first, second]);
    cpu.step();
    expect(cpu.registers.pc).toBe(0x7c3);
  });

  it('calls anywhere in the program region, returning past both words', () => {
    const [first, second] = encodeLong(InstructionType.CALL, 0x600);
    const image = rom([first, second]);
    image[0x600] = encode(InstructionType.RTN);
    const cpu = new HMCS44CPU(image);

    cpu.step();
    expect(cpu.registers.pc).toBe(0x600);

    cpu.step();
    expect(cpu.registers.pc).toBe(2);
  });

  it('skips a long call without executing its second word', () => {
    const [first, second] = encodeLong(InstructionType.CALL, 0x600);
    const cpu = cpuRunning([
      encode(InstructionType.LAI, 9),
      encode(InstructionType.ALEI, 5),
      first,
      second,
      encode(InstructionType.LBI, 4),
    ]);
    steps(cpu, 4);
    expect(cpu.registers.pc).toBe(5);
    expect(cpu.registers.b).toBe(4);
    expect(cpu.registers.stackPointer).toBe(0);
  });
});

describe('HMCS44CPU - unassigned and unimplemented opcodes', () => {
  it('counts an unassigned opcode and carries on', () => {
    const cpu = cpuRunning([0x3ff, encode(InstructionType.LAI, 4)]);
    expect(() => steps(cpu, 2)).not.toThrow();
    expect(cpu.illegalOpcodes).toBe(1);
    expect(cpu.registers.a).toBe(4);
    expect(cpu.registers.pc).toBe(2);
  });

  it('leaves the registers alone on an unassigned opcode', () => {
    const cpu = cpuRunning([encode(InstructionType.LAI, 5), 0x3ff]);
    steps(cpu, 2);
    expect(cpu.registers.a).toBe(5);
    expect(cpu.registers.carry).toBe(false);
    expect(cpu.registers.status).toBe(1);
  });

  it('counts a decoded instruction that has no handler yet', () => {
    const cpu = cpuRunning([encode(InstructionType.DAA), encode(InstructionType.ROTL)]);
    steps(cpu, 2);
    expect(cpu.unimplementedOpcodes).toBe(2);
    expect(cpu.illegalOpcodes).toBe(0);
  });

  it('keeps the two counters distinct', () => {
    const cpu = cpuRunning([0x3ff, encode(InstructionType.DAA)]);
    steps(cpu, 2);
    expect(cpu.illegalOpcodes).toBe(1);
    expect(cpu.unimplementedOpcodes).toBe(1);
  });
});

describe('HMCS44CPU - halt', () => {
  it('halts on STOP', () => {
    const cpu = cpuRunning([encode(InstructionType.STOP)]);
    cpu.step();
    expect(cpu.running).toBe(false);
  });

  it('halts on SBY - the core models no timer to wake it', () => {
    const cpu = cpuRunning([encode(InstructionType.SBY)]);
    cpu.step();
    expect(cpu.running).toBe(false);
  });

  it('resumes on start() without losing state', () => {
    const cpu = cpuRunning([encode(InstructionType.LAI, 5), encode(InstructionType.STOP)]);
    steps(cpu, 2);
    cpu.start();
    expect(cpu.running).toBe(true);
    expect(cpu.registers.a).toBe(5);
  });
});

describe('HMCS44CPU - getState', () => {
  it('captures every subsystem', () => {
    const cpu = cpuRunning([
      encode(InstructionType.LAI, 3),
      encode(InstructionType.SED, 6),
      encode(InstructionType.LRA, 1),
    ]);
    cpu.memory.clearRam();
    steps(cpu, 3);

    const state = cpu.getState();
    expect(state.cycles).toBe(3);
    expect(state.running).toBe(true);
    expect(state.elapsedTime).toBe(3 / CYCLE_HZ);
    expect(state.illegalOpcodes).toBe(0);
    expect(state.unimplementedOpcodes).toBe(0);
    expect(state.registers.a).toBe(3);
    expect(state.registers.pc).toBe(3);
    expect(state.memory.ram).toHaveLength(RAM_SIZE);
    expect(state.memory.ramCleared).toBe(true);
    expect(state.ports.dPins & (1 << 6)).not.toBe(0);
    expect(state.ports.rPins & 0x000f0).not.toBe(0);
  });

  it('is a snapshot, not a live view', () => {
    const cpu = cpuRunning([encode(InstructionType.LAI, 3), encode(InstructionType.LAI, 8)]);
    cpu.step();
    const state = cpu.getState();
    cpu.step();

    expect(state.registers.a).toBe(3);
    expect(state.cycles).toBe(1);
    expect(cpu.registers.a).toBe(8);
  });
});

describe('HMCS44CPU - disassemble', () => {
  it('renders a one-word instruction with its operand', () => {
    const cpu = cpuRunning([encode(InstructionType.LAI, 5), 0x200 | 12]);
    expect(cpu.disassemble(0)).toBe('LAI 5');
    expect(cpu.disassemble(1)).toBe('BR 12');
  });

  it('renders a two-word instruction with its recombined target', () => {
    const [first, second] = encodeLong(InstructionType.CALL, 0x4d2);
    const cpu = cpuRunning([first, second]);
    expect(cpu.disassemble(0)).toBe(`CALL ${0x4d2}`);
  });

  it('renders an unassigned word as UNKNOWN and changes no state', () => {
    const cpu = cpuRunning([0x3ff]);
    expect(cpu.disassemble(0)).toBe('UNKNOWN');
    expect(cpu.cycles).toBe(0);
    expect(cpu.registers.pc).toBe(0);
  });
});
