import { expect, test } from 'vitest';
import { flushStorage, serializeStorage } from '../src/domain/storageQueue';

test('project and conversation writes share ordering and a failed write permits retry', async () => {
  const queue = { current: Promise.resolve() };
  const writes: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const partial = serializeStorage(queue, async () => {
    await gate;
    writes.push('partial');
  });
  const project = serializeStorage(queue, async () => {
    writes.push('project');
    throw new Error('Disk full');
  });
  const failure = expect(project).rejects.toThrow('Disk full');
  const retry = serializeStorage(queue, async () => {
    writes.push('retry');
  });
  const final = serializeStorage(queue, async () => {
    writes.push('final');
  });
  expect(writes).toEqual([]);
  release();
  await Promise.all([partial, failure, retry, final]);
  await flushStorage(queue);
  expect(writes).toEqual(['partial', 'project', 'retry', 'final']);
});

test('closing waits for a save added while the existing queue is draining', async () => {
  const queue = { current: Promise.resolve() };
  const writes: string[] = [];
  let next: Promise<void> | undefined;
  const first = serializeStorage(queue, async () => {
    writes.push('first');
    next = serializeStorage(queue, async () => {
      writes.push('next');
    });
  });
  await flushStorage(queue);
  await first;
  await next;
  expect(writes).toEqual(['first', 'next']);
});
