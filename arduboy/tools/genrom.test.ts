// Does the generated header hold the ROM the assembler produced, at the
// addresses the machine will fetch from?
//
// Paths in this file are relative to the repository root.
//
// ## What this is guarding
//
// Regeneration being byte-identical proves nothing here. A generator that laid
// the words down in source order, or numbered them by ordinal, would be
// deterministic, would match the word count, would match the PLA slot count,
// and would ship a ROM whose program counter walks into words the program never
// wrote. Determinism is a property of the generator; this file is about the
// *map*.
//
// So the assertion that matters is the cross-check against the listing's own
// two columns. `tools/tmsasm/output.ts` prints `ORD` and `OFF` on every row,
// including the ones where they agree, precisely so the difference is visible
// without reassembling - and on this ROM they disagree on 1500 of 1655 words,
// which is what gives the check its teeth. A header built the wrong way fails
// on the first disagreeing row.

import { describe, expect, it } from 'vitest';

import { OPLA_SLOT_COUNT } from '../../tools/tmsasm/assembler.js';
import { oplaImage, romImage } from '../../tools/tmsasm/output.js';
import { assembleRom, renderHeader, ROM_WORDS, sourceDigest } from './genrom.js';

/** Pull the named PROGMEM array back out of the rendered header. */
function parseArray(header: string, name: string): number[] {
  const match = new RegExp(`${name}\\[[^\\]]+\\] PROGMEM = \\{([^}]*)\\}`, 's').exec(header);
  expect(match, `${name} not found in the header`).not.toBeNull();
  return Array.from(match![1].matchAll(/0x([0-9A-F]{2})/g), (m) => Number.parseInt(m[1]!, 16));
}

describe('genrom', () => {
  const result = assembleRom();
  const header = renderHeader(result, sourceDigest());
  const rom = parseArray(header, 'JF_ROM');
  const opla = parseArray(header, 'JF_OPLA');

  it('emits every word of the address space, not just the ones the source wrote', () => {
    expect(rom).toHaveLength(ROM_WORDS);
    expect(opla).toHaveLength(OPLA_SLOT_COUNT);
  });

  it('places every assembled word at its physical ROM address', () => {
    // `romImage` is the reference for the map; this asserts the header did not
    // re-derive it. Every word, not a sample: the failure this catches is
    // systematic, so a sample that missed it would be luck.
    const image = romImage(result);
    for (const word of result.words) {
      expect(rom[word.address], `word at ${word.address}`).toBe(image[word.address]);
      expect(rom[word.address], `word at ${word.address}`).toBe(word.word);
    }
  });

  it('is exercised by a ROM whose ordinal and offset mostly disagree', () => {
    // Non-vacuity. If this ROM happened to place every instruction at its own
    // ordinal, the assertion above would pass for a source-ordered generator
    // too, and this file would be guarding nothing. It disagrees on most words.
    const disagreeing = result.words.filter(
      (word) => (word.address & 0x3f) !== word.ordinal,
    ).length;
    expect(disagreeing).toBeGreaterThan(result.words.length / 2);
  });

  it('fills every unwritten word with MNEA rather than leaving it to the linker', () => {
    // 0x00 decodes as MNEA and walks quietly; flash erases to 0xFF, which is
    // CALL and writes outputs. A partial initialiser would leave the tail to
    // the toolchain, which is the choice the fill word exists to make.
    const written = new Set(result.words.map((word) => word.address));
    for (let address = 0; address < ROM_WORDS; address += 1) {
      if (!written.has(address)) {
        expect(rom[address], `unwritten word at ${address}`).toBe(0x00);
      }
    }
  });

  it('carries the output PLA the assembler built, dark slot included', () => {
    expect(opla).toEqual(Array.from(oplaImage(result)));
    // Reset writes index 0 before the program has chosen anything, so a lit
    // slot 0 is a flash of garbage at power-on.
    expect(opla[0]).toBe(0);
  });

  it('records the source digest, so a stale header is identifiable by eye', () => {
    expect(header).toContain(sourceDigest());
    expect(header).toContain(`${result.words.length} of ${ROM_WORDS} emitted`);
  });

  it('regenerates byte-identically from the same source', () => {
    const again = renderHeader(assembleRom(), sourceDigest());
    expect(again).toBe(header);
  });
});
