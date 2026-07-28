import { describe, it, expect } from 'vitest';
import {
  AsmError,
  DEFAULT_SOURCE_NAME,
  describeToken,
  TokenKind,
  tokenize,
  type Token,
} from './lexer.js';

/** Tokens with the structural noise removed, so a test reads as the source does. */
function kinds(source: string): TokenKind[] {
  return tokenize(source).map((token) => token.kind);
}

/** Every token but the trailing EOF. */
function significant(source: string): Token[] {
  return tokenize(source).filter((token) => token.kind !== TokenKind.EOF);
}

/** The single token a one-token source produces. */
function only(source: string): Token {
  const tokens = significant(source);
  expect(tokens).toHaveLength(1);
  return tokens[0] as Token;
}

describe('tokenize - structure', () => {
  it('ends every stream with exactly one EOF', () => {
    const tokens = tokenize('TAY\n');
    expect(tokens.at(-1)?.kind).toBe(TokenKind.EOF);
    expect(tokens.filter((token) => token.kind === TokenKind.EOF)).toHaveLength(1);
  });

  it('produces no tokens but EOF for empty input', () => {
    expect(kinds('')).toEqual([TokenKind.EOF]);
  });

  it('freezes tokens so a consumer cannot rewrite the scan', () => {
    for (const token of tokenize('loop: TCY $F ; go\n')) {
      expect(Object.isFrozen(token)).toBe(true);
    }
  });

  it('tokenizes a full statement', () => {
    expect(kinds('loop: TCY $F\n')).toEqual([
      TokenKind.LABEL,
      TokenKind.IDENTIFIER,
      TokenKind.NUMBER,
      TokenKind.NEWLINE,
      TokenKind.EOF,
    ]);
  });

  it('keeps a newline for a blank line and a comment-only line', () => {
    expect(kinds('\n; just a comment\n')).toEqual([
      TokenKind.NEWLINE,
      TokenKind.NEWLINE,
      TokenKind.EOF,
    ]);
  });

  it('treats a comment as running to the end of the line, not past it', () => {
    expect(kinds('TAY ; comment with TCY $F in it\nTAY\n')).toEqual([
      TokenKind.IDENTIFIER,
      TokenKind.NEWLINE,
      TokenKind.IDENTIFIER,
      TokenKind.NEWLINE,
      TokenKind.EOF,
    ]);
  });

  it('skips spaces and tabs without emitting anything', () => {
    expect(kinds('\t  TAY  \t')).toEqual([TokenKind.IDENTIFIER, TokenKind.EOF]);
  });

  it('does not require a trailing newline', () => {
    expect(kinds('TAY')).toEqual([TokenKind.IDENTIFIER, TokenKind.EOF]);
  });
});

describe('tokenize - positions', () => {
  it('reports 1-based line and column of a token', () => {
    const source = 'TAY\n  TCY 3\n';
    const tokens = significant(source);
    const tcy = tokens.find((token) => token.value === 'TCY');
    expect(tcy?.position).toEqual({ file: DEFAULT_SOURCE_NAME, line: 2, column: 3, offset: 6 });
  });

  it('points the operand at its own column, not the mnemonic’s', () => {
    const three = significant('  TCY 3\n').find((token) => token.kind === TokenKind.NUMBER);
    expect(three?.position.line).toBe(1);
    expect(three?.position.column).toBe(7);
  });

  it('counts CRLF as one line break and restarts the column', () => {
    const tokens = significant('TAY\r\nSEC\r\n');
    expect(tokens[2]?.value).toBe('SEC');
    expect(tokens[2]?.position).toEqual({
      file: DEFAULT_SOURCE_NAME,
      line: 2,
      column: 1,
      offset: 5,
    });
  });

  it('counts a bare CR as a line break', () => {
    const tokens = significant('TAY\rSEC');
    expect(tokens[2]?.position.line).toBe(2);
  });

  it('counts a tab as one column', () => {
    expect(only('\tTAY').position.column).toBe(2);
  });

  it('carries the caller’s file name into every position', () => {
    const tokens = tokenize('TAY\n', 'jetfighter.asm');
    for (const token of tokens) {
      expect(token.position.file).toBe('jetfighter.asm');
    }
  });

  it('places EOF after the last character', () => {
    const eof = tokenize('TAY').at(-1);
    expect(eof?.position).toEqual({
      file: DEFAULT_SOURCE_NAME,
      line: 1,
      column: 4,
      offset: 3,
    });
  });
});

