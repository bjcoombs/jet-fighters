// The comparison harness's command line, and the report it writes.
//
// Paths in this file are relative to the repository root.
//
// The group that matters most is `with no romset present`. Contract V11 fails a
// harness that cannot run without the romset, and the failure it is guarding
// against is a tool that treats "the artifacts are missing" as an error
// condition. So the assertions there are about the *exit code* as much as about
// the output: absent, partial, and a directory that does not exist all have to
// leave the process at zero, having done the work.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EXIT, parseArguments, parseInputSpec, runCli, UsageError } from './cli.js';
import { DEFAULT_SWEEPS, ourMachineImage } from './harness.js';
import { SWEEP_INSTRUCTIONS } from '../../src/machine/board/tms1370-cadence.js';
import { ARTIFACTS } from './romset.js';

/**
 * Sweeps a CLI test runs, and why it is not the default.
 *
 * The CLI records twice - our image and the comparison target - so a test that
 * ran {@link DEFAULT_SWEEPS} would spend most of this file's wall clock proving
 * something eight sweeps prove. Stated in sweeps, not cycles, for the same
 * reason the default is.
 */
const TEST_SWEEPS = 8;
const SWEEPS_ARGS = ['--sweeps', String(TEST_SWEEPS)];

/** Collect what an invocation wrote, without touching a terminal. */
function capture(): { streams: { out: (t: string) => void; err: (t: string) => void }; out: () => string; err: () => string } {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  return {
    streams: {
      out: (text) => outChunks.push(text),
      err: (text) => errChunks.push(text),
    },
    out: () => outChunks.join(''),
    err: () => errChunks.join(''),
  };
}

const scratch = mkdtempSync(join(tmpdir(), 'jf-compare-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('parsing the command line', () => {
  it('defaults to a run of whole sweeps against our own image', () => {
    const options = parseArguments([]);
    expect(options.original).toBeUndefined();
    expect(options.cycles).toBe(DEFAULT_SWEEPS * SWEEP_INSTRUCTIONS);
    expect(options.input).toEqual([]);
    expect(options.json).toBe(false);
  });

  it('takes --sweeps and --cycles, but not both', () => {
    expect(parseArguments(['--sweeps', '3']).cycles).toBe(3 * SWEEP_INSTRUCTIONS);
    expect(parseArguments(['--cycles=1234']).cycles).toBe(1234);
    expect(() => parseArguments(['--sweeps', '3', '--cycles', '4'])).toThrow(UsageError);
  });

  it('takes --original as the comparison target’s directory', () => {
    expect(parseArguments(['--original', '/romsets/ginv']).original).toBe('/romsets/ginv');
    expect(parseArguments(['--original=/romsets/ginv']).original).toBe('/romsets/ginv');
  });

  it('carries the PLA plane orderings through, since they are assumptions', () => {
    const options = parseArguments(['--pla-input-order', 'lsb-first', '--pla-output-order=lsb-first']);
    expect(options.pla.inputOrder).toBe('lsb-first');
    expect(options.pla.outputOrder).toBe('lsb-first');
    expect(() => parseArguments(['--pla-input-order', 'sideways'])).toThrow(/msb-first or lsb-first/);
  });

  it('rejects an unknown flag rather than ignoring it', () => {
    expect(() => parseArguments(['--compare-everything'])).toThrow(/unknown option/);
  });

  it('rejects a flag with no value', () => {
    expect(() => parseArguments(['--original'])).toThrow(/needs a value/);
    expect(() => parseArguments(['--original', '--json'])).toThrow(/needs a value/);
  });
});

