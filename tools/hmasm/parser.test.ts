import { describe, it, expect } from 'vitest';
import {
  AsmError,
  DirectiveKind,
  ExpressionKind,
  isaEntryForMnemonic,
  isStringExpression,
  MNEMONICS,
  operandArity,
  parse,
  StatementKind,
  type DataDirective,
  type EquDirective,
  type Expression,
  type InstructionStatement,
  type LabelStatement,
  type OrgDirective,
  type PageDirective,
  type PatternDirective,
  type Statement,
} from './parser.js';
import { ISA, OperandKind } from '../../src/machine/cpu/isa.js';
import { InstructionType } from '../../src/machine/cpu/instruction.js';

/** The statements of a source fragment, with the file name diagnostics use. */
function statementsOf(source: string): readonly Statement[] {
  return parse(source, 'jetfighter.asm').statements;
}

/** The single statement a one-statement fragment produces. */
function onlyStatement(source: string): Statement {
  const statements = statementsOf(source);
  expect(statements).toHaveLength(1);
  return statements[0] as Statement;
}

/** Fold an expression to a number, for asserting on parsed operand shapes. */
function evaluate(expression: Expression, symbols: Record<string, number> = {}): number {
  switch (expression.kind) {
    case ExpressionKind.NUMBER:
      return expression.value;
    case ExpressionKind.SYMBOL: {
      const value = symbols[expression.name];
      expect(value, `symbol ${expression.name}`).toBeDefined();
      return value ?? 0;
    }
    case ExpressionKind.UNARY:
      return expression.operator === '-'
        ? -evaluate(expression.operand, symbols)
        : evaluate(expression.operand, symbols);
    case ExpressionKind.BINARY:
      return expression.operator === '+'
        ? evaluate(expression.left, symbols) + evaluate(expression.right, symbols)
        : evaluate(expression.left, symbols) - evaluate(expression.right, symbols);
  }
}

describe('parse - instructions against the shared ISA table', () => {
  it('resolves a mnemonic to its row of ISA, not to a table of its own', () => {
    const statement = onlyStatement('LAI 5\n') as InstructionStatement;
    expect(statement.kind).toBe(StatementKind.INSTRUCTION);
    expect(statement.type).toBe(InstructionType.LAI);
    expect(statement.entry).toBe(isaEntryForMnemonic('LAI'));
    expect(statement.entry.operandKind).toBe(OperandKind.IMMEDIATE);
    expect(evaluate(statement.operands[0] as Expression)).toBe(5);
  });

  it('accepts every mnemonic the architecture defines, at its own arity', () => {
    for (const entry of ISA) {
      const source =
        operandArity(entry) === 0 ? `${entry.mnemonic}\n` : `${entry.mnemonic} 0\n`;
      const statement = onlyStatement(source) as InstructionStatement;
      expect(statement.mnemonic).toBe(entry.mnemonic);
      expect(statement.entry).toBe(entry);
      expect(statement.operands).toHaveLength(operandArity(entry));
    }
  });

  it('exposes one mnemonic per instruction', () => {
    expect(MNEMONICS).toHaveLength(ISA.length);
    expect(new Set(MNEMONICS).size).toBe(ISA.length);
  });

  it('derives arity from the operand kind rather than a hand-kept list', () => {
    expect(operandArity(isaEntryForMnemonic('NOP')!)).toBe(0);
    expect(operandArity(isaEntryForMnemonic('TBR')!)).toBe(0);
    expect(operandArity(isaEntryForMnemonic('P')!)).toBe(1);
    expect(operandArity(isaEntryForMnemonic('BR')!)).toBe(1);
    expect(operandArity(isaEntryForMnemonic('JMPL')!)).toBe(1);
  });

  it('canonicalises the mnemonic to upper case whatever the source used', () => {
    const statement = onlyStatement('lai 5\n') as InstructionStatement;
    expect(statement.mnemonic).toBe('LAI');
    expect(statement.type).toBe(InstructionType.LAI);
  });

  it('takes a branch target as a symbol operand', () => {
    const statement = onlyStatement('BR strobe\n') as InstructionStatement;
    expect(statement.operands[0]).toMatchObject({
      kind: ExpressionKind.SYMBOL,
      name: 'strobe',
    });
  });

  it('treats a two-word instruction as one written operand', () => {
    const statement = onlyStatement('JMPL main\n') as InstructionStatement;
    expect(statement.entry.words).toBe(2);
    expect(statement.operands).toHaveLength(1);
  });

  it('freezes statements and their operand lists', () => {
    const statement = onlyStatement('LAI 5\n');
    expect(Object.isFrozen(statement)).toBe(true);
    expect(Object.isFrozen((statement as InstructionStatement).operands)).toBe(true);
  });
});