describe('tokenize - numbers', () => {
  it('reads the canonical $ hexadecimal form', () => {
    const token = only('$1F');
    expect(token.kind).toBe(TokenKind.NUMBER);
    expect(token.numericValue).toBe(31);
    expect(token.text).toBe('$1F');
  });

  it('accepts 0x hexadecimal as an alias', () => {
    expect(only('0x1f').numericValue).toBe(31);
    expect(only('0X1F').numericValue).toBe(31);
  });

  it('reads the % binary form and its 0b alias', () => {
    expect(only('%1010').numericValue).toBe(10);
    expect(only('0b1010').numericValue).toBe(10);
  });

  it('reads decimal, including a leading zero', () => {
    expect(only('31').numericValue).toBe(31);
    expect(only('0').numericValue).toBe(0);
    expect(only('007').numericValue).toBe(7);
  });

  it('reads the widest values the architecture uses', () => {
    expect(only('$3FF').numericValue).toBe(1023);
    expect(only('2047').numericValue).toBe(2047);
  });

  it('rejects a radix prefix with no digits', () => {
    expect(() => tokenize('$')).toThrow(/hexadecimal literal has no digits/);
    expect(() => tokenize('%')).toThrow(/binary literal has no digits/);
  });

  it('rejects a stray digit rather than starting a new token', () => {
    expect(() => tokenize('12A')).toThrow(/invalid digit 'A' in decimal literal/);
    expect(() => tokenize('%102')).toThrow(/invalid digit '2' in binary literal/);
    expect(() => tokenize('$1FG')).toThrow(/invalid digit 'G' in hexadecimal literal/);
  });

  it('names the column of the offending digit', () => {
    try {
      tokenize('  TCY 12A\n');
      expect.unreachable('expected an AsmError');
    } catch (error) {
      expect(error).toBeInstanceOf(AsmError);
      expect((error as AsmError).position).toMatchObject({ line: 1, column: 9 });
    }
  });

  it('rejects a literal too large to hold exactly', () => {
    expect(() => tokenize('$FFFFFFFFFFFFFFFFFF')).toThrow(/too large/);
  });
});

describe('tokenize - names', () => {
  it('reads a label and strips the colon from its value', () => {
    const token = only('loop:');
    expect(token.kind).toBe(TokenKind.LABEL);
    expect(token.value).toBe('loop');
    expect(token.text).toBe('loop:');
  });

  it('reads an identifier written next to a colon on the next token as a label', () => {
    expect(kinds('a: b\n')).toEqual([
      TokenKind.LABEL,
      TokenKind.IDENTIFIER,
      TokenKind.NEWLINE,
      TokenKind.EOF,
    ]);
  });

  it('preserves the case of a symbol name', () => {
    expect(only('Loop:').value).toBe('Loop');
    expect(only('someLabel').value).toBe('someLabel');
  });

  it('accepts underscores and digits after the first character', () => {
    expect(only('_grid_0').value).toBe('_grid_0');
  });

  it('upper-cases a directive so matching is case-insensitive', () => {
    const token = only('.org');
    expect(token.kind).toBe(TokenKind.DIRECTIVE);
    expect(token.value).toBe('.ORG');
    expect(token.text).toBe('.org');
  });

  it('rejects a dot with no directive name', () => {
    expect(() => tokenize('. 4')).toThrow(/expected a directive name/);
  });
});

