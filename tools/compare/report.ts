// The comparison report: what the harness found, in a form a person reads and
// a form a gate parses.
//
// Paths in this file are relative to the repository root.
//
// Two decisions here are worth stating, because both are about not misleading a
// reader who has no romset and never will have one on this run.
//
// **The romset's state is always printed, present or absent.** A report that
// only mentions the artifacts when it has them reads, on the ordinary run, as
// though the comparison were complete. It is not: with no romset the harness is
// reporting our own machine's surface and checking its own comparator, and the
// report says so in as many words.
//
// **Durations are printed as ranges.** `src/machine/cpu/tms1370/timing.ts`
// records MAME's stated +/-50 kHz on a 350 kHz approximation, so a cycle count
// has no single answer in milliseconds. Every figure the harness compares is in
// instruction cycles, which is rate-free; where the report quotes one as a
// duration it quotes both ends.
//
// Node-side tool: no DOM, no timers, no Web APIs, no runtime dependencies.

import {
  cyclesToMillisecondRange,
  Mode,
  SPEAKER_EDGE_TOLERANCE_CYCLES,
  type Comparison,
  type HarnessResult,
} from './harness.js';
import { ARTIFACTS, type RomsetInspection } from './romset.js';
import {
  CYCLE_HZ_MAX,
  CYCLE_HZ_MIN,
  OSCILLATOR_HZ,
  OSCILLATOR_SPREAD_HZ,
} from '../../src/machine/cpu/tms1370/timing.js';

/**
 * Differing sweeps printed in full before the report summarises the rest.
 *
 * A run against a genuinely different program mismatches on every sweep, and a
 * few hundred cell-by-cell diffs is not a report. The count that was dropped is
 * always stated - a truncation nobody is told about reads as "that was all of
 * them".
 */
export const MISMATCH_SAMPLE_LIMIT = 5;

/** Everything the report is written from. */
export interface ReportInput {
  readonly result: HarnessResult;
  /** What was found where a romset was looked for, if anywhere was. */
  readonly romset?: RomsetInspection;
}

/** Cycles, with the duration range they correspond to. */
function cyclesWithRange(cycles: number): string {
  const [low, high] = cyclesToMillisecondRange(cycles);
  return `${cycles} cycles (${low.toFixed(1)}-${high.toFixed(1)} ms)`;
}

/** A score value as a player would read it, or a mark for one they could not. */
function scoreText(value: number | undefined): string {
  return value === undefined ? '--' : String(value);
}

/** The romset section: what was looked for and what was there. */
function romsetSection(romset: RomsetInspection | undefined): string[] {
  if (romset === undefined) {
    return [
      '## Original artifacts',
      '',
      'No romset directory was given, so none was looked for. This is the ordinary',
      'case: this project has obtained none of the four artifacts, and the harness is',
      'built to run without them. Pass `--original <dir>` to compare against a dump.',
      '',
      '| Artifact | Gates |',
      '| --- | --- |',
      `| \`${ARTIFACTS.machineImage}\` | the comparison target's program |`,
      `| \`${ARTIFACTS.outputPla}\` | what that program's O indices light |`,
      `| \`${ARTIFACTS.microPla}\` | the opcode verification (PRD R0) |`,
      `| \`${ARTIFACTS.artwork}\` | the segment addressing (PRD R4) |`,
      '',
    ];
  }
  const lines = [
    '## Original artifacts',
    '',
    `Looked in \`${romset.directory}\`.`,
    '',
    '| Artifact | State |',
    '| --- | --- |',
  ];
  for (const name of Object.values(ARTIFACTS)) {
    lines.push(`| \`${name}\` | ${romset.present.includes(name) ? 'present' : 'absent'} |`);
  }
  lines.push('');
  if (!romset.comparable) {
    lines.push(
      'Not comparable: a comparison target needs the program dump **and** the output',
      'PLA that interprets it. A dump on its own emits five-bit indices and says',
      'nothing about which plates they drive.',
      '',
    );
  }
  return lines;
}

