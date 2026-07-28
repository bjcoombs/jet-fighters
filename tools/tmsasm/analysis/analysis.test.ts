// The five silent-failure classes of PRD R2, and the rejections that make them
// loud. Acceptance contract criterion V3 counts one test per class, each driving
// a violating program through the assembler and asserting it fails to assemble.
//
// The two rejections that landed with the assembler itself - the page allocator
// reserving chapter 0 page 15, and the 2048-word and 128-nibble ceilings - are
// asserted in assembler.test.ts and are not repeated here.
//
// Paths in this file are relative to the repository root.

import { describe, expect, it } from 'vitest';
import { assemble, AsmError } from '../assembler.js';
import { ISA } from '../isa.js';
import { RAM_FILE_COUNT } from '../memory.js';
import {
  MAX_REPORTED_GAP,
  R_OUTPUT_X_LIMIT,
  setsStatus,
  statusSettingMnemonicsFromSummaries,
  STATUS_SETTING_MNEMONICS,
  X_MSB,
} from './index.js';

/** Assemble, expecting a positioned rejection, and hand back its message. */
function rejection(source: string, file = 'bad.asm'): string {
  let thrown: unknown;
  try {
    assemble(source, file);
  } catch (error) {
    thrown = error;
  }
  expect(thrown, 'expected this program to fail to assemble').toBeInstanceOf(AsmError);
  const error = thrown as AsmError;
  expect(error.position.file).toBe(file);
  expect(error.position.line).toBeGreaterThan(0);
  expect(error.position.column).toBeGreaterThan(0);
  return error.message;
}

describe('class 1: LFSR placement', () => {
  it('rejects a branch to an address arithmetic produced rather than to an LFSR state', () => {
    // `start + 2` is the third instruction only if the page is laid out
    // linearly. It is not: words 0, 1 and 2 of a page sit at $000, $001 and
    // $003, so $002 holds nothing at all.
    const message = rejection('start:  CLA\n        CLA\n        CLA\n        BR start + 2\n');
    expect(message).toContain('$002');
    expect(message).toContain('not the address of any instruction');
    expect(message).toContain('LFSR state, not a linear position');
  });

  it('names the address the counted-from-zero instruction actually landed at', () => {
    const message = rejection('start:  CLA\n        CLA\n        CLA\n        BR start + 2\n');
    expect(message).toContain('Word 2 of chapter 0, page 0 is at $003');
  });

  it('rejects a branch into a data region', () => {
    const message = rejection('        BR table\n        RETN\n.PAGE 1\ntable:  .DB 1, 2, 3\n');
    expect(message).toContain('holds a data word');
  });

  it('accepts a branch to a label, which is already an LFSR state', () => {
    const result = assemble('loop:   CLA\n        CLA\n        BR loop\n');
    expect(result.instructions).toHaveLength(3);
  });
});

describe('class 2: a page-crossing branch inside a subroutine', () => {
  const CROSSING = `.PAGE 0
main:   CALL sub
        RETN
.PAGE 1
sub:    LDP 2
        BR far
.PAGE 2
far:    RETN
`;

  it('rejects a branch that would change page while the call latch is set', () => {
    const message = rejection(CROSSING);
    expect(message).toContain('crosses from chapter 0, page 1 to page 2');
    expect(message).toContain('call latch set');
    expect(message).toContain('does not transfer the page buffer into the page address');
  });

  it('names the call site that made the routine a subroutine', () => {
    expect(rejection(CROSSING)).toMatch(/the CALL at bad\.asm:2:9/);
  });

  it('accepts the same branch outside a subroutine, where PB does reach PA', () => {
    const result = assemble('.PAGE 0\nmain:   LDP 1\n        BR sub\n.PAGE 1\nsub:    RETN\n');
    expect(result.instructions).toHaveLength(3);
  });

  it('accepts a branch inside a subroutine that stays on its page', () => {
    const result = assemble(
      '.PAGE 0\nmain:   CALL sub\n        RETN\n.PAGE 1\nsub:    CLA\n        BR sub\n',
    );
    expect(result.instructions).toHaveLength(4);
  });
});

