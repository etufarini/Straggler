import { expect, test } from 'vitest';
import { countLabel } from '../src/domain/text';

test.each([
  [0, 'file', '0 files'],
  [1, 'file', '1 file'],
  [2, 'file', '2 files'],
  [0, 'chat', '0 chats'],
  [1, 'chat', '1 chat'],
  [2, 'chat', '2 chats'],
] as const)('formats %i %s with English plurality', (count, noun, expected) => {
  expect(countLabel(count, noun)).toBe(expected);
});
