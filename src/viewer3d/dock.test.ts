import { describe, expect, it } from 'vitest';

import { classifyKey } from '../input/input.js';
import { DOCK_KEYS, GROUPS, dockKey, groupOf, grouped, titleOf } from './dock.js';

describe('dockKey', () => {
  it('maps the views, the cycle, hide and clear, either case', () => {
    expect(dockKey('f')).toEqual({ type: 'view', view: 'front' });
    expect(dockKey('B')).toEqual({ type: 'view', view: 'back' });
    expect(dockKey('i')).toEqual({ type: 'view', view: 'inside' });
    expect(dockKey('E')).toEqual({ type: 'cycle' });
    expect(dockKey('h')).toEqual({ type: 'hide' });
    expect(dockKey('Escape')).toEqual({ type: 'clear' });
    expect(dockKey('p')).toBeNull();
  });

  it('takes none of the machine\'s keys', () => {
    for (const key of [...DOCK_KEYS, ...DOCK_KEYS.filter((k) => k.length === 1).map((k) => k.toUpperCase())]) {
      expect(dockKey(key), key).not.toBeNull();
      expect(classifyKey(key), key).toBeNull();
    }
    for (const key of ['p', 'P', '1', '2', '3', 'ArrowUp', 'ArrowDown', 'w', 's', ' ', 'Enter', 'm', 'M']) {
      expect(dockKey(key), key).toBeNull();
    }
  });
});

describe('groups', () => {
  it('puts each part where the model has it', () => {
    expect(groupOf('front_shell')).toBe('Case');
    expect(groupOf('battery_door')).toBe('Case');
    expect(groupOf('sticker')).toBe('Case');
    expect(groupOf('window')).toBe('Tube');
    expect(groupOf('tube_face')).toBe('Tube');
    expect(groupOf('fire_cap')).toBe('Controls');
    expect(groupOf('power_switch')).toBe('Controls');
    expect(groupOf('lever_disc')).toBe('Controls');
    expect(groupOf('pcb')).toBe('Board');
    expect(groupOf('tms1370')).toBe('Board');
    expect(groupOf('electrolytics')).toBe('Board');
  });

  it('lists groups in their order, parts in the given order, and leaves the root out', () => {
    const g = grouped(['console', 'tms1370', 'window', 'front_shell', 'pcb', 'fire_cap', 'back_shell']);
    expect([...g.keys()]).toEqual(GROUPS);
    expect(g.get('Case')).toEqual(['front_shell', 'back_shell']);
    expect(g.get('Board')).toEqual(['tms1370', 'pcb']);
    expect(g.get('Tube')).toEqual(['window']);
    expect(g.get('Controls')).toEqual(['fire_cap']);
  });
});

describe('titleOf', () => {
  it('reads a part name as words', () => {
    expect(titleOf('tube_grid_pins')).toBe('Tube grid pins');
    expect(titleOf('pcb')).toBe('Pcb');
  });
});
