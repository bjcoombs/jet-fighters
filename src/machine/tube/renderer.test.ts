import { describe, expect, it } from 'vitest';

import { getSegmentById, loadAtlas } from './atlas.js';
import type { SegmentId } from './atlas-schema.js';
import type { PwmFrame, SegmentDuty } from '../board/display.js';
import { callsOf, createFakeCanvas, createFakeContext, type FakeCanvasContext } from './fake-canvas.js';
import { VIEWBOX } from './layout.js';
import type { MeshSurfaceFactory } from './mesh.js';
import { BACKGROUND, GHOST_ALPHA, SILKSCREEN, TUBE_PALETTE, ghostFill } from './palette.js';
import { PHOSPHOR, REFRESH_OFF_TIME_MS, type PhosphorSet } from './phosphor.js';
import { createTubeRenderer, type TubeRenderer } from './renderer.js';

/** A PWM frame lighting the named segments at the given duty. */
function frameOf(entries: readonly { id: SegmentId; duty: number }[]): PwmFrame {
  const segments: SegmentDuty[] = entries.map(({ id, duty }) => {
    const segment = getSegmentById(id);
    return { grid: segment.grid, plate: segment.plate, activeCycles: duty * 1000, duty };
  });
  return { startCycle: 0, endCycle: 1000, cycles: 1000, segments };
}

/**
 * The duty a segment driven for the whole of its grid's slot accumulates. The
 * reference duty is a property of the sweep, so both regions carry the same one.
 */
const FULL_DUTY = PHOSPHOR.cyan.referenceDuty;

const EMPTY_FRAME: PwmFrame = { startCycle: 0, endCycle: 1000, cycles: 1000, segments: [] };

function setup(options?: Parameters<typeof createTubeRenderer>[1]): {
  renderer: TubeRenderer;
  recorder: FakeCanvasContext;
} {
  const { ctx, recorder } = createFakeContext();
  const renderer = createTubeRenderer(ctx, options);
  renderer.resize(726, 600, 1);
  return { renderer, recorder };
}

/** Drive a frame repeatedly until the phosphor settles, then clear the record. */
function settle(renderer: TubeRenderer, recorder: FakeCanvasContext, frame: PwmFrame): void {
  for (let i = 0; i < 200; i += 1) {
    renderer.draw(frame, 16);
  }
  recorder.calls.length = 0;
}

/** Every fill colour used, excluding the background and the silkscreen ink. */
function phosphorFills(recorder: FakeCanvasContext): readonly string[] {
  return recorder.calls
    .filter((call) => call.op === 'fill')
    .map((call) => call.fillStyle)
    .filter((style) => style !== BACKGROUND && style !== SILKSCREEN);
}

function alphaOf(css: string): number {
  const match = /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/.exec(css);
  if (!match) throw new Error(`not an rgba string: ${css}`);
  return Number(match[1]);
}

describe('createTubeRenderer', () => {
  it('throws when the canvas has no 2D context', () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => createTubeRenderer(canvas)).toThrow(/2D canvas context unavailable/);
  });

  it('sizes the backing store to css x dpr and draws in logical pixels', () => {
    const { canvas, recorder } = createFakeCanvas();
    const renderer = createTubeRenderer(canvas);
    renderer.resize(363, 300, 2);
    expect(canvas.width).toBe(726);
    expect(canvas.height).toBe(600);
    const [transform] = callsOf(recorder, 'setTransform');
    expect(transform.args).toEqual([2, 0, 0, 2, 0, 0]);

    renderer.draw(EMPTY_FRAME, 16);
    const [background] = callsOf(recorder, 'fillRect');
    expect(background.args).toEqual([0, 0, 363, 300]);
    expect(background.fillStyle).toBe(BACKGROUND);
  });

  it('projects the atlas onto the canvas with a single uniform scale', () => {
    const { renderer, recorder } = setup();
    renderer.draw(EMPTY_FRAME, 16);
    const [scale] = callsOf(recorder, 'scale');
    expect(scale.args).toEqual([2, 2]);
    const [translate] = callsOf(recorder, 'translate');
    expect(translate.args).toEqual([0, 0]);
  });

  it('rejects an unknown segment id', () => {
    const { renderer } = setup();
    expect(() => renderer.brightnessOf('jet_lane9_col9' as SegmentId)).toThrow(/Unknown segment id/);
  });
});

