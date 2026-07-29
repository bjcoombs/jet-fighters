// Reading the original artifacts, against a file system that has none of them.
//
// Paths in this file are relative to the repository root.
//
// Every byte in this file is synthetic. No romset artifact is committed to this
// repository, none has been obtained, and nothing here is a decode of a real
// one - the PLA texts below are hand-written in the Berkeley form to exercise
// the reader, not transcriptions of `tms1100_ginv_output.pla`.
//
// The first group is the important one: an absent romset is an ordinary,
// reportable state and never an exception. Contract V11 turns on that, because
// a harness that throws when the romset is missing is a harness nobody can run
// today.

import { describe, expect, it } from 'vitest';
import {
  ARTIFACTS,
  COMPARISON_ARTIFACTS,
  RomsetError,
  describeAssumptions,
  inspectRomset,
  loadComparisonTarget,
  loadOutputPla,
  parsePla,
  type RomsetFs,
} from './romset.js';
import { O_PLA_ENTRY_COUNT } from '../../src/machine/cpu/tms1370/opla.js';
import { ROM_WORD_COUNT } from '../../src/machine/cpu/tms1370/registers.js';

/** A file system holding exactly the files a test names, and nothing else. */
function fakeFs(files: Record<string, string | Uint8Array>): RomsetFs {
  const bytesOf = (path: string): Uint8Array => {
    const value = files[path];
    if (value === undefined) {
      throw new Error(`no such file: ${path}`);
    }
    return typeof value === 'string' ? new TextEncoder().encode(value) : value;
  };
  return {
    exists: (path) => Object.hasOwn(files, path),
    readBytes: bytesOf,
    readText: (path) => new TextDecoder().decode(bytesOf(path)),
  };
}

/**
 * A Berkeley-form PLA in the shape the reader expects, built by hand.
 *
 * One term per index, no don't-cares, so the expected table is exactly the
 * masks passed in. Written MSB-first in both planes, which is what the reader
 * assumes by default and what the test therefore has to state explicitly.
 */
function plaText(masks: readonly number[]): string {
  const terms = masks.map(
    (mask, index) =>
      `${index.toString(2).padStart(5, '0')} ${mask.toString(2).padStart(8, '0')}`,
  );
  return ['# synthetic, this test only', '.i 5', '.o 8', `.p ${terms.length}`, ...terms, '.e'].join(
    '\n',
  );
}

describe('an absent romset', () => {
  const nothing = fakeFs({});

  it('is a report, not an exception', () => {
    const inspection = inspectRomset('/romsets/ginv', nothing);
    expect(inspection.present).toEqual([]);
    expect(inspection.absent).toEqual(Object.values(ARTIFACTS));
    expect(inspection.comparable).toBe(false);
  });

  it('names all four artifacts, so a reader knows what to go and find', () => {
    const inspection = inspectRomset('/romsets/ginv', nothing);
    expect(inspection.absent).toContain('mp2110');
    expect(inspection.absent).toContain('tms1100_ginv_output.pla');
    expect(inspection.absent).toContain('tms1100_common2_micro.pla');
    expect(inspection.absent).toContain('ginv.svg');
  });

  it('is only an error when a caller has asked for a target it cannot build', () => {
    expect(() => loadComparisonTarget('/romsets/ginv', {}, nothing)).toThrow(RomsetError);
    expect(() => loadComparisonTarget('/romsets/ginv', {}, nothing)).toThrow(/mp2110/);
  });
});

describe('a partial romset', () => {
  it('is not comparable on a program dump alone', () => {
    const fs = fakeFs({ '/r/mp2110': new Uint8Array(ROM_WORD_COUNT) });
    const inspection = inspectRomset('/r', fs);
    expect(inspection.present).toEqual(['mp2110']);
    expect(inspection.comparable).toBe(false);
    // The message has to say *why*, because "a dump is not enough" is the one
    // thing a reader of this harness gets wrong by default.
    expect(() => loadComparisonTarget('/r', {}, fs)).toThrow(/cannot say\s+what lights/);
  });

  it('needs both of the two comparison artifacts', () => {
    expect(COMPARISON_ARTIFACTS).toEqual(['mp2110', 'tms1100_ginv_output.pla']);
  });
});

