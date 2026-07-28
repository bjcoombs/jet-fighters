import { describe, expect, it } from 'vitest';
import {
  AsmError,
  DirectiveKind,
  ExpressionKind,
  isStringExpression,
  parse,
  StatementKind,
  type DataDirective,
  type DirectiveStatement,
  type EquDirective,
  type InstructionStatement,
  type OplaDirective,
  type PageDirective,
  type Statement,
} from './parser.js';

/** The statements of a source, with the trailing structure stripped. */
function statements(source: string): readonly Statement[] {
  return parse(source).statements;
}

/** The single statement a one-line source produces. */
function only(source: string): Statement {
  const parsed = statements(source);
  expect(parsed).toHaveLength(1);
  return parsed[0] as Statement;
}

/** The directive a one-line source produces, typed. */
function directive(source: string): DirectiveStatement {
  const statement = only(source);
  expect(statement.kind).toBe(StatementKind.DIRECTIVE);
  return statement as DirectiveStatement;
}

describe('instructions', () => {
  it('parses an operand-less mnemonic', () => {
    const statement = only('RETN\n') as InstructionStatement;
    expect(statement.kind).toBe(StatementKind.INSTRUCTION);
    expect(statement.mnemonic).toBe('RETN');
    expect(statement.operands).toHaveLength(0);
  });

  it('parses a mnemonic with one operand', () => {
    const statement = only('TCY 3\n') as InstructionStatement;
    expect(statement.mnemonic).toBe('TCY');
    expect(statement.operands).toHaveLength(1);
    expect(statement.operands[0]?.kind).toBe(ExpressionKind.NUMBER);
  });

  it('canonicalises an alias to the mnemonic it stands for', () => {
    expect((only('IAC\n') as InstructionStatement).mnemonic).toBe('A1AAC');
    expect((only('DAN\n') as InstructionStatement).mnemonic).toBe('A15AAC');
  });

  it('accepts any case', () => {
    expect((only('retn\n') as InstructionStatement).mnemonic).toBe('RETN');
  });

  it('carries the instruction table row so the assembler needs no second lookup', () => {
    const statement = only('LDX 2\n') as InstructionStatement;
    expect(statement.entry.mnemonic).toBe('LDX');
    expect(statement.entry.opcode).toBe(0x28);
  });

  it('rejects an operand on an instruction that takes none', () => {
    expect(() => parse('RETN 1\n')).toThrow(/RETN takes no operand, got 1/);
  });

  it('rejects a missing operand', () => {
    expect(() => parse('TCY\n')).toThrow(/TCY takes one operand, got 0/);
  });

  it('rejects two operands - no instruction on this machine has two', () => {
    expect(() => parse('TCY 1, 2\n')).toThrow(/TCY takes one operand, got 2/);
  });

  it('names a near miss on an unknown mnemonic', () => {
    expect(() => parse('RETNN\n')).toThrow(/unknown mnemonic 'RETNN'.*did you mean 'RETN'/);
  });

  it('says so when a directive was typed without its dot', () => {
    expect(() => parse('ORG 4\n')).toThrow(/directives start with a dot, as '\.ORG'/);
  });

  it('rejects an HMCS44 mnemonic - this is a different machine', () => {
    expect(() => parse('LAI 3\n')).toThrow(/unknown mnemonic/);
  });
});

describe('labels', () => {
  it('is its own statement even when it shares a line', () => {
    const parsed = statements('loop: TAY\n');
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.kind).toBe(StatementKind.LABEL);
    expect(parsed[1]?.kind).toBe(StatementKind.INSTRUCTION);
  });

  it('is case-sensitive', () => {
    const parsed = statements('Loop:\nloop:\n');
    expect(parsed.map((statement) => (statement as { name: string }).name)).toEqual([
      'Loop',
      'loop',
    ]);
  });

  it('accepts several on one line', () => {
    expect(statements('a: b: RETN\n')).toHaveLength(3);
  });
});

describe('expressions', () => {
  it('is additive only', () => {
    const statement = only('TCY start + 2 - 1\n') as InstructionStatement;
    expect(statement.operands[0]?.kind).toBe(ExpressionKind.BINARY);
  });

  it('accepts parentheses and unary minus', () => {
    expect(() => parse('TCY (base + 1) - -2\n')).not.toThrow();
  });

  it('rejects a string as an instruction operand', () => {
    expect(() => parse('TCY "x"\n')).toThrow(/only valid as a \.DB item/);
  });

  it('has no multiplication - every operand field is six bits or narrower', () => {
    expect(() => parse('TCY 2 * 3\n')).toThrow(AsmError);
  });
});

