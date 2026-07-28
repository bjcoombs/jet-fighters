// TMS1000-family assembler (PRD R2), analysis 1: LFSR placement.
//
// Paths in this header are relative to the repository root.
//
// ## The failure this rejects
//
// The program counter is a shift register, so the n-th instruction of a page is
// at physical offset `LFSR_SEQUENCE[n]` and a label is therefore an **LFSR
// state**, not a position in a list (memory.ts). Address arithmetic on a label
// - `BR loop + 2` for "two instructions past `loop`" - is the one way a source
// can state a linear layout out loud, and it is wrong on this machine: the two
// orders agree on only five of a page's sixty-four words.
//
// The resulting ROM assembles, disassembles, and jumps into the middle of the
// program. That is exactly the silent failure PRD R2 class 1 names, so the
// assembler rejects it: **a branch or call target must be the address at which
// an instruction was actually emitted.** A target that lands on a word the
// program never wrote, or on a `.DB`/`.DW` data word, is not a place execution
// was meant to reach.
//
// The check also re-derives every instruction's address from its `(chapter,
// page, ordinal)` triple and insists the emitter agreed. Nothing a source can
// write makes that fail today - it is the emitter's own invariant, held here
// where the requirement is stated rather than left implicit in the cursor.
//
// Node-side tool: no DOM, no Web APIs, no runtime dependencies.

import { AsmError } from '../lexer.js';
import { OperandKind } from '../isa.js';
import {
  lfsrOffset,
  romAddress,
  romAddressForOrdinal,
  romChapter,
  romOffset,
  romPage,
} from '../memory.js';
import { formatAddress, formatPage } from '../assembler.js';
import type { AssemblyResult } from '../assembler.js';
import { formatSite } from './cfg.js';
import type { ControlFlowGraph } from './cfg.js';

/**
 * The rule, quoted in every diagnostic this module raises.
 *
 * One sentence rather than a paragraph per site: the reader hitting this has
 * written the same mistake in more than one place, and reading it once is
 * enough.
 */
const LFSR_RULE =
  'a label resolves to an LFSR state, not a linear position - the n-th instruction of a ' +
  'page is at physical offset LFSR_SEQUENCE[n], so adding to a label steps through ' +
  'physical addresses and not through instructions';

/** Reject branch targets that are not instruction addresses. */
export function checkLfsrPlacement(result: AssemblyResult, cfg: ControlFlowGraph): void {
  const dataAddresses = new Map(result.words.map((word) => [word.address, word]));

  for (const instruction of result.instructions) {
    const expected = romAddressForOrdinal(
      instruction.chapter,
      instruction.page,
      instruction.ordinal,
    );
    if (instruction.address !== expected || instruction.offset !== lfsrOffset(instruction.ordinal)) {
      throw new AsmError(
        `${instruction.mnemonic} was placed at ${formatAddress(instruction.address)} but is ` +
          `word ${instruction.ordinal} of ${formatPage(instruction.chapter, instruction.page)}, ` +
          `which the LFSR puts at ${formatAddress(expected)} - ${LFSR_RULE}`,
        instruction.position,
      );
    }

    if (instruction.entry.operandKind !== OperandKind.BRANCH_TARGET) {
      continue;
    }
    const target = instruction.target as number;
    if (cfg.nodeAt(target) !== undefined) {
      continue;
    }

    const occupant = dataAddresses.get(target);
    const reason = occupant
      ? `it holds a data word emitted at ${occupant.position.file}:${occupant.position.line}:` +
        `${occupant.position.column}`
      : 'no word is emitted there';
    throw new AsmError(
      `${instruction.mnemonic} at ${formatSite(instruction)} targets ` +
        `${formatAddress(target)}, which is not the address of any instruction - ${reason}. ` +
        `${LFSR_RULE}${meantHint(cfg, target)}`,
      instruction.position,
    );
  }
}

/**
 * `. Word 2 of chapter 0, page 0 is at $003` - the correction, when there is one.
 *
 * A target of `$002` on a page whose second word sits at `$003` is the signature
 * of a linear position written where an LFSR state belongs, and naming the
 * address the author meant turns the diagnostic into a fix. Silent when the
 * ordinal reading of the offset holds nothing either, because then the guess
 * would be noise.
 */
function meantHint(cfg: ControlFlowGraph, target: number): string {
  // The offset read as an ordinal: what the author wrote, if they were counting
  // instructions. Both are 0..63, so this is always a legal reading.
  const ordinal = romOffset(target);
  const page = romPage(target);
  const chapter = romChapter(target);
  const asOrdinal = romAddress(chapter, page, lfsrOffset(ordinal));
  if (asOrdinal === target || cfg.nodeAt(asOrdinal) === undefined) {
    return '';
  }
  return (
    `. Word ${ordinal} of ${formatPage(chapter, page)} is at ` +
    `${formatAddress(asOrdinal)}, if that is the instruction meant`
  );
}