/** The surface section: what our machine put on its pins. */
function surfaceSection(comparison: Comparison): string[] {
  const { left } = comparison;
  const lastFrame = left.frames[left.frames.length - 1];
  const sweepCycles = left.frames.map((frame) => frame.toCycle - frame.fromCycle);
  const shortest = sweepCycles.length === 0 ? 0 : Math.min(...sweepCycles);
  const longest = sweepCycles.length === 0 ? 0 : Math.max(...sweepCycles);
  return [
    '## The surface',
    '',
    `Recorded from \`${left.image.name}\`: ${left.image.provenance}`,
    '',
    '| Measure | Value |',
    '| --- | --- |',
    `| Instruction cycles executed | ${cyclesWithRange(left.cycles)} |`,
    `| Complete display sweeps | ${left.frames.length} |`,
    `| Sweep length | ${shortest}-${longest} cycles |`,
    `| Display grids driven | ${left.gridsStrobed.join(', ') || 'none'} |`,
    `| Superimposed input strobes | ${left.superimposedStrobes.length} |`,
    `| Power-on to first light | ${
      left.firstLitCycle === undefined ? 'never lit' : cyclesWithRange(left.firstLitCycle)
    } |`,
    `| Speaker edges | ${left.speakerEdges.length} |`,
    `| Lit cells, last sweep | ${lastFrame === undefined ? 0 : lastFrame.litCells.size} |`,
    `| Score progression | ${left.scoreProgression.map(scoreText).join(' -> ')} |`,
    '',
  ];
}

/** The comparison section: where the two recordings agreed and where they did not. */
function comparisonSection(comparison: Comparison, mode: string): string[] {
  const lines = [
    '## The comparison',
    '',
    mode === Mode.selfConsistency
      ? 'Our machine image against a second recording of itself. With no romset present\n' +
        'this is what drives the comparator end to end - sweep splitting, cell\n' +
        'differencing, edge pairing, score progression - so a `matched` verdict below\n' +
        'comes from a comparator that ran.'
      : `Our machine image (left) against \`${comparison.right.image.name}\` (right):\n` +
        comparison.right.image.provenance,
    '',
    '| Measure | Left | Right |',
    '| --- | --- | --- |',
    `| Complete sweeps | ${comparison.left.frames.length} | ${comparison.right.frames.length} |`,
    `| Speaker edges | ${comparison.speaker.leftEdges} | ${comparison.speaker.rightEdges} |`,
    `| Score progression | ${comparison.leftScoreProgression.map(scoreText).join(' -> ')} | ${comparison.rightScoreProgression
      .map(scoreText)
      .join(' -> ')} |`,
    '',
    '| Check | Result |',
    '| --- | --- |',
    `| Sweeps compared | ${comparison.framesMatched} of ${comparison.framesCompared} matched |`,
    `| Sweep counts agree | ${comparison.frameCountsAgree ? 'yes' : 'no'} |`,
    `| Speaker edges paired | ${comparison.speaker.matchedEdges} of ${Math.min(
      comparison.speaker.leftEdges,
      comparison.speaker.rightEdges,
    )}, worst skew ${comparison.speaker.worstSkewCycles} cycles (tolerance ${SPEAKER_EDGE_TOLERANCE_CYCLES}) |`,
    `| Score progression agrees | ${comparison.scoreProgressionAgrees ? 'yes' : 'no'} |`,
    '',
  ];

  if (comparison.inputs.length > 0) {
    lines.push(
      '### Input response',
      '',
      '| Injected at | Left | Right | Skew |',
      '| --- | --- | --- | --- |',
    );
    for (const input of comparison.inputs) {
      const describe = (cycles: number | undefined): string =>
        cycles === undefined ? 'not seen' : `${cycles} cycles`;
      lines.push(
        `| ${input.event.cycle} | ${describe(input.leftLitResponseCycles)} | ` +
          `${describe(input.rightLitResponseCycles)} | ` +
          `${input.skewCycles === undefined ? '-' : `${input.skewCycles} cycles`}` +
          `${input.matched ? '' : ' (over tolerance)'} |`,
      );
    }
    lines.push('');
  }

  if (comparison.frameMismatches.length > 0) {
    lines.push('### Sweeps that differ', '', '| Sweep | Only left | Only right | Score |', '| --- | --- | --- | --- |');
    for (const mismatch of comparison.frameMismatches.slice(0, MISMATCH_SAMPLE_LIMIT)) {
      lines.push(
        `| ${mismatch.index} | ${mismatch.onlyInLeft.join(' ') || '-'} | ` +
          `${mismatch.onlyInRight.join(' ') || '-'} | ` +
          `${scoreText(mismatch.leftScore)} vs ${scoreText(mismatch.rightScore)} |`,
      );
    }
    lines.push('');
    if (comparison.frameMismatches.length > MISMATCH_SAMPLE_LIMIT) {
      lines.push(
        `${comparison.frameMismatches.length - MISMATCH_SAMPLE_LIMIT} further differing ` +
          `sweeps are not listed. Cells are \`grid:plate\`.`,
        '',
      );
    }
  }

  return lines;
}

