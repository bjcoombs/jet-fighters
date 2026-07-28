// TMS1000-family assembler (PRD R2), analyses 2 and 3: what a subroutine may do.
//
// Paths in this header are relative to the repository root.
//
// Both rejections read the same walk - `reachableInsideSubroutine` in cfg.ts -
// because both are the same question asked twice: what is true of an instruction
// when the call latch is set. They are two exported checks rather than one so a
// diagnostic names the class it belongs to.
//
// ## Analysis 2 - a page-crossing branch inside a subroutine
//
// `LDP` loads the page *buffer* PB and PB transfers into the page *address* PA
// only on a taken branch. From MAME's `op_br1`
// (`docs/research/tms1370-architecture.md` section 2, S1 `tms1k_base.cpp:404-414`):
//
//     if (m_status) {
//         if (m_clatch == 0)      //  <-- only outside a subroutine
//             m_pa = m_pb;
//         m_ca = m_cb;
//         m_pc = m_opcode & m_pc_mask;
//     }
//
// So inside a subroutine a branch keeps PA and takes only the low six bits of
// the target: `LDP 3` / `BR elsewhere` lands at the target's *offset* on the
// page the subroutine is already on. TI states the same limit from the other
// side - "up to 128 words that are contained on two pages of alternate chapters
// are available in a single subroutine" (S3 section 3.2) - because `m_ca = m_cb`
// is *not* guarded by the latch. A chapter change inside a subroutine is
// therefore legal and is not rejected here; only a page change is.
//
// ## Analysis 3 - a `CALL` reachable from inside a subroutine
//
// The return address is one 6-bit register SR plus the chapter latch CS, and the
// save is guarded by `if (!m_clatch)` (S1 `tms1k_base.cpp:434-446`). A `CALL`
// executed inside a subroutine therefore branches without saving anything: it
// does not overflow a stack, it silently loses the outer return address, and the
// program fails at some later `RETN` that returns to the wrong place entirely.
//
// This is interprocedural. A routine can be entered by `BR` with the latch clear
// and by `CALL` with it set, so whether a `CALL` inside it is a defect depends on
// its callers, not on its own text. The walk is a conservative
// over-approximation: it treats every branch as takeable and every reachable
// `CALL` as executed. PRD R2 allows that - "the over-approximation may reject
// legitimate programs; if so, it must say which call site forced the rejection"
// - which is why the rejection names the `CALL` that set the latch as well as
// the one that violates the rule.
//
// Node-side tool: no DOM, no Web APIs, no runtime dependencies.

import { AsmError } from '../lexer.js';
import { romPage } from '../memory.js';
import { formatAddress, formatPage } from '../assembler.js';
import { CALL_MNEMONIC, FlowKind, formatSite, reachableInsideSubroutine } from './cfg.js';
import type { ControlFlowGraph } from './cfg.js';
import type { AssembledInstruction } from '../assembler.js';

/** `CALL step at demo.asm:41:9` - how a rejection names the site that forced it. */
function describeCallSite(callSite: AssembledInstruction): string {
  return `the ${CALL_MNEMONIC} at ${formatSite(callSite)}`;
}

/**
 * Reject a branch that would change page while the call latch is set.
 *
 * @throws AsmError naming both the branch and the call site that made its
 *   routine a subroutine.
 */
export function checkPageCrossingBranchInSubroutine(cfg: ControlFlowGraph): void {
  const insideSubroutine = reachableInsideSubroutine(cfg);

  for (const node of cfg.nodes) {
    if (node.kind !== FlowKind.BRANCH) {
      continue;
    }
    const callSite = insideSubroutine.get(node.index);
    if (!callSite) {
      continue;
    }
    const instruction = node.instruction;
    const target = instruction.target as number;
    const targetPage = romPage(target);
    if (targetPage === instruction.page) {
      continue;
    }
    throw new AsmError(
      `${instruction.mnemonic} to ${formatAddress(target)} crosses from ` +
        `${formatPage(instruction.chapter, instruction.page)} to page ${targetPage}, and it is ` +
        `reachable with the call latch set - ${describeCallSite(callSite)} enters this code as ` +
        'a subroutine. Inside one, a taken branch does not transfer the page buffer into the ' +
        'page address, so this lands at the target offset on page ' +
        `${instruction.page} instead. Only the chapter can change inside a subroutine; move the ` +
        'routine onto one page, or reach the other page from outside the subroutine',
      instruction.position,
    );
  }
}

/**
 * Reject a `CALL` reachable with the call latch already set.
 *
 * @throws AsmError naming the offending call site - the outer `CALL` that made
 *   the routine a subroutine - as well as the inner one, per PRD R2.
 */
export function checkCallInsideSubroutine(cfg: ControlFlowGraph): void {
  const insideSubroutine = reachableInsideSubroutine(cfg);

  for (const node of cfg.nodes) {
    if (node.kind !== FlowKind.CALL) {
      continue;
    }
    const callSite = insideSubroutine.get(node.index);
    if (!callSite) {
      continue;
    }
    const instruction = node.instruction;
    throw new AsmError(
      `${instruction.mnemonic} to ${formatAddress(instruction.target as number)} is reachable ` +
        `with the call latch set: ${describeCallSite(callSite)} enters this code as a ` +
        'subroutine, and the return-address save is guarded by the call latch, so this ' +
        'second call saves nothing and the outer return address is lost. The failure is a ' +
        `wild jump at the eventual RETN, not here. Fix it at ${formatSite(callSite)} or by ` +
        'inlining one of the two routines - this core has one level of subroutine return',
      instruction.position,
    );
  }
}
