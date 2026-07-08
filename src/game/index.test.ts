import { describe, it, expect } from 'vitest';
import { GAME_MODULE } from './index.js';

describe('game module scaffold', () => {
  it('exposes its placeholder marker', () => {
    expect(GAME_MODULE).toBe('game');
  });
});
