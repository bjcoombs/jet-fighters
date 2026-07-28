import { describe, expect, it } from 'vitest';

import {
  K_MASK,
  OSCILLATOR_PULSES_PER_INSTRUCTION,
  R_INDEX_X_BIT,
  Tms1370Cpu,
  X_MSB,
  type Tms1370CpuOptions,
  type Tms1370Pins,
} from './cpu.js';
import { CYCLES_PER_INSTRUCTION, encodeInstruction, Mnemonic } from './isa.js';
import { Tms1370Rom } from './memory.js';
import { O_INDEX_MASK, O_LINE_MASK, O_PLA_ENTRY_COUNT, Tms1370OutputPla } from './opla.js';
import { RAM_FILE_COUNT, RAM_WORD_COUNT, RAM_WORDS_PER_FILE, Tms1370Ram } from './ram.js';
import {
  pcForOrdinal,
  RESET_CHAPTER,
  RESET_PAGE,
  RESET_PC,
  RESET_ROM_ADDRESS,
  R_OUTPUT_COUNT,
  X_MASK,
} from './registers.js';
import { CLOCK_DIVIDER, CYCLE_HZ, OSCILLATOR_HZ } from './timing.js';

/** Assemble words onto a page at their LFSR offsets. */
function place(rom: Tms1370Rom, words: number[], page = RESET_PAGE, firstOrdinal = 0): void {
  words.forEach((word, offset) => {
    rom.writeAt(RESET_CHAPTER, page, pcForOrdinal(firstOrdinal + offset), word);
  });
}

/** A core running the given words from the reset entry point. */
function coreRunning(words: number[], options: Omit<Tms1370CpuOptions, 'rom'> = {}): Tms1370Cpu {
  const rom = new Tms1370Rom();
  place(rom, words);
  return new Tms1370Cpu({ ...options, rom });
}

const op = encodeInstruction;

describe('reset', () => {
  it('enters at chapter 0, page 15, PC 0 with R cleared, O index 0, status 0 and the call latch clear', () => {
    // Research doc section 7, every conjunct from the same table: MAME's
    // device_reset sets pa = pb = 0xf, pc = 0, ca = cb = 0; clears the R
    // outputs; writes the O register with index 0; and leaves status and the
    // call latch clear.
    const indices: number[] = [];
    const rWrites: Array<[number, boolean]> = [];
    const pins: Tms1370Pins = {
      writeOIndex: (index) => indices.push(index),
      writeR: (index, on) => rWrites.push([index, on]),
    };
    const cpu = coreRunning([op(Mnemonic.CLA)], { pins });

    const registers = cpu.registers;
    expect(registers.ca).toBe(RESET_CHAPTER);
    expect(registers.pa).toBe(RESET_PAGE);
    expect(registers.pc).toBe(RESET_PC);
    expect(cpu.romAddress).toBe(RESET_ROM_ADDRESS);
    expect(registers.r).toBe(0);
    expect(cpu.oIndex).toBe(0);
    expect(registers.status).toBe(0);
    expect(registers.statusLatch).toBe(0);
    expect(registers.callLatch).toBe(0);
    expect(cpu.cycles).toBe(0);
    expect(cpu.lastOpcode).toBeNull();

    expect(indices).toEqual([0]);
    expect(rWrites).toHaveLength(R_OUTPUT_COUNT);
    expect(rWrites.every(([, on]) => on === false)).toBe(true);
  });

  it('returns the machine to the entry point from anywhere', () => {
    const cpu = coreRunning([op(Mnemonic.CLA), op(Mnemonic.CLA), op(Mnemonic.CLA)]);
    cpu.run(3);
    cpu.registers.x = 5;
    cpu.reset();
    expect(cpu.romAddress).toBe(RESET_ROM_ADDRESS);
    expect(cpu.registers.x).toBe(0);
    expect(cpu.cycles).toBe(0);
  });

  it('does not clear RAM', () => {
    // Research doc section 7: MAME's device_reset touches no RAM, and the safe
    // assumption on a mask-ROM MCU is that power-up contents are arbitrary and
    // the program clears what it needs. The RAM object's own reset is a
    // documented no-op, so this is an assertion about a call with a defined
    // behaviour rather than about a missing line.
    const ram = new Tms1370Ram();
    ram.powerOn(0xf);
    const rom = new Tms1370Rom();
    place(rom, [op(Mnemonic.CLA)]);
    const cpu = new Tms1370Cpu({ rom, ram });

    expect(ram.snapshot().every((nibble) => nibble === 0xf)).toBe(true);
    cpu.run(1);
    cpu.reset();
    expect(ram.snapshot().every((nibble) => nibble === 0xf)).toBe(true);
  });
});