describe('parse - labels', () => {
  it('emits a label as its own statement', () => {
    const statements = statementsOf('strobe:\n');
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({ kind: StatementKind.LABEL, name: 'strobe' });
  });

  it('emits a label sharing a line with an instruction as a separate statement', () => {
    const statements = statementsOf('strobe: LAI 5\n');
    expect(statements.map((statement) => statement.kind)).toEqual([
      StatementKind.LABEL,
      StatementKind.INSTRUCTION,
    ]);
  });

  it('accepts several labels on one address', () => {
    const statements = statementsOf('entry: start: NOP\n');
    expect(statements.map((statement) => statement.kind)).toEqual([
      StatementKind.LABEL,
      StatementKind.LABEL,
      StatementKind.INSTRUCTION,
    ]);
  });

  it('keeps symbol names case-sensitive', () => {
    const statements = statementsOf('Loop:\nloop:\n') as LabelStatement[];
    expect(statements.map((statement) => statement.name)).toEqual(['Loop', 'loop']);
  });

  it('accepts a label in front of a directive', () => {
    const statements = statementsOf('table: .DW 1, 2\n');
    expect(statements.map((statement) => statement.kind)).toEqual([
      StatementKind.LABEL,
      StatementKind.DIRECTIVE,
    ]);
  });
});

describe('parse - expressions', () => {
  const operand = (source: string): Expression =>
    (onlyStatement(source) as InstructionStatement).operands[0] as Expression;

  it('reads every numeric radix the lexer accepts', () => {
    expect(evaluate(operand('LAI $F\n'))).toBe(15);
    expect(evaluate(operand('LAI %1010\n'))).toBe(10);
    expect(evaluate(operand('LAI 9\n'))).toBe(9);
  });

  it('adds and subtracts left to right', () => {
    expect(evaluate(operand('BR 10 - 3 - 2\n'))).toBe(5);
    expect(evaluate(operand('BR 1 + 2 - 4\n'))).toBe(-1);
  });

  it('reads a parenthesised group', () => {
    expect(evaluate(operand('BR 10 - (3 - 2)\n'))).toBe(9);
  });

  it('reads unary minus and plus', () => {
    expect(evaluate(operand('BR -1\n'))).toBe(-1);
    expect(evaluate(operand('BR +2\n'))).toBe(2);
  });

  it('mixes symbols with literals so a label can be offset', () => {
    expect(evaluate(operand('BR strobe + 2\n'), { strobe: 40 })).toBe(42);
  });

  it('keeps the position of each part of an expression', () => {
    const expression = operand('  BR base + 2\n');
    expect(expression.kind).toBe(ExpressionKind.BINARY);
    if (expression.kind !== ExpressionKind.BINARY) {
      return;
    }
    expect(expression.left.position).toMatchObject({ line: 1, column: 6 });
    expect(expression.right.position).toMatchObject({ line: 1, column: 13 });
  });

  it('rejects an unclosed group', () => {
    expect(() => parse('BR (1 + 2\n')).toThrow(/expected '\)'/);
  });

  it('rejects a string where a value belongs', () => {
    expect(() => parse('LAI "x"\n')).toThrow(/string literal is only valid as a \.DB item/);
  });
});

