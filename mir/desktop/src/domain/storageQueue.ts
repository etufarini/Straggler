export interface StorageQueue {
  current: Promise<void>;
}

export function serializeStorage<T>(queue: StorageQueue, operation: () => Promise<T>): Promise<T> {
  const pending = queue.current.catch(() => {}).then(operation);
  queue.current = pending.then(() => {});
  // A failed save is reported by its owner; a later retry must still be possible.
  void queue.current.catch(() => {});
  return pending;
}

export function trackStorageWork<T>(
  work: Set<Promise<unknown>>,
  operation: () => Promise<T>,
): Promise<T> {
  const pending = Promise.resolve().then(operation);
  work.add(pending);
  void pending.then(
    () => work.delete(pending),
    () => work.delete(pending),
  );
  return pending;
}

export async function flushStorage(
  queue: StorageQueue,
  work?: Set<Promise<unknown>>,
): Promise<void> {
  let pending: Promise<void>;
  let failure: PromiseRejectedResult | undefined;
  do {
    pending = queue.current;
    const settled = await Promise.allSettled([pending, ...(work ?? [])]);
    failure ??= settled.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
  } while (pending !== queue.current || work?.size);
  if (failure) throw failure.reason;
}