describe('the ghost layer', () => {
  it('is drawn even when nothing is lit', () => {
    const { renderer, recorder } = setup();
    renderer.draw(EMPTY_FRAME, 16);

    const fills = phosphorFills(recorder);
    expect(fills).toEqual([ghostFill('red'), ghostFill('cyan')]);
    for (const fill of fills) {
      expect(alphaOf(fill)).toBe(GHOST_ALPHA);
    }
  });

  it('covers every segment on the tube, in both phosphor regions', () => {
    const { renderer, recorder } = setup();
    renderer.draw(EMPTY_FRAME, 16);

    // Two ghost paths (one per region) covering all 71 segments, plus nothing
    // else: with no duty anywhere, the active layer has nothing to draw.
    const ghostFillCalls = recorder.calls.filter(
      (call) => call.op === 'fill' && call.fillStyle.startsWith('rgba') && alphaOf(call.fillStyle) === GHOST_ALPHA,
    );
    expect(ghostFillCalls).toHaveLength(2);

    const moves = callsOf(recorder, 'moveTo').length;
    const subpaths = loadAtlas().segments.reduce(
      (total, segment) => total + (segment.path.match(/[Mm]/g)?.length ?? 0),
      0,
    );
    expect(moves).toBeGreaterThanOrEqual(subpaths);
  });

  it('sits underneath the lit segments', () => {
    const { renderer, recorder } = setup();
    settle(renderer, recorder, frameOf([{ id: 'launcher_lane1', duty: FULL_DUTY }]));
    renderer.draw(frameOf([{ id: 'launcher_lane1', duty: FULL_DUTY }]), 16);

    const fills = phosphorFills(recorder);
    expect(fills.slice(0, 2)).toEqual([ghostFill('red'), ghostFill('cyan')]);
    expect(fills.length).toBeGreaterThan(2);
  });
});

describe('brightness from PWM duty', () => {
  it('brings a fully-driven segment to full brightness', () => {
    const { renderer, recorder } = setup();
    const frame = frameOf([{ id: 'jet_lane0_col3', duty: FULL_DUTY }]);
    settle(renderer, recorder, frame);
    expect(renderer.brightnessOf('jet_lane0_col3')).toBeCloseTo(1, 6);
  });

  it('leaves an undriven segment dark', () => {
    const { renderer, recorder } = setup();
    settle(renderer, recorder, frameOf([{ id: 'jet_lane0_col3', duty: FULL_DUTY }]));
    expect(renderer.brightnessOf('jet_lane2_col3')).toBe(0);
  });

  it('separates static PWM patterns by their duty, not by on/off', () => {
    const { renderer, recorder } = setup();
    const frame = frameOf([
      { id: 'jet_lane0_col1', duty: FULL_DUTY },
      { id: 'jet_lane1_col1', duty: FULL_DUTY * 0.5 },
      { id: 'jet_lane2_col1', duty: FULL_DUTY * 0.1 },
    ]);
    settle(renderer, recorder, frame);

    const bright = renderer.brightnessOf('jet_lane0_col1');
    const middle = renderer.brightnessOf('jet_lane1_col1');
    const faint = renderer.brightnessOf('jet_lane2_col1');
    expect(bright).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(faint);
    expect(faint).toBeGreaterThan(0);

    // ...and that separation reaches the canvas as three distinct alphas.
    renderer.draw(frame, 16);
    const alphas = phosphorFills(recorder)
      .filter((fill) => alphaOf(fill) !== GHOST_ALPHA)
      .map(alphaOf);
    expect(new Set(alphas).size).toBeGreaterThanOrEqual(3);
  });

  it('ignores duty at addresses the atlas does not wire', () => {
    const { renderer } = setup();
    // Plate 19 on grid 9 reaches no phosphor - the atlas uses 71 of 200 addresses.
    const stray: PwmFrame = {
      startCycle: 0,
      endCycle: 1000,
      cycles: 1000,
      segments: [{ grid: 9, plate: 19, activeCycles: 100, duty: FULL_DUTY }],
    };
    expect(() => renderer.draw(stray, 16)).not.toThrow();
  });

  it('accepts the board\'s segment list as well as a whole frame', () => {
    const { renderer, recorder } = setup();
    const frame = frameOf([{ id: 'battleship_lane1', duty: FULL_DUTY }]);
    for (let i = 0; i < 200; i += 1) {
      renderer.draw(frame.segments, 16);
    }
    recorder.calls.length = 0;
    expect(renderer.brightnessOf('battleship_lane1')).toBeCloseTo(1, 6);
  });
});