/** The whole report, as text. */
export function formatReport(input: ReportInput): string {
  const { result, romset } = input;
  const { comparison } = result;
  const lines = [
    '# Jet Fighters comparison harness',
    '',
    `Mode: **${result.mode}**`,
    '',
    'Timing is compared in instruction cycles, which is rate-free. Durations are quoted',
    `as ranges because MAME's ${OSCILLATOR_HZ / 1000} kHz carries a stated ` +
      `+/-${OSCILLATOR_SPREAD_HZ / 1000} kHz, putting the`,
    `instruction rate between ${Math.round(CYCLE_HZ_MIN)} and ${Math.round(
      CYCLE_HZ_MAX,
    )} cycles a second.`,
    '',
    ...romsetSection(romset),
    ...surfaceSection(comparison),
    ...comparisonSection(comparison, result.mode),
    '## Verdict',
    '',
    comparison.matched
      ? 'No mismatch. The two recordings agree on every sweep compared, on the speaker\n' +
        'edge stream, and on the score the digits read out.'
      : 'MISMATCH. The two recordings differ on the surface above. This is a genuine\n' +
        'difference and is what sets a non-zero exit code.',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * The same report as data.
 *
 * Sets become sorted arrays and the sweep bodies are left out: this is the
 * shape a gate reads to decide something, not an archive of the run. Anything
 * a caller might branch on is here, which is why `matched` is at the top level
 * rather than needing to be recomputed from the sections.
 */
export function reportJson(input: ReportInput): Record<string, unknown> {
  const { result, romset } = input;
  const { comparison } = result;
  return {
    mode: result.mode,
    matched: comparison.matched,
    romset:
      romset === undefined
        ? { looked: false, present: [], absent: Object.values(ARTIFACTS), comparable: false }
        : {
            looked: true,
            directory: romset.directory,
            present: romset.present,
            absent: romset.absent,
            comparable: romset.comparable,
          },
    left: recordingJson(comparison, 'left'),
    right: recordingJson(comparison, 'right'),
    framesCompared: comparison.framesCompared,
    framesMatched: comparison.framesMatched,
    frameCountsAgree: comparison.frameCountsAgree,
    frameMismatches: comparison.frameMismatches.map((mismatch) => ({
      index: mismatch.index,
      onlyInLeft: mismatch.onlyInLeft,
      onlyInRight: mismatch.onlyInRight,
      leftScore: mismatch.leftScore ?? null,
      rightScore: mismatch.rightScore ?? null,
    })),
    speaker: comparison.speaker,
    scoreProgressionAgrees: comparison.scoreProgressionAgrees,
    inputs: comparison.inputs.map((input_) => ({
      cycle: input_.event.cycle,
      leftLitResponseCycles: input_.leftLitResponseCycles ?? null,
      rightLitResponseCycles: input_.rightLitResponseCycles ?? null,
      skewCycles: input_.skewCycles ?? null,
      matched: input_.matched,
    })),
  };
}

/** One side of a comparison, as data. */
function recordingJson(comparison: Comparison, side: 'left' | 'right'): Record<string, unknown> {
  const recording = comparison[side];
  const lastFrame = recording.frames[recording.frames.length - 1];
  return {
    name: recording.image.name,
    provenance: recording.image.provenance,
    cycles: recording.cycles,
    frames: recording.frames.length,
    gridsStrobed: recording.gridsStrobed,
    superimposedStrobes: recording.superimposedStrobes.length,
    firstLitCycle: recording.firstLitCycle ?? null,
    speakerEdges: recording.speakerEdges.length,
    scoreProgression: recording.scoreProgression.map((value) => value ?? null),
    lastFrameLitCells: lastFrame === undefined ? [] : [...lastFrame.litCells].sort(),
  };
}
