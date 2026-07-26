import { describe, it, expect } from 'vitest';
import {
  D_GRID_FIRST,
  D_GRID_LAST,
  D_GRID_MASK,
  D_INPUT,
  D_MASK,
  D_PIN_COUNT,
  D_SPEAKER,
  PIN_FLOAT_LEVEL,
  Ports,
  R_MASK,
  R_PIN_COUNT,
  R_PORT_COUNT,
  R_PORT_WIDTH,
} from './ports.js';

/** All D pins driving 0 - the state `reset()` leaves behind. */
function quietPorts(): Ports {
  return new Ports();
}

describe('Ports - reset state', () => {
  it('comes up with every pin an output holding 0', () => {
    const ports = quietPorts();
    expect(ports.dOutput).toBe(0);
    expect(ports.dDirection).toBe(D_MASK);
    expect(ports.readDPort()).toBe(0);
    expect(ports.rOutput).toBe(0);
    expect(ports.rDirection).toBe(R_MASK);
    expect(ports.readRPort()).toBe(0);
  });

  it('leaves no grid strobed and the speaker at rest', () => {
    const ports = quietPorts();
    expect(ports.readGrids()).toBe(0);
    expect(ports.readSpeaker()).toBe(0);
  });

  it('returns to the quiet state after being driven', () => {
    const ports = quietPorts();
    ports.writeDPort(D_MASK, D_MASK);
    ports.writeRPort(R_MASK, R_MASK);
    ports.reset();
    expect(ports.readDPort()).toBe(0);
    expect(ports.readRPort()).toBe(0);
  });
});

describe('Ports - D pin read and write', () => {
  it('reflects the output latch on an output pin', () => {
    const ports = quietPorts();
    ports.writeD(3, 1);
    expect(ports.readD(3)).toBe(1);
    ports.writeD(3, 0);
    expect(ports.readD(3)).toBe(0);
  });

  it('treats any non-zero write as a 1', () => {
    const ports = quietPorts();
    ports.writeD(2, 9);
    expect(ports.readD(2)).toBe(1);
  });

  it('leaves neighbouring pins untouched', () => {
    const ports = quietPorts();
    ports.writeD(5, 1);
    expect(ports.readD(4)).toBe(0);
    expect(ports.readD(6)).toBe(0);
    expect(ports.readDPort()).toBe(1 << 5);
  });

  it('rejects pin indices outside D0-D15', () => {
    const ports = quietPorts();
    expect(() => ports.readD(-1)).toThrow(RangeError);
    expect(() => ports.readD(D_PIN_COUNT)).toThrow(RangeError);
    expect(() => ports.writeD(16, 1)).toThrow(RangeError);
    expect(() => ports.setDDirection(1.5, true)).toThrow(RangeError);
  });
});

describe('Ports - open-drain semantics', () => {
  it('pulls low on 0 and floats on 1', () => {
    const ports = quietPorts();
    ports.setExternalD(7, 1);

    ports.writeD(7, 0);
    expect(ports.readD(7)).toBe(0);
    expect(ports.isDFloating(7)).toBe(false);

    ports.writeD(7, 1);
    expect(ports.isDFloating(7)).toBe(true);
    expect(ports.readD(7)).toBe(1);
  });

  it('wins over the external level while it is pulling low', () => {
    const ports = quietPorts();
    ports.setExternalD(7, 1);
    ports.writeD(7, 0);
    // The board cannot drive a pin the chip is holding down.
    expect(ports.readD(7)).toBe(0);
  });

  it('shows the external level through a released pin', () => {
    const ports = quietPorts();
    ports.writeD(7, 1);
    ports.setExternalD(7, 0);
    expect(ports.readD(7)).toBe(0);
    ports.setExternalD(7, 1);
    expect(ports.readD(7)).toBe(1);
  });

  it('floats undriven pins to the documented idle level', () => {
    const ports = quietPorts();
    ports.setDDirection(9, false);
    expect(ports.isDFloating(9)).toBe(true);
    expect(ports.readD(9)).toBe(PIN_FLOAT_LEVEL);
  });
});