describe('tokenize - strings', () => {
  it('reads a string and drops the quotes from its value', () => {
    const token = only('"HI"');
    expect(token.kind).toBe(TokenKind.STRING);
    expect(token.value).toBe('HI');
    expect(token.text).toBe('"HI"');
  });

  it('decodes the supported escapes', () => {
    expect(only('"a\\\\b"').value).toBe('a\\b');
    expect(only('"a\\"b"').value).toBe('a"b');
    expect(only('"a\\nb"').value).toBe('a\nb');
    expect(only('"a\\tb"').value).toBe('a\tb');
    expect(only('"a\\0"').value).toBe('a\0');
  });

  it('reads an empty string', () => {
    expect(only('""').value).toBe('');
  });

  it('rejects an unknown escape', () => {
    expect(() => tokenize('"a\\q"')).toThrow(/unknown escape sequence/);
  });

  it('rejects a string that runs to the end of the line or of the file', () => {
    expect(() => tokenize('"unterminated\n')).toThrow(/unterminated string literal/);
    expect(() => tokenize('"unterminated')).toThrow(/unterminated string literal/);
  });

  it('points an unterminated string at its opening quote', () => {
    try {
      tokenize('.DB "oops\n');
      expect.unreachable('expected an AsmError');
    } catch (error) {
      expect((error as AsmError).position).toMatchObject({ line: 1, column: 5 });
    }
  });

  it('rejects single quotes with an actionable message', () => {
    expect(() => tokenize("'A'")).toThrow(/single quotes are not a literal form/);
  });
});

describe('tokenize - punctuation', () => {
  it('reads the separator and the expression operators', () => {
    expect(kinds('a, b + c - (d)')).toEqual([
      TokenKind.IDENTIFIER,
      TokenKind.COMMA,
      TokenKind.IDENTIFIER,
      TokenKind.PLUS,
      TokenKind.IDENTIFIER,
      TokenKind.MINUS,
      TokenKind.LPAREN,
      TokenKind.IDENTIFIER,
      TokenKind.RPAREN,
      TokenKind.EOF,
    ]);
  });

  it('rejects a character that begins no token', () => {
    expect(() => tokenize('TAY @')).toThrow(/unexpected character '@'/);
  });

  it('names the column of an unexpected character', () => {
    try {
      tokenize('TAY @');
      expect.unreachable('expected an AsmError');
    } catch (error) {
      expect((error as AsmError).position).toMatchObject({ line: 1, column: 5 });
    }
  });
});

describe('AsmError', () => {
  it('prefixes its message with file, line and column', () => {
    try {
      tokenize('TAY\n  @\n', 'jetfighter.asm');
      expect.unreachable('expected an AsmError');
    } catch (error) {
      expect((error as AsmError).message).toBe(
        "jetfighter.asm:2:3: unexpected character '@'",
      );
      expect((error as AsmError).name).toBe('AsmError');
    }
  });
});

describe('describeToken', () => {
  it('names the tokens with no visible text', () => {
    const tokens = tokenize('TAY\n');
    expect(describeToken(tokens[1] as Token)).toBe('end of line');
    expect(describeToken(tokens[2] as Token)).toBe('end of input');
  });

  it('quotes source text for everything else', () => {
    expect(describeToken(only('TCY'))).toBe("'TCY'");
    expect(describeToken(only('$1F'))).toBe("'$1F'");
    expect(describeToken(only('"HI"'))).toBe('string "HI"');
  });
});

describe('tokenize - a realistic fragment', () => {
  const source = [
    '; strobe one grid',
    '        .ORG    $040',
    'strobe: LYI     0           ; grid 0',
    '        SEDY',
    '        LAM',
    '        BR      strobe',
    '        .DB     "AB", %0001',
    '',
  ].join('\n');

  it('scans it without error and keeps every line number', () => {
    const tokens = tokenize(source, 'jetfighter.asm');
    const strobeLabel = tokens.find((token) => token.kind === TokenKind.LABEL);
    expect(strobeLabel?.value).toBe('strobe');
    expect(strobeLabel?.position.line).toBe(3);

    const branchTarget = tokens.filter((token) => token.value === 'strobe');
    expect(branchTarget).toHaveLength(2);
    expect(branchTarget[1]?.kind).toBe(TokenKind.IDENTIFIER);
    expect(branchTarget[1]?.position.line).toBe(6);
  });

  it('reads the data directive’s mixed items', () => {
    const tokens = tokenize(source);
    const data = tokens.filter((token) => token.position.line === 7);
    expect(data.map((token) => token.kind)).toEqual([
      TokenKind.DIRECTIVE,
      TokenKind.STRING,
      TokenKind.COMMA,
      TokenKind.NUMBER,
      TokenKind.NEWLINE,
    ]);
    expect(data[1]?.value).toBe('AB');
    expect(data[3]?.numericValue).toBe(1);
  });
});
