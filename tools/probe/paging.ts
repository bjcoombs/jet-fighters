// Where a branch actually lands: a forward analysis of the page and chapter
// buffers over an assembled program.
//
// Paths in this file are relative to the repository root.
//
// ## The failure this finds
//
// `BR` and `CALL` carry six bits. The page comes from the page buffer PB and
// the chapter from the chapter buffer CB, both of which are *state* - `LDP` and
// `COMC` write them and nothing else does. So a branch whose target is on
// another page is correct only if PB happens to hold that page on every path
// that reaches it, and a branch across chapters only if CB happens to hold the
// other one. Get it wrong and the branch still assembles, still executes, and
// lands at the target's *offset* on whatever page PB was left holding.
//
// `tools/tmsasm/analysis/subroutine.ts` rejects the case where the answer is
// decidable from the instruction alone - inside a subroutine PB is not
// transferred at all, so a page-crossing branch there is always wrong. Outside
// one it is not decidable from the instruction: it is a dataflow question, and
// this is the dataflow.
//
// ## Why it lives here and not in the assembler
//
// It is written against `asm/jetfighter.asm`'s own convention - a flat main loop
// of paged branches - and it reports what that ROM needs rather than what the
// architecture forbids. A program that loaded PB in one routine and branched in
// another would be rejected here and would be perfectly legal silicon. Promoting
// it into `tools/tmsasm/` means deciding what to do about that, and this task is
// not the place to decide it; what this task needs is a check that the ROM it
// ships lands where its labels say. The eleven branches it found on its first
// run were all real, and all of them silently ran the wrong code.
//
// Node-side tool: no DOM, no Web APIs, no runtime dependencies.

import type { AssembledInstruction, AssemblyResult } from '../tmsasm/assembler.js';
import { romChapter, romPage, RESET_PAGE } from '../tmsasm/memory.js';
import { setsStatus } from '../tmsasm/analysis/status.js';

/** What PB and CB may hold at a program point. `undefined` means "any value". */
interface BufferState {
  page: ReadonlySet<number> | undefined;
  chapter: ReadonlySet<number> | undefined;
}

/** One branch whose target is somewhere other than where its label says. */
export interface PagingViolation {
  readonly instruction: AssembledInstruction;
  /** Human-readable account of what the buffers may hold at that point. */
  readonly reason: string;
}

const CALL_MNEMONIC = 'CALL';
const BRANCH_MNEMONICS = new Set(['BR', CALL_MNEMONIC]);

function union(
  into: ReadonlySet<number> | undefined,
  from: ReadonlySet<number> | undefined,
): { next: ReadonlySet<number> | undefined; changed: boolean } {
  if (into === undefined) {
    return { next: undefined, changed: false };
  }
  if (from === undefined) {
    return { next: undefined, changed: true };
  }
  const next = new Set(into);
  let changed = false;
  for (const value of from) {
    if (!next.has(value)) {
      next.add(value);
      changed = true;
    }
  }
  return { next, changed };
}

/** True when PB and CB both certainly select `target`'s page and chapter. */
function agrees(state: BufferState, target: number): boolean {
  const page = state.page;
  const chapter = state.chapter;
  return (
    page !== undefined &&
    page.size === 1 &&
    page.has(romPage(target)) &&
    chapter !== undefined &&
    chapter.size === 1 &&
    chapter.has(romChapter(target))
  );
}

/**
 * Every branch that may land somewhere other than its target.
 *
 * The entry state is the machine's own: reset leaves PB at the reset page and
 * CB at chapter 0. `CALL` swaps PA and PB, and `RETN` copies PB back into PA, so
 * a call site's fall-through resumes with PB holding *its own* page - which is
 * why a routine does not have to reload PB after calling a leaf.
 */