describe('parsing an input schedule', () => {
  it('closes a contact on the K matrix, never pokes game state', () => {
    expect(parseInputSpec('lever=up@1200')).toEqual({ cycle: 1200, change: { lane: 0 } });
    expect(parseInputSpec('lever=centre@0')).toEqual({ cycle: 0, change: { lane: 1 } });
    expect(parseInputSpec('lever=down@10')).toEqual({ cycle: 10, change: { lane: 2 } });
    expect(parseInputSpec('skill=3@10')).toEqual({ cycle: 10, change: { skill: 3 } });
    expect(parseInputSpec('fire@10')).toEqual({ cycle: 10, change: { fire: true } });
    expect(parseInputSpec('unfire@20')).toEqual({ cycle: 20, change: { fire: false } });
  });

  it('rejects a spec it cannot honour rather than guessing', () => {
    expect(() => parseInputSpec('lever=up')).toThrow(/no @cycle/);
    expect(() => parseInputSpec('lever=up@later')).toThrow(/whole-number cycle/);
    expect(() => parseInputSpec('lever=sideways@1')).toThrow(/lever takes/);
    expect(() => parseInputSpec('skill=9@1')).toThrow(/skill takes/);
    expect(() => parseInputSpec('throttle=2@1')).toThrow(/no such control/);
  });
});

describe('with no romset present', () => {
  it('runs, reports the surface, and exits zero', () => {
    const capture_ = capture();
    const code = runCli(SWEEPS_ARGS, capture_.streams);
    expect(code).toBe(EXIT.ok);
    expect(capture_.err()).toBe('');
    const report = capture_.out();
    expect(report).toContain('Mode: **self-consistency**');
    expect(report).toContain('## The surface');
    expect(report).toContain('Display grids driven | 0, 1, 2, 3, 4, 5, 6, 7, 8');
    expect(report).toContain('Score progression');
    expect(report).toContain('No mismatch');
  });

  it('says which artifacts it would need, without treating their absence as a fault', () => {
    const capture_ = capture();
    runCli(SWEEPS_ARGS, capture_.streams);
    const report = capture_.out();
    for (const name of Object.values(ARTIFACTS)) {
      expect(report).toContain(name);
    }
    expect(report).not.toMatch(/error|warning|failed/i);
  });

  it('exits zero when the named romset directory does not exist', () => {
    const capture_ = capture();
    const code = runCli([...SWEEPS_ARGS, '--original', join(scratch, 'nowhere')], capture_.streams);
    expect(code).toBe(EXIT.ok);
    expect(capture_.out()).toContain('| `mp2110` | absent |');
    expect(capture_.err()).toBe('');
  });

  it('exits zero when only the program dump is there, and says why it is not enough', () => {
    const partial = join(scratch, 'partial');
    writeFileSync(join(mkdirp(partial), ARTIFACTS.machineImage), new Uint8Array(2048));
    const capture_ = capture();
    const code = runCli([...SWEEPS_ARGS, '--original', partial], capture_.streams);
    expect(code).toBe(EXIT.ok);
    expect(capture_.out()).toContain('Not comparable');
    expect(capture_.out()).toContain('nothing about which plates they drive');
    expect(capture_.err()).toBe('');
  });
});

