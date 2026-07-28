import { describe, expect, it } from 'vitest';
import {
  assemble,
  AsmError,
  OPLA_SLOT_COUNT,
  SymbolKind,
  type AssembledWord,
  type AssemblyResult,
} from './assembler.js';
import {
  LFSR_SEQUENCE,
  RAM_SIZE,
  RESET_ADDRESS,
  RESET_CHAPTER,
  RESET_PAGE,
  ROM_PAGE_COUNT,
  ROM_PAGE_SIZE,
  ROM_SIZE,
  romAddress,
  WORD_MASK,
} from './memory.js';

/** The word emitted at a ROM address, or undefined. */
function wordAt(result: AssemblyResult, address: number): AssembledWord | undefined {
  return result.words.find((word) => word.address === address);
}

/** The value of a symbol, or a failed expectation naming it. */
function symbol(result: AssemblyResult, name: string): number {
  const found = result.symbols.find((entry) => entry.name === name);
  expect(found, `no symbol '${name}'`).toBeDefined();
  return (found as { value: number }).value;
}

/** `n` copies of a one-word instruction, one per line. */
function filler(count: number, mnemonic = 'RETN'): string {
  return `${mnemonic}\n`.repeat(count);
}

describe('LFSR placement', () => {
  it('puts the n-th instruction of a page at physical offset lfsr[n]', () => {
    const result = assemble(filler(8, 'CLA'));
    expect(result.words.map((word) => word.offset).sort((a, b) => a - b)).toEqual(
      [...LFSR_SEQUENCE.slice(0, 8)].sort((a, b) => a - b),
    );
    for (let ordinal = 0; ordinal < 8; ordinal += 1) {
      const word = wordAt(result, LFSR_SEQUENCE[ordinal] as number);
      expect(word?.ordinal, `ordinal ${ordinal}`).toBe(ordinal);
    }
  });

  it('does not lay instructions down sequentially', () => {
    const result = assemble(filler(8, 'CLA'));
    const disagreeing = result.words.filter((word) => word.ordinal !== word.offset);
    expect(disagreeing.length).toBeGreaterThan(0);
    // The third instruction of a page is the first that moves.
    expect(wordAt(result, 0x03)?.ordinal).toBe(2);
  });

  it('agrees with the ordinal on only five of a page\'s sixty-four words', () => {
    const result = assemble(filler(ROM_PAGE_SIZE, 'CLA'));
    const agreeing = result.words.filter((word) => word.ordinal === word.offset);
    // Fixed points of the sequence in docs/research/tms1370-architecture.md.
    expect(agreeing.map((word) => word.ordinal).sort((a, b) => a - b)).toEqual([0, 1, 22, 24, 35]);
    expect(agreeing.length * 10).toBeLessThan(ROM_PAGE_SIZE);
  });

  it('fills a page completely - the LFSR is a bijection over it', () => {
    const result = assemble(filler(ROM_PAGE_SIZE, 'CLA'));
    expect(result.words).toHaveLength(ROM_PAGE_SIZE);
    expect(new Set(result.words.map((word) => word.address)).size).toBe(ROM_PAGE_SIZE);
  });
});

