import { describe, it, expect } from 'vitest';
import {
  assemble,
  AsmError,
  RAM_SYMBOL_PREFIX,
  SymbolKind,
  type AssemblyResult,
} from './assembler.js';
import { decode, encode, encodeLong, longAddress } from '../../src/machine/cpu/decoder.js';
import { InstructionType, isTwoWord } from '../../src/machine/cpu/instruction.js';
import {
  RAM_FILE_SIZE,
  RAM_SIZE,
  ROM_PAGE_SIZE,
  ROM_PROGRAM_SIZE,
  ROM_SIZE,
} from '../../src/machine/cpu/memory.js';
import { ISA, OperandKind } from '../../src/machine/cpu/isa.js';

/** Assemble a fragment under the name diagnostics quote. */
function build(source: string): AssemblyResult {
  return assemble(source, 'jetfighter.asm');
}

/** Just the words, in address order. */
function wordsOf(source: string): readonly number[] {
  return build(source).words.map((word) => word.word);
}

/** The AsmError a fragment raises, so a test can assert on its position. */
function errorFrom(source: string): AsmError {
  try {
    build(source);
  } catch (error) {
    expect(error).toBeInstanceOf(AsmError);
    return error as AsmError;
  }
  expect.unreachable('expected an AsmError');
  throw new Error('unreachable');
}

/** The symbol table as a plain object, for terse assertions. */
function symbolValues(result: AssemblyResult): Record<string, number> {
  return Object.fromEntries(result.symbols.map((symbol) => [symbol.name, symbol.value]));
}

describe('assemble - encoding comes from the shared ISA table', () => {
  it('emits the word encodeInstruction builds, not one of its own', () => {
    expect(wordsOf('LAI 5\n')).toEqual([encode(InstructionType.LAI, 5)]);
    expect(wordsOf('NOP\n')).toEqual([encode(InstructionType.NOP)]);
  });

  it('assembles every instruction in the architecture to a decodable word', () => {
    for (const entry of ISA) {
      if (entry.words === 2) {
        // Two-word instructions take a target address, exercised separately.
        continue;
      }
      const source =
        entry.operandKind === OperandKind.NONE ? `${entry.mnemonic}\n` : `${entry.mnemonic} 0\n`;
      const words = wordsOf(source);
      expect(words, entry.mnemonic).toHaveLength(1);
      expect(decode(words[0] as number).type, entry.mnemonic).toBe(entry.type);
    }
  });

  it('splits a long jump across two words the decoder recombines', () => {
    const words = wordsOf('.ORG $400\nJMPL $123\n');
    expect(words).toEqual(encodeLong(InstructionType.JMPL, 0x123));
    const instruction = decode(words[0] as number);
    expect(isTwoWord(instruction)).toBe(true);
    expect(longAddress(instruction, words[1] as number)).toBe(0x123);
  });

  it('splits a long call the same way', () => {
    const words = wordsOf('CALL $7FF\n');
    const instruction = decode(words[0] as number);
    expect(instruction.type).toBe(InstructionType.CALL);
    expect(longAddress(instruction, words[1] as number)).toBe(0x7ff);
  });
});

