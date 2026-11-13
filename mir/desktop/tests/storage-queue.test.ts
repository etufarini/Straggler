import { expect, test } from 'vitest';
import { flushStorage, serializeStorage, trackStorageWork } from '../src/domain/storageQueue';

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

test('closing includes a pending chooser and every file in its batch', async () => {
  const queue = { current: Promise.resolve() };
  const work = new Set<Promise<unknown>>();
  let choose!: () => void;
  let finishSecond!: () => void;
  const chooser = new Promise<void>((resolve) => {
    choose = resolve;
  });
  const second = new Promise<void>((resolve) => {
    finishSecond = resolve;
  });
  const writes: string[] = [];
  const batch = trackStorageWork(work, async () => {
    await chooser;
    for (const file of ['first', 'second']) {
      await serializeStorage(queue, async () => {
        if (file === 'second') await second;
        writes.push(file);
      });
    }
  });
  let closed = false;
  const close = flushStorage(queue, work).then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  choose();
  for (let tick = 0; tick < 12; tick++) await Promise.resolve();
  expect(writes).toEqual(['first']);
  expect(closed).toBe(false);
  finishSecond();
  await Promise.all([batch, close]);
  expect(writes).toEqual(['first', 'second']);
  expect(closed).toBe(true);
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