describe('parse - directives', () => {
  it('reads .ORG', () => {
    const directive = onlyStatement('.ORG $040\n') as OrgDirective;
    expect(directive.kind).toBe(StatementKind.DIRECTIVE);
    expect(directive.directive).toBe(DirectiveKind.ORG);
    expect(evaluate(directive.address)).toBe(0x040);
  });

  it('matches a directive case-insensitively', () => {
    expect((onlyStatement('.org 0\n') as OrgDirective).directive).toBe(DirectiveKind.ORG);
  });

  it('reads .EQU with the name inside the directive', () => {
    const directive = onlyStatement('.EQU SPEED, 3\n') as EquDirective;
    expect(directive.directive).toBe(DirectiveKind.EQU);
    expect(directive.name).toBe('SPEED');
    expect(directive.namePosition).toMatchObject({ line: 1, column: 6 });
    expect(evaluate(directive.value)).toBe(3);
  });

  it('requires the comma after an .EQU name', () => {
    expect(() => parse('.EQU SPEED 3\n')).toThrow(/expected ',' after the \.EQU symbol name/);
  });

  it('reads .DW as a list of values', () => {
    const directive = onlyStatement('.DW 1, $3FF, 2 + 3\n') as DataDirective;
    expect(directive.directive).toBe(DirectiveKind.DW);
    expect(directive.items).toHaveLength(3);
    expect(directive.items.map((item) => (isStringExpression(item) ? NaN : evaluate(item)))).toEqual(
      [1, 1023, 5],
    );
  });

  it('reads .DB with text mixed into the values', () => {
    const directive = onlyStatement('.DB "AB", 0, %1\n') as DataDirective;
    expect(directive.directive).toBe(DirectiveKind.DB);
    const [text, zero, one] = directive.items;
    expect(text && isStringExpression(text) && text.value).toBe('AB');
    expect(zero && !isStringExpression(zero) && evaluate(zero)).toBe(0);
    expect(one && !isStringExpression(one) && evaluate(one)).toBe(1);
  });

  it('keeps text out of .DW, where it has no defined width', () => {
    expect(() => parse('.DW "AB"\n')).toThrow(/\.DW takes values, not text/);
  });

  it('requires at least one data item', () => {
    expect(() => parse('.DB\n')).toThrow(/expected a value/);
  });

  it('reads .INCLUDE and keeps the path position for a missing-file error', () => {
    const statement = onlyStatement('.INCLUDE "notes.asm"\n');
    expect(statement).toMatchObject({
      directive: DirectiveKind.INCLUDE,
      path: 'notes.asm',
    });
  });

  it('requires a quoted path on .INCLUDE', () => {
    expect(() => parse('.INCLUDE notes.asm\n')).toThrow(/expected a quoted file path/);
  });

  it('reads .PAGE with and without a page number', () => {
    const bare = onlyStatement('.PAGE\n') as PageDirective;
    expect(bare.directive).toBe(DirectiveKind.PAGE);
    expect(bare.page).toBeUndefined();

    const numbered = onlyStatement('.PAGE 2\n') as PageDirective;
    expect(numbered.page && evaluate(numbered.page)).toBe(2);
  });

  it('reads .PATTERN with and without a table number', () => {
    const bare = onlyStatement('.PATTERN\n') as PatternDirective;
    expect(bare.table).toBeUndefined();

    const numbered = onlyStatement('.PATTERN 3\n') as PatternDirective;
    expect(numbered.table && evaluate(numbered.table)).toBe(3);
  });

  it('reads .ALIGN, .RES and .END', () => {
    expect(onlyStatement('.ALIGN 32\n')).toMatchObject({ directive: DirectiveKind.ALIGN });
    expect(onlyStatement('.RES 4\n')).toMatchObject({ directive: DirectiveKind.RES });
    expect(onlyStatement('.END\n')).toMatchObject({ directive: DirectiveKind.END });
  });

  it('rejects an argument on .END', () => {
    expect(() => parse('.END 1\n')).toThrow(/expected end of line/);
  });

  it('names an unknown directive and suggests the nearest one', () => {
    expect(() => parse('.ORGG 0\n')).toThrow(/unknown directive '\.ORGG' \(did you mean '\.ORG'\?\)/);
  });
});

