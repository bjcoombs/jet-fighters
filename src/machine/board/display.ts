// The multiplexed VFD as the board wires it.
//
// The matrix is a constructor parameter rather than a fact of this module. It
// defaults to the live board's - 9 grids on R0-R8 against 12 plates on O0-O7
// plus R11-R14, from src/machine/topology.ts. It is not hardcoded here, because
// which matrix the board scans is a fact about which core is soldered to the
// tube and this module drives whichever it is handed.
//
// This module owns the frame period. The duty arithmetic lives in pwm.ts, which
// knows nothing about ports.
//
// Pure state only: no DOM, no timers, no Web APIs. Nothing here has its own
// clock - frame boundaries come from the display sweep, never from wall time.

import { DEFAULT_TOPOLOGY, type DisplayTopology } from '../topology.js';
import { PwmAccumulator, type PwmFrame, type SegmentDuty } from './pwm.js';
import { REFRESH_TIMEOUT_CYCLES } from './tms1370-cadence.js';

/**
 * Display grids the board scans by default: nine, driven by R0-R8.
 *
 * The counts and masks below are {@link DEFAULT_TOPOLOGY}'s, re-exported so the
 * many callers that only ever want the live board's figures do not each have to
 * reach through a topology object. A caller that wants a *specific* machine's
 * figures passes that topology to the {@link Display} constructor and reads the
 * counts off it.
 */
export const GRID_COUNT = DEFAULT_TOPOLOGY.gridCount;

/** R0-R8 as a bit mask, in the R latch's own bit positions. */
export const GRID_MASK = DEFAULT_TOPOLOGY.gridMask;

/**
 * Plate (anode) lines per grid on the default topology: twelve.
 *
 * O0-O7 are plates 0-7 and R11-R14 are plates 8-11 - the board resolves that
 * split before it reaches this module, which addresses plates 0-11 and takes no
 * position on which pin each came from. See src/machine/topology.ts.
 */
export const PLATE_COUNT = DEFAULT_TOPOLOGY.plateCount;

/** Plates 0-11 as a bit mask. */
export const PLATE_MASK = DEFAULT_TOPOLOGY.plateMask;

/**
 * Machine cycles with no grid driven after which the tube is taken to be dark.
 *
 * The ROM has one core and no sound hardware, so it bit-bangs the speaker in a
 * timed delay loop and stops strobing the grids for as long as the note lasts
 * (the note delay loops in asm/jetfighter.asm). The tube goes out - measured on the real
 * unit at 133-167 ms on every sound, 14-17% of all frames during active play
 * (docs/evidence/vfd-appearance.md, section 5 and D1).
 *
 * This is the threshold that separates that from the sweep's own blanking
 * intervals, and the two do not merely fail to overlap - there is a wide empty
 * band between them. Driving the ROM and timing every interval with no grid
 * driven, over two independent runs (82 s of played and unattended game,
 * n = 36,624; and 20 s, n = 13,453):
 *
 * | interval                                    | cycles              |
 * | ------------------------------------------- | ------------------- |
 * | between grids, and between sweeps           | 13 to **707**       |
 * | shortest sound blank (launcher warning beep) | **16,990** (42.5 ms) |
 * | a march note                                 | 28,415 (71.0 ms)    |
 * | the loss sequence                            | 254,754 (636.9 ms)  |
 *
 * **No interval at all falls between 707 and 16,990** - confirmed separately in
 * both runs. The 2000 this module carried therefore sat 2.8x above the longest
 * gap a running sweep produced and 8.5x below the shortest a sound produced, so
 * neither ordinary sweep jitter nor a longer-than-average pass through the game
 * logic could reach it. 5 ms at the 400 kHz oscillator.
 *
 * **That figure was a literal, and every part of the table above is the v2
 * machine's 400 kHz.** At the TMS1370's instruction rate the same wall-clock intervals are
 * seven times fewer cycles and 2000 lands the wrong side of them, which is the
 * first of PRD R5's six re-derivation classes and what
 * `docs/contract/v3.contract.md` criterion V14 forbids: no listed cycle constant
 * may be a numeric literal unless the same file also defines the sweep length it
 * derives from. This module defines no sweep length, so it does not define this
 * constant either - it re-exports the one
 * {@link ../board/tms1370-cadence.js `tms1370-cadence.ts`} derives from the
 * measured sweep, where the reasoning for three sweeps' worth lives beside the
 * sweep it is three of.
 *
 * It is not a frame period and does not impose one: nothing here schedules a
 * refresh, this only decides how long a tube left undriven goes on being
 * reported as lit. See {@link Display.getObservedFrame}.
 */