describe('power-on garbage, and the ROM clear routine that costs real time', () => {
  // A ROM that clears all 128 RAM nibbles and only then drives a grid and a lit
  // O slot. Laid out on the reset page: a per-file clear subroutine called eight
  // times. Its shape matters only in that the clear precedes the first output.
  const CLEAR_SUBROUTINE_ORDINAL = 32;
  const LIT_O_INDEX = 1;
  const DISPLAY_GRID = 3;

  /**
   * A ceiling on the clear routine, not a measurement of it.
   *
   * Expressed as a generous multiple of the RAM the routine has to walk so that
   * changing the routine moves nothing here. A literal here would be a bet on
   * how the ROM is written.
   */
  const INSTRUCTIONS_PER_NIBBLE_CEILING = 16;
  const CLEAR_ROUTINE_CEILING = RAM_WORD_COUNT * INSTRUCTIONS_PER_NIBBLE_CEILING;

  function clearingCore(): { cpu: Tms1370Cpu; ram: Tms1370Ram } {
    const rom = new Tms1370Rom();
    const main: number[] = [op(Mnemonic.LDP, RESET_PAGE)];
    for (let file = 0; file < RAM_FILE_COUNT; file += 1) {
      main.push(op(Mnemonic.LDX, file));
      main.push(op(Mnemonic.CALL, pcForOrdinal(CLEAR_SUBROUTINE_ORDINAL)));
    }
    const displayOrdinal = main.length;
    main.push(
      op(Mnemonic.LDX, 0),
      op(Mnemonic.TCY, DISPLAY_GRID),
      op(Mnemonic.SETR),
      op(Mnemonic.ANAAC, LIT_O_INDEX),
      op(Mnemonic.TDO),
      op(Mnemonic.BR, pcForOrdinal(displayOrdinal + 5)),
    );
    place(rom, main);

    const loopOrdinal = CLEAR_SUBROUTINE_ORDINAL + 1;
    place(
      rom,
      [
        op(Mnemonic.TCY, 0),
        op(Mnemonic.CLA),
        op(Mnemonic.TAM),
        op(Mnemonic.IYC),
        op(Mnemonic.YNEC, 0),
        op(Mnemonic.BR, pcForOrdinal(loopOrdinal)),
        op(Mnemonic.RETN),
      ],
      RESET_PAGE,
      CLEAR_SUBROUTINE_ORDINAL,
    );

    const ram = new Tms1370Ram();
    ram.powerOn(0xf);
    const litSlots = Array.from({ length: O_PLA_ENTRY_COUNT }, (_unused, index) =>
      index === 0 ? 0 : O_LINE_MASK,
    );
    const cpu = new Tms1370Cpu({ rom, ram, outputPla: new Tms1370OutputPla(litSlots) });
    return { cpu, ram };
  }

  it('lights no segment before the ROM has finished clearing RAM', () => {
    // Contract V2's second conjunct at core level: clearing 128 nibbles costs
    // real instruction time, and that cost must not race the first display
    // sweep. Nothing is driven while it runs - no grid on an R latch, and the O
    // register still holding the dark index 0 it was reset with. The probe suite
    // asserts the same property against the assembled game ROM once tools/tmsasm
    // and the re-addressed board land; this is the machine's half of it.
    const { cpu, ram } = clearingCore();
    expect(ram.snapshot().every((nibble) => nibble === 0xf)).toBe(true);

    let instructions = 0;
    while (ram.snapshot().some((nibble) => nibble !== 0)) {
      expect(cpu.r, `R driven after ${instructions} instructions`).toBe(0);
      expect(cpu.oLines, `O driven after ${instructions} instructions`).toBe(0);
      cpu.step();
      instructions += 1;
      expect(instructions).toBeLessThan(CLEAR_ROUTINE_CEILING);
    }

    // It cost real time: at minimum one instruction per nibble written.
    expect(instructions).toBeGreaterThan(RAM_WORD_COUNT);
    expect(cpu.r).toBe(0);
    expect(cpu.oLines).toBe(0);
  });

  it('drives the display once the clear routine completes, so the assertion is armed', () => {
    // Without this, "nothing is lit" would be satisfied by a machine that never
    // lights anything - the same shape as deleting the test.
    const { cpu } = clearingCore();
    let instructions = 0;
    while (cpu.r === 0 && instructions < CLEAR_ROUTINE_CEILING) {
      cpu.step();
      instructions += 1;
    }
    expect(cpu.r).toBe(1 << DISPLAY_GRID);
    while (cpu.oLines === 0 && instructions < CLEAR_ROUTINE_CEILING) {
      cpu.step();
      instructions += 1;
    }
    expect(cpu.oIndex).toBe(LIT_O_INDEX);
    expect(cpu.oLines).toBe(O_LINE_MASK);
  });

  it('clears every one of the eight RAM files, not just the first', () => {
    const { cpu, ram } = clearingCore();
    cpu.run(CLEAR_ROUTINE_CEILING);
    expect(ram.snapshot()).toHaveLength(RAM_FILE_COUNT * RAM_WORDS_PER_FILE);
    expect(ram.snapshot().every((nibble) => nibble === 0)).toBe(true);
  });
});

