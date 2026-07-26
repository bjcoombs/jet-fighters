// The property that keeps the assembler and the CPU from drifting apart.
//
// Both are built from src/machine/cpu/isa.ts, and the point of that table is
// that neither side can quietly acquire an opinion of its own. This test proves
// it end to end on a real program: asm/example.asm is assembled, and then every
// word it produced is handed to the *CPU's* decoder and read back. What comes
// out has to be the instruction the source line wrote, with the operand the
// source line asked for - and for a branch, the address the CPU would actually
// jump to, computed the way cpu.ts computes it.
//
// The two sides are worked out independently: the expected instruction comes
// from the parser's AST plus the assembler's symbol table, and the actual one
// from decoding the emitted word. Nothing is compared to itself.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { assemble, type AssembledWord } from './assembler.js';
import {
  ExpressionKind,
  parse,
  StatementKind,
  type Expression,
  type InstructionStatement,
} from './parser.js';
import { decode, longAddress } from '../../src/machine/cpu/decoder.js';
import { InstructionType, isTwoWord } from '../../src/machine/cpu/instruction.js';
import { OperandKind } from '../../src/machine/cpu/isa.js';
import { romAddress, romPage, ROM_PROGRAM_SIZE } from '../../src/machine/cpu/memory.js';

const SOURCE_PATH = 'asm/example.asm';
const source = readFileSync(SOURCE_PATH, 'utf8');
const result = assemble(source, SOURCE_PATH);
const program = parse(source, SOURCE_PATH);

/** Symbol values, for evaluating an operand independently of the assembler. */
const symbols = new Map(result.symbols.map((symbol) => [symbol.name, symbol.value]));

/** Where a statement starts - the key that pairs a word with its source. */
function key(line: number, column: number): string {
  return `${line}:${column}`;
}

/** Every instruction of the source, by the position the assembler records. */
const instructionByPosition = new Map<string, InstructionStatement>(
  program.statements
    .filter((statement) => statement.kind === StatementKind.INSTRUCTION)
    .map((statement) => [key(statement.position.line, statement.position.column), statement]),
);

/** Fold an operand expression using the assembler's symbol table. */
function evaluate(expression: Expression): number {
  switch (expression.kind) {
    case ExpressionKind.NUMBER:
      return expression.value;
    case ExpressionKind.SYMBOL: {
      const value = symbols.get(expression.name);
      expect(value, `symbol ${expression.name}`).toBeDefined();
      return value ?? 0;
    }
    case ExpressionKind.UNARY:
      return expression.operator === '-' ? -evaluate(expression.operand) : evaluate(expression.operand);
    case ExpressionKind.BINARY:
      return expression.operator === '+'
        ? evaluate(expression.left) + evaluate(expression.right)
        : evaluate(expression.left) - evaluate(expression.right);
  }
}

/** The word at an address, or undefined where the source emitted nothing. */
const wordAt = new Map<number, AssembledWord>(result.words.map((word) => [word.address, word]));

/** The first word of each statement, paired with the instruction that wrote it. */
const assembledInstructions: { word: AssembledWord; statement: InstructionStatement }[] =
  result.words.flatMap((word) => {
    if (word.continuation) {
      return [];
    }
    const statement = instructionByPosition.get(key(word.position.line, word.position.column));
    return statement ? [{ word, statement }] : [];
  });

describe('asm/example.asm - assembled, then read back by the CPU decoder', () => {
  it('is a substantial program, so the round trip can actually fail', () => {
    // A one-instruction fixture would pass this file trivially. The example is a
    // whole program - five routines, a page-0 call table, data and a pattern
    // table - so a drift between the assembler and the decoder has somewhere to
    // show up.
    expect(assembledInstructions.length).toBeGreaterThanOrEqual(60);
    expect(result.words.length).toBeGreaterThan(assembledInstructions.length);
  });

  it('accounts for every instruction in the source', () => {
    expect(assembledInstructions).toHaveLength(instructionByPosition.size);
  });

  it('decodes every emitted word back to the instruction the source wrote', () => {
    for (const { word, statement } of assembledInstructions) {
      const instruction = decode(word.word);
      expect(instruction.type, `${statement.mnemonic} at ${word.address}`).toBe(statement.type);
      expect(instruction.words, statement.mnemonic).toBe(statement.entry.words);
    }
  });

  it('gives back the operand the source asked for', () => {
    for (const { word, statement } of assembledInstructions) {
      const entry = statement.entry;
      if (entry.operandKind === OperandKind.NONE) {
        expect(decode(word.word).operands, statement.mnemonic).toHaveLength(0);
        continue;
      }
      // The branch and long-jump operands are addresses in the source and
      // something else in the word, so they are checked on their own terms below.
      if (entry.operandKind === OperandKind.PAGE_OFFSET || entry.words === 2) {
        continue;
      }
      const written = evaluate(statement.operands[0] as Expression);
      expect(decode(word.word).operands[0], `${statement.mnemonic} ${written}`).toBe(written);
    }
  });

  it('sends every branch to the address the CPU would compute', () => {
    let branches = 0;
    for (const { word, statement } of assembledInstructions) {
      const entry = statement.entry;
      if (entry.operandKind !== OperandKind.PAGE_OFFSET) {
        continue;
      }
      branches += 1;
      const target = evaluate(statement.operands[0] as Expression);
      const offset = decode(word.word).operands[0] as number;
      // Exactly the arithmetic cpu.ts performs for BR and CAL: BR inherits the
      // page of its own word, CAL is fixed to page 0.
      const reached =
        entry.type === InstructionType.CAL
          ? romAddress(0, offset)
          : romAddress(romPage(word.address), offset);
      expect(reached, `${entry.mnemonic} at ${word.address}`).toBe(target);
    }
    expect(branches, 'the example should exercise both BR and CAL').toBeGreaterThanOrEqual(8);
  });

  it('sends every long jump and call to the address the CPU would compute', () => {
    let longs = 0;
    for (const { word, statement } of assembledInstructions) {
      if (statement.entry.words !== 2) {
        continue;
      }
      longs += 1;
      const instruction = decode(word.word);
      expect(isTwoWord(instruction)).toBe(true);
      const second = wordAt.get(word.address + 1);
      expect(second, `second word of ${statement.mnemonic}`).toBeDefined();
      expect(longAddress(instruction, second?.word ?? 0)).toBe(
        evaluate(statement.operands[0] as Expression),
      );
    }
    expect(longs, 'the example should exercise JMPL and CALL').toBeGreaterThanOrEqual(5);
  });

  it('leaves no word in the program region that decodes to nothing', () => {
    // Data words are exempt: `.DB`/`.DW` may hold any ten-bit value. Everything
    // the source wrote as an instruction has to be a legal encoding, though -
    // an operand naming hardware the device lacks decodes to UNKNOWN, and the
    // assembler is supposed to have rejected it long before here.
    for (const { word } of assembledInstructions) {
      expect(decode(word.word).type, `word at ${word.address}`).not.toBe(InstructionType.UNKNOWN);
    }
  });

  it('fits inside the program region, with its tables above it', () => {
    const programWords = result.words.filter((word) => word.address < ROM_PROGRAM_SIZE);
    const patternWords = result.words.filter((word) => word.address >= ROM_PROGRAM_SIZE);
    expect(programWords.at(-1)?.address).toBeLessThan(ROM_PROGRAM_SIZE);
    expect(patternWords).toHaveLength(16);
  });

  it('stays well inside the 160 nibbles of RAM', () => {
    expect(result.ramHighWater).toBeGreaterThan(0);
    expect(result.ramHighWater).toBeLessThanOrEqual(160);
  });
});