describe('labels resolve to LFSR states', () => {
  it('binds a label to the physical address, not the ordinal position', () => {
    const result = assemble('CLA\nCLA\nCLA\nhere: CLA\n');
    // Fourth instruction: ordinal 3, LFSR state $07.
    expect(symbol(result, 'here')).toBe(0x07);
    expect(LFSR_SEQUENCE[3]).toBe(0x07);
  });

  it('carries the chapter and page in the label value', () => {
    const result = assemble('.CHAPTER 1\n.PAGE 3\nhere: CLA\n');
    expect(symbol(result, 'here')).toBe(romAddress(1, 3, 0));
  });

  it('emits a branch operand that is the target LFSR state', () => {
    const result = assemble('CLA\nCLA\nCLA\ntarget: CLA\nBR target\n');
    const branch = result.instructions.find((entry) => entry.mnemonic === 'BR');
    expect(branch?.operand).toBe(0x07);
    expect(branch?.target).toBe(0x07);
    expect(wordAt(result, branch?.address as number)?.word).toBe(0x80 | 0x07);
  });

  it('emits the low six bits for a target on another page', () => {
    const result = assemble('.PAGE 2\nfar: CLA\n.PAGE 0\nBR far\n');
    const branch = result.instructions.find((entry) => entry.mnemonic === 'BR');
    expect(branch?.target).toBe(romAddress(0, 2, 0));
    expect(branch?.operand).toBe(0);
  });

  it('resolves a label defined further down - two passes exist for this', () => {
    const result = assemble('BR later\nCLA\nlater: CLA\n');
    expect(symbol(result, 'later')).toBe(LFSR_SEQUENCE[2]);
  });

  it('rejects an unknown symbol', () => {
    expect(() => assemble('BR nowhere\n')).toThrow(/unknown symbol 'nowhere'/);
  });

  it('rejects a redefinition, naming where the first one was', () => {
    expect(() => assemble('a: CLA\na: CLA\n')).toThrow(/'a' is already defined at .*:1:1/);
  });
});

describe('the page allocator reserves the reset page', () => {
  it('never allocates chapter 0 page 15 to general code', () => {
    // Fifteen bare `.PAGE` directives - one more than the pages below the reset
    // page - each with a word on it, then one more that must fail rather than
    // land on the reset page.
    const source = `${'.PAGE\nCLA\n'.repeat(ROM_PAGE_COUNT - 1)}`;
    const result = assemble(source);
    const pagesUsed = new Set(result.words.map((word) => `${word.chapter}:${word.page}`));
    expect(pagesUsed.size).toBe(ROM_PAGE_COUNT - 1);
    expect(pagesUsed.has(`${RESET_CHAPTER}:${RESET_PAGE}`)).toBe(false);
  });

  it('records the reservation as a claim made before any source was read', () => {
    const claim = assemble('CLA\n').pageClaims.find(
      (entry) => entry.chapter === RESET_CHAPTER && entry.page === RESET_PAGE,
    );
    expect(claim?.reserved).toBe(true);
    expect(claim?.position).toBeUndefined();
  });

  it('refuses a bare .PAGE rather than handing over the reset page, and says why', () => {
    const source = `${'.PAGE\nCLA\n'.repeat(ROM_PAGE_COUNT - 1)}.PAGE\nCLA\n`;
    expect(() => assemble(source)).toThrow(
      /no free page left in chapter 0.*chapter 0, page 15 is reserved for the reset routine/s,
    );
  });

  it('wraps to a lower free page rather than refusing after an explicit .PAGE 15', () => {
    // Reset routine first, then a bare `.PAGE` for everything else - the layout
    // that a forward-only allocator would reject while pages 0-14 sat empty.
    const result = assemble('.PAGE 15\nreset: CLA\n.PAGE\nmain: CLA\n');
    expect(symbol(result, 'reset')).toBe(RESET_ADDRESS);
    expect(symbol(result, 'main')).toBe(romAddress(0, 0, 0));
  });

  it('never wraps onto a page that already holds code', () => {
    const result = assemble('.PAGE 0\nCLA\n.PAGE 15\nCLA\n.PAGE\nhere: CLA\n');
    expect(symbol(result, 'here')).toBe(romAddress(0, 1, 0));
  });

  it('still lets the source place the reset routine there explicitly', () => {
    const result = assemble('.PAGE 15\nreset: CLA\n');
    expect(symbol(result, 'reset')).toBe(RESET_ADDRESS);
    expect(result.resetVectorPresent).toBe(true);
  });

  it('reports the reset vector as absent when nothing was emitted at it', () => {
    expect(assemble('CLA\n').resetVectorPresent).toBe(false);
  });

  it('leaves the reset page free in chapter 1 - only chapter 0 page 15 is the entry', () => {
    const source = `.CHAPTER 1\n${'.PAGE\nCLA\n'.repeat(ROM_PAGE_COUNT)}`;
    const result = assemble(source);
    const pagesUsed = new Set(result.words.map((word) => `${word.chapter}:${word.page}`));
    expect(pagesUsed.size).toBe(ROM_PAGE_COUNT);
    expect(pagesUsed.has(`1:${RESET_PAGE}`)).toBe(true);
  });
});

