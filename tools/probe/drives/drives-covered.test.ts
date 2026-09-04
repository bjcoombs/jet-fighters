// Every drive in this directory is either exercised by CI or excluded on the
// record. This is the file that makes "either" true.
//
// Paths in this file are relative to the repository root.
//
// `drives/README.md` says every gameplay figure quoted in a review, a commit
// message or `docs/evidence/` should be re-derivable from this repository by
// somebody other than whoever measured it. Nothing enforced that, and it failed
// five times - two drives sat dead for a whole tag, printing zeroes that read as
// findings. **The shape of the failure was always the same: an instrument that
// had stopped producing opportunities printed a zero, and a zero looks like an
// answer.**
//
// The per-drive floors live beside each drive in `<drive>.test.ts`. What is
// asserted here is the thing those files cannot assert about themselves: that no
// drive is missing one. A new drive added to this directory fails this file
// until somebody decides which column it belongs in.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = fileURLToPath(new URL('.', import.meta.url));

interface Coverage {
  /** The file that asserts this drive's floors, or `null` when excluded. */
  readonly test: string | null;
  /** Why, in the excluded case - and any caveat in the covered case. */
  readonly note?: string;
}

/**
 * Every non-test TypeScript file in this directory, and what exercises it.
 *
 * Keep this in the same order as `ls`. A drive whose entry says `test: null`
 * is a deliberate exclusion and the note is the reason it is one.
 */
const COVERAGE: Readonly<Record<string, Coverage>> = {
  'battleship-lead.ts': { test: 'battleship-lead.test.ts' },
  'column-hit-profile.ts': { test: 'column-hit-profile.test.ts' },
  'entry-onto-missile.ts': { test: 'entry-onto-missile.test.ts' },
  'entry-point.ts': {
    test: null,
    note:
      'Not a drive. It answers "am I the program being run" for the drives that ' +
      'print only when they are, and every drive test imports it transitively.',
  },
  'entry-spread.ts': { test: 'entry-spread.test.ts' },
  'loss-warning-partials.ts': {
    test: 'loss-warning-partials.test.ts',
    note:
      'Covered, with one caveat: it decodes assets/reference/loss-audio.m4a through ' +
      'ffmpeg, so the test skips on a machine without ffmpeg on PATH. It does not ' +
      'skip in CI - .github/workflows/ci.yml installs ffmpeg if the runner lacks it, ' +
      'and the test fails rather than skips when CI is set and ffmpeg is missing.',
  },
  'march-tone-identity.ts': {
    test: 'march-tone-identity.test.ts',
    note:
      'Covered, with the same ffmpeg caveat as loss-warning-partials.ts. Its floors ' +
      'are unusual in one way worth knowing: the drive reaches a negative conclusion, ' +
      'and a broken decoder reaches the same one for free, so the test floors what the ' +
      'drive still *finds* and adds a ceiling on the negative control.',
  },
  'march-wall-clock.ts': { test: 'march-wall-clock.test.ts' },
  'missile-transit.ts': {
    test: 'missile-transit.test.ts',
    note:
      'The only drive here that measures the physical unit rather than the emulated ' +
      'machine. It reads assets/reference/skill3-video-cells.csv, which the tracer ' +
      'produces from the owner recording - the drive itself needs no ffmpeg, NumPy or ' +
      'video decode, which is deliberate: loss-warning-partials.ts could not run in a ' +
      'clean checkout for exactly that reason.',
  },
  'parked-endings.ts': { test: 'parked-endings.test.ts' },
  'playability-audit.ts': { test: 'playability-audit.test.ts' },
  'score-windows.ts': {
    test: 'score-windows.test.ts',
    note:
      'The second drive here that measures the physical unit. Same shape as ' +
      'missile-transit.ts and for the same reason: it reads ' +
      'assets/reference/skill3-video-score.csv, which tools/video/score_windows.py ' +
      'produces from the committed crop, so the drive needs no ffmpeg, NumPy or video ' +
      'decode. Its floors are unusual in one way: its subject is dark for more of the ' +
      'clip than it is lit, so one of them asserts a named frame is still *dark* - the ' +
      'frame a fabricated row was once read off.',
  },
  'recording.ts': {
    test: null,
    note:
      'Not a drive. It is the ffmpeg decoder and the spectral helpers the two drives ' +
      'that measure a recording share - loss-warning-partials.ts and ' +
      'march-tone-identity.ts - and it prints nothing and decides nothing. Both of ' +
      'those tests exercise it, and a fault in it fails them rather than passing ' +
      'quietly here.',
  },
  'render-drive.ts': {
    test: 'render-drive.test.ts',
    note:
      'A library rather than a script - it wires a machine to the real renderer and ' +
      'owns no policy. render-drive.test.ts was here before this task and is the ' +
      'precedent the rest follow: it carries its own preconditions ("no battleship ' +
      'crossed", "the game never ended") for the same reason the floors exist.',
  },
};

describe('drive coverage', () => {
  it('accounts for every file in tools/probe/drives/', () => {
    const present = readdirSync(HERE)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .sort();
    expect(
      present,
      'a file in tools/probe/drives/ is not listed in COVERAGE. Add it with a test ' +
        'that floors its opportunity count, or with `test: null` and the reason. ' +
        'A drive nothing runs is a drive that rots in silence - see the README.',
    ).toEqual(Object.keys(COVERAGE).sort());
  });

  it('names a test file that exists for every covered drive', () => {
    const tests = new Set(readdirSync(HERE).filter((name) => name.endsWith('.test.ts')));
    for (const [drive, coverage] of Object.entries(COVERAGE)) {
      if (coverage.test === null) continue;
      expect(tests.has(coverage.test), `${drive} claims ${coverage.test}, which is not here`).toBe(
        true,
      );
    }
  });

  it('states a reason for every exclusion', () => {
    for (const [drive, coverage] of Object.entries(COVERAGE)) {
      if (coverage.test !== null) continue;
      expect(coverage.note ?? '', `${drive} is excluded without saying why`).not.toBe('');
    }
  });
});
