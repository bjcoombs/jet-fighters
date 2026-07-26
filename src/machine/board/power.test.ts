import { describe, it, expect } from 'vitest';
import { HMCS44CPU } from '../cpu/cpu.js';
import { encode } from '../cpu/decoder.js';
import { InstructionType } from '../cpu/instruction.js';
import { RAM_POWER_ON_FILL, RAM_SIZE } from '../cpu/memory.js';
import { Display } from './display.js';
import { PowerSwitch, type PoweredMachine } from './power.js';
import { Speaker } from './speaker.js';

/** A ROM that strobes grid 0 with a plate and then spins. */
function tickerRom(): Uint16Array {
  const rom = new Uint16Array(2048);
  const program = [
    encode(InstructionType.LAI, 1),
    encode(InstructionType.LRA, 0),
    encode(InstructionType.SED, 0),
    encode(InstructionType.NOP),
  ];
  rom.set(program);
  return rom;
}

function machine(): PoweredMachine {
  return { cpu: new HMCS44CPU(tickerRom()), display: new Display(), speaker: new Speaker() };
}

describe('PowerSwitch - the off position', () => {
  it('starts off, so a board is dark until something throws the switch', () => {
    const parts = machine();
    const power = new PowerSwitch(parts);

    expect(power.state).toBe('off');
    expect(power.isOn).toBe(false);
    expect(parts.cpu.running).toBe(false);
  });

  it('halts the core where it stands', () => {
    const parts = machine();
    const power = new PowerSwitch(parts, 'on');
    parts.cpu.run(50);
    const cycles = parts.cpu.cycles;

    power.off();
    expect(parts.cpu.running).toBe(false);
    expect(parts.cpu.run(100)).toBe(0);
    expect(parts.cpu.cycles).toBe(cycles);
  });

  it('invalidates RAM - the switch cutting the battery is the reset', () => {
    const parts = machine();
    const power = new PowerSwitch(parts, 'on');
    parts.cpu.memory.writeRam(0, 0x7);

    power.off();
    expect(parts.cpu.memory.readRam(0)).toBe(RAM_POWER_ON_FILL);
    expect(parts.cpu.memory.ramCleared).toBe(false);
  });

  it('leaves no nibble of RAM surviving the cut', () => {
    const parts = machine();
    const power = new PowerSwitch(parts, 'on');
    for (let address = 0; address < RAM_SIZE; address += 1) {
      parts.cpu.memory.writeRam(address, address & 0x0f);
    }

    power.off();
    const survivors = parts.cpu.memory
      .snapshot()
      .ram.filter((nibble) => nibble !== RAM_POWER_ON_FILL);
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
  it('resets the core and starts it running', () => {
    const parts = machine();
    const power = new PowerSwitch(parts);
    power.on();

    expect(power.isOn).toBe(true);
    expect(parts.cpu.running).toBe(true);
    expect(parts.cpu.cycles).toBe(0);
    expect(parts.cpu.registers.pc).toBe(0);
  });

  it('brings RAM up undefined and then clears it', () => {
    const parts = machine();
    const power = new PowerSwitch(parts);
    power.on();

    expect(parts.cpu.memory.ramCleared).toBe(true);
    expect(parts.cpu.memory.readRam(0)).toBe(0);
  });

  it('exposes the undefined window between supply and clear loop', () => {
    const parts = machine();
    const power = new PowerSwitch(parts);
    power.powerOnUncleared();

    expect(power.isOn).toBe(true);
    expect(parts.cpu.memory.ramCleared).toBe(false);
    expect(parts.cpu.memory.readRam(0)).toBe(RAM_POWER_ON_FILL);
  });

  it('rewinds display accounting with the CPU cycle counter', () => {
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
    parts.cpu.memory.writeRam(5, 0x9);

    power.cycle();
    expect(parts.cpu.memory.readRam(5)).toBe(0);
    expect(parts.cpu.cycles).toBe(0);
    expect(parts.cpu.running).toBe(true);
  });

  it('leaves the machine running the same ROM from the top', () => {
    const parts = machine();
    const power = new PowerSwitch(parts, 'on');
    parts.cpu.run(100);
    const before = parts.cpu.getState().ports.rPins;

    power.cycle();
    expect(parts.cpu.getState().ports.rPins).toBe(0);
    parts.cpu.run(100);
    expect(parts.cpu.getState().ports.rPins).toBe(before);
  });
});