describe('the hardware ceilings are assembly errors, not silent wrapping', () => {
  it('rejects a 65th word on a page rather than wrapping to the next', () => {
    expect(() => assemble(filler(ROM_PAGE_SIZE + 1, 'CLA'))).toThrow(
      /chapter 0, page 0 is full: a page holds 64 words/,
    );
  });

  it('rejects running past the 2048th word rather than wrapping to zero', () => {
    // Every page of both chapters filled, then one more word.
    const chapters = [0, 1]
      .map((chapter) => {
        const pages = Array.from(
          { length: ROM_PAGE_COUNT },
          (_unused, page) => `.PAGE ${page}\n${filler(ROM_PAGE_SIZE, 'CLA')}`,
        ).join('');
        return `.CHAPTER ${chapter}\n${pages}`;
      })
      .join('');
    const full = assemble(chapters);
    expect(full.words).toHaveLength(ROM_SIZE);
    expect(() => assemble(`${chapters}CLA\n`)).toThrow(/chapter 1, page 15 is full/);
  });

  it('rejects a .PAGE past the last page', () => {
    expect(() => assemble(`.PAGE ${ROM_PAGE_COUNT}\n`)).toThrow(
      /\.PAGE number out of range: 16 \(expected 0\.\.15\)/,
    );
  });

  it('rejects a .CHAPTER past the last chapter', () => {
    expect(() => assemble('.CHAPTER 2\n')).toThrow(/\.CHAPTER number out of range: 2/);
  });

  it('rejects an .ORG past the last ROM word', () => {
    expect(() => assemble(`.ORG ${ROM_SIZE}\n`)).toThrow(
      /\.ORG address out of range: 2048 \(expected 0\.\.2047\)/,
    );
  });

  it('rejects a RAM_ constant past the 128th nibble rather than wrapping', () => {
    expect(() => assemble(`.EQU RAM_TOP, ${RAM_SIZE}\n`)).toThrow(
      /'RAM_TOP' reaches RAM nibble 128, past the 128 nibbles the device implements/,
    );
    expect(assemble(`.EQU RAM_TOP, ${RAM_SIZE - 1}\n`).ramHighWater).toBe(RAM_SIZE);
  });

  it('rejects an LDX naming a RAM file the device does not have', () => {
    expect(() => assemble('LDX 8\n')).toThrow(/LDX RAM file out of range: 8 \(expected 0\.\.7\)/);
    expect(assemble('LDX 7\n').ramHighWater).toBe(RAM_SIZE);
  });

  it('rejects two regions overlapping rather than letting the later one win', () => {
    expect(() => assemble('.ORG 0\nCLA\n.ORG 0\nCLA\n')).toThrow(
      /\$000 \(chapter 0, page 0, word 0\) already holds a word emitted at/,
    );
  });
});

describe('every emitted word is eight bits', () => {
  it('holds instructions inside 0..255', () => {
    const result = assemble('CLA\nLDP 15\nBR 0\nCALL 0\nTCY 15\nA15AAC\n');
    for (const word of result.words) {
      expect(word.word).toBeGreaterThanOrEqual(0);
      expect(word.word).toBeLessThanOrEqual(WORD_MASK);
    }
  });

  it('rejects a .DB item wider than a word', () => {
    expect(() => assemble('.DB 256\n')).toThrow(/\.DB value out of range: 256/);
  });

  it('splits a .DW item into two eight-bit words, high byte first', () => {
    const result = assemble('.DW $1234\n');
    expect(result.words).toHaveLength(2);
    const byOrdinal = [...result.words].sort((left, right) => left.ordinal - right.ordinal);
    expect(byOrdinal.map((word) => word.word)).toEqual([0x12, 0x34]);
    for (const word of result.words) {
      expect(word.word).toBeLessThanOrEqual(WORD_MASK);
    }
  });

  it('rejects a .DW item wider than sixteen bits', () => {
    expect(() => assemble('.DW $10000\n')).toThrow(/\.DW value out of range/);
  });

  it('emits one word per character of a .DB string', () => {
    const result = assemble('.DB "HI"\n');
    expect(result.words.map((word) => word.word).sort()).toEqual([0x48, 0x49]);
  });
});