describe('assemble - two passes and symbols', () => {
  it('binds a label to the address of the next word emitted after it', () => {
    const result = build('NOP\nstart:\nLAI 1\n');
    expect(symbolValues(result)).toEqual({ start: 1 });
    expect(result.symbols[0]?.kind).toBe(SymbolKind.LABEL);
  });

  it('binds a label sharing a line with its instruction to that instruction', () => {
    expect(symbolValues(build('NOP\nloop: LAI 1\n'))).toEqual({ loop: 1 });
  });

  it('resolves a forward reference from pass one', () => {
    const words = wordsOf('JMPL done\nNOP\ndone:\nNOP\n');
    expect(longAddress(decode(words[0] as number), words[1] as number)).toBe(3);
  });

  it('takes a constant from .EQU and folds it into an operand expression', () => {
    const result = build('.EQU SPEED, 2\nLAI SPEED + 1\n');
    expect(symbolValues(result)).toEqual({ SPEED: 2 });
    expect(result.symbols[0]?.kind).toBe(SymbolKind.CONSTANT);
    expect(result.words[0]?.word).toBe(encode(InstructionType.LAI, 3));
  });

  it('treats symbol names case-sensitively', () => {
    const result = build('.EQU Speed, 1\n.EQU SPEED, 2\nNOP\n');
    expect(symbolValues(result)).toEqual({ Speed: 1, SPEED: 2 });
  });

  it('rejects a redefinition and names where the first definition was', () => {
    const error = errorFrom('.EQU SPEED, 1\n.EQU SPEED, 2\n');
    expect(error.message).toMatch(/'SPEED' is already defined at jetfighter\.asm:1:6/);
    expect(error.position).toMatchObject({ line: 2, column: 6 });
  });

  it('rejects a label colliding with a constant', () => {
    expect(() => build('.EQU main, 1\nmain:\nNOP\n')).toThrow(/'main' is already defined/);
  });

  it('rejects an unknown symbol at the position it was referenced', () => {
    const error = errorFrom('NOP\nLAI  missing\n');
    expect(error.message).toMatch(/unknown symbol 'missing'/);
    expect(error.position).toMatchObject({ line: 2, column: 6 });
  });

  it('explains that a layout directive cannot look forward', () => {
    const error = errorFrom('.ORG here\nhere:\nNOP\n');
    expect(error.message).toMatch(/only use symbols defined above/);
    expect(error.position).toMatchObject({ line: 1, column: 6 });
  });
});

describe('assemble - layout directives', () => {
  it('sets the emit address from .ORG', () => {
    const result = build('.ORG $100\nNOP\n');
    expect(result.words[0]?.address).toBe(0x100);
    expect(result.highestAddress).toBe(0x100);
  });

  it('returns words in address order however the .ORG regions were written', () => {
    const result = build('.ORG $10\nLAI 1\n.ORG $00\nLAI 2\n');
    expect(result.words.map((word) => word.address)).toEqual([0x00, 0x10]);
  });

  it('rejects two regions overlapping, naming the earlier word', () => {
    const error = errorFrom('.ORG $10\nLAI 1\n.ORG $10\nLAI 2\n');
    expect(error.message).toMatch(/\$010 already holds a word emitted at jetfighter\.asm:2:1/);
    expect(error.position).toMatchObject({ line: 4, column: 1 });
  });

  it('starts a numbered page with .PAGE', () => {
    expect(build('.PAGE 3\nNOP\n').words[0]?.address).toBe(3 * ROM_PAGE_SIZE);
  });

  it('advances .PAGE with no operand to the next page boundary', () => {
    expect(build('NOP\n.PAGE\nNOP\n').words[1]?.address).toBe(ROM_PAGE_SIZE);
  });

  it('leaves .PAGE with no operand alone when already on a boundary', () => {
    expect(build('.PAGE\nNOP\n').words[0]?.address).toBe(0);
  });

  it('pads forward to a boundary with .ALIGN', () => {
    expect(build('NOP\n.ALIGN 8\nNOP\n').words[1]?.address).toBe(8);
  });

  it('rejects a non-positive .ALIGN boundary', () => {
    expect(() => build('.ALIGN 0\nNOP\n')).toThrow(/positive whole number of words/);
  });

  it('reserves words with .RES without emitting them', () => {
    const result = build('NOP\n.RES 4\nNOP\n');
    expect(result.words).toHaveLength(2);
    expect(result.words[1]?.address).toBe(5);
  });

  it('assembles into a pattern table with .PATTERN', () => {
    const result = build('.PATTERN 2\n.DW 1, 2\n');
    expect(result.words.map((word) => word.address)).toEqual([
      ROM_PROGRAM_SIZE + 32,
      ROM_PROGRAM_SIZE + 33,
    ]);
  });

  it('starts .PATTERN with no operand at the foot of the pattern region', () => {
    expect(build('.PATTERN\n.DW 1\n').words[0]?.address).toBe(ROM_PROGRAM_SIZE);
  });

  it('rejects a pattern table the device does not have', () => {
    expect(() => build('.PATTERN 8\n.DW 1\n')).toThrow(/\.PATTERN table out of range: 8/);
  });
});

