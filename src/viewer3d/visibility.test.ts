import { Group, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import type { Part } from './scene.js';
import { CASE_PARTS, createVisibility } from './visibility.js';

function part(name: string, parentOf?: Part): Part {
  const object = new Group();
  object.name = name;
  parentOf?.object.add(object);
  return { name, object, extras: { label: name }, restPosition: new Vector3(), explodeLocal: new Vector3() };
}

function model() {
  const front = part('front_shell');
  const window = part('window', front);
  const back = part('back_shell');
  const door = part('battery_door', back);
  const mask = part('scope_mask', front);
  const pcb = part('pcb');
  const chip = part('tms1370', pcb);
  const parts = new Map([front, window, back, door, mask, pcb, chip].map((p) => [p.name, p]));
  return { parts, front, window, back, door, mask, pcb, chip };
}

describe('createVisibility', () => {
  it('hides and shows a part, and tells', () => {
    const m = model();
    const v = createVisibility(m.parts);
    v.hide('tms1370');
    expect(m.chip.object.visible).toBe(false);
    expect(v.isHidden('tms1370')).toBe(true);
    expect(v.hidden).toEqual(['tms1370']);
    v.show('tms1370');
    expect(m.chip.object.visible).toBe(true);
    expect(v.hidden).toEqual([]);
  });

  it('bare takes the case off and leaves the board', () => {
    const m = model();
    const v = createVisibility(m.parts);
    v.hide('tms1370');
    v.bare();
    expect(v.hidden).toEqual([...CASE_PARTS].filter((n) => m.parts.has(n)));
    expect(m.front.object.visible).toBe(false);
    expect(m.back.object.visible).toBe(false);
    expect(m.pcb.object.visible).toBe(true);
    expect(m.chip.object.visible).toBe(true);
    // Mounted on a hidden shell: not rendered, whatever its own flag says.
    let visible = true;
    m.window.object.traverseAncestors((a) => {
      if (!a.visible) visible = false;
    });
    expect(visible).toBe(false);
  });

  it('showAll restores everything and reports each change once', () => {
    const m = model();
    const v = createVisibility(m.parts);
    let changes = 0;
    v.onChange(() => changes++);
    v.bare();
    v.showAll();
    v.showAll();
    expect(changes).toBe(2);
    expect(v.hidden).toEqual([]);
    expect(m.front.object.visible).toBe(true);
  });

  it('ignores names that are not parts', () => {
    const m = model();
    const v = createVisibility(m.parts);
    v.hide('nothing');
    expect(v.hidden).toEqual([]);
  });
});