describe('layout directives', () => {
  it('.ORG positions the cursor by physical address and carries on in LFSR order', () => {
    const result = assemble('.ORG $003\nCLA\nCLA\n');
    const ordinals = [...result.words].sort((left, right) => left.ordinal - right.ordinal);
    expect(ordinals.map((word) => word.ordinal)).toEqual([2, 3]);
    expect(ordinals.map((word) => word.offset)).toEqual([0x03, 0x07]);
  });

  it('.PAGE with a number starts that page of the current chapter', () => {
    const result = assemble('.PAGE 4\nhere: CLA\n');
    expect(symbol(result, 'here')).toBe(romAddress(0, 4, 0));
  });

  it('.PAGE with no number takes the next free page', () => {
    const result = assemble('CLA\n.PAGE\nhere: CLA\n');
    expect(symbol(result, 'here')).toBe(romAddress(0, 1, 0));
  });

  it('.PAGE never hands back a page already holding code', () => {
    const result = assemble('.PAGE 0\nCLA\n.PAGE\nhere: CLA\n');
    expect(symbol(result, 'here')).toBe(romAddress(0, 1, 0));
  });

  it('resolves a bare .PAGE identically on both passes', () => {
    // A label after the `.PAGE` and a branch to it from before it can only agree
    // if the allocator gave the same answer twice.
    const result = assemble('BR here\n.PAGE\nhere: CLA\n');
    const branch = result.instructions.find((entry) => entry.mnemonic === 'BR');
    expect(branch?.target).toBe(romAddress(0, 1, 0));
    expect(symbol(result, 'here')).toBe(romAddress(0, 1, 0));
  });

  it('.CHAPTER selects a chapter at its page 0', () => {
    const result = assemble('.CHAPTER 1\nhere: CLA\n');
    expect(symbol(result, 'here')).toBe(romAddress(1, 0, 0));
  });

  it('.RES reserves words without emitting them', () => {
    const result = assemble('.RES 3\nhere: CLA\n');
    expect(result.words).toHaveLength(1);
    expect(symbol(result, 'here')).toBe(LFSR_SEQUENCE[3]);
  });

  it('rejects a layout directive that names a symbol defined below it', () => {
    expect(() => assemble('.ORG LATER\n.EQU LATER, 4\n')).toThrow(
      /layout directives and \.EQU are resolved as the assembler reaches them/,
    );
  });
});

describe('.EQU', () => {
  it('binds a constant', () => {
    const result = assemble('.EQU SPEED, 3\nTCY SPEED\n');
    expect(symbol(result, 'SPEED')).toBe(3);
    expect(result.symbols[0]?.kind).toBe(SymbolKind.CONSTANT);
  });

  it('counts a RAM_ constant towards the high-water mark', () => {
    expect(assemble('.EQU RAM_SCORE, 20\n').ramHighWater).toBe(21);
  });

  it('rejects a negative RAM_ constant', () => {
    expect(() => assemble('.EQU RAM_X, -1\n')).toThrow(/must be a RAM address, got -1/);
  });
});