describe('branches', () => {
  it('takes a branch when status is set and skips it when clear', () => {
    const taken = coreRunning([op(Mnemonic.CLA), op(Mnemonic.BR, pcForOrdinal(9))]);
    taken.run(2);
    expect(taken.registers.pc).toBe(pcForOrdinal(9));

    // YNEC 0 with Y = 0 clears status, so the branch immediately after it is not
    // taken and execution falls through to the next word.
    const skipped = coreRunning([op(Mnemonic.YNEC, 0), op(Mnemonic.BR, pcForOrdinal(9))]);
    skipped.run(2);
    expect(skipped.registers.pc).toBe(pcForOrdinal(2));
  });

  it('makes a branch unconditional if anything not status-setting sits between test and branch', () => {
    // TI's rule, S3 section 2.9: "If an instruction that does not affect status
    // is placed between an instruction that does affect status and a branch or
    // call instruction, then the branch or call is always successful." The test
    // and the branch must be adjacent.
    const separated = coreRunning([
      op(Mnemonic.YNEC, 0),
      op(Mnemonic.CLA),
      op(Mnemonic.BR, pcForOrdinal(9)),
    ]);
    separated.run(3);
    expect(separated.registers.pc).toBe(pcForOrdinal(9));
  });

  it('moves the page buffer into the page on a taken branch outside a subroutine', () => {
    const cpu = coreRunning([op(Mnemonic.LDP, 3), op(Mnemonic.BR, pcForOrdinal(0))]);
    cpu.run(2);
    expect(cpu.registers.inSubroutine).toBe(false);
    expect(cpu.registers.pa).toBe(3);
  });

  it('does not move the page on a taken branch inside a subroutine', () => {
    // Research doc section 2, from op_br1: `if (m_clatch == 0) m_pa = m_pb;`.
    // A subroutine's reachable code is one page number - and a BR between pages
    // inside one assembles cleanly and silently jumps to the wrong place, which
    // is why the assembler is required to reject it.
    const rom = new Tms1370Rom();
    place(rom, [op(Mnemonic.LDP, RESET_PAGE), op(Mnemonic.CALL, pcForOrdinal(8))]);
    place(rom, [op(Mnemonic.LDP, 3), op(Mnemonic.BR, pcForOrdinal(20))], RESET_PAGE, 8);
    const cpu = new Tms1370Cpu({ rom });

    cpu.run(4);
    expect(cpu.registers.inSubroutine).toBe(true);
    expect(cpu.registers.pb).toBe(3);
    expect(cpu.registers.pa).toBe(RESET_PAGE);
    expect(cpu.registers.pc).toBe(pcForOrdinal(20));
  });

  it('moves the chapter buffer into the chapter inside a subroutine as well as outside', () => {
    // `m_ca = m_cb` is not guarded by the call latch, which is what gives a
    // subroutine 128 words across two chapters (research doc section 2; S3
    // section 3.2 states the same from TI's side).
    const rom = new Tms1370Rom();
    place(rom, [op(Mnemonic.LDP, RESET_PAGE), op(Mnemonic.CALL, pcForOrdinal(8))]);
    place(rom, [op(Mnemonic.COMC), op(Mnemonic.BR, pcForOrdinal(20))], RESET_PAGE, 8);
    const cpu = new Tms1370Cpu({ rom });

    cpu.run(4);
    expect(cpu.registers.inSubroutine).toBe(true);
    expect(cpu.registers.ca).toBe(1);
    expect(cpu.registers.pa).toBe(RESET_PAGE);
  });
});