describe('assemble - data directives', () => {
  it('emits one word per .DW item', () => {
    expect(wordsOf('.DW 1, $3FF, %101\n')).toEqual([1, 0x3ff, 5]);
  });

  it('rejects a .DW item wider than a ten-bit word', () => {
    expect(() => build('.DW $400\n')).toThrow(/\.DW value out of range: 1024 \(expected 0\.\.1023\)/);
  });

  it('emits one byte-sized word per .DB item', () => {
    expect(wordsOf('.DB 0, 255\n')).toEqual([0, 255]);
  });

  it('rejects a .DB item wider than a byte', () => {
    expect(() => build('.DB 256\n')).toThrow(/\.DB value out of range: 256 \(expected 0\.\.255\)/);
  });

  it('expands a .DB string to one word per character', () => {
    expect(wordsOf('.DB "HI!"\n')).toEqual([72, 73, 33]);
  });

  it('rejects a character that does not fit in a byte', () => {
    const error = errorFrom('.DB "\\n\u00e9\u4e2d"\n');
    expect(error.message).toMatch(/character code 20013 does not fit in 0\.\.255/);
  });

  it('reserves the same space in both passes, so a following label is right', () => {
    expect(symbolValues(build('.DB "ABC", 4\nafter:\nNOP\n'))).toEqual({ after: 4 });
  });
});

describe('assemble - branch reachability', () => {
  it('turns a same-page BR target into an in-page offset', () => {
    const words = wordsOf('.ORG $45\ntarget:\nNOP\nBR target\n');
    expect(words[1]).toBe(encode(InstructionType.BR, 0x05));
  });

  it('rejects a BR to another page and names both pages', () => {
    const error = errorFrom('.ORG $00\nfar:\nNOP\n.ORG $40\nBR far\n');
    expect(error.message).toMatch(/BR reaches only its own page/);
    expect(error.message).toMatch(/page 2 and \$000 is on page 0/);
    expect(error.position).toMatchObject({ line: 5, column: 4 });
  });

  it('turns a page-0 CAL target into an in-page offset', () => {
    const words = wordsOf('.ORG $07\nsub:\nNOP\n.ORG $80\nCAL sub\n');
    expect(words[1]).toBe(encode(InstructionType.CAL, 0x07));
  });

  it('rejects a CAL outside page 0 and points at CALL', () => {
    const error = errorFrom('.ORG $40\nsub:\nNOP\nCAL sub\n');
    expect(error.message).toMatch(/CAL reaches page 0 only/);
    expect(error.message).toMatch(/Use CALL for a subroutine outside page 0/);
  });

  it('rejects a branch target outside the program region', () => {
    expect(() => build('BR $800\n')).toThrow(/BR target out of the program region: 2048/);
  });

  it('rejects a long jump outside the program region', () => {
    expect(() => build('JMPL $800\n')).toThrow(/JMPL target address out of range: 2048/);
  });
});

describe('assemble - operand ranges come off the ISA row', () => {
  it('rejects an immediate wider than four bits', () => {
    const error = errorFrom('LAI 16\n');
    expect(error.message).toMatch(/LAI immediate out of range: 16 \(expected 0\.\.15\)/);
    expect(error.position).toMatchObject({ line: 1, column: 5 });
  });

  it('rejects a negative immediate', () => {
    expect(() => build('LAI -1\n')).toThrow(/LAI immediate out of range: -1/);
  });

  it('rejects an R port the device does not have', () => {
    expect(() => build('LAR 5\n')).toThrow(/LAR R port out of range: 5 \(expected 0\.\.4\)/);
  });

  it('rejects a RAM bit index above three', () => {
    expect(() => build('SEM 4\n')).toThrow(/SEM RAM bit out of range: 4 \(expected 0\.\.3\)/);
  });

  it('rejects a pattern table above seven', () => {
    expect(() => build('P 8\n')).toThrow(/P pattern table out of range: 8 \(expected 0\.\.7\)/);
  });

  it('accepts every valid operand of every group instruction', () => {
    for (const entry of ISA) {
      if (entry.operandKind === OperandKind.NONE || entry.words === 2) {
        continue;
      }
      if (entry.operandKind === OperandKind.PAGE_OFFSET) {
        continue;
      }
      for (let operand = 0; operand < entry.operandLimit; operand += 1) {
        // LXI encodes all sixteen file numbers, but the device implements ten;
        // the RAM ceiling check rejects the other six, and has its own tests.
        if (entry.type === InstructionType.LXI && operand >= RAM_SIZE / RAM_FILE_SIZE) {
          continue;
        }
        const words = wordsOf(`${entry.mnemonic} ${operand}\n`);
        expect(words[0], `${entry.mnemonic} ${operand}`).toBe(encode(entry.type, operand));
      }
    }
  });
});