describe('.ORG', () => {
  it('takes one expression', () => {
    const statement = directive('.ORG $3C0\n');
    expect(statement.directive).toBe(DirectiveKind.ORG);
  });
});

describe('.CHAPTER', () => {
  it('takes one expression', () => {
    const statement = directive('.CHAPTER 1\n');
    expect(statement.directive).toBe(DirectiveKind.CHAPTER);
  });

  it('requires its argument', () => {
    expect(() => parse('.CHAPTER\n')).toThrow(/expected a value/);
  });
});

describe('.PAGE', () => {
  it('takes an optional page number', () => {
    const numbered = directive('.PAGE 3\n') as PageDirective;
    expect(numbered.page).toBeDefined();
    const bare = directive('.PAGE\n') as PageDirective;
    expect(bare.page).toBeUndefined();
  });
});

describe('.EQU', () => {
  it('puts the name inside the directive', () => {
    const statement = directive('.EQU SPEED, 3\n') as EquDirective;
    expect(statement.name).toBe('SPEED');
    expect(statement.value.kind).toBe(ExpressionKind.NUMBER);
  });

  it('requires the comma', () => {
    expect(() => parse('.EQU SPEED 3\n')).toThrow(/','/);
  });
});

describe('.DB and .DW', () => {
  it('take one or more items', () => {
    const statement = directive('.DB 1, 2, 3\n') as DataDirective;
    expect(statement.items).toHaveLength(3);
  });

  it('lets .DB carry text', () => {
    const statement = directive('.DB "HI"\n') as DataDirective;
    expect(isStringExpression(statement.items[0] as never)).toBe(true);
  });

  it('does not let .DW carry text', () => {
    expect(() => parse('.DW "HI"\n')).toThrow(/\.DW takes values, not text/);
  });
});

describe('.OPLA', () => {
  it('takes a slot index and a plate mask', () => {
    const statement = directive('.OPLA 5, %00001111\n') as OplaDirective;
    expect(statement.directive).toBe(DirectiveKind.OPLA);
    expect(statement.index.kind).toBe(ExpressionKind.NUMBER);
    expect(statement.mask.kind).toBe(ExpressionKind.NUMBER);
  });

  it('requires the comma between them', () => {
    expect(() => parse('.OPLA 5 15\n')).toThrow(/','/);
  });

  it('requires both arguments', () => {
    expect(() => parse('.OPLA 5\n')).toThrow(/','/);
  });
});

describe('.RES, .INCLUDE and .END', () => {
  it('parse', () => {
    expect(directive('.RES 4\n').directive).toBe(DirectiveKind.RES);
    expect(directive('.INCLUDE "other.asm"\n').directive).toBe(DirectiveKind.INCLUDE);
    expect(directive('.END\n').directive).toBe(DirectiveKind.END);
  });

  it('requires a quoted path on .INCLUDE', () => {
    expect(() => parse('.INCLUDE other.asm\n')).toThrow(/a quoted file path/);
  });
});

describe('directives that do not exist', () => {
  it('rejects .ALIGN - a page whose words are visited in LFSR order has no alignment', () => {
    expect(() => parse('.ALIGN 8\n')).toThrow(/unknown directive '\.ALIGN'/);
  });

  it('rejects .PATTERN - this machine has no pattern region', () => {
    expect(() => parse('.PATTERN 1\n')).toThrow(/unknown directive '\.PATTERN'/);
  });

  it('names a near miss', () => {
    expect(() => parse('.PAG 1\n')).toThrow(/did you mean '\.PAGE'/);
  });
});

describe('lines', () => {
  it('ignores blank and comment-only lines', () => {
    expect(statements('\n; nothing\n\n')).toHaveLength(0);
  });

  it('rejects trailing junk after a statement', () => {
    expect(() => parse('.RES 4 4\n')).toThrow(/expected end of line/);
  });

  it('reports the position of the first thing it rejects', () => {
    try {
      parse('  RETN\n  TCY\n');
      expect.unreachable('expected an AsmError');
    } catch (error) {
      expect(error).toBeInstanceOf(AsmError);
      expect((error as AsmError).position.line).toBe(2);
    }
  });
});