describe('subroutines', () => {
  function callingCore(): Tms1370Cpu {
    const rom = new Tms1370Rom();
    place(rom, [
      op(Mnemonic.LDP, RESET_PAGE),
      op(Mnemonic.CALL, pcForOrdinal(8)),
      op(Mnemonic.CLA),
    ]);
    place(rom, [op(Mnemonic.RETN)], RESET_PAGE, 8);
    return new Tms1370Cpu({ rom });
  }

  it('saves the following word as the return address and comes back to it', () => {
    const cpu = callingCore();
    cpu.run(2);
    expect(cpu.registers.inSubroutine).toBe(true);
    expect(cpu.registers.sr).toBe(pcForOrdinal(2));
    expect(cpu.registers.pc).toBe(pcForOrdinal(8));

    cpu.run(1);
    expect(cpu.registers.inSubroutine).toBe(false);
    expect(cpu.registers.pc).toBe(pcForOrdinal(2));
    expect(cpu.registers.pa).toBe(RESET_PAGE);
  });

  it('CALL inside a subroutine saves no return address', () => {
    // The one-level stack asserted as a capability, not as a count. Research doc
    // section 2: the save is guarded by `if (!m_clatch)`, so nesting does not
    // overflow a stack - it silently loses the outer return address, and the
    // failure is a wild jump much later rather than a fault at the call site.
    // A four-deep stack is one of the three TMS1370-in-name shapes the contract
    // names; this is what fails it.
    const rom = new Tms1370Rom();
    place(rom, [op(Mnemonic.LDP, RESET_PAGE), op(Mnemonic.CALL, pcForOrdinal(8))]);
    place(rom, [op(Mnemonic.CALL, pcForOrdinal(20))], RESET_PAGE, 8);
    const cpu = new Tms1370Cpu({ rom });

    cpu.run(2);
    const outerReturn = cpu.registers.sr;
    expect(outerReturn).toBe(pcForOrdinal(2));
    expect(cpu.registers.callLatch).toBe(1);

    cpu.run(1);
    expect(cpu.registers.pc).toBe(pcForOrdinal(20));
    expect(cpu.registers.callLatch).toBe(1);
    expect(cpu.registers.sr, 'the inner CALL overwrote the return address').toBe(outerReturn);
  });

  it('has exactly one level of return state, with no second slot to write', () => {
    const cpu = coreRunning([op(Mnemonic.CLA)]);
    expect(cpu.registers.saveReturnState(0x2a)).toBe(true);
    expect(cpu.registers.sr).toBe(0x2a);
    expect(cpu.registers.saveReturnState(0x15)).toBe(false);
    expect(cpu.registers.sr).toBe(0x2a);
  });

  it('RETN outside a subroutine restores no program counter, but still moves PB into PA', () => {
    // Research doc section 2, from op_retn1: the restore is guarded by the call
    // latch; `m_pa = m_pb` is not.
    const cpu = coreRunning([op(Mnemonic.LDP, 7), op(Mnemonic.RETN)]);
    cpu.registers.sr = 0x2a;
    cpu.run(2);
    expect(cpu.registers.pa).toBe(7);
    expect(cpu.registers.pc).toBe(pcForOrdinal(2));
    expect(cpu.registers.callLatch).toBe(0);
  });

  it('restores the chapter it was called from', () => {
    // A subroutine that crosses into chapter 1 and returns. CS is saved with SR
    // and restored with it, so the caller resumes in chapter 0 without having
    // to complement the buffer back.
    const rom = new Tms1370Rom();
    place(rom, [op(Mnemonic.LDP, RESET_PAGE), op(Mnemonic.CALL, pcForOrdinal(8))]);
    place(rom, [op(Mnemonic.COMC), op(Mnemonic.BR, pcForOrdinal(20))], RESET_PAGE, 8);
    // The branch moved the chapter without moving the page, so the rest of the
    // subroutine sits at the same page and word offsets in chapter 1.
    rom.writeAt(1, RESET_PAGE, pcForOrdinal(20), op(Mnemonic.RETN));
    const cpu = new Tms1370Cpu({ rom });

    cpu.run(4);
    expect(cpu.registers.ca).toBe(1);
    expect(cpu.registers.cs).toBe(RESET_CHAPTER);

    cpu.run(1);
    expect(cpu.registers.ca).toBe(RESET_CHAPTER);
    expect(cpu.registers.callLatch).toBe(0);
    expect(cpu.registers.pc).toBe(pcForOrdinal(2));
  });
});