describe('phosphor persistence', () => {
  it('decays gradually when a segment stops being driven', () => {
    const { renderer, recorder } = setup();
    settle(renderer, recorder, frameOf([{ id: 'rocket_lane1_col2', duty: FULL_DUTY }]));

    const trail: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      renderer.draw(EMPTY_FRAME, 0.5);
      trail.push(renderer.brightnessOf('rocket_lane1_col2'));
    }

    expect(trail[0]).toBeLessThan(1);
    expect(trail[0]).toBeGreaterThan(0.3);
    for (let i = 1; i < trail.length; i += 1) {
      expect(trail[i]).toBeLessThan(trail[i - 1]);
      expect(trail[i]).toBeGreaterThan(0);
    }
  });

  it('fades each region on its own measured residual', () => {
    // The renderer end of the section 3 measurement: light a red segment and a
    // cyan one, stop driving both, and average what is left over one grid
    // off-interval. The two must land in different bands, which is only possible
    // if the field resolves its constants per colour region.
    const { renderer, recorder } = setup();
    settle(
      renderer,
      recorder,
      frameOf([
        { id: 'jet_lane0_col1', duty: FULL_DUTY },
        { id: 'launcher_lane0', duty: FULL_DUTY },
      ]),
    );

    // 200 steps, not more: each one paints the whole atlas, and the trapezoid
    // average over a smooth exponential has converged by then. Measured against
    // a 4000-step run it agrees to four significant figures - red 0.15501 vs
    // 0.15500, cyan 0.03506 vs 0.03500 - both far inside the bands asserted
    // below. The larger count only cost wall clock, and timed this test out in
    // CI at 5 s while passing locally.
    const steps = 200;
    const dt = REFRESH_OFF_TIME_MS / steps;
    let red = renderer.brightnessOf('jet_lane0_col1') / 2;
    let cyan = renderer.brightnessOf('launcher_lane0') / 2;
    for (let i = 0; i < steps; i += 1) {
      renderer.draw(EMPTY_FRAME, dt);
      red += renderer.brightnessOf('jet_lane0_col1');
      cyan += renderer.brightnessOf('launcher_lane0');
    }
    red = (red - renderer.brightnessOf('jet_lane0_col1') / 2) / steps;
    cyan = (cyan - renderer.brightnessOf('launcher_lane0') / 2) / steps;

    // vfd-appearance.md section 3: red 13-21%, cyan 3.2-4.5%.
    expect(red).toBeGreaterThanOrEqual(0.13);
    expect(red).toBeLessThanOrEqual(0.21);
    expect(cyan).toBeGreaterThanOrEqual(0.032);
    expect(cyan).toBeLessThanOrEqual(0.045);
  });

  it('still paints a decaying segment after its duty is gone', () => {
    const { renderer, recorder } = setup();
    settle(renderer, recorder, frameOf([{ id: 'rocket_lane1_col2', duty: FULL_DUTY }]));
    renderer.draw(EMPTY_FRAME, 1);
    // Ghost pair plus the fading segment (bloom fill and core fill).
    expect(phosphorFills(recorder).length).toBeGreaterThan(2);
  });

  it('does not light instantly - the rise is visible over several frames', () => {
    const { renderer } = setup();
    const frame = frameOf([{ id: 'score_tens_sega', duty: FULL_DUTY }]);
    renderer.draw(frame, 1);
    const first = renderer.brightnessOf('score_tens_sega');
    renderer.draw(frame, 1);
    const second = renderer.brightnessOf('score_tens_sega');
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(1);
    expect(second).toBeGreaterThan(first);
    expect(second).toBeLessThan(1);
  });

  it('blanks instantly on power off', () => {
    const { renderer, recorder } = setup();
    settle(renderer, recorder, frameOf([{ id: 'score_label', duty: FULL_DUTY }]));
    renderer.blank();
    expect(renderer.brightnessOf('score_label')).toBe(0);

    // The printed silkscreen and the ghost matrix survive a dark tube.
    renderer.draw(EMPTY_FRAME, 16);
    expect(phosphorFills(recorder)).toEqual([ghostFill('red'), ghostFill('cyan')]);
    expect(callsOf(recorder, 'strokeRect').length).toBeGreaterThan(0);
  });

  it('produces flicker rather than a clean square under rapid on/off', () => {
    const { renderer } = setup();
    // Half a millisecond a side, inside both phosphors' time constants.
    const lit = frameOf([
      { id: 'missile_lane0_col1', duty: FULL_DUTY },
      { id: 'jet_lane0_col1', duty: FULL_DUTY },
    ]);
    const cyan: number[] = [];
    const red: number[] = [];
    for (let i = 0; i < 120; i += 1) {
      renderer.draw(i % 2 === 0 ? lit : EMPTY_FRAME, 0.5);
      cyan.push(renderer.brightnessOf('missile_lane0_col1'));
      red.push(renderer.brightnessOf('jet_lane0_col1'));
    }

    for (const samples of [cyan, red]) {
      const tail = samples.slice(-20);
      const min = Math.min(...tail);
      const max = Math.max(...tail);
      // Never fully on, never fully off - a shimmering ripple, not a square wave.
      expect(min).toBeGreaterThan(0);
      expect(max).toBeLessThan(1);
      expect(max - min).toBeGreaterThan(0.05);
    }

    // Red rides the higher for it: at the same cadence the slower phosphor loses
    // less between drives, which is the asymmetry the video measured.
    const trough = (samples: readonly number[]): number => Math.min(...samples.slice(-20));
    expect(trough(red)).toBeGreaterThan(trough(cyan));
    // The slower one still holds well above the floor.
    expect(trough(red)).toBeGreaterThan(0.4);
  });
});

