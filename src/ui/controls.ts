/**
 * On-case control wiring for the Jet Fighters tabletop unit.
 *
 * `setupControls` attaches pointer/touch handlers to the DOM produced by
 * {@link ../ui/case.ts | buildCase} and fires semantic callbacks. It performs
 * NO keyboard handling - the input layer (task 7) drives the same callbacks.
 *
 * Pure geometry/state helpers are exported for unit testing without a DOM.
 */

export type Lane = 0 | 1 | 2;
export type SkillLevel = 1 | 2 | 3;

export interface ControlsConfig {
  onFire: () => void;
  onLaneChange: (lane: Lane) => void;
  onSkillChange: (level: SkillLevel) => void;
  onPowerToggle: (on: boolean) => void;
}

// --- Pure helpers (unit-tested; no DOM) -----------------------------------

/**
 * Map a vertical position within the lever slot (0 = top, 1 = bottom) to a
 * lane. Top third -> lane 0, middle third -> lane 1, bottom third -> lane 2.
 */
export function laneFromFraction(fraction: number): Lane {
  const f = clamp01(fraction);
  if (f < 1 / 3) return 0;
  if (f < 2 / 3) return 1;
  return 2;
}

/** Centre of a lane's slot band as a 0..1 fraction (for positioning the knob). */
export function laneToFraction(lane: Lane): number {
  return (lane * 2 + 1) / 6;
}

/** Advance the skill dial 1 -> 2 -> 3 -> 1. */
export function cycleSkill(level: SkillLevel): SkillLevel {
  return level === 3 ? 1 : ((level + 1) as SkillLevel);
}

/**
 * Rotation (degrees) of the dial pointer for a skill level. The dial sweeps a
 * 100-degree arc: level 1 at -50deg, level 2 centred, level 3 at +50deg.
 */
export function skillToAngle(level: SkillLevel): number {
  return (level - 2) * 50;
}

/** Clamp any number to a valid lane index. */
export function clampLane(value: number): Lane {
  if (value <= 0) return 0;
  if (value >= 2) return 2;
  return Math.round(value) as Lane;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// --- DOM wiring ------------------------------------------------------------

/**
 * Wire the on-case controls inside `container` to `config`. Any control that is
 * absent from the DOM is skipped, so partial cases still work.
 */
export function setupControls(container: HTMLElement, config: ControlsConfig): void {
  wireFire(container, config.onFire);
  wireLever(container, config.onLaneChange);
  wireDial(container, config.onSkillChange);
  wirePower(container, config.onPowerToggle);
}

function query(container: HTMLElement, name: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-control="${name}"]`);
}

function wireFire(container: HTMLElement, onFire: () => void): void {
  const btn = query(container, 'fire');
  if (!btn) return;

  const press = (e: PointerEvent): void => {
    e.preventDefault();
    btn.classList.add('is-pressed');
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture unsupported - ignore */
    }
    onFire();
  };
  const release = (): void => {
    btn.classList.remove('is-pressed');
  };

  btn.addEventListener('pointerdown', press);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);
}

function wireLever(container: HTMLElement, onLaneChange: (lane: Lane) => void): void {
  const lever = query(container, 'lever');
  if (!lever) return;

  let current: Lane = 1;
  let dragging = false;

  const render = (lane: Lane): void => {
    lever.dataset.lane = String(lane);
    lever.setAttribute('aria-valuenow', String(lane));
  };
  const set = (lane: Lane): void => {
    render(lane);
    if (lane !== current) {
      current = lane;
      onLaneChange(lane);
    }
  };
  const laneAt = (clientY: number): Lane => {
    const rect = lever.getBoundingClientRect();
    if (rect.height === 0) return current;
    return laneFromFraction((clientY - rect.top) / rect.height);
  };

  lever.addEventListener('pointerdown', (e) => {
    dragging = true;
    try {
      lever.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
    set(laneAt(e.clientY));
  });
  lever.addEventListener('pointermove', (e) => {
    if (dragging) set(laneAt(e.clientY));
  });
  const end = (): void => {
    dragging = false;
  };
  lever.addEventListener('pointerup', end);
  lever.addEventListener('pointercancel', end);

  render(current); // initialise visual without firing the callback
}

function wireDial(container: HTMLElement, onSkillChange: (level: SkillLevel) => void): void {
  const dial = query(container, 'skill');
  if (!dial) return;

  let current: SkillLevel = 1;

  const render = (level: SkillLevel): void => {
    dial.dataset.level = String(level);
    dial.style.setProperty('--dial-angle', `${skillToAngle(level)}deg`);
    dial.setAttribute('aria-valuenow', String(level));
  };
  const set = (level: SkillLevel): void => {
    render(level);
    if (level !== current) {
      current = level;
      onSkillChange(level);
    }
  };

  // Clicking a printed number jumps to it; clicking the dial face cycles.
  dial.querySelectorAll<HTMLElement>('[data-level]').forEach((tick) => {
    tick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const lvl = Number(tick.dataset.level);
      if (lvl === 1 || lvl === 2 || lvl === 3) set(lvl);
    });
  });
  dial.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    set(cycleSkill(current));
  });

  render(current);
}

function wirePower(container: HTMLElement, onPowerToggle: (on: boolean) => void): void {
  const sw = query(container, 'power');
  if (!sw) return;

  let on = false;
  const render = (): void => {
    sw.dataset.on = String(on);
    sw.setAttribute('aria-checked', String(on));
  };
  sw.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    on = !on;
    render();
    onPowerToggle(on);
  });
  render();
}