describe('the O write path', () => {
  it('is structurally indexed by a 5-bit status_latch:accumulator value', () => {
    // Contract V4's core conjunct. The machine's whole output vocabulary is the
    // table's, because the core's O state *is* a five-bit index: there are 32
    // reachable states and the only route to eight lines is the PLA's decode.
    // A core accepting an arbitrary 8-bit O write fails this even if the ROM
    // never exercises it - "a TMS1370 in name" is exactly what it would be.
    const table = Array.from({ length: O_PLA_ENTRY_COUNT }, (_unused, index) => (index * 3) & 0xff);
    const pla = new Tms1370OutputPla(table);
    const everyIndexWritten: number[] = [];
    const reachable = new Set<number>();

    for (let statusLatch = 0; statusLatch <= 1; statusLatch += 1) {
      for (let a = 0; a <= 0xf; a += 1) {
        const written: number[] = [];
        const cpu = coreRunning([op(Mnemonic.TDO)], {
          outputPla: pla,
          pins: {
            writeOIndex: (index) => {
              written.push(index);
              everyIndexWritten.push(index);
            },
          },
        });
        // The reset write is one of them; the TDO below is the other.
        expect(written).toEqual([0]);
        cpu.registers.statusLatch = statusLatch;
        cpu.registers.a = a;
        cpu.step();
        expect(written).toEqual([0, (statusLatch << 4) | a]);
        reachable.add(cpu.oLines);
      }
    }

    // Every index the core can ever emit fits in five bits...
    expect(everyIndexWritten).toHaveLength(2 * 2 * 16);
    expect(everyIndexWritten.every((index) => index >= 0 && index <= O_INDEX_MASK)).toBe(true);
    // ...so the reachable output set is exactly the table's vocabulary...
    expect(reachable).toEqual(pla.vocabulary);
    // ...and every mask the table does not hold is unreachable, by exhaustion
    // over the whole 8-bit space rather than by inspection.
    for (let mask = 0; mask <= O_LINE_MASK; mask += 1) {
      if (!pla.vocabulary.has(mask)) {
        expect(reachable.has(mask), `mask 0x${mask.toString(16)} is not in the table`).toBe(false);
      }
    }
  });

  it('exposes no entry point that could name a plate mask', () => {
    // The structural half stated as a shape: if a `writeOMask` is ever added,
    // this fails. `writeO` takes the 5-bit index and nothing else, and the
    // snapshot carries `oIndex` rather than an output word.
    const surface = Object.getOwnPropertyNames(Tms1370Cpu.prototype).sort();
    expect(surface).toEqual(
      [
        'constructor',
        'cycles',
        'execute',
        'lastOpcode',
        'oIndex',
        'oLines',
        'r',
        'rOutputIndex',
        'readK',
        'readRam',
        'reset',
        'romAddress',
        'run',
        'runOscillatorPulses',
        'setR',
        'snapshot',
        'step',
        'writeO',
        'writeRam',
      ].sort(),
    );

    const cpu = coreRunning([op(Mnemonic.TDO)]);
    expect(Object.keys(cpu.snapshot())).toContain('oIndex');
    expect(Object.keys(cpu.snapshot())).not.toContain('o');
    expect(Object.keys(cpu.snapshot())).not.toContain('oLines');
  });

  it('drives darkness rather than an arbitrary pattern when no table is supplied', () => {
    const cpu = coreRunning([op(Mnemonic.TDO)]);
    cpu.registers.a = 0xf;
    cpu.registers.statusLatch = 1;
    cpu.step();
    expect(cpu.oIndex).toBe(O_INDEX_MASK);
    expect(cpu.oLines).toBe(0);
  });
});

