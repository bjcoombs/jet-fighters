// TMS1000-family assembler (PRD R2), analysis 4: `SETR`/`RSTR` while X >= 4.
//
// Paths in this header are relative to the repository root.
//
// ## The failure this rejects
//
// `SETR` and `RSTR` name an R output by Y, but MAME's TMS1100-family override
// computes the latch index as `BIT(X, 2) << 4 | Y` (S1 `tms1100.cpp:77-92`, via
// `docs/research/tms1370-architecture.md` section 3). X's most significant bit
// is a fifth index bit. This part has sixteen R outputs, so with X >= 4 the
// write addresses R16-R31, which do not exist: the intended output never moves
// and nothing reports it. TI states the constraint directly - S3 section 3.3,
// "When using the set or reset R instructions, the X register must be less than
// four."
//
// Under PRD R4 the display grids, the input strobes, the high plates and the
// speaker are all R lines, so every sweep, every strobe and every sound edge on
// this machine is exposed to it.
//
// ## What is tracked, and where it gives up
//
// A forward may-analysis over the control-flow graph. X is set by `LDX` (a
// constant) and by `COMX` (which complements *only the MSB* on this core, so it
// toggles exactly the bit that matters here). The state at each instruction is
// the set of values X may hold, plus an "unknown" flag; a rejection is raised
// only when a value that is definitely reachable is >= 4.
//
// Unknown is not an error. X is unknown at an entry point and after a `CALL`,
// because what the callee left in X is not decided here. Rejecting on unknown
// would refuse every program that writes an R output after calling anything,
// which is every display sweep. So this analysis is deliberately not a proof
// that X < 4 everywhere - it is a rejection of the cases where the source says
// in as many words that it is not.
//
// Node-side tool: no DOM, no Web APIs, no runtime dependencies.

import { AsmError } from '../lexer.js';
import { RAM_FILE_COUNT } from '../memory.js';
import { formatSite, FlowKind } from './cfg.js';
import type { CfgNode, ControlFlowGraph } from './cfg.js';
import type { AssembledInstruction } from '../assembler.js';

/**
 * The bit of X that MAME uses as the fifth R-latch index bit.
 *
 * X is three bits wide (one of eight RAM files), so this is its MSB - and `X >=
 * this` is the same statement as "the fifth index bit is set", which is why one
 * constant serves as both the mask and the ceiling.
 */
export const X_MSB = RAM_FILE_COUNT >> 1;

/** The first RAM file an R output instruction may not be executed under. */
export const R_OUTPUT_X_LIMIT = X_MSB;

/** Mnemonics that write an R output latch indexed by X's MSB and Y. */
export const R_OUTPUT_MNEMONICS: ReadonlySet<string> = Object.freeze(
  new Set(['SETR', 'RSTR']),
);

/** The mnemonic that loads X with a constant. */
const LOAD_X_MNEMONIC = 'LDX';

/** The mnemonic that complements X's MSB - and only its MSB, on this core. */
const COMPLEMENT_X_MNEMONIC = 'COMX';

/**
 * What X may hold at a program point.
 *
 * `known` maps each possible value to the instruction that put it there, so a
 * rejection can point at the `LDX` or `COMX` responsible rather than only at the
 * `SETR`. `unknown` means some path arrives with a value this analysis cannot
 * name; it never triggers a rejection.
 */
interface XState {
  readonly known: Map<number, AssembledInstruction | undefined>;
  unknown: boolean;
}

/** The state at an entry point: X is whatever it is. */
function unknownState(): XState {
  return { known: new Map(), unknown: true };
}

/** Fold `source` into `into`; true when `into` gained something. */
function merge(into: XState, source: XState): boolean {
  let changed = false;
  if (source.unknown && !into.unknown) {
    into.unknown = true;
    changed = true;
  }
  for (const [value, witness] of source.known) {
    if (!into.known.has(value)) {
      into.known.set(value, witness);
      changed = true;
    }
  }
  return changed;
}

/** What the state becomes after executing `node`. */
function transfer(node: CfgNode, before: XState): XState {
  const { entry, operand } = node.instruction;
  if (entry.mnemonic === LOAD_X_MNEMONIC) {
    return { known: new Map([[operand as number, node.instruction]]), unknown: false };
  }
  if (entry.mnemonic === COMPLEMENT_X_MNEMONIC) {
    return {
      known: new Map([...before.known].map(([value]) => [value ^ X_MSB, node.instruction])),
      unknown: before.unknown,
    };
  }
  return { known: new Map(before.known), unknown: before.unknown };
}

/**
 * Reject an R output instruction that can execute with X >= 4.
 *
 * @throws AsmError naming the instruction that put the offending value in X.
 */
export function checkROutputFileSelection(cfg: ControlFlowGraph): void {
  const states = cfg.nodes.map((): XState => ({ known: new Map(), unknown: false }));
  const queued = new Set<number>();
  const worklist: number[] = [];

  const feed = (index: number | undefined, incoming: XState): void => {
    if (index === undefined) {
      return;
    }
    if (merge(states[index] as XState, incoming) && !queued.has(index)) {
      queued.add(index);
      worklist.push(index);
    }
  };

  // Every instruction is seeded unknown rather than only the entry points. An
  // R output written in code the graph cannot reach from an entry is still code
  // in the ROM, and seeding it unknown analyses it without inventing a value.
  for (let index = 0; index < cfg.nodes.length; index += 1) {
    feed(index, unknownState());
  }

  while (worklist.length > 0) {
    const index = worklist.pop() as number;
    queued.delete(index);
    const node = cfg.nodes[index] as CfgNode;
    const after = transfer(node, states[index] as XState);
    if (node.kind === FlowKind.RETURN) {
      continue;
    }
    if (node.kind === FlowKind.CALL) {
      // Into the callee X flows unchanged; back at the call site it does not,
      // because the callee is free to load X and this analysis does not follow
      // the return edge.
      feed(node.target, after);
      feed(node.fallThrough, unknownState());
      continue;
    }
    feed(node.target, after);
    feed(node.fallThrough, after);
  }

  for (const node of cfg.nodes) {
    if (!R_OUTPUT_MNEMONICS.has(node.instruction.entry.mnemonic)) {
      continue;
    }
    const state = states[node.index] as XState;
    const offending = [...state.known.keys()]
      .filter((value) => value >= R_OUTPUT_X_LIMIT)
      .sort((left, right) => left - right);
    if (offending.length === 0) {
      continue;
    }
    const first = offending[0] as number;
    const witness = state.known.get(first);
    throw new AsmError(
      `${node.instruction.mnemonic} can execute with X = ` +
        `${offending.join(' or ')}${witness ? `, loaded at ${formatSite(witness)}` : ''}. The R ` +
        `latch is indexed BIT(X, 2) << 4 | Y, so X >= ${R_OUTPUT_X_LIMIT} addresses R16-R31, ` +
        'which this device does not have - the write is silently discarded and the output ' +
        `never moves. Select a RAM file below ${R_OUTPUT_X_LIMIT} before writing an R output`,
      node.instruction.position,
    );
  }
}
