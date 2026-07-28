// TMS1000-family assembler (PRD R2), the control-flow graph the static analyses
// share.
//
// Paths in this header are relative to the repository root.
//
// ## Why a graph and not a scan
//
// Three of the five silent-failure classes PRD R2 names are questions about
// *reachability*, not about a single instruction: whether a `BR` runs with the
// call latch set, whether a `CALL` is reachable from inside a subroutine, and
// what X holds when an R output is written. None of them can be decided by
// looking at the instruction that violates them - the violation is in how
// control got there.
//
// ## Successors, and the two places this machine is not a straight line
//
// Straight-line execution follows the *ordinal*, not the address: the successor
// of the n-th instruction of a page is the (n+1)-th, which sits at physical
// offset `LFSR_SEQUENCE[n + 1]` (memory.ts). Building the graph on addresses
// would connect each instruction to whatever the LFSR happens to have put next
// to it, which is a different program.
//
//   - `BR` and `CALL` are **conditional** on status, so both have a fall-through
//     edge as well as a target edge. There is no unconditional jump on this core
//     (`docs/research/tms1370-architecture.md` section 2), so treating a branch
//     as always taken would drop real paths.
//   - `RETN` has no successor here. Where it returns to is the caller's business
//     and is modelled by the call latch rather than by an edge, because the
//     return register is one level deep and the whole point of analysis 3 is
//     that a second `CALL` overwrites it.
//
// A page holds 64 words and the LFSR wraps from the 64th back to the first. An
// instruction at the last ordinal of a page is given no fall-through: a program
// that runs off the end of a page and wraps to its top is a defect of a kind
// this graph is not the right place to diagnose, and inventing the edge would
// make every full page look like a loop.
//
// ## Call-latch reachability
//
// `reachableInsideSubroutine` walks states of `(instruction, call latch)` rather
// than instructions, which is the context sensitivity PRD R2 asks for: the same
// routine can be entered by `BR` with the latch clear and by `CALL` with it set,
// and only the second is a subroutine. Each latched state carries the `CALL`
// that set the latch, so a rejection can name the call site that forced it and
// not only the callee.
//
// Node-side tool: no DOM, no Web APIs, no runtime dependencies.

import { OperandKind } from '../isa.js';
import {
  RESET_ADDRESS,
  ROM_PAGE_SIZE,
  romAddressForOrdinal,
} from '../memory.js';
import type { AssembledInstruction, AssemblyResult } from '../assembler.js';

/** The mnemonic of the branch instruction, as the ISA table spells it. */
export const BRANCH_MNEMONIC = 'BR';

/** The mnemonic of the call instruction, as the ISA table spells it. */
export const CALL_MNEMONIC = 'CALL';

/** The mnemonic of the return instruction, as the ISA table spells it. */
export const RETURN_MNEMONIC = 'RETN';

/** What an instruction does to control flow. */
export enum FlowKind {
  /** Falls through to the next ordinal of its page and nowhere else. */
  LINEAR = 'LINEAR',
  /** `BR` - falls through, and reaches its target when status is 1. */
  BRANCH = 'BRANCH',
  /** `CALL` - falls through, and enters its target as a subroutine. */
  CALL = 'CALL',
  /** `RETN` - no successor in this graph. */
  RETURN = 'RETURN',
}

/** One instruction and where control can go from it. */
export interface CfgNode {
  /** Index into `ControlFlowGraph.nodes`, which is source order. */
  readonly index: number;
  readonly instruction: AssembledInstruction;
  readonly kind: FlowKind;
  /**
   * The next ordinal of the same page, when an instruction was emitted there.
   *
   * Absent for `RETN`, at the last ordinal of a page, and where the following
   * word is data or was never emitted at all.
   */
  readonly fallThrough?: number;
  /** The branch or call target, when an instruction was emitted at it. */
  readonly target?: number;
}

/** Every instruction of a program, with its successors. */
export interface ControlFlowGraph {
  readonly nodes: readonly CfgNode[];
  /** The node holding a ROM address, or undefined when none does. */
  nodeAt(address: number): CfgNode | undefined;
  /**
   * Where execution starts: the reset entry point when the program has one.
   *
   * A test fixture that assembles four instructions and no reset routine still
   * needs a root, so the first instruction in source order stands in. Either
   * way the roots are only a starting set - `reachableInsideSubroutine` seeds
   * anything they do not reach, so no instruction goes unanalysed.
   */
  readonly entryIndex?: number;
}

/** True when the instruction transfers control to an address it names. */
function isTransfer(instruction: AssembledInstruction): boolean {
  return instruction.entry.operandKind === OperandKind.BRANCH_TARGET;
}

/** What an instruction does to control flow. */
function flowKindOf(instruction: AssembledInstruction): FlowKind {
  if (instruction.entry.mnemonic === RETURN_MNEMONIC) {
    return FlowKind.RETURN;
  }
  if (!isTransfer(instruction)) {
    return FlowKind.LINEAR;
  }
  return instruction.entry.mnemonic === CALL_MNEMONIC ? FlowKind.CALL : FlowKind.BRANCH;
}