describe('assemble - the 2048-word program ceiling', () => {
  it('fills the program region exactly without complaint', () => {
    const result = build(`.ORG ${ROM_PROGRAM_SIZE - 1}\nNOP\n`);
    expect(result.highestAddress).toBe(ROM_PROGRAM_SIZE - 1);
  });

  it('rejects a word that would land in the pattern region by running off the end', () => {
    const error = errorFrom(`.ORG ${ROM_PROGRAM_SIZE - 1}\nNOP\nNOP\n`);
    expect(error.message).toMatch(/ROM overflow: the program region holds 2048 words/);
    expect(error.message).toMatch(/reached with \.PATTERN, not by running off the end/);
    expect(error.position).toMatchObject({ line: 3, column: 1 });
  });

  it('rejects a two-word instruction straddling the end of the program region', () => {
    expect(() => build(`.ORG ${ROM_PROGRAM_SIZE - 1}\nJMPL 0\n`)).toThrow(/ROM overflow/);
  });

  it('rejects .RES running past the end of the program region', () => {
    expect(() => build('.ORG $7FF\n.RES 2\nNOP\n')).toThrow(/ROM overflow/);
  });

  it('rejects a word past the end of the pattern region too', () => {
    expect(() => build(`.ORG ${ROM_SIZE - 1}\n.DW 1, 2\n`)).toThrow(
      /ROM overflow: \$880 is past the last ROM word \$87F/,
    );
  });

  it('rejects an .ORG outside the ROM entirely', () => {
    expect(() => build(`.ORG ${ROM_SIZE}\nNOP\n`)).toThrow(/\.ORG address out of range: 2176/);
  });
});

describe('assemble - the RAM high-water mark', () => {
  it('is zero for a program that names no RAM file', () => {
    expect(build('NOP\n').ramHighWater).toBe(0);
  });

  it('counts one whole file per LXI, since Y reaches every nibble of it', () => {
    expect(build('LXI 0\n').ramHighWater).toBe(RAM_FILE_SIZE);
    expect(build('LXI 2\nLXI 1\n').ramHighWater).toBe(3 * RAM_FILE_SIZE);
  });

  it('counts the last file of the device as the whole of RAM', () => {
    expect(build('LXI 9\n').ramHighWater).toBe(RAM_SIZE);
  });

  it('rejects an LXI selecting a RAM file the device does not implement', () => {
    const error = errorFrom('NOP\nLXI 10\n');
    expect(error.message).toMatch(/LXI 10 selects RAM file 10, which reaches RAM nibble 175/);
    expect(error.message).toMatch(/past the 160 nibbles the device implements/);
    expect(error.position).toMatchObject({ line: 2, column: 1 });
  });

  it(`counts an .EQU named with the ${RAM_SYMBOL_PREFIX} prefix as a RAM address`, () => {
    expect(build('.EQU RAM_SCORE, 32\nNOP\n').ramHighWater).toBe(33);
  });

  it('ignores a constant that does not claim to be a RAM address', () => {
    expect(build('.EQU SPEED, 999\nNOP\n').ramHighWater).toBe(0);
  });

  it('rejects a RAM_ constant past the end of RAM', () => {
    expect(() => build(`.EQU RAM_TOP, ${RAM_SIZE}\nNOP\n`)).toThrow(
      /'RAM_TOP' reaches RAM nibble 160, past the 160 nibbles/,
    );
  });

  it('rejects a RAM_ constant that is not an address at all', () => {
    expect(() => build('.EQU RAM_BASE, -1\nNOP\n')).toThrow(/its value must be a RAM address/);
  });

  it('takes the larger of the LXI and RAM_ constant claims', () => {
    expect(build('.EQU RAM_FLAGS, 100\nLXI 1\n').ramHighWater).toBe(101);
    expect(build('.EQU RAM_FLAGS, 4\nLXI 4\n').ramHighWater).toBe(5 * RAM_FILE_SIZE);
  });
});