export { REFRESH_TIMEOUT_CYCLES };

/** Immutable view of the tube at an instant. */
export interface DisplaySnapshot {
  /** Grids currently driven, as a bit mask over R0-R8. */
  readonly gridMask: number;
  /** Plates currently driven, as a bit mask over plates 0-11. */
  readonly plateMask: number;
  /** Frame periods completed since the last `clear()`. */
  readonly frameCount: number;
  /** Distinct grids driven since the last `clear()`, ascending (contract V3). */
  readonly gridsStrobed: readonly number[];
  /** Per-segment duty over the most recently completed frame period. */
  readonly frame: PwmFrame;
}

/**
 * The tube's electrical state and its PWM history.
 *
 * Frame periods are derived from the sweep, not imposed on it. The frame closes
 * when the sweep *wraps*: grid 0 rising after the highest grid has been strobed.
 * That makes the frame rate a property of the program - if the ROM spends longer
 * on one pass through the game logic, the frame lengthens and every duty in it
 * is measured against the longer period, exactly as the real display dims when
 * the sweep slows.
 *
 * The wrap, rather than "a grid rises that has already risen this frame". The
 * second rule was right for a machine that drew each grid exactly once per
 * sweep. This ROM makes four passes over the glass and reaches grid 0 in three
 * of them, so that rule would call every *pass* a frame and hand the renderer
 * one segment family at a time. The highest grid is only reached in the
 * high-bank passes, which is what makes it the sweep's boundary marker without
 * this module having to know the pass order - the same marker
 * `tools/probe/tms1370-probe.ts` takes its measured sweep periods between.
 *
 * A sweep that never reaches the highest grid never completes a frame on its
 * own; callers that need a boundary anyway (the probe taking a snapshot) call
 * `endFrame`.
 *
 * A sweep that *stops* is the other case, and it is not hypothetical: the ROM
 * stops sweeping on every sound. Two things follow, and both live here rather
 * than in the renderer, because the tube is dark for an electrical reason and
 * not a drawing one. `getObservedFrame` reports the tube dark once the drive has
 * been gone longer than {@link REFRESH_TIMEOUT_CYCLES}, and the stalled interval
 * is taken out of the frame period it fell in, so the sweeps either side of a
 * note are measured against their own length rather than against the note's.
 */
export class Display {
  /**
   * The matrix this instance scans.
   *
   * Defaults to the live board's. It is a constructor parameter rather than a
   * module constant so a test can drive a matrix of its own choosing without
   * reaching past this class to change what every other caller scans. See
   * src/machine/topology.ts.
   */
  private readonly topology: DisplayTopology;
  private readonly pwm: PwmAccumulator;

  private _gridMask = 0;
  private _plateMask = 0;
  private _sawLastGrid = false;
  private _strobedGrids = 0;
  private _frameCount = 0;
  private _lastFrame: PwmFrame | undefined;
  private _lastDriveCycle = 0;

  constructor(topology: DisplayTopology = DEFAULT_TOPOLOGY) {
    this.topology = topology;
    this.pwm = new PwmAccumulator(topology.gridCount, topology.plateCount);
  }

  /** Grids this display scans, and the plates it drives against them. */
  get matrix(): DisplayTopology {
    return this.topology;
  }

  /** Grids currently driven, as a bit mask over the grid lines. */
  get gridMask(): number {
    return this._gridMask;
  }

  /** Plates currently driven, as a bit mask over plates 0-11. */
  get plateMask(): number {
    return this._plateMask;
  }

  /** Frame periods completed since the last `clear()`. */
  get frameCount(): number {
    return this._frameCount;
  }