describe('phosphor colour and bloom', () => {
  it('paints each region in its own phosphor colour', () => {
    const { renderer, recorder } = setup();
    const frame = frameOf([
      { id: 'jet_lane0_col1', duty: FULL_DUTY },
      { id: 'launcher_lane0', duty: FULL_DUTY },
    ]);
    settle(renderer, recorder, frame);
    renderer.draw(frame, 16);

    const lit = phosphorFills(recorder).filter((fill) => alphaOf(fill) !== GHOST_ALPHA);
    const red = TUBE_PALETTE.red.hot;
    const cyan = TUBE_PALETTE.cyan.hot;
    expect(lit).toContain(`rgba(${red.r}, ${red.g}, ${red.b}, 1)`);
    expect(lit).toContain(`rgba(${cyan.r}, ${cyan.g}, ${cyan.b}, 1)`);
  });

  it('blooms in proportion to brightness', () => {
    const { renderer, recorder } = setup();
    const frame = frameOf([{ id: 'jet_lane0_col1', duty: FULL_DUTY }]);
    settle(renderer, recorder, frame);
    renderer.draw(frame, 16);
    const brightBlur = Math.max(...callsOf(recorder, 'fill').map((call) => call.shadowBlur));

    recorder.calls.length = 0;
    const dim = frameOf([{ id: 'jet_lane0_col1', duty: FULL_DUTY * 0.05 }]);
    for (let i = 0; i < 200; i += 1) renderer.draw(dim, 16);
    recorder.calls.length = 0;
    renderer.draw(dim, 16);
    const dimBlur = Math.max(...callsOf(recorder, 'fill').map((call) => call.shadowBlur));

    expect(brightBlur).toBeGreaterThan(0);
    expect(dimBlur).toBeGreaterThan(0);
    expect(dimBlur).toBeLessThan(brightBlur);
  });

  it('scales the bloom with the projection so it holds up at any size', () => {
    const frame = frameOf([{ id: 'jet_lane0_col1', duty: FULL_DUTY }]);

    const blurAt = (cssWidth: number, dpr: number): number => {
      const { ctx, recorder } = createFakeContext();
      const renderer = createTubeRenderer(ctx);
      renderer.resize(cssWidth, cssWidth * (VIEWBOX.height / VIEWBOX.width), dpr);
      for (let i = 0; i < 200; i += 1) renderer.draw(frame, 16);
      recorder.calls.length = 0;
      renderer.draw(frame, 16);
      return Math.max(...callsOf(recorder, 'fill').map((call) => call.shadowBlur));
    };

    expect(blurAt(726, 1)).toBeCloseTo(2 * blurAt(363, 1), 6);
    // shadowBlur is not affected by the transform, so it carries the dpr too.
    expect(blurAt(363, 2)).toBeCloseTo(2 * blurAt(363, 1), 6);
  });

  it('can be built without bloom for a diagnostic view', () => {
    const { renderer, recorder } = setup({ glow: false });
    const frame = frameOf([{ id: 'jet_lane0_col1', duty: FULL_DUTY }]);
    settle(renderer, recorder, frame);
    renderer.draw(frame, 16);
    for (const call of callsOf(recorder, 'fill')) {
      expect(call.shadowBlur).toBe(0);
    }
  });

  it('honours custom phosphor constants', () => {
    const instant: PhosphorSet = {
      cyan: { ...PHOSPHOR.cyan, riseTimeMs: 0.001 },
      red: { ...PHOSPHOR.red, riseTimeMs: 0.001 },
    };
    const { renderer } = setup({ phosphor: instant });
    renderer.draw(frameOf([{ id: 'jet_lane0_col1', duty: FULL_DUTY }]), 16);
    expect(renderer.brightnessOf('jet_lane0_col1')).toBeCloseTo(1, 6);
  });
});