describe('assemble - listing metadata', () => {
  it('carries the source line each word came from', () => {
    const result = build('  LAI 5   ; load\n');
    expect(result.words[0]?.sourceLine).toBe('  LAI 5   ; load');
  });

  it('marks the second word of a two-word instruction as a continuation', () => {
    const result = build('CALL $10\n');
    expect(result.words.map((word) => word.continuation)).toEqual([false, true]);
  });

  it('marks every word of a data directive after the first as a continuation', () => {
    const result = build('.DW 1, 2, 3\n');
    expect(result.words.map((word) => word.continuation)).toEqual([false, true, true]);
  });

  it('reports an empty assembly as having no highest address', () => {
    const result = build('; nothing but a comment\n');
    expect(result.words).toHaveLength(0);
    expect(result.highestAddress).toBe(-1);
  });

  it('freezes the result and its word list', () => {
    const result = build('NOP\n');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.words)).toBe(true);
    expect(Object.isFrozen(result.words[0])).toBe(true);
  });
});

describe('assemble - .END and .INCLUDE', () => {
  it('stops assembling a file at .END', () => {
    expect(wordsOf('LAI 1\n.END\nLAI 2\n')).toEqual([encode(InstructionType.LAI, 1)]);
  });

  it('splices an included file in at the point of the directive', () => {
    const result = assemble('LAI 1\n.INCLUDE "tail.asm"\nLAI 3\n', 'main.asm', {
      readInclude: (path) => ({ file: path, source: 'LAI 2\n' }),
    });
    expect(result.words.map((word) => word.word)).toEqual([
      encode(InstructionType.LAI, 1),
      encode(InstructionType.LAI, 2),
      encode(InstructionType.LAI, 3),
    ]);
    expect(result.words[1]?.position.file).toBe('tail.asm');
    expect(result.words[1]?.sourceLine).toBe('LAI 2');
  });

  it('ends an include at its own .END and carries on with the includer', () => {
    const result = assemble('.INCLUDE "tail.asm"\nLAI 3\n', 'main.asm', {
      readInclude: (path) => ({ file: path, source: 'LAI 2\n.END\nLAI 9\n' }),
    });
    expect(result.words.map((word) => word.word)).toEqual([
      encode(InstructionType.LAI, 2),
      encode(InstructionType.LAI, 3),
    ]);
  });

  it('resolves a label defined in an included file', () => {
    const result = assemble('JMPL sub\n.INCLUDE "tail.asm"\n', 'main.asm', {
      readInclude: (path) => ({ file: path, source: 'sub:\nNOP\n' }),
    });
    expect(symbolValues(result)).toEqual({ sub: 2 });
  });

  it('reports an unreadable include at the path, not at the directive', () => {
    let error: AsmError | undefined;
    try {
      assemble('.INCLUDE "missing.asm"\n', 'main.asm', {
        readInclude: () => {
          throw new Error('ENOENT: no such file');
        },
      });
    } catch (caught) {
      error = caught as AsmError;
    }
    expect(error?.message).toMatch(/cannot read \.INCLUDE "missing\.asm": ENOENT/);
    expect(error?.position).toMatchObject({ line: 1, column: 10 });
  });

  it('rejects an include cycle rather than recursing forever', () => {
    expect(() =>
      assemble('.INCLUDE "loop.asm"\n', 'main.asm', {
        readInclude: (path) => ({ file: path, source: '.INCLUDE "loop.asm"\n' }),
      }),
    ).toThrow(/\.INCLUDE cycle: main\.asm -> loop\.asm -> loop\.asm/);
  });

  it('refuses .INCLUDE when the host supplied no file reader', () => {
    expect(() => build('.INCLUDE "tail.asm"\n')).toThrow(/called without a file reader/);
  });
});
