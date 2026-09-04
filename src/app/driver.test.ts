import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assemble } from '../../tools/tmsasm/assembler.js';
import { oplaImage, romImage } from '../../tools/tmsasm/output.js';
import type { SegmentDuty } from '../machine/board/display.js';
import type { PwmFrame } from '../machine/board/display.js';
import type { TubeRenderer } from '../machine/tube/renderer.js';
import { createDriver, MAX_FRAME_MS } from './driver.js';

function loadImage() {
  const path = resolve(import.meta.dirname, '..', '..', 'asm', 'jetfighter.asm');
  const assembly = assemble(readFileSync(path, 'utf8'), path, {
    readInclude: (included, fromFile) => {
      const resolved = resolve(dirname(fromFile), included);
      return { file: resolved, source: readFileSync(resolved, 'utf8') };
    },
  });
  return { rom: romImage(assembly), opla: oplaImage(assembly) };
}

/** A renderer that records what it was asked to draw and when. */
function recordingRenderer() {
  const draws: { count: number; dtMs: number }[] = [];
  let blanks = 0;
  const renderer: TubeRenderer = {
    draw(pwm: PwmFrame | readonly SegmentDuty[], dtMs: number) {
      const list = Array.isArray(pwm) ? pwm : (pwm as PwmFrame).segments;
      draws.push({ count: list.length, dtMs });
    },
    resize() {},
    blank() {
      blanks += 1;
    },
    brightnessOf() {
      return 0;
    },
  };
  return { renderer, draws, blanks: () => blanks };
}

describe('createDriver', () => {
  const image = loadImage();

  it('starts dark, and only the power switch starts it', () => {
    const { renderer, draws } = recordingRenderer();
    const driver = createDriver({ image, renderer, audioContext: () => null });

    driver.frame(0);
    driver.frame(16);
    expect(driver.board.power.state).toBe('off');
    expect(driver.board.cycles).toBe(0);
    // It still paints: an unpowered tube is a dark tube, drawn every frame.
    expect(draws).toHaveLength(2);
    expect(draws[1].dtMs).toBe(16);

    driver.apply({ type: 'POWER', on: true });
    expect(driver.board.power.state).toBe('on');
    driver.frame(32);
    expect(driver.board.cycles).toBeGreaterThan(0);
  });

  it('runs the board for the elapsed time, carrying the fractional debt', () => {
    const { renderer } = recordingRenderer();
    const cyclesPerSecond = 1000;
    const driver = createDriver({ image, renderer, cyclesPerSecond, audioContext: () => null });
    driver.apply({ type: 'POWER', on: true });

    driver.frame(0);
    driver.frame(16.5); // 16.5 cycles owed: 16 executed, 0.5 carried
    driver.frame(33); // 16.5 + 0.5 = 17 owed
    // Within an instruction or two of 33: the board executes whole
    // instructions and repays the overshoot next frame.
    expect(driver.board.cycles).toBeGreaterThanOrEqual(30);
    expect(driver.board.cycles).toBeLessThanOrEqual(36);
  });

  it('caps a frame at MAX_FRAME_MS so a backgrounded tab does not sprint', () => {
    const { renderer, draws } = recordingRenderer();
    const cyclesPerSecond = 10_000;
    const driver = createDriver({ image, renderer, cyclesPerSecond, audioContext: () => null });
    driver.apply({ type: 'POWER', on: true });

    driver.frame(0);
    driver.frame(60_000);
    expect(draws[1].dtMs).toBe(MAX_FRAME_MS);
    expect(driver.board.cycles).toBeLessThanOrEqual((MAX_FRAME_MS / 1000) * cyclesPerSecond + 8);
  });

  it('blanks the phosphor on either throw of the power switch', () => {
    const { renderer, blanks } = recordingRenderer();
    const driver = createDriver({ image, renderer, audioContext: () => null });
    driver.apply({ type: 'POWER', on: true });
    driver.apply({ type: 'POWER', on: false });
    expect(blanks()).toBe(2);
    expect(driver.board.power.state).toBe('off');
  });

  it('closes the contacts the inputs name', () => {
    const { renderer } = recordingRenderer();
    const driver = createDriver({ image, renderer, audioContext: () => null });
    driver.apply({ type: 'LANE', lane: 2 });
    driver.apply({ type: 'SKILL', level: 3 });
    driver.apply({ type: 'FIRE', pressed: true });
    expect(driver.board.input.lever).toBe(2);
    expect(driver.board.input.skill).toBe(3);
    expect(driver.board.input.fire).toBe(true);
  });

  it('schedules itself through the injected scheduler, once per frame', () => {
    const { renderer } = recordingRenderer();
    const queued: ((now: number) => void)[] = [];
    const driver = createDriver({
      image,
      renderer,
      audioContext: () => null,
      schedule: (cb) => queued.push(cb),
    });
    driver.start();
    driver.start(); // idempotent
    expect(queued).toHaveLength(1);
    queued.shift()!(0);
    expect(queued).toHaveLength(1);
  });
});
