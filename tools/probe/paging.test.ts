// Tests for the page/chapter-buffer analysis.
//
// Paths in this file are relative to the repository root.

import { describe, expect, it } from 'vitest';
import { assemble } from '../tmsasm/assembler.js';
import { findPagingViolations, formatViolation } from './paging.js';
import { assembleGame } from './tms1370-probe.js';

/** Assemble a fragment, with the reset page carrying it so it is reachable. */
function build(source: string) {
  return assemble(source, 'paging.asm');
}

describe('the game ROM', () => {
  it('lands every branch on the page and chapter its label is on', () => {
    // A `BR` outside a subroutine takes its page from PB and its chapter from
    // CB, both of which are state. Getting either wrong assembles cleanly and
    // runs the wrong code - the first draft of asm/jetfighter.asm had eleven of
    // them, and every one silently executed somebody else's routine.
    const violations = findPagingViolations(assembleGame());
    expect(violations.map(formatViolation)).toEqual([]);
  });
});

describe('a branch that changes page', () => {
  it('is accepted when PB names the target page', () => {
    const result = build(
      '.PAGE 15\n' +
        '        LDP  1\n' +
        '        BR   there\n' +
        '.PAGE 1\n' +
        'there:  RETN\n',
    );
    expect(findPagingViolations(result)).toEqual([]);
  });

  it('is reported when PB names some other page', () => {
    const result = build(
      '.PAGE 15\n' +
        '        LDP  2\n' +
        '        BR   there\n' +
        '.PAGE 1\n' +
        'there:  RETN\n',
    );
    const violations = findPagingViolations(result);
    expect(violations).toHaveLength(1);
    expect(formatViolation(violations[0]!)).toContain('PB may be 2');
  });

  it('is reported when the page is never loaded at all', () => {
    const result = build('.PAGE 15\n        CLA\n        BR   there\n.PAGE 1\nthere:  RETN\n');
    expect(findPagingViolations(result)).toHaveLength(1);
  });

  it('counts a branch within a page too, because PA is reloaded either way', () => {
    // A taken branch always copies PB into PA, so even an in-page branch is
    // wrong if PB is left naming somewhere else. This is the case that cost
    // asm/jetfighter.asm its render step: an arm that had loaded the *next*
    // stage's page then branched to a label beside it.
    const result = build(
      '.PAGE 15\n' +
        '        LDP  1\n' +
        '        MNEZ\n' +
        '        BR   here\n' +
        'here:   RETN\n' +
        '.PAGE 1\n' +
        '        RETN\n',
    );
    expect(findPagingViolations(result)).toHaveLength(1);
  });
});

describe('a branch that changes chapter', () => {
  it('is accepted after a COMC', () => {
    const result = build(
      '.PAGE 15\n' +
        '        COMC\n' +
        '        LDP  0\n' +
        '        BR   there\n' +
        '.CHAPTER 1\n' +
        '.PAGE 0\n' +
        'there:  RETN\n',
    );
    expect(findPagingViolations(result)).toEqual([]);
  });

  it('is reported without one', () => {
    const result = build(
      '.PAGE 15\n' +
        '        LDP  0\n' +
        '        BR   there\n' +
        '.CHAPTER 1\n' +
        '.PAGE 0\n' +
        'there:  RETN\n',
    );
    const violations = findPagingViolations(result);
    expect(violations).toHaveLength(1);
    expect(formatViolation(violations[0]!)).toContain('CB may be 0');
  });
});

describe('what the analysis does not have to be told', () => {
  it('resumes a call site with PB naming its own page', () => {
    // `CALL` swaps PA and PB and `RETN` copies PB back into PA, so a routine
    // does not reload PB after calling a leaf on another page. An analysis that
    // missed the swap would report every instruction after every call.
    const result = build(
      '.PAGE 15\n' +
        '        LDP  1\n' +
        '        CALL leaf\n' +
        '        MNEZ\n' +
        '        BR   back\n' +
        'back:   RETN\n' +
        '.PAGE 1\n' +
        'leaf:   RETN\n',
    );
    expect(findPagingViolations(result)).toEqual([]);
  });

  it('does not give an always-taken branch a fall-through', () => {
    // Status is 1 unless the previous instruction tested something, so a branch
    // with a non-test behind it is taken every time. Treating it as a
    // conditional would carry the target's page into the words below it and
    // report a violation there instead of here.
    const result = build(
      '.PAGE 15\n' +
        '        LDP  1\n' +
        '        BR   there\n' +
        '        BR   never\n' +
        'never:  RETN\n' +
        '.PAGE 1\n' +
        'there:  RETN\n',
    );
    expect(findPagingViolations(result)).toEqual([]);
  });
});