describe('a complete comparison target', () => {
  const masks = Array.from({ length: O_PLA_ENTRY_COUNT }, (_unused, index) => index * 7);
  const rom = Uint8Array.from({ length: ROM_WORD_COUNT }, (_unused, at) => at & 0xff);
  const fs = fakeFs({
    '/r/mp2110': rom,
    '/r/tms1100_ginv_output.pla': plaText(masks.map((mask) => mask & 0xff)),
  });

  it('loads the dump and the table that interprets it', () => {
    const image = loadComparisonTarget('/r', {}, fs);
    expect(image.name).toBe('mp2110');
    expect(image.rom).toEqual(rom);
    expect([...image.opla]).toEqual(masks.map((mask) => mask & 0xff));
  });

  it('carries its provenance, assumptions and all, into the report', () => {
    const image = loadComparisonTarget('/r', {}, fs);
    expect(image.provenance).toContain('/r/mp2110');
    expect(image.provenance).toContain('/r/tms1100_ginv_output.pla');
    expect(image.provenance).toContain('ASSUMED');
    expect(image.provenance).toContain('unverified');
  });

  it('rejects a dump larger than the ROM the chip addresses', () => {
    const oversized = fakeFs({
      '/r/mp2110': new Uint8Array(ROM_WORD_COUNT + 1),
      '/r/tms1100_ginv_output.pla': plaText(masks.map(() => 0)),
    });
    expect(() => loadComparisonTarget('/r', {}, oversized)).toThrow(/2048/);
  });
});

describe('reading a Berkeley-form output PLA', () => {
  it('expands a term’s don’t-cares over every index it covers', () => {
    // `----1` is every odd index; `0000-` is indices 0 and 1.
    const text = ['.i 5', '.o 8', '.p 2', '----1 00000001', '0000- 10000000', '.e'].join('\n');
    const table = parsePla(text);
    expect(table[0]).toBe(0b1000_0000);
    expect(table[1]).toBe(0b1000_0001);
    expect(table[3]).toBe(0b0000_0001);
    expect(table[2]).toBe(0);
  });

  it('reads both planes the other way round when told to', () => {
    const text = ['.i 5', '.o 8', '.p 1', '10000 00000001', '.e'].join('\n');
    expect(parsePla(text)[16]).toBe(0b0000_0001);
    expect(parsePla(text, { inputOrder: 'lsb-first', outputOrder: 'lsb-first' })[1]).toBe(
      0b1000_0000,
    );
  });

  it('ignores comments and the keywords it has no use for', () => {
    const text = [
      '# TMS1100 output PLA',
      '.type fd',
      '.i 5',
      '.o 8',
      '.ilb s a3 a2 a1 a0',
      '.p 1',
      '00001 00000011  # a comment on a term',
      '.e',
    ].join('\n');
    expect(parsePla(text)[1]).toBe(0b11);
  });

  it('refuses a table whose term count does not match its own header', () => {
    // A file truncated in transit parses cleanly and is wrong, and a wrong
    // table is reported as a difference in the *original's* display. That false
    // finding is worse than a refusal.
    const text = ['.i 5', '.o 8', '.p 4', '00000 00000001', '.e'].join('\n');
    expect(() => parsePla(text)).toThrow(/declares 4 terms and holds 1/);
  });

  it('refuses a plane width that is not this chip’s', () => {
    expect(() => parsePla(['.i 4', '.o 8', '.p 0', '.e'].join('\n'))).toThrow(/indexed by 5 bits/);
    expect(() => parsePla(['.i 5', '.o 5', '.p 0', '.e'].join('\n'))).toThrow(/8 O lines/);
  });

  it('refuses a file that is not a PLA at all', () => {
    expect(() => parsePla('nothing here')).toThrow(/not a Berkeley-form PLA/);
  });
});

describe('reading a raw table', () => {
  it('takes at most 32 masks and pads the rest dark', () => {
    const fs = fakeFs({ '/r/table.bin': Uint8Array.from([0x00, 0x81, 0x42]) });
    const table = loadOutputPla('/r/table.bin', {}, fs);
    expect(table.length).toBe(O_PLA_ENTRY_COUNT);
    expect([...table.subarray(0, 3)]).toEqual([0x00, 0x81, 0x42]);
    expect([...table.subarray(3)].every((mask) => mask === 0)).toBe(true);
  });

  it('refuses a file too long to be either form', () => {
    const fs = fakeFs({ '/r/table.bin': new Uint8Array(O_PLA_ENTRY_COUNT + 1) });
    expect(() => loadOutputPla('/r/table.bin', {}, fs)).toThrow(/at most 32 masks/);
  });
});

describe('the assumptions line', () => {
  it('says what was assumed and that it was not verified', () => {
    expect(describeAssumptions()).toContain('input msb-first');
    expect(describeAssumptions()).toContain('output msb-first');
    expect(describeAssumptions()).toContain('unverified');
    expect(describeAssumptions({ inputOrder: 'lsb-first' })).toContain('input lsb-first');
  });
});
