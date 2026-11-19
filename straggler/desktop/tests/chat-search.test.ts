import { describe, expect, it } from 'vitest';
import { titleMatch } from '../src/domain/chatSearch';

describe('chat title search', () => {
  it('ignores case and composed or decomposed accents without losing highlight offsets', () => {
    expect(titleMatch('😀 Café plans', 'CAFE')).toEqual({ start: 3, end: 7 });
    expect(titleMatch('Cafe\u0301 plans', 'café')).toEqual({ start: 0, end: 5 });
    expect(titleMatch('Chat', 'absent')).toBeNull();
    expect(titleMatch('Chat', ' ')).toBeNull();
  });
});