describe('with a comparison target present', () => {
  it('compares against it, interpreting it through the PLA supplied beside it', () => {
    // The target here is our own image, written out as a dump would be. That is
    // not a stand-in for the original - no original artifact exists here - it is
    // the only way to exercise the loading path without one.
    const dir = mkdirp(join(scratch, 'target'));
    const { rom, opla } = ourImageFiles();
    writeFileSync(join(dir, ARTIFACTS.machineImage), rom);
    writeFileSync(join(dir, ARTIFACTS.outputPla), opla);

    const capture_ = capture();
    const code = runCli([...SWEEPS_ARGS, '--original', dir], capture_.streams);
    expect(code).toBe(EXIT.ok);
    expect(capture_.out()).toContain('Mode: **against-original**');
    expect(capture_.out()).toContain('| `mp2110` | present |');
    expect(capture_.out()).toContain('No mismatch');
  });

  it('exits non-zero on a genuine mismatch, and only on one', () => {
    const dir = mkdirp(join(scratch, 'mismatch'));
    const { rom, opla } = ourImageFiles();
    // Every lit plate mask inverted: the program is untouched and the glass is
    // not. Inverting the whole table rather than one slot because only a
    // handful of the 32 are reached in a short idle run, and this test is about
    // the exit code rather than about which slot is spent where.
    const altered = Uint8Array.from(opla, (mask) => (mask === 0 ? 0 : mask ^ 0xff));
    writeFileSync(join(dir, ARTIFACTS.machineImage), rom);
    writeFileSync(join(dir, ARTIFACTS.outputPla), altered);

    const capture_ = capture();
    const code = runCli([...SWEEPS_ARGS, '--original', dir], capture_.streams);
    expect(code).toBe(EXIT.mismatch);
    expect(capture_.out()).toContain('MISMATCH');
  });

  it('reports a file error as a usage error, not as a mismatch', () => {
    const dir = mkdirp(join(scratch, 'broken'));
    writeFileSync(join(dir, ARTIFACTS.machineImage), new Uint8Array(2048));
    writeFileSync(join(dir, ARTIFACTS.outputPla), '.i 5\n.o 8\n.p 4\n00000 00000001\n.e\n');
    const capture_ = capture();
    const code = runCli([...SWEEPS_ARGS, '--original', dir], capture_.streams);
    expect(code).toBe(EXIT.usage);
    expect(capture_.err()).toContain('declares 4 terms and holds 1');
  });
});

describe('the report’s other forms', () => {
  it('writes JSON a gate can branch on', () => {
    const capture_ = capture();
    const code = runCli([...SWEEPS_ARGS, '--json'], capture_.streams);
    expect(code).toBe(EXIT.ok);
    const report = JSON.parse(capture_.out()) as Record<string, unknown>;
    expect(report.mode).toBe('self-consistency');
    expect(report.matched).toBe(true);
    expect(report.romset).toMatchObject({ looked: false, comparable: false });
    expect((report.left as Record<string, unknown>).gridsStrobed).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('writes the report to a file when asked', () => {
    const path = join(scratch, 'report.md');
    const capture_ = capture();
    expect(runCli([...SWEEPS_ARGS, '--out', path], capture_.streams)).toBe(EXIT.ok);
    expect(readFileSync(path, 'utf8')).toBe(capture_.out());
  });

  it('prints usage on --help and exits zero', () => {
    const capture_ = capture();
    expect(runCli(['--help'], capture_.streams)).toBe(EXIT.ok);
    expect(capture_.out()).toContain('--original <dir>');
    expect(capture_.out()).toContain('An absent romset is none of those three');
  });

  it('prints usage on a bad command line and exits two', () => {
    const capture_ = capture();
    expect(runCli(['--nonsense'], capture_.streams)).toBe(EXIT.usage);
    expect(capture_.err()).toContain('unknown option');
  });

  it('takes an input schedule and reports each event’s response', () => {
    const capture_ = capture();
    const at = 3 * SWEEP_INSTRUCTIONS;
    const code = runCli([...SWEEPS_ARGS, '--input', `lever=up@${at}`], capture_.streams);
    expect(code).toBe(EXIT.ok);
    expect(capture_.out()).toContain('### Input response');
    expect(capture_.out()).toContain(String(at));
  });
});

/** `mkdir -p`, returning the path so a caller can write into it inline. */
function mkdirp(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

/**
 * Our own assembled image, as the two files a romset directory holds.
 *
 * Standing in for a dump this project does not have. It is not a substitute for
 * the original and proves nothing about it - what it exercises is the loading
 * and comparison path, which is the half of the harness that has to be ready
 * before an artifact arrives.
 */
function ourImageFiles(): { rom: Uint8Array; opla: Uint8Array } {
  const image = ourMachineImage();
  return { rom: image.rom, opla: image.opla };
}