describe('class 3: a CALL reachable from inside a subroutine', () => {
  const NESTED = `main:   CALL outer
        RETN
outer:  CALL inner
        RETN
inner:  RETN
`;

  it('rejects the inner call - the outer return address would be lost', () => {
    const message = rejection(NESTED);
    expect(message).toContain('reachable with the call latch set');
    expect(message).toContain('saves nothing and the outer return address is lost');
  });

  it('names the offending call site, not only the callee', () => {
    // PRD R2: "if so, it must say which call site forced the rejection".
    // `CALL outer` on line 1 is what enters this code as a subroutine.
    expect(rejection(NESTED)).toMatch(/the CALL at bad\.asm:1:9/);
  });

  it('points at the inner call as the position of the diagnostic', () => {
    let thrown: unknown;
    try {
      assemble(NESTED, 'bad.asm');
    } catch (error) {
      thrown = error;
    }
    expect((thrown as AsmError).position.line).toBe(3);
  });

  it('rejects an interprocedural path, not only a syntactic nesting', () => {
    // `leaf` holds the second CALL and is called from `middle`, which is itself
    // only ever reached by a CALL. Nothing here is lexically nested.
    const message = rejection(`entry:  CALL middle
        RETN
middle: CALL leaf
        RETN
leaf:   CALL last
        RETN
last:   RETN
`);
    expect(message).toContain('call latch set');
  });

  it('accepts a routine that is only ever entered by BR, latch clear', () => {
    const result = assemble(`main:   CLA
        BR helper
        RETN
helper: CALL leaf
        RETN
leaf:   RETN
`);
    expect(result.instructions).toHaveLength(6);
  });

  it('accepts sibling calls from one routine - one level of return is enough', () => {
    const result = assemble(`main:   CALL first
        CALL second
        RETN
first:  RETN
second: RETN
`);
    expect(result.instructions).toHaveLength(5);
  });
});

describe(`class 4: SETR/RSTR with X >= ${R_OUTPUT_X_LIMIT}`, () => {
  it('rejects an R output written while X selects a file at or above the limit', () => {
    const message = rejection('        LDX 4\n        TCY 0\n        SETR\n');
    expect(message).toContain('SETR can execute with X = 4');
    expect(message).toContain('BIT(X, 2) << 4 | Y');
    expect(message).toContain('R16-R31');
  });

  it('names where the offending file was loaded', () => {
    expect(rejection('        LDX 4\n        TCY 0\n        SETR\n')).toMatch(
      /loaded at bad\.asm:1:9/,
    );
  });

  it('rejects RSTR under the same rule', () => {
    expect(rejection('        LDX 7\n        RSTR\n')).toContain('RSTR can execute with X = 7');
  });

  it('follows COMX, which complements exactly the bit that matters', () => {
    // COMX flips only the MSB of X on this core, and the MSB is the fifth
    // R-latch index bit - so LDX 0 followed by COMX is X = 4.
    expect(rejection('        LDX 0\n        COMX\n        SETR\n')).toContain(
      'can execute with X = 4',
    );
  });

  it('follows a branch into the R write', () => {
    expect(
      rejection('        LDX 5\n        BR write\n        RETN\nwrite:  SETR\n'),
    ).toContain('can execute with X = 5');
  });

  it('accepts an R output written from a file below the limit', () => {
    const result = assemble('        LDX 0\n        TCY 3\n        SETR\n        RSTR\n');
    expect(result.instructions).toHaveLength(4);
  });

  it('accepts an R output written with X unknown rather than guessing at it', () => {
    // Nothing here says what X holds. Rejecting would refuse every sweep that
    // writes a grid after calling anything.
    const result = assemble('        CALL sub\n        SETR\n        RETN\nsub:    RETN\n');
    expect(result.instructions).toHaveLength(4);
  });

  it('derives the limit from X being three bits wide, not from a literal', () => {
    expect(X_MSB).toBe(RAM_FILE_COUNT / 2);
    expect(R_OUTPUT_X_LIMIT).toBe(X_MSB);
  });
});

