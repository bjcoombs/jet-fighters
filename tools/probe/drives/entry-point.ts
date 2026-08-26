// Is this module the program being run, or one a test imported?
//
// Paths in this file are relative to the repository root.
//
// Every drive beside this file answers its question in an exported function and
// prints the answer only when it is the thing being run, so that
// `<drive>.test.ts` can import the same function and assert on the numbers
// instead of parsing the printed line. That split needs one bit of information -
// "am I the entry point" - and this is where it is decided, once.
//
// The two cases, both measured rather than assumed:
//
//   - `npx vite-node tools/probe/drives/<file>.ts` leaves `process.argv[1]`
//     pointing at the vite-node binary, not at the module, so the module path
//     never matches and the basename test is what answers. This is the same
//     shape `tools/probe/machine-probe.ts` and `tools/tmsasm/cli.ts` use.
//   - Under `vitest run`, `process.argv[1]` is
//     `node_modules/vitest/dist/workers/forks.js`. It matches neither test, so
//     an imported drive stays quiet and does not run itself a second time.

import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * True when `moduleUrl` names the program being run.
 *
 * @param moduleUrl the caller's `import.meta.url`.
 */
export function isEntryPoint(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return resolve(entry) === fileURLToPath(moduleUrl) || basename(entry).startsWith('vite-node');
  } catch {
    return false;
  }
}