describe('parse - diagnostics', () => {
  it('names the line, the column and the mnemonic of an unknown instruction', () => {
    try {
      parse('        NOP\n        LAII 3\n', 'jetfighter.asm');
      expect.unreachable('expected an AsmError');
    } catch (error) {
      expect(error).toBeInstanceOf(AsmError);
      const asmError = error as AsmError;
      expect(asmError.position).toMatchObject({ line: 2, column: 9 });
      expect(asmError.message).toContain("jetfighter.asm:2:9:");
      expect(asmError.message).toContain("unknown mnemonic 'LAII'");
      expect(asmError.message).toContain("did you mean 'LAI'?");
    }
  });

  it('offers no suggestion when nothing is close', () => {
    expect(() => parse('QQQQQQ\n')).toThrow(/unknown mnemonic 'QQQQQQ'$/m);
  });

  it('points a directive typed without its dot back at the dot', () => {
    expect(() => parse('ORG $040\n')).toThrow(
      /unknown mnemonic 'ORG' - directives start with a dot, as '\.ORG'/,
    );
  });

  it('rejects an operand on an operand-less instruction', () => {
    expect(() => parse('NOP 1\n')).toThrow(/NOP takes no operand, got 1/);
  });

  it('rejects a missing operand', () => {
    expect(() => parse('LAI\n')).toThrow(/LAI takes 1 operand, got 0/);
  });

  it('rejects a second operand no instruction has', () => {
    expect(() => parse('LAI 1, 2\n')).toThrow(/LAI takes 1 operand, got 2/);
  });

  it('rejects trailing text after a complete statement', () => {
    expect(() => parse('NOP SEC\n')).toThrow(/NOP takes no operand, got 1/);
    expect(() => parse('LAI 1 2\n')).toThrow(/expected end of line, got '2'/);
  });

  it('rejects a statement that starts with something that is neither', () => {
    expect(() => parse('42\n')).toThrow(
      /expected a label, a mnemonic or a directive, got '42'/,
    );
  });
});

describe('parse - whole files', () => {
  it('ignores blank lines and comment-only lines', () => {
    const statements = statementsOf('\n; header\n\nNOP\n\n; trailer\n');
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({ kind: StatementKind.INSTRUCTION, mnemonic: 'NOP' });
  });

  it('parses a file with no trailing newline', () => {
    expect(statementsOf('NOP')).toHaveLength(1);
  });

  it('parses an empty file to an empty program', () => {
    const program = parse('', 'empty.asm');
    expect(program.file).toBe('empty.asm');
    expect(program.statements).toEqual([]);
  });

  it('carries the file name onto the program and every position', () => {
    const program = parse('loop: BR loop\n', 'jetfighter.asm');
    expect(program.file).toBe('jetfighter.asm');
    for (const statement of program.statements) {
      expect(statement.position.file).toBe('jetfighter.asm');
    }
  });

  it('parses a grid-strobe routine end to end', () => {
    const source = [
      '; one pass of the display sweep',
      '        .EQU    GRIDS, 9',
      '        .PAGE   2',
      'strobe: LYI     0',
      'next:   SEDY',
      '        LAM',
      '        LRA     0',
      '        REDY',
      '        IY',
      '        YNEI    GRIDS',
      '        BR      next',
      '        JMPL    strobe',
      '        .PATTERN 0',
      'digits: .DW     $3F, $06, $5B',
      '        .END',
    ].join('\n');

    const statements = statementsOf(source);
    expect(statements.map((statement) => statement.kind)).toEqual([
      StatementKind.DIRECTIVE,
      StatementKind.DIRECTIVE,
      StatementKind.LABEL,
      StatementKind.INSTRUCTION,
      StatementKind.LABEL,
      StatementKind.INSTRUCTION,
      StatementKind.INSTRUCTION,
      StatementKind.INSTRUCTION,
      StatementKind.INSTRUCTION,
      StatementKind.INSTRUCTION,
      StatementKind.INSTRUCTION,
      StatementKind.INSTRUCTION,
      StatementKind.INSTRUCTION,
      StatementKind.DIRECTIVE,
      StatementKind.LABEL,
      StatementKind.DIRECTIVE,
      StatementKind.DIRECTIVE,
    ]);

    const branch = statements.find(
      (statement) =>
        statement.kind === StatementKind.INSTRUCTION && statement.mnemonic === 'BR',
    ) as InstructionStatement;
    expect(branch.position.line).toBe(11);
    expect(branch.operands[0]).toMatchObject({ kind: ExpressionKind.SYMBOL, name: 'next' });
  });
});