  /** Distinct grids driven since the last `clear()`, as a bit mask. */
  get strobedGrids(): number {
    return this._strobedGrids;
  }

  /**
   * Drive the grid lines.
   *
   * Grid 0 rising after the highest grid has been strobed is the sweep wrapping,
   * so the frame closes at `cycle` - crediting the interval that just ended to
   * the outgoing state - before the new grid is recorded in the next period.
   */
  setGrids(mask: number, cycle: number): void {
    const next = mask & this.topology.gridMask;
    if (next === this._gridMask) {
      return;
    }

    // Drive resuming after the sweep stopped. The stall is taken out of the
    // frame period it happened in, before that frame can close: the tube was
    // not being scanned then, so it is not refresh time, and leaving it in
    // would make the sweeps either side of a note read as dim ones. See
    // `PwmAccumulator.exclude`.
    if (this._gridMask === 0 && next !== 0) {
      const gap = cycle - this._lastDriveCycle;
      if (gap > REFRESH_TIMEOUT_CYCLES) {
        this.pwm.exclude(gap);
      }
    }

    const rising = next & ~this._gridMask;
    if ((rising >>> (this.topology.gridCount - 1)) & 1) {
      this._sawLastGrid = true;
    } else if (this._sawLastGrid && (rising & 1) !== 0) {
      this.endFrame(cycle);
    }

    // When drive ended, which is what `refreshGap` measures from. Only the
    // falling edge is recorded: while a grid is up the gap is zero by
    // definition, and the ROM holds one up for a whole dwell without producing
    // a transition to record.
    if (this._gridMask !== 0 && next === 0) {
      this._lastDriveCycle = cycle;
    }

    this._gridMask = next;
    this._strobedGrids |= rising;
    this.pwm.recordState(next, this._plateMask, cycle);
  }

  /** Drive the plate lines. */
  setPlates(mask: number, cycle: number): void {
    const next = mask & this.topology.plateMask;
    if (next === this._plateMask) {
      return;
    }
    this._plateMask = next;
    this.pwm.recordState(this._gridMask, next, cycle);
  }

  /** Raise or drop one grid line, as a single R-pin transition does. */
  setGridPin(pin: number, value: number, cycle: number): void {
    assertIndex(pin, this.topology.gridCount, 'grid');
    this.setGrids(setBit(this._gridMask, pin, value), cycle);
  }

  /** Raise or drop one plate line, as a single O- or R-pin transition does. */
  setPlatePin(pin: number, value: number, cycle: number): void {
    assertIndex(pin, this.topology.plateCount, 'plate');
    this.setPlates(setBit(this._plateMask, pin, value), cycle);
  }

  /**
   * Close the frame period at `cycle` and open the next one there.
   *
   * Called by the sweep detector, and by a caller that needs a boundary the
   * sweep has not produced.
   */
  endFrame(cycle: number): PwmFrame {
    const frame = this.pwm.endFrame(cycle);
    this._lastFrame = frame;
    this._frameCount += 1;
    this._sawLastGrid = false;
    return frame;
  }

  /** Per-segment duty accrued so far this frame, without closing it. */
  sample(cycle: number): PwmFrame {
    return this.pwm.sample(cycle);
  }

  /**
   * The most recently completed frame, or an empty one before the first sweep
   * has wrapped. A renderer draws this: it is the last period the tube actually
   * finished, so every duty in it is measured against a complete denominator.
   */
  getFrame(): PwmFrame {
    return this._lastFrame ?? emptyFrame(this.pwm.frameStart);
  }

  /** Segments lit during the most recently completed frame, with their duty. */
  getLitSegments(): readonly SegmentDuty[] {
    return this.getFrame().segments;
  }

  /**
   * Machine cycles since a grid was last driven, as of `cycle`.
   *
   * Zero while a grid is up. This is how long the tube has been receiving no
   * drive at all, which is the only thing that decides whether it is lit.
   */
  refreshGap(cycle: number): number {
    if (this._gridMask !== 0) {
      return 0;
    }
    return Math.max(0, cycle - this._lastDriveCycle);
  }

