// TMS1000-family assembler (PRD R2), analysis 5: the gap between a test and its
// branch.
//
// Paths in this header are relative to the repository root.
//
// ## The failure this rejects
//
// Status is set to 1 at the start of every instruction and driven to 0 only by
// the instruction that tests something (S1 `tms1k_base.cpp:651`, S3 sections 2.4
// and 2.9; `docs/research/tms1370-architecture.md` section 5). `BR` and `CALL`
// are taken when status is 1 and there is no unconditional jump on this core, so
// a branch is made unconditional by simply not testing immediately before it.
//
// TI states the consequence in as many words (S3 section 2.9):
//
// > If an instruction that does not affect status is placed between an
// > instruction that does affect status and a branch or call instruction, then
// > the branch or call is always successful.
//
// So `YNEC 0` / `LDP 3` / `BR loop` is not a conditional branch that sometimes
// misfires. It is an unconditional branch, every time, and it assembles
// cleanly. The `LDP` in that sketch is the usual way the mistake gets written:
// the page buffer has to be loaded before the branch, and the obvious place to
// put it is the one place it must not go.
//
// ## Scanned backwards from the branch, not forwards from the test
//
// A status-setting instruction whose result nothing consumes is ordinary - `IYC`
// and `TAMIYC` are used for their side effects all over a real ROM, and flagging
// every one of them that is not followed by a branch would reject every program.
// The signal is at the *branch*: a branch with a test a short way behind it and
// nothing in between that touches status is a branch whose author expected a
// condition.
//
// The scan stops at the first branch, call or return it walks back through,
// because those leave status at 1 and end the sequence the author was building.
//
// `MAX_REPORTED_GAP` bounds how far back a test still counts as "its" test. It
// is a diagnostic bound and not a hardware figure: the hardware rule has no
// distance in it at all, one intervening instruction is already fatal, and the
// bound exists only so that a test thirty instructions back - which is unrelated
// code, not a mistake - is not reported as one.
//
// Node-side tool: no DOM, no Web APIs, no runtime dependencies.

import { AsmError } from '../lexer.js';
import { ISA } from '../isa.js';
import { romAddressForOrdinal } from '../memory.js';
import { formatSite, FlowKind } from './cfg.js';
import type { CfgNode, ControlFlowGraph } from './cfg.js';

/**
 * How many instructions may sit between a test and a branch and still be
 * reported.
 *
 * The gap patterns that produce this bug are the page and chapter set-ups that
 * have to precede a branch - `LDP`, `COMC`, or both - so two covers the ones
 * seen in practice and three leaves a margin. Above it the test belongs to
 * something else.
 */
export const MAX_REPORTED_GAP = 3;

/**
 * The instructions that can drive status to 0, and are therefore tests.
 *
 * Transcribed from the standard TMS1100 map in
 * `docs/research/tms1370-architecture.md` section 5 - the same table isa.ts
 * transcribes its encodings from. Every one of them is a microinstruction-defined
 * opcode, so this list is exactly as provisional as the rest of the set:
 * `tms1100_common2_micro.pla` has **not** been obtained by this project and
 * nothing here is a decode read off it.
 *
 * isa.test.ts's counterpart in this analysis's tests pins the list against the
 * ISA table's own summaries, so an instruction gaining or losing a status effect
 * cannot leave the two disagreeing silently.
 */
export const STATUS_SETTING_MNEMONICS: ReadonlySet<string> = Object.freeze(
  new Set([
    'MNEA',
    'ALEM',
    'YNEA',
    'DYN',
    'IYC',
    'AMAAC',
    'DMAN',
    'KNEZ',
    'TAMDYN',
    'TAMIYC',
    'TBIT1',
    'SAMAN',
    'CPAIZ',
    'IMAC',
    'MNEZ',
    'YNEC',
    // The whole AnAAC family. Every one of the fifteen writes its carry out to
    // status, which is what makes `A6AAC` the BCD carry test and `A15AAC` a
    // loop counter, and leaving them out both missed real violations after an
    // add and reported false ones *before* the add that was the real test -
    // `AMAAC / A6AAC / BR` reads as a gap of one unless the second add counts
    // as a test in its own right. Derived from the ISA table rather than
    // listed, so the family cannot gain a member this set does not know about.
    ...ISA.filter((entry) => /^A\d+AAC$/.test(entry.mnemonic)).map((entry) => entry.mnemonic),
  ]),
);

/** True when executing this mnemonic can leave status clear. */
export function setsStatus(mnemonic: string): boolean {
  return STATUS_SETTING_MNEMONICS.has(mnemonic);
}

/**
 * The ISA rows whose summary says they write status.
 *
 * The summaries are prose for the listing, not a machine-readable field, so this
 * is a cross-check rather than the definition - see `STATUS_SETTING_MNEMONICS`.
 */
export function statusSettingMnemonicsFromSummaries(): readonly string[] {
  return ISA.filter((entry) => entry.summary.includes('status =')).map((entry) => entry.mnemonic);
}

/** The instruction straight-line execution reaches this one from. */
function linearPredecessor(cfg: ControlFlowGraph, node: CfgNode): CfgNode | undefined {
  const { chapter, page, ordinal } = node.instruction;
  if (ordinal === 0) {
    return undefined;
  }
  const previous = cfg.nodeAt(romAddressForOrdinal(chapter, page, ordinal - 1));
  // Only a real fall-through counts: a `RETN` at the previous ordinal does not
  // reach this instruction, so its status effect - it has none - says nothing.
  return previous && previous.kind !== FlowKind.RETURN ? previous : undefined;
}

/**
 * Reject a branch separated from its test by instructions that do not test.
 *
 * @throws AsmError naming the test, the branch, and what sits between them.
 */
export function checkStatusTestAdjacency(cfg: ControlFlowGraph): void {
  for (const node of cfg.nodes) {
    if (node.kind !== FlowKind.BRANCH && node.kind !== FlowKind.CALL) {
      continue;
    }
    const between: CfgNode[] = [];
    let cursor = linearPredecessor(cfg, node);
    while (cursor && between.length <= MAX_REPORTED_GAP) {
      if (cursor.kind !== FlowKind.LINEAR) {
        break;
      }
      if (setsStatus(cursor.instruction.entry.mnemonic)) {
        if (between.length === 0) {
          break;
        }
        const names = between
          .map((skipped) => `${skipped.instruction.mnemonic} at ${formatSite(skipped.instruction)}`)
          .reverse()
          .join(', ');
        throw new AsmError(
          `${node.instruction.mnemonic} is always taken: ${cursor.instruction.mnemonic} at ` +
            `${formatSite(cursor.instruction)} sets status, but ${names} ` +
            `${between.length === 1 ? 'runs' : 'run'} between the test and this branch, and ` +
            'status is restored to 1 at the start of every instruction. The test and the ' +
            'branch must be adjacent - move the intervening ' +
            `${between.length === 1 ? 'instruction' : 'instructions'} above the test, or drop ` +
            'the test if the branch is meant to be unconditional',
          node.instruction.position,
        );
      }
      between.push(cursor);
      cursor = linearPredecessor(cfg, cursor);
    }
  }
}