/**
 * The address straight-line execution reaches after `instruction`.
 *
 * Undefined at the last ordinal of a page - see the header on why the LFSR wrap
 * is deliberately not an edge.
 */
export function successorAddress(instruction: AssembledInstruction): number | undefined {
  const nextOrdinal = instruction.ordinal + 1;
  if (nextOrdinal >= ROM_PAGE_SIZE) {
    return undefined;
  }
  return romAddressForOrdinal(instruction.chapter, instruction.page, nextOrdinal);
}

/** Build the control-flow graph of an assembled program. */
export function buildControlFlowGraph(result: AssemblyResult): ControlFlowGraph {
  const indexByAddress = new Map<number, number>();
  result.instructions.forEach((instruction, index) => {
    indexByAddress.set(instruction.address, index);
  });

  const nodes: CfgNode[] = result.instructions.map((instruction, index) => {
    const kind = flowKindOf(instruction);
    const successor = kind === FlowKind.RETURN ? undefined : successorAddress(instruction);
    const fallThrough =
      successor === undefined ? undefined : indexByAddress.get(successor);
    const target =
      instruction.target === undefined ? undefined : indexByAddress.get(instruction.target);
    return Object.freeze({
      index,
      instruction,
      kind,
      ...(fallThrough === undefined ? {} : { fallThrough }),
      ...(target === undefined ? {} : { target }),
    });
  });

  const resetIndex = indexByAddress.get(RESET_ADDRESS);
  const entryIndex = resetIndex ?? (nodes.length > 0 ? 0 : undefined);

  return Object.freeze({
    nodes: Object.freeze(nodes),
    nodeAt: (address: number): CfgNode | undefined => {
      const index = indexByAddress.get(address);
      return index === undefined ? undefined : nodes[index];
    },
    ...(entryIndex === undefined ? {} : { entryIndex }),
  });
}

/** One state of the walk: an instruction, and whether the call latch is set. */
interface LatchState {
  readonly index: number;
  readonly latched: boolean;
  /** The `CALL` that set the latch on the path that reached here. */
  readonly callSite?: AssembledInstruction;
}

/**
 * Every instruction reachable with the call latch set, and the call that set it.
 *
 * The witness is the *first* call site the walk reaches an instruction through.
 * Any one of them is enough to explain the rejection and naming one is what PRD
 * R2 requires; naming all of them would turn a diagnostic into a report.
 *
 * Instructions no root reaches are seeded as roots themselves with the latch
 * clear, so unreachable code is analysed rather than skipped. Clear rather than
 * set, because code nothing calls is not inside a subroutine: seeding it latched
 * would reject every `CALL` in a program whose entry point the assembler cannot
 * see, which is every unit-test fixture.
 */
export function reachableInsideSubroutine(
  cfg: ControlFlowGraph,
): ReadonlyMap<number, AssembledInstruction> {
  const seen = new Set<string>();
  const witnesses = new Map<number, AssembledInstruction>();
  const queue: LatchState[] = [];

  const push = (state: LatchState): void => {
    const key = `${state.index}:${state.latched ? 1 : 0}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    queue.push(state);
  };

  const drain = (): void => {
    while (queue.length > 0) {
      const state = queue.pop() as LatchState;
      const node = cfg.nodes[state.index] as CfgNode;
      if (state.latched && state.callSite && !witnesses.has(state.index)) {
        witnesses.set(state.index, state.callSite);
      }
      if (node.kind === FlowKind.RETURN) {
        continue;
      }
      if (node.target !== undefined) {
        push(
          node.kind === FlowKind.CALL
            ? { index: node.target, latched: true, callSite: node.instruction }
            : { index: node.target, latched: state.latched, ...witnessOf(state) },
        );
      }
      if (node.fallThrough !== undefined) {
        push({ index: node.fallThrough, latched: state.latched, ...witnessOf(state) });
      }
    }
  };

  if (cfg.entryIndex !== undefined) {
    push({ index: cfg.entryIndex, latched: false });
    drain();
  }
  for (let index = 0; index < cfg.nodes.length; index += 1) {
    if (!seen.has(`${index}:0`) && !seen.has(`${index}:1`)) {
      push({ index, latched: false });
      drain();
    }
  }

  return witnesses;
}

/** Carry a state's call-site witness onto a successor state, if it has one. */
function witnessOf(state: LatchState): { callSite?: AssembledInstruction } {
  return state.callSite === undefined ? {} : { callSite: state.callSite };
}

/** `demo.asm:41:9` - how a diagnostic names another instruction's place. */
export function formatSite(instruction: AssembledInstruction): string {
  const { file, line, column } = instruction.position;
  return `${file}:${line}:${column}`;
}