describe('layer order', () => {
  it('paints background, then phosphor, then the printed silkscreen', () => {
    const { renderer, recorder } = setup();
    const frame = frameOf([{ id: 'score_label', duty: FULL_DUTY }]);
    settle(renderer, recorder, frame);
    renderer.draw(frame, 16);

    const ops = recorder.calls;
    const background = ops.findIndex((call) => call.op === 'fillRect' && call.fillStyle === BACKGROUND);
    const ghost = ops.findIndex((call) => call.op === 'fill' && call.fillStyle === ghostFill('red'));
    const litSegment = ops.findIndex(
      (call) => call.op === 'fill' && call.fillStyle.startsWith('rgba') && call.shadowBlur > 0,
    );
    const silkscreen = ops.findIndex((call) => call.op === 'strokeRect');

    expect(background).toBeGreaterThanOrEqual(0);
    expect(ghost).toBeGreaterThan(background);
    expect(litSegment).toBeGreaterThan(ghost);
    expect(silkscreen).toBeGreaterThan(litSegment);
  });

  it('leaves the context balanced across a frame', () => {
    const { renderer, recorder } = setup();
    renderer.draw(frameOf([{ id: 'jet_lane0_col1', duty: FULL_DUTY }]), 16);
    expect(callsOf(recorder, 'save').length).toBe(callsOf(recorder, 'restore').length);
  });
});