describe('timing', () => {
  it('executes one instruction per six oscillator pulses', () => {
    // S3 section 2.8, verbatim: "Six oscillator pulses constitute one
    // instruction cycle. All instructions are executed in one instruction
    // cycle." The divider comes from timing.ts; no rate appears here.
    expect(OSCILLATOR_PULSES_PER_INSTRUCTION).toBe(CLOCK_DIVIDER);
    const cpu = coreRunning([op(Mnemonic.CLA)]);
    expect(cpu.runOscillatorPulses(OSCILLATOR_PULSES_PER_INSTRUCTION)).toBe(1);
    expect(cpu.cycles).toBe(CYCLES_PER_INSTRUCTION);
  });

  it('carries leftover pulses, so slicing the drive does not change the count', () => {
    const sliced = coreRunning([op(Mnemonic.CLA)]);
    expect(sliced.runOscillatorPulses(OSCILLATOR_PULSES_PER_INSTRUCTION - 1)).toBe(0);
    expect(sliced.runOscillatorPulses(1)).toBe(1);

    const whole = coreRunning([op(Mnemonic.CLA)]);
    whole.runOscillatorPulses(OSCILLATOR_PULSES_PER_INSTRUCTION * 10);
    let carried = 0;
    const carrier = coreRunning([op(Mnemonic.CLA)]);
    for (let slice = 0; slice < 10; slice += 1) {
      carried += carrier.runOscillatorPulses(OSCILLATOR_PULSES_PER_INSTRUCTION / 2);
      carried += carrier.runOscillatorPulses(OSCILLATOR_PULSES_PER_INSTRUCTION / 2);
    }
    expect(carried).toBe(whole.cycles);
  });

  it('derives its instruction count from the oscillator constant, never from a rate', () => {
    // One second of oscillator pulses buys CYCLE_HZ instructions, which is
    // OSCILLATOR_HZ / CLOCK_DIVIDER and is computed here for the same reason
    // timing.ts computes it: refining the oscillator estimate must move this
    // number rather than leave a stale copy behind. The midpoint of the stated
    // 50-66.7 kHz range appears nowhere as a literal.
    const cpu = coreRunning([op(Mnemonic.CLA)]);
    expect(cpu.runOscillatorPulses(OSCILLATOR_HZ)).toBe(Math.floor(CYCLE_HZ));
    expect(cpu.cycles).toBe(Math.floor(CYCLE_HZ));
  });

  it('reports the cost of a step rather than assuming it', () => {
    const cpu = coreRunning([op(Mnemonic.CLA), op(Mnemonic.CLA)]);
    expect(cpu.step()).toBe(CYCLES_PER_INSTRUCTION);
    expect(cpu.run(1)).toBe(CYCLES_PER_INSTRUCTION);
    expect(cpu.cycles).toBe(2 * CYCLES_PER_INSTRUCTION);
  });
});

describe('fetch and the program counter', () => {
  it('walks the LFSR sequence rather than counting', () => {
    const cpu = coreRunning(Array.from({ length: 8 }, () => op(Mnemonic.CLA)));
    const visited: number[] = [];
    for (let step = 0; step < 8; step += 1) {
      visited.push(cpu.registers.pc);
      cpu.step();
    }
    // The first eight physical word addresses of a page, from research doc
    // section 2's transcribed sequence.
    expect(visited).toEqual([0x00, 0x01, 0x03, 0x07, 0x0f, 0x1f, 0x3f, 0x3e]);
  });

  it('records the opcode it executed', () => {
    const cpu = coreRunning([op(Mnemonic.TAY), op(Mnemonic.CLA)]);
    cpu.step();
    expect(cpu.lastOpcode).toBe(op(Mnemonic.TAY));
    cpu.step();
    expect(cpu.lastOpcode).toBe(op(Mnemonic.CLA));
  });

  it('snapshots the whole core immutably', () => {
    const cpu = coreRunning([op(Mnemonic.CLA)]);
    const snapshot = cpu.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.registers.romAddress).toBe(RESET_ROM_ADDRESS);
    expect(snapshot.oIndex).toBe(0);
  });
});

describe('core widths', () => {
  it('names the widths the TMS1100 core actually has', () => {
    expect(X_MASK).toBe(0b111);
    expect(X_MSB).toBe(0b100);
    expect(K_MASK).toBe(0b1111);
    expect(R_INDEX_X_BIT).toBe(2);
    expect(RAM_WORD_COUNT).toBe(RAM_FILE_COUNT * RAM_WORDS_PER_FILE);
  });
});