describe('Ports - direction register', () => {
  it('changes whether a pin follows its latch or the outside world', () => {
    const ports = quietPorts();
    ports.setExternalD(11, 1);
    ports.writeD(11, 0);
    expect(ports.readD(11)).toBe(0);

    ports.setDDirection(11, false);
    expect(ports.readD(11)).toBe(1);

    ports.setDDirection(11, true);
    expect(ports.readD(11)).toBe(0);
  });

  it('preserves the latch across a direction change', () => {
    const ports = quietPorts();
    ports.writeD(12, 1);
    ports.setDDirection(12, false);
    ports.setDDirection(12, true);
    expect(ports.dOutput & (1 << 12)).toBe(1 << 12);
    expect(ports.readD(12)).toBe(1);
  });

  it('sets several directions at once through a mask', () => {
    const ports = quietPorts();
    ports.setDDirectionPort(D_GRID_MASK, 0);
    expect(ports.dDirection).toBe(D_MASK & ~D_GRID_MASK);
    expect(ports.readD(0)).toBe(PIN_FLOAT_LEVEL);
    expect(ports.readD(10)).toBe(0);
  });
});

describe('Ports - grid strobes (V3)', () => {
  it('strobes one grid at a time across D0-D9', () => {
    const ports = quietPorts();
    const strobed: number[] = [];

    for (let grid = D_GRID_FIRST; grid <= D_GRID_LAST; grid += 1) {
      ports.writeDPort(D_GRID_MASK, 1 << grid);
      expect(ports.readGrids()).toBe(1 << grid);
      strobed.push(grid);
    }

    expect(strobed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('keeps the grid mask clear of the speaker and input pins', () => {
    expect(D_GRID_MASK & (1 << D_SPEAKER)).toBe(0);
    expect(D_GRID_MASK & (1 << D_INPUT)).toBe(0);
  });

  it('does not disturb the grids when the speaker toggles', () => {
    const ports = quietPorts();
    ports.writeDPort(D_GRID_MASK, 1 << 4);
    ports.writeD(D_SPEAKER, 1);
    expect(ports.readGrids()).toBe(1 << 4);
  });
});

describe('Ports - D14 speaker (V5)', () => {
  it('toggles independently of every other pin', () => {
    const ports = quietPorts();
    ports.writeDPort(D_MASK & ~(1 << D_SPEAKER), D_GRID_MASK);
    const others = ports.readDPort() & ~(1 << D_SPEAKER);

    ports.writeD(D_SPEAKER, 1);
    expect(ports.readSpeaker()).toBe(1);
    expect(ports.readDPort() & ~(1 << D_SPEAKER)).toBe(others);

    ports.writeD(D_SPEAKER, 0);
    expect(ports.readSpeaker()).toBe(0);
    expect(ports.readDPort() & ~(1 << D_SPEAKER)).toBe(others);
  });

  it('reports one edge per transition, not per write', () => {
    const ports = quietPorts();
    const edges: number[] = [];
    ports.onDChange = (pin, value) => {
      if (pin === D_SPEAKER) {
        edges.push(value);
      }
    };

    ports.writeD(D_SPEAKER, 1);
    ports.writeD(D_SPEAKER, 1);
    ports.writeD(D_SPEAKER, 0);
    ports.writeD(D_SPEAKER, 1);

    expect(edges).toEqual([1, 0, 1]);
  });
});

describe('Ports - D15 input (V4)', () => {
  it('reads the external state the board drives', () => {
    const ports = quietPorts();
    ports.setDDirection(D_INPUT, false);

    ports.setExternalD(D_INPUT, 0);
    expect(ports.readD(D_INPUT)).toBe(0);

    ports.setExternalD(D_INPUT, 1);
    expect(ports.readD(D_INPUT)).toBe(1);
  });

  it('reads the external state through the open-drain idiom too', () => {
    // The real HMCS40 D pins have no direction latch: the program writes 1 to
    // release the pin, then reads it back.
    const ports = quietPorts();
    ports.writeD(D_INPUT, 1);
    ports.setExternalD(D_INPUT, 0);
    expect(ports.readD(D_INPUT)).toBe(0);
  });

  it('sees a strobed key only while its own strobe line is asserted', () => {
    const ports = quietPorts();
    ports.setDDirection(D_INPUT, false);
    // Board convention for this test: the key ties D15 to the strobe on D2.
    const wireMatrix = (): void => {
      ports.setExternalD(D_INPUT, ports.readD(2));
    };

    ports.writeDPort(D_GRID_MASK, 1 << 2);
    wireMatrix();
    expect(ports.readD(D_INPUT)).toBe(1);

    ports.writeDPort(D_GRID_MASK, 1 << 3);
    wireMatrix();
    expect(ports.readD(D_INPUT)).toBe(0);
  });
});

describe('Ports - bulk D access', () => {
  it('writes only the masked bits', () => {
    const ports = quietPorts();
    ports.writeDPort(D_MASK, 0xffff);
    ports.writeDPort(0x000f, 0x0005);
    expect(ports.dOutput).toBe(0xfff5);
  });

  it('ignores value bits outside the mask', () => {
    const ports = quietPorts();
    ports.writeDPort(0x00f0, 0xffff);
    expect(ports.dOutput).toBe(0x00f0);
  });

  it('discards bits above D15', () => {
    const ports = quietPorts();
    ports.writeDPort(0xf0000 | D_MASK, 0xfffff);
    expect(ports.dOutput).toBe(D_MASK);
    expect(ports.readDPort()).toBe(D_MASK);
  });

  it('reads back the resolved pin state, not the latch', () => {
    const ports = quietPorts();
    ports.writeDPort(D_MASK, D_MASK);
    ports.setExternalDPort(0x00ff, 0x0000);
    expect(ports.dOutput).toBe(D_MASK);
    expect(ports.readDPort()).toBe(0xff00);
  });
});

describe('Ports - R ports', () => {
  it('reads and writes single pins across all 20', () => {
    const ports = quietPorts();
    for (let pin = 0; pin < R_PIN_COUNT; pin += 1) {
      ports.writeR(pin, 1);
      expect(ports.readR(pin)).toBe(1);
      ports.writeR(pin, 0);
      expect(ports.readR(pin)).toBe(0);
    }
  });

  it('rejects pin indices outside R0-R19', () => {
    const ports = quietPorts();
    expect(() => ports.readR(R_PIN_COUNT)).toThrow(RangeError);
    expect(() => ports.writeR(-1, 1)).toThrow(RangeError);
  });

  it('applies the same open-drain resolution as the D ports', () => {
    const ports = quietPorts();
    ports.setExternalR(17, 1);

    ports.writeR(17, 0);
    expect(ports.readR(17)).toBe(0);
    expect(ports.isRFloating(17)).toBe(false);

    ports.writeR(17, 1);
    expect(ports.isRFloating(17)).toBe(true);
    expect(ports.readR(17)).toBe(1);

    ports.setExternalR(17, 0);
    expect(ports.readR(17)).toBe(0);
  });

  it('honours the direction register like the D ports', () => {
    const ports = quietPorts();
    ports.setExternalR(2, 1);
    ports.writeR(2, 0);
    expect(ports.readR(2)).toBe(0);
    ports.setRDirection(2, false);
    expect(ports.readR(2)).toBe(1);
  });

  it('writes only the masked bits and discards bits above R19', () => {
    const ports = quietPorts();
    ports.writeRPort(R_MASK, R_MASK);
    ports.writeRPort(0x0000f, 0x00003);
    expect(ports.rOutput).toBe(0xffff3);

    ports.writeRPort(0xfffffff, 0xfffffff);
    expect(ports.rOutput).toBe(R_MASK);
    expect(ports.readRPort()).toBe(R_MASK);
  });

  it('transfers 4-bit nibbles on ports R0-R4', () => {
    const ports = quietPorts();
    expect(R_PORT_COUNT).toBe(5);
    expect(R_PORT_COUNT * R_PORT_WIDTH).toBe(R_PIN_COUNT);

    ports.writeRNibble(0, 0x5);
    ports.writeRNibble(4, 0xa);
    expect(ports.readRNibble(0)).toBe(0x5);
    expect(ports.readRNibble(4)).toBe(0xa);
    expect(ports.readRNibble(1)).toBe(0x0);
    expect(ports.readRPort()).toBe(0xa0005);
  });

  it('masks nibble writes to 4 bits and rejects unknown ports', () => {
    const ports = quietPorts();
    ports.writeRNibble(1, 0xff);
    expect(ports.readRNibble(1)).toBe(0x0f);
    expect(ports.readRNibble(2)).toBe(0x00);
    expect(() => ports.writeRNibble(R_PORT_COUNT, 0)).toThrow(RangeError);
  });
});

describe('Ports - change callbacks', () => {
  it('fires once per changed pin on a bulk write', () => {
    const ports = quietPorts();
    const changes: Array<[number, number]> = [];
    ports.onDChange = (pin, value) => changes.push([pin, value]);

    ports.writeDPort(D_MASK, 0b101);

    expect(changes).toEqual([
      [0, 1],
      [2, 1],
    ]);
  });

  it('fires when a direction change alters the observable pin', () => {
    const ports = quietPorts();
    ports.setExternalD(6, 1);
    ports.writeD(6, 0);
    const changes: Array<[number, number]> = [];
    ports.onDChange = (pin, value) => changes.push([pin, value]);

    ports.setDDirection(6, false);

    expect(changes).toEqual([[6, 1]]);
  });

  it('fires when the board changes an external level a pin is showing', () => {
    const ports = quietPorts();
    ports.writeD(8, 1);
    const changes: Array<[number, number]> = [];
    ports.onDChange = (pin, value) => changes.push([pin, value]);

    ports.setExternalD(8, 0);

    expect(changes).toEqual([[8, 0]]);
  });

  it('stays silent when a write leaves the pin state unchanged', () => {
    const ports = quietPorts();
    ports.writeD(1, 1);
    const changes: Array<[number, number]> = [];
    ports.onDChange = (pin, value) => changes.push([pin, value]);

    ports.writeD(1, 1);
    // The chip is not pulling D1 down, so the external level is invisible here.
    ports.setDDirection(1, false);

    expect(changes).toEqual([]);
  });

  it('reports R-port transitions through onRChange', () => {
    const ports = quietPorts();
    const changes: Array<[number, number]> = [];
    ports.onRChange = (pin, value) => changes.push([pin, value]);

    ports.writeRNibble(3, 0x9);

    expect(changes).toEqual([
      [12, 1],
      [15, 1],
    ]);
  });

  it('is optional - port writes work with no listener attached', () => {
    const ports = quietPorts();
    expect(() => ports.writeDPort(D_MASK, D_MASK)).not.toThrow();
    expect(() => ports.writeRPort(R_MASK, R_MASK)).not.toThrow();
  });
});

describe('Ports - snapshot', () => {
  it('records the registers and the resolved pin state', () => {
    const ports = quietPorts();
    ports.writeDPort(D_GRID_MASK, 1 << 5);
    ports.setDDirection(D_INPUT, false);
    ports.setExternalD(D_INPUT, 0);
    ports.writeRNibble(0, 0x3);

    expect(ports.snapshot()).toMatchObject({
      dOutput: 1 << 5,
      dPins: 1 << 5,
      rOutput: 0x3,
      rPins: 0x3,
    });
  });

  it('is a copy, not a live view of the port file', () => {
    const ports = quietPorts();
    const snapshot = ports.snapshot();
    ports.writeD(D_SPEAKER, 1);
    expect(snapshot.dPins).toBe(0);
  });
});