describe('the control-grid mesh', () => {
  /** A surface factory over recording contexts - the injectable stand-in for OffscreenCanvas. */
  function meshSurfaces(): MeshSurfaceFactory {
    return () => {
      const { ctx } = createFakeContext();
      return { context: ctx, image: {} as CanvasImageSource };
    };
  }

  /** A renderer sized so the mesh resolves, or so it does not. */
  function atScale(
    devicePxPerUnit: number,
    options?: Parameters<typeof createTubeRenderer>[1],
  ): { renderer: TubeRenderer; recorder: FakeCanvasContext } {
    const { ctx, recorder } = createFakeContext();
    const renderer = createTubeRenderer(ctx, { meshSurface: meshSurfaces(), ...options });
    // One CSS pixel per device pixel, so the scale is the projection's alone.
    renderer.resize(VIEWBOX.width * devicePxPerUnit, VIEWBOX.height * devicePxPerUnit, 1);
    return { renderer, recorder };
  }

  const LIT = () => frameOf([{ id: 'jet_lane0_col1', duty: FULL_DUTY }]);

  it('draws nothing at the magnification the case shell gives the tube', () => {
    // 726 x 600 on a 2x display is 4 device px per atlas unit - a 2.5 px mesh
    // period, which is a moire and not a honeycomb. The whole point of the gate
    // is that the ordinary case pays nothing.
    const { renderer, recorder } = atScale(4);
    settle(renderer, recorder, LIT());
    renderer.draw(LIT(), 16);
    expect(callsOf(recorder, 'drawImage')).toHaveLength(0);
  });

  it('draws once a zoom has given it the pixels', () => {
    const { renderer, recorder } = atScale(16);
    settle(renderer, recorder, LIT());
    renderer.draw(LIT(), 16);
    expect(callsOf(recorder, 'drawImage')).toHaveLength(1);
  });

  it('composes the layer on resize, not on every frame', () => {
    // The layer is the expensive part; a frame is meant to be one blit.
    let surfaces = 0;
    const counting: MeshSurfaceFactory = () => {
      surfaces += 1;
      const { ctx } = createFakeContext();
      return { context: ctx, image: {} as CanvasImageSource };
    };
    const { ctx } = createFakeContext();
    const renderer = createTubeRenderer(ctx, { meshSurface: counting });
    renderer.resize(VIEWBOX.width * 16, VIEWBOX.height * 16, 1);
    const afterResize = surfaces;
    expect(afterResize).toBeGreaterThan(0);
    for (let i = 0; i < 50; i += 1) renderer.draw(LIT(), 16);
    expect(surfaces).toBe(afterResize);
  });

  it('rebuilds the layer when the magnification changes', () => {
    let surfaces = 0;
    const counting: MeshSurfaceFactory = () => {
      surfaces += 1;
      const { ctx } = createFakeContext();
      return { context: ctx, image: {} as CanvasImageSource };
    };
    const { ctx } = createFakeContext();
    const renderer = createTubeRenderer(ctx, { meshSurface: counting });
    renderer.resize(VIEWBOX.width * 16, VIEWBOX.height * 16, 1);
    const afterFirst = surfaces;
    // The same CSS box at twice the device pixel ratio: a browser zoom step.
    renderer.resize(VIEWBOX.width * 8, VIEWBOX.height * 8, 2);
    expect(surfaces).toBeGreaterThan(afterFirst);
  });

  it('sits over the phosphor and under the printed silkscreen', () => {
    // The grid is inside the envelope, in front of the anode; the silkscreen is
    // ink on the outside of the glass.
    const { renderer, recorder } = atScale(16);
    const frame = frameOf([{ id: 'score_label', duty: FULL_DUTY }]);
    settle(renderer, recorder, frame);
    renderer.draw(frame, 16);

    const ops = recorder.calls;
    const ghost = ops.findIndex((call) => call.op === 'fill' && call.fillStyle === ghostFill('red'));
    const mesh = ops.findIndex((call) => call.op === 'drawImage');
    const silkscreen = ops.findIndex((call) => call.op === 'strokeRect');
    expect(ghost).toBeGreaterThanOrEqual(0);
    expect(mesh).toBeGreaterThan(ghost);
    expect(silkscreen).toBeGreaterThan(mesh);
  });

  it('is suppressed outright by the diagnostic switch', () => {
    const { renderer, recorder } = atScale(16, { mesh: false });
    settle(renderer, recorder, LIT());
    renderer.draw(LIT(), 16);
    expect(callsOf(recorder, 'drawImage')).toHaveLength(0);
  });

  it('carries on without a mesh where no surface can be had', () => {
    // tools/probe/ and the node environment take this path.
    const { ctx, recorder } = createFakeContext();
    const renderer = createTubeRenderer(ctx, { meshSurface: () => null });
    renderer.resize(VIEWBOX.width * 16, VIEWBOX.height * 16, 1);
    settle(renderer, recorder, LIT());
    renderer.draw(LIT(), 16);
    expect(callsOf(recorder, 'drawImage')).toHaveLength(0);
    expect(callsOf(recorder, 'fill').length).toBeGreaterThan(0);
  });

  it('leaves the context balanced when it has drawn', () => {
    const { renderer, recorder } = atScale(16);
    renderer.draw(LIT(), 16);
    expect(callsOf(recorder, 'save').length).toBe(callsOf(recorder, 'restore').length);
  });
});