describe('.OPLA', () => {
  it('assembles a declared slot into the table', () => {
    const result = assemble('.OPLA 3, %00001111\n');
    expect(result.opla[3]).toBe(0x0f);
    expect(result.oplaEntries).toHaveLength(1);
  });

  it('leaves every undeclared slot dark', () => {
    const result = assemble('.OPLA 3, $0F\n');
    expect(result.opla).toHaveLength(OPLA_SLOT_COUNT);
    for (let slot = 0; slot < OPLA_SLOT_COUNT; slot += 1) {
      if (slot !== 3) {
        expect(result.opla[slot], `slot ${slot}`).toBe(0);
      }
    }
  });

  it('emits a 32-slot table even when the source declares nothing', () => {
    const result = assemble('CLA\n');
    expect(result.opla).toHaveLength(OPLA_SLOT_COUNT);
    expect([...result.opla].every((mask) => mask === 0)).toBe(true);
  });

  it('accepts an explicit dark slot 0', () => {
    expect(assemble('.OPLA 0, 0\n').oplaEntries).toHaveLength(1);
  });

  it('rejects a lit slot 0 - reset writes index 0 before the program chooses', () => {
    expect(() => assemble('.OPLA 0, 1\n')).toThrow(
      /O PLA slot 0 must be all plates dark.*flash of garbage at power-on/s,
    );
  });

  it('rejects a slot past the five-bit index', () => {
    expect(() => assemble('.OPLA 32, 0\n')).toThrow(
      /\.OPLA slot index out of range: 32 \(expected 0\.\.31\)/,
    );
  });

  it('rejects a mask wider than the eight plates the O PLA drives', () => {
    expect(() => assemble('.OPLA 1, 256\n')).toThrow(
      /\.OPLA plate mask out of range: 256 \(expected 0\.\.255\)/,
    );
  });

  it('rejects declaring the same slot twice', () => {
    expect(() => assemble('.OPLA 1, 1\n.OPLA 1, 2\n')).toThrow(
      /O PLA slot 1 is already declared at/,
    );
  });

  it('occupies no program words - it is mask-programmed data, not code', () => {
    expect(assemble('.OPLA 1, 1\n.OPLA 2, 2\n').words).toHaveLength(0);
  });
});

describe('the instruction record the later analyses run over', () => {
  it('is in source order and fully addressed', () => {
    const result = assemble('CLA\nTAY\nBR 0\n');
    expect(result.instructions.map((entry) => entry.mnemonic)).toEqual(['CLA', 'TAY', 'BR']);
    expect(result.instructions.map((entry) => entry.ordinal)).toEqual([0, 1, 2]);
    expect(result.instructions.map((entry) => entry.offset)).toEqual([0x00, 0x01, 0x03]);
  });

  it('records the operand as the source wrote it, not as it was encoded', () => {
    const ldx = assemble('LDX 1\n').instructions[0];
    expect(ldx?.operand).toBe(1);
    expect(assemble('LDX 1\n').words[0]?.word).toBe(0x2c);
  });

  it('records the branch target address as well as the six bits emitted', () => {
    const result = assemble('.PAGE 2\nfar: CLA\n.PAGE 0\nCALL far\n');
    const call = result.instructions.find((entry) => entry.mnemonic === 'CALL');
    expect(call?.target).toBe(romAddress(0, 2, 0));
    expect(call?.operand).toBe(0);
  });
});

describe('.INCLUDE', () => {
  it('splices another source in', () => {
    const result = assemble('.INCLUDE "other.asm"\nCLA\n', 'main.asm', {
      readInclude: () => ({ file: 'other.asm', source: 'CLA\n' }),
    });
    expect(result.words).toHaveLength(2);
  });

  it('is a diagnostic when no reader was supplied', () => {
    expect(() => assemble('.INCLUDE "other.asm"\n')).toThrow(/called without a file reader/);
  });

  it('rejects a cycle', () => {
    expect(() =>
      assemble('.INCLUDE "a.asm"\n', 'a.asm', {
        readInclude: () => ({ file: 'a.asm', source: '.INCLUDE "a.asm"\n' }),
      }),
    ).toThrow(/\.INCLUDE cycle/);
  });

  it('stops an included file at its own .END', () => {
    const result = assemble('.INCLUDE "other.asm"\nCLA\n', 'main.asm', {
      readInclude: () => ({ file: 'other.asm', source: 'CLA\n.END\nCLA\n' }),
    });
    expect(result.words).toHaveLength(2);
  });
});

describe('diagnostics', () => {
  it('carry a file, line and column', () => {
    try {
      assemble('CLA\n  LDX 9\n', 'game.asm');
      expect.unreachable('expected an AsmError');
    } catch (error) {
      expect(error).toBeInstanceOf(AsmError);
      expect((error as AsmError).message).toMatch(/^game\.asm:2:7:/);
    }
  });
});

describe('an empty assembly', () => {
  it('produces nothing and reports no highest address', () => {
    const result = assemble('');
    expect(result.words).toHaveLength(0);
    expect(result.highestAddress).toBe(-1);
    expect(result.ramHighWater).toBe(0);
  });
});