export function findPagingViolations(result: AssemblyResult): readonly PagingViolation[] {
  const byAddress = new Map<number, AssembledInstruction>();
  for (const instruction of result.instructions) {
    byAddress.set(instruction.address, instruction);
  }
  const byOrdinal = new Map<string, AssembledInstruction>();
  for (const instruction of result.instructions) {
    byOrdinal.set(`${instruction.chapter}/${instruction.page}/${instruction.ordinal}`, instruction);
  }
  const fallThrough = (at: AssembledInstruction): AssembledInstruction | undefined =>
    byOrdinal.get(`${at.chapter}/${at.page}/${at.ordinal + 1}`);

  const state = new Map<number, BufferState>();
  const entry = result.instructions.find(
    (instruction) => instruction.page === RESET_PAGE && instruction.ordinal === 0,
  );
  if (!entry) {
    return [];
  }
  state.set(entry.address, {
    page: new Set([RESET_PAGE]),
    chapter: new Set([0]),
  });

  const queue: AssembledInstruction[] = [entry];
  while (queue.length > 0) {
    const node = queue.pop() as AssembledInstruction;
    const before = state.get(node.address) as BufferState;
    const mnemonic = node.entry.mnemonic;

    let after: BufferState = { page: before.page, chapter: before.chapter };
    if (mnemonic === 'LDP') {
      after = { page: new Set([node.operand as number]), chapter: before.chapter };
    } else if (mnemonic === 'COMC') {
      after = {
        page: before.page,
        chapter: before.chapter && new Set([...before.chapter].map((value) => value ^ 1)),
      };
    } else if (mnemonic === CALL_MNEMONIC) {
      // The call swaps PA and PB and RETN copies PB back into PA, so the site
      // resumes with PB holding the page the call was made from.
      after = { page: new Set([node.page]), chapter: before.chapter };
    }

    const successors: { at: AssembledInstruction; with: BufferState }[] = [];
    if (BRANCH_MNEMONICS.has(mnemonic)) {
      // Status is 1 at the start of every instruction and driven to 0 only by a
      // test, so a branch whose immediate predecessor does not test is taken
      // every time and has no fall-through. That is the same rule
      // `analysis/status.ts` rejects a *gap* under, read the other way round,
      // and without it every unconditional jump in the program would appear to
      // fall through and carry its target's page into the code below it.
      const target = byAddress.get(node.target as number);
      // The taken edge is followed only when the buffers agree with the target.
      // A branch that lands somewhere else is reported below, and propagating
      // the state it would arrive with would spread one wrong page through
      // every routine downstream and bury the branch that caused it.
      if (target && agrees(before, node.target as number)) {
        successors.push({ at: target, with: { page: before.page, chapter: before.chapter } });
      }
      const previous = byOrdinal.get(`${node.chapter}/${node.page}/${node.ordinal - 1}`);
      // `TCY j` / `YNEC k` with j != k is this ROM's unconditional jump: a test
      // whose answer is written into the two operands. Reading it as a real
      // test would give every one of them a fall-through edge that never
      // executes, and those edges carry the target's page into the code below.
      const beforePrevious = byOrdinal.get(`${node.chapter}/${node.page}/${node.ordinal - 2}`);
      const alwaysTrue =
        previous?.entry.mnemonic === 'YNEC' &&
        beforePrevious?.entry.mnemonic === 'TCY' &&
        beforePrevious.operand !== previous.operand;
      const conditional =
        previous !== undefined &&
        !alwaysTrue &&
        !BRANCH_MNEMONICS.has(previous.entry.mnemonic) &&
        previous.entry.mnemonic !== 'RETN' &&
        setsStatus(previous.entry.mnemonic);
      // A `CALL` always continues at the following word - taken it returns
      // there, untaken it falls through to it - so its successor is not
      // conditional on the test the way a `BR`'s fall-through is.
      const next =
        conditional || mnemonic === CALL_MNEMONIC ? fallThrough(node) : undefined;
      if (next) {
        successors.push({ at: next, with: after });
      }
    } else if (mnemonic !== 'RETN') {
      const next = fallThrough(node);
      if (next) {
        successors.push({ at: next, with: after });
      }
    }

    for (const successor of successors) {
      const existing = state.get(successor.at.address);
      if (!existing) {
        state.set(successor.at.address, {
          page: successor.with.page && new Set(successor.with.page),
          chapter: successor.with.chapter && new Set(successor.with.chapter),
        });
        queue.push(successor.at);
        continue;
      }
      const page = union(existing.page, successor.with.page);
      const chapter = union(existing.chapter, successor.with.chapter);
      if (page.changed || chapter.changed) {
        state.set(successor.at.address, { page: page.next, chapter: chapter.next });
        queue.push(successor.at);
      }
    }
  }

  const violations: PagingViolation[] = [];
  for (const node of result.instructions) {
    if (!BRANCH_MNEMONICS.has(node.entry.mnemonic)) {
      continue;
    }
    const before = state.get(node.address);
    if (!before) {
      continue; // unreachable code carries no claim about where it would land
    }
    const target = node.target as number;
    if (agrees(before, target)) {
      continue;
    }
    const wantPage = romPage(target);
    const wantChapter = romChapter(target);
    const reasons: string[] = [];
    if (!before.page || before.page.size !== 1 || !before.page.has(wantPage)) {
      reasons.push(
        `PB may be ${before.page ? [...before.page].join(' or ') : 'anything'} where the ` +
          `target is on page ${wantPage}`,
      );
    }
    if (!before.chapter || before.chapter.size !== 1 || !before.chapter.has(wantChapter)) {
      reasons.push(
        `CB may be ${before.chapter ? [...before.chapter].join(' or ') : 'anything'} where the ` +
          `target is in chapter ${wantChapter}`,
      );
    }
    if (reasons.length > 0) {
      violations.push({ instruction: node, reason: reasons.join('; ') });
    }
  }
  return violations;
}

/** `jetfighter.asm:412 BR -> $2C0: PB may be 5 ...` - one violation, as a line. */
export function formatViolation(violation: PagingViolation): string {
  const { instruction, reason } = violation;
  return (
    `${instruction.position.file}:${instruction.position.line} ${instruction.mnemonic} to ` +
    `$${(instruction.target as number).toString(16).toUpperCase().padStart(3, '0')}: ${reason}`
  );
}