describe('class 5: an instruction between a status-setting test and its branch', () => {
  it('rejects a branch separated from its test, which makes it unconditional', () => {
    const message = rejection('loop:   YNEC 0\n        LDP 0\n        BR loop\n');
    expect(message).toContain('BR is always taken');
    expect(message).toContain('YNEC at bad.asm:1:9 sets status');
    expect(message).toContain('LDP at bad.asm:2:9');
    expect(message).toContain('The test and the branch must be adjacent');
  });

  it('rejects the same gap before a CALL', () => {
    expect(rejection('        MNEZ\n        CLA\n        CALL sub\n        RETN\nsub:    RETN\n'))
      .toContain('CALL is always taken');
  });

  it('lists every instruction in the gap, in execution order', () => {
    const message = rejection('        IYC\n        LDP 0\n        COMC\n        BR $000\n');
    expect(message).toContain('LDP at bad.asm:2:9, COMC at bad.asm:3:9');
  });

  it('accepts a test adjacent to its branch', () => {
    const result = assemble('loop:   CLA\n        YNEC 0\n        BR loop\n');
    expect(result.instructions).toHaveLength(3);
  });

  it('accepts an unconditional branch with no test behind it', () => {
    const result = assemble('loop:   CLA\n        LDP 0\n        BR loop\n');
    expect(result.instructions).toHaveLength(3);
  });

  it('accepts a status-setting instruction used for its side effect alone', () => {
    // TAMIYC stores and steps Y; its carry is not a condition anyone asked for,
    // and no branch follows it before the next test.
    const result = assemble(`        LDX 0
        TCY 0
        TAMIYC
        TCY 1
        CLA
        TAM
        RETN
`);
    expect(result.instructions).toHaveLength(7);
  });

  it(`stops looking ${MAX_REPORTED_GAP} instructions back - further is unrelated code`, () => {
    const filler = '        CLA\n'.repeat(MAX_REPORTED_GAP + 1);
    const result = assemble(`loop:   YNEC 0\n${filler}        BR loop\n`);
    expect(result.instructions).toHaveLength(MAX_REPORTED_GAP + 3);
  });

  it('reports a gap exactly at the bound', () => {
    const filler = '        CLA\n'.repeat(MAX_REPORTED_GAP);
    expect(rejection(`loop:   YNEC 0\n${filler}        BR loop\n`)).toContain('always taken');
  });
});

describe('the status-setting table agrees with the ISA it was transcribed beside', () => {
  it('names exactly the instructions whose ISA summary writes status', () => {
    expect([...STATUS_SETTING_MNEMONICS].sort()).toEqual(
      [...statusSettingMnemonicsFromSummaries()].sort(),
    );
  });

  it('names only instructions the ISA has', () => {
    const known = new Set(ISA.map((entry) => entry.mnemonic));
    for (const mnemonic of STATUS_SETTING_MNEMONICS) {
      expect(known.has(mnemonic), mnemonic).toBe(true);
    }
  });

  it('does not count a branch as a test', () => {
    expect(setsStatus('BR')).toBe(false);
    expect(setsStatus('CALL')).toBe(false);
    expect(setsStatus('YNEC')).toBe(true);
  });
});

describe('the analyses do not simply refuse everything', () => {
  it('assembles a program that uses every construct they police', () => {
    const result = assemble(`.PAGE 15
reset:  CLA
        TDO
        LDX 0
        TCY 0
        SETR
clear:  TCMIY 0
        YNEC 0
        BR clear
        LDP 0
        BR main
.PAGE 0
main:   LDX 1
        TCY 2
        RSTR
        CALL step
        LDP 0
        BR main
step:   TCY 0
        TMA
        IAC
        TAM
        RETN
`);
    expect(result.instructions.length).toBeGreaterThan(15);
    expect(result.resetVectorPresent).toBe(true);
  });
});
