// The multiplexed VFD as the board wires it: 10 grids against 20 plates.
//
// Sources: the sibling device MAME emulates (Gakken Heiankyo Alien, HD38800 at
// 400 kHz) scans 10 grids on D0-D9 against ~20 plates on the R ports plus
// D10-D13, and Jet Fighter is modelled as its twin - docs/prd/jet-fighters-v2.md
// (Technical Context, R4). The grid count is a documented fact; see PLATE_COUNT
// below for what is and is not known about the plate bus.
//
// This module owns the geometry and the frame period. The duty arithmetic lives
// in pwm.ts, which knows nothing about ports.
//
// Pure state only: no DOM, no timers, no Web APIs. Nothing here has its own
// clock - frame boundaries come from the display sweep, never from wall time.

import { D_GRID_LAST, D_GRID_FIRST, D_GRID_MASK, R_MASK, R_PIN_COUNT } from '../cpu/ports.js';
import { PwmAccumulator, type PwmFrame, type SegmentDuty } from './pwm.js';

/** Display grids, driven by D0-D9. Ten, per the sibling hardware. */
export const GRID_COUNT = D_GRID_LAST - D_GRID_FIRST + 1;

/** D0-D9 as a bit mask. */
export const GRID_MASK = D_GRID_MASK;

/**
 * Plate (anode) lines per grid.
 *
 * The research fixes the count at "~20 plates (R ports + D10-D13)" without
 * saying how many come from each side, and the segment atlas addresses plates by
 * *R-port bit index* over 0-19 (src/machine/tube/atlas-schema.ts). This model
 * therefore wires the whole 20-line plate bus to R0-R19 and leaves D10-D13
 * unassigned. That is a stated assumption, not a measured fact: the split cannot
 * be settled without a teardown, and the atlas would have to move with it. The
 * atlas as shipped uses plates 0-11, so the assumption is not currently load
 * bearing - it only fixes where plates 12-19 would come from.
 */
export const PLATE_COUNT = R_PIN_COUNT;

/** R0-R19 as a bit mask. */
export const PLATE_MASK = R_MASK;

/**
 * Machine cycles with no grid driven after which the tube is taken to be dark.
 *
 * The ROM has one core and no sound hardware, so it bit-bangs the speaker in a
 * timed delay loop and stops strobing the grids for as long as the note lasts
 * (`note_loop` in asm/jetfighter.asm). The tube goes out - measured on the real
 * unit at 133-167 ms on every sound, 14-17% of all frames during active play
 * (docs/evidence/vfd-appearance.md, section 5 and D1).
 *
 * This is the threshold that separates that from the sweep's own blanking
 * intervals, and the two do not overlap anywhere near it. Driving the ROM and
 * timing every interval with no grid driven, over 1400 slices of a played game:
 *
 * | interval                                     | cycles        |
 * | -------------------------------------------- | ------------- |
 * | between grids, and between sweeps (n = 5526) | 13 to **660** |
 * | shortest note the ROM can play (warning beep) | **~4045**     |
 * | a march note                                  | ~28,400       |
 *
 * 2000 is 3x the longest gap a running sweep produces and half the shortest a
 * sound produces, so neither ordinary sweep jitter nor a longer-than-average
 * pass through the game logic can reach it. 5 ms at the 400 kHz oscillator.
 *
 * It is not a frame period and does not impose one: nothing here schedules a
 * refresh, this only decides how long a tube left undriven goes on being
 * reported as lit. See {@link Display.getObservedFrame}.
 */
export const REFRESH_TIMEOUT_CYCLES = 2000;

/** Immutable view of the tube at an instant. */
export interface DisplaySnapshot {
  /** Grids currently driven, as a bit mask over D0-D9. */
  readonly gridMask: number;
  /** Plates currently driven, as a bit mask over R0-R19. */
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
 * Frame periods are derived from the sweep, not imposed on it. The ROM's master
 * loop strobes each grid in turn and starts over; this class calls a frame
 * complete the moment a grid is driven that has already been driven since the
 * last boundary. That makes the frame rate a property of the program - if the
 * ROM spends longer on one pass through the game logic, the frame lengthens and
 * every duty in it is measured against the longer period, exactly as the real
 * display dims when the sweep slows.
 *
 * A sweep that never repeats a grid never completes a frame on its own; callers
 * that need a boundary anyway (the probe taking a snapshot) call `endFrame`.
 */
export class Display {
  private readonly pwm = new PwmAccumulator(GRID_COUNT, PLATE_COUNT);

  private _gridMask = 0;
  private _plateMask = 0;
  private _seenGrids = 0;
  private _strobedGrids = 0;
  private _frameCount = 0;
  private _lastFrame: PwmFrame | undefined;
  private _lastDriveCycle = 0;

  /** Grids currently driven, as a bit mask over D0-D9. */
  get gridMask(): number {
    return this._gridMask;
  }

  /** Plates currently driven, as a bit mask over R0-R19. */
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
   * A rising edge on a grid already driven this frame is the sweep wrapping, so
   * the frame closes at `cycle` - crediting the interval that just ended to the
   * outgoing state - before the new grid is recorded in the next period.
   */
  setGrids(mask: number, cycle: number): void {
    const next = mask & GRID_MASK;
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
    if ((rising & this._seenGrids) !== 0) {
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
    this._seenGrids |= rising;
    this._strobedGrids |= rising;
    this.pwm.recordState(next, this._plateMask, cycle);
  }

  /** Drive the plate lines. */
  setPlates(mask: number, cycle: number): void {
    const next = mask & PLATE_MASK;
    if (next === this._plateMask) {
      return;
    }
    this._plateMask = next;
    this.pwm.recordState(this._gridMask, next, cycle);
  }

  /** Raise or drop one grid line, as a single D-pin transition does. */
  setGridPin(pin: number, value: number, cycle: number): void {
    assertIndex(pin, GRID_COUNT, 'grid');
    this.setGrids(setBit(this._gridMask, pin, value), cycle);
  }

  /** Raise or drop one plate line, as a single R-pin transition does. */
  setPlatePin(pin: number, value: number, cycle: number): void {
    assertIndex(pin, PLATE_COUNT, 'plate');
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
    this._seenGrids = 0;
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
   * only when a grid rises that has already risen, so a stalled sweep completes
   * no period, and `getFrame()` goes on reporting the last fully lit sweep for
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
    assertIndex(grid, GRID_COUNT, 'grid');
    assertIndex(plate, PLATE_COUNT, 'plate');
    const segment = this.getFrame().segments.find((s) => s.grid === grid && s.plate === plate);
    return segment?.duty ?? 0;
  }

  /** Distinct grids driven since the last `clear()`, ascending (contract V3). */
  getStrobedGrids(): number[] {
    const grids: number[] = [];
    for (let grid = 0; grid < GRID_COUNT; grid += 1) {
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
    this._seenGrids = 0;
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