  /** True while the sweep is still refreshing the tube. See `getObservedFrame`. */
  isRefreshing(cycle: number): boolean {
    return this.refreshGap(cycle) <= REFRESH_TIMEOUT_CYCLES;
  }

  /**
   * What is on the tube at `cycle` - the frame a renderer should draw.
   *
   * While the sweep is running this is {@link getFrame}, the last period the
   * tube completed, measured against a complete denominator. That is the right
   * answer for a refreshing display and it is what this returns almost always.
   *
   * It is the wrong answer while the sweep has *stopped*. A frame period closes
   * only when the sweep wraps, so a stalled sweep completes no period, and
   * `getFrame()` goes on reporting the last fully lit sweep for
   * as long as the stall lasts. The ROM stalls the sweep on every sound - it
   * bit-bangs the speaker in a delay loop and cannot strobe at the same time -
   * so the tube the ROM has switched off reads as lit, for 71 ms on a march
   * note and 637 ms on the loss sequence. That is D1 of
   * docs/evidence/vfd-appearance.md, the largest visible divergence the
   * reference video found, and it is a bug in this observation surface rather
   * than in the ROM: the ROM already stops driving the grids.
   *
   * So once the gap since the last drive passes {@link REFRESH_TIMEOUT_CYCLES},
   * this reports what is actually true - no grid driven, therefore no segment
   * lit, therefore every duty zero. The phosphor downstream turns that into the
   * decay a real tube shows when its supply of electrons stops
   * (src/machine/tube/phosphor.ts). Nothing here fades anything, and nothing
   * here knows a sound is playing: the tube is dark because nothing is driving
   * it, which is the same reason the real one is.
   *
   * The frame returned spans the stall rather than being zero-length, so a
   * caller that reads `cycles` sees how long the tube has been dark.
   */
  getObservedFrame(cycle: number): PwmFrame {
    if (this.isRefreshing(cycle)) {
      return this.getFrame();
    }
    return {
      startCycle: this._lastDriveCycle,
      endCycle: cycle,
      cycles: cycle - this._lastDriveCycle,
      segments: [],
    };
  }

  /** Duty of one segment in the most recently completed frame; 0 if unlit. */
  getSegmentDuty(grid: number, plate: number): number {
    assertIndex(grid, this.topology.gridCount, 'grid');
    assertIndex(plate, this.topology.plateCount, 'plate');
    const segment = this.getFrame().segments.find((s) => s.grid === grid && s.plate === plate);
    return segment?.duty ?? 0;
  }

  /** Distinct grids driven since the last `clear()`, ascending (contract V3). */
  getStrobedGrids(): number[] {
    const grids: number[] = [];
    for (let grid = 0; grid < this.topology.gridCount; grid += 1) {
      if ((this._strobedGrids >>> grid) & 1) {
        grids.push(grid);
      }
    }
    return grids;
  }

  /**
   * Blank the tube and forget every frame - the power switch going off, and the
   * only path that may rewind the cycle count.
   */
  clear(cycle = 0): void {
    this.pwm.clear(cycle);
    this._gridMask = 0;
    this._plateMask = 0;
    this._sawLastGrid = false;
    this._strobedGrids = 0;
    this._frameCount = 0;
    this._lastFrame = undefined;
    this._lastDriveCycle = cycle;
  }

  /** Immutable snapshot for tests, the probe, and future debug tooling. */
  snapshot(): DisplaySnapshot {
    return {
      gridMask: this._gridMask,
      plateMask: this._plateMask,
      frameCount: this._frameCount,
      gridsStrobed: this.getStrobedGrids(),
      frame: this.getFrame(),
    };
  }
}

/** A frame of zero length with nothing lit - the tube before its first sweep. */
function emptyFrame(cycle: number): PwmFrame {
  return { startCycle: cycle, endCycle: cycle, cycles: 0, segments: [] };
}

function setBit(word: number, index: number, value: number): number {
  const bit = 1 << index;
  return value ? word | bit : word & ~bit;
}

function assertIndex(index: number, count: number, label: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`${label} out of range: ${index} (expected 0..${count - 1})`);
  }
}

export type { PwmFrame, SegmentDuty };
