// Measured game lifetimes, for the probes that have to outlast one.
//
// Paths in this file are relative to the repository root.
//
// CLAUDE.md: "A literal timeout in a test about a machine that stops is a bet on
// when it stops." Every horizon in `tools/probe/` is therefore a multiple of a
// named, measured constant. This file exists because one of those constants is
// needed by **more than one** probe, and the copy was already wrong: the same
// figure stood at 43.2 s in `lever-after-game-over.test.ts` and at 36.9 s in
// `launcher-lives.test.ts`, which measured it. The rule buys nothing if the
// number it names is duplicated by value, so it is named here once.
//
// **Re-derive rather than trust.** Reproduce any figure below with:
//
//     npx vite-node tools/probe/drives/parked-endings.ts

/**
 * The latest a parked-lever game ends, in seconds of emulated time.
 *
 * **Measured on this machine** by parking the lever in each lane at skill 1 and
 * running to silence. The last speaker edge falls at **24.053 s** in lane 1,
 * **35.655 s** in lane 2 and **35.972 s** in lane 0. The lanes differ because
 * the squadron's entries and the rocket's lane rotation are not symmetric about
 * the lever, not because one lane is played better - nobody is playing.
 *
 * Lane 1 ends a third sooner than either neighbour because it is the only lane
 * these runs reach with both threats: lanes 0 and 2 lose all three launchers to
 * captures, lane 1 loses two and one to a rocket. Whether the centre is
 * *systematically* more lethal or these runs simply caught a rotor that served
 * lane 1 is not established - `rocket_fire`'s rotor does reach all three lanes,
 * so a longer sample would settle it. Nobody has taken that sample.
 *
 * **The constant is a ceiling and is deliberately above the measurement.** It
 * held 36.9 s when the latest ending measured 36.9 s; the entry position now
 * varies, which moved every lane by a few hundred milliseconds, and 36.9 s still
 * clears the new latest ending by 0.9 s. Rounding it down to the new figure
 * would shorten every run below it for no evidence, which is the wrong direction
 * to move a horizon. It moves down only when the *ceiling* stops being one.
 *
 * The figure this replaced was 45.4 s, taken while `jm_capture` still let a jet
 * crossing any lane but the lever's through for nothing - `open-questions.md`
 * section 6, the rule the owner settled.
 */
export const PARKED_GAME_END_S = 36.9;

/**
 * How far past an ending a run must carry to be sure it saw it.
 *
 * Two fifths again as long: 51.7 s against a 35.972 s latest ending, so a run
 * carries 15.7 s past the last edge it is meant to observe and cannot quietly
 * stop short of it, which is exactly how the v2 horizon failed.
 *
 * The factor is 1.4 rather than 1.5 because 1.4 is what the measurement asks
 * for: the slack it buys is two fifths of a whole parked game, far wider than
 * the 11.9 s spread between the three lanes' endings, and widening it further
 * would buy wall-clock time rather than evidence.
 */
export const HORIZON_FACTOR = 1.4;

/** A parked-lever run's horizon in seconds: the ending, widened. */
export const PARKED_HORIZON_S = PARKED_GAME_END_S * HORIZON_FACTOR;
