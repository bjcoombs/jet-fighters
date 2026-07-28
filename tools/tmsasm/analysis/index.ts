// TMS1000-family assembler (PRD R2), the static analyses, and the order they run
// in.
//
// Paths in this header are relative to the repository root.
//
// Five silent-failure classes, each of which assembles cleanly on real silicon
// and fails later as a wild jump or an output that never moves. PRD R2 names
// them and the acceptance contract's criterion V3 counts them:
//
// | # | Class                                                    | Module        |
// | - | -------------------------------------------------------- | ------------- |
// | 1 | LFSR placement - a label is a state, not a position       | placement.ts  |
// | 2 | A page-crossing branch inside a subroutine                | subroutine.ts |
// | 3 | A `CALL` reachable from inside a subroutine               | subroutine.ts |
// | 4 | `SETR`/`RSTR` with X >= 4                                 | r-outputs.ts  |
// | 5 | An instruction between a status-setting test and its branch | status.ts   |
//
// ## Why they run here and not at the point of emission
//
// Every one of them is a question about the assembled program rather than about
// a statement: which page a target is on, what the call latch holds, what X was
// loaded with on the path that got here. `assemble` builds the fully-addressed
// instruction record for exactly this, and calls `analyzeProgram` on it before
// returning - so a violating program raises an `AsmError` from `assemble` like
// any other rejection, with the same file, line and column.
//
// ## Order
//
// Placement first, because the other four read a control-flow graph and a graph
// built over branches that do not land on instructions would be describing a
// program that does not exist. Then the two local analyses, then the two that
// need call-latch reachability. Only the first violation is reported: this
// assembler stops at the first thing the architecture rejects, everywhere else
// too, and a program with a wild branch in it has not earned a second opinion.
//
// Node-side tool: no DOM, no Web APIs, no runtime dependencies.

import type { AssemblyResult } from '../assembler.js';
import { buildControlFlowGraph } from './cfg.js';
import { checkLfsrPlacement } from './placement.js';
import { checkROutputFileSelection } from './r-outputs.js';
import { checkStatusTestAdjacency } from './status.js';
import {
  checkCallInsideSubroutine,
  checkPageCrossingBranchInSubroutine,
} from './subroutine.js';

export { buildControlFlowGraph, FlowKind } from './cfg.js';
export type { CfgNode, ControlFlowGraph } from './cfg.js';
export { checkLfsrPlacement } from './placement.js';
export {
  checkROutputFileSelection,
  R_OUTPUT_MNEMONICS,
  R_OUTPUT_X_LIMIT,
  X_MSB,
} from './r-outputs.js';
export {
  checkStatusTestAdjacency,
  MAX_REPORTED_GAP,
  setsStatus,
  statusSettingMnemonicsFromSummaries,
  STATUS_SETTING_MNEMONICS,
} from './status.js';
export {
  checkCallInsideSubroutine,
  checkPageCrossingBranchInSubroutine,
} from './subroutine.js';

/**
 * Run every static analysis over an assembled program.
 *
 * @throws AsmError on the first silent-failure class the program falls into.
 *   Every message carries file, line and column, in the shape the hardware
 *   ceilings already use.
 */
export function analyzeProgram(result: AssemblyResult): void {
  if (result.instructions.length === 0) {
    return;
  }
  const cfg = buildControlFlowGraph(result);
  checkLfsrPlacement(result, cfg);
  checkROutputFileSelection(cfg);
  checkStatusTestAdjacency(cfg);
  checkPageCrossingBranchInSubroutine(cfg);
  checkCallInsideSubroutine(cfg);
}
