import { describe, it, expect } from 'vitest';
import { Tms1370Cpu } from '../cpu/tms1370/cpu.js';
import { encodeInstruction, Mnemonic } from '../cpu/tms1370/isa.js';
import { Tms1370Rom } from '../cpu/tms1370/memory.js';
import { RAM_WORD_COUNT } from '../cpu/tms1370/ram.js';
import { RESET_CHAPTER, RESET_PAGE, RESET_PC, ROM_WORD_COUNT } from '../cpu/tms1370/registers.js';
import { Display } from './display.js';
import { PowerSwitch, RAM_POWER_ON_FILL, type PoweredMachine } from './power.js';
import { Speaker } from './speaker.js';

/**
 * A ROM of nothing but SETR.
 *
 * Every word, rather than a program at the reset vector: the program counter is
 * an LFSR, so "the next instruction" is not the next address and a four-word
 * program laid down in order would not be executed in order. Filling the image
 * makes what the core runs independent of where it lands, and SETR with X and Y
 * both 0 out of reset drives exactly R0 - one observable pin, deterministically.
 */
function setrRom(): Tms1370Rom {
  return new Tms1370Rom(new Uint8Array(ROM_WORD_COUNT).fill(encodeInstruction(Mnemonic.SETR)));
}

function machine(): PoweredMachine {
  return {
    cpu: new Tms1370Cpu({ rom: setrRom() }),
    display: new Display(),
    speaker: new Speaker(),
  };
}

describe('PowerSwitch - the off position', () => {
  it('starts off, so a board is dark until something throws the switch', () => {
    const power = new PowerSwitch(machine());

    expect(power.state).toBe('off');
    expect(power.isOn).toBe(false);
  });

  it('invalidates RAM - the switch cutting the battery is the reset', () => {
    const parts = machine();
    const power = new PowerSwitch(parts, 'on');
    parts.cpu.ram.write(0, 0, 0x7);

    power.off();
    expect(parts.cpu.ram.read(0, 0)).toBe(RAM_POWER_ON_FILL);
  });

  it('leaves no nibble of RAM surviving the cut', () => {
    const parts = machine();
    const power = new PowerSwitch(parts, 'on');
    for (let address = 0; address < RAM_WORD_COUNT; address += 1) {
      parts.cpu.ram.write(address >> 4, address & 0xf, address & 0x0f);
    }

    power.off();
    const survivors = [...parts.cpu.ram.snapshot()].filter(
      (nibble) => nibble !== RAM_POWER_ON_FILL,
    );
    expect(survivors).toHaveLength(0);
  });

  it('blanks the tube', () => {
    const parts = machine();
    const power = new PowerSwitch(parts, 'on');
    parts.display.setGrids(1, 0);
    parts.display.setPlates(1, 0);
    parts.display.endFrame(100);

    power.off();
    expect(parts.display.gridMask).toBe(0);
    expect(parts.display.getLitSegments()).toEqual([]);
    expect(parts.display.frameCount).toBe(0);
  });

  it('silences the speaker and drops the pending edges', () => {
    const parts = machine();
    const power = new PowerSwitch(parts, 'on');
    parts.speaker.recordEdge(10, 1);

    power.off();
    expect(parts.speaker.level).toBe(0);
    expect(parts.speaker.edgeCount).toBe(0);
  });
});

describe('PowerSwitch - the on position', () => {
  it('resets the core to the reset vector', () => {
    const parts = machine();
    const power = new PowerSwitch(parts);
    power.on();

    expect(power.isOn).toBe(true);
    expect(parts.cpu.cycles).toBe(0);
    const registers = parts.cpu.registers.snapshot();
    expect(registers.ca).toBe(RESET_CHAPTER);
    expect(registers.pa).toBe(RESET_PAGE);
    expect(registers.pc).toBe(RESET_PC);
    expect(registers.r).toBe(0);
  });

  it('brings RAM up undefined and leaves the clearing to the ROM', () => {
    // The whole of the power-on RAM story on this core. The supply arriving does
    // not zero PMOS RAM and neither does INIT, so a machine that has just been
    // switched on is holding junk until the program's own clear routine runs -
    // which costs real instruction time before the first sweep and is a
    // power-on garbage flash the hardware actually has.
    const parts = machine();
    const power = new PowerSwitch(parts);
    power.on();

    expect(parts.cpu.ram.read(0, 0)).toBe(RAM_POWER_ON_FILL);
    expect(RAM_POWER_ON_FILL).not.toBe(0);
  });

  it('rewinds display accounting with the core cycle counter', () => {
    const parts = machine();
    const power = new PowerSwitch(parts, 'on');
    parts.display.setGrids(1, 5_000);

    power.cycle();
    expect(parts.cpu.cycles).toBe(0);
    expect(() => parts.display.setGrids(1, 10)).not.toThrow();
  });

  it('rewinds speaker timestamps with it too', () => {
    const parts = machine();
    const power = new PowerSwitch(parts, 'on');
    parts.speaker.recordEdge(5_000, 1);

    power.cycle();
    expect(() => parts.speaker.recordEdge(10, 1)).not.toThrow();
    expect(parts.speaker.edges[0]).toEqual({ cycle: 10, level: 1 });
  });

  it('restarts a running machine when thrown on again', () => {
    const parts = machine();
    const power = new PowerSwitch(parts, 'on');
    parts.cpu.run(100);

    power.on();
    expect(parts.cpu.cycles).toBe(0);
    expect(power.isOn).toBe(true);
  });
});

describe('PowerSwitch - power cycling', () => {
  it('is the machine only restart path, and it clears the score', () => {
    const parts = machine();
    const power = new PowerSwitch(parts, 'on');
    parts.cpu.run(200);
    parts.cpu.ram.write(0, 5, 0x9);

    power.cycle();
    expect(parts.cpu.ram.read(0, 5)).toBe(RAM_POWER_ON_FILL);
    expect(parts.cpu.cycles).toBe(0);
    expect(power.isOn).toBe(true);
  });

  it('leaves the machine running the same ROM from the top', () => {
    const parts = machine();
    const power = new PowerSwitch(parts, 'on');
    parts.cpu.run(100);
    const before = parts.cpu.registers.r;
    expect(before).not.toBe(0);

    power.cycle();
    expect(parts.cpu.registers.r).toBe(0);
    parts.cpu.run(100);
    expect(parts.cpu.registers.r).toBe(before);
  });
});
