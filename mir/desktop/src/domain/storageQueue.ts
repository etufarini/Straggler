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

export async function flushStorage(queue: StorageQueue): Promise<void> {
  let pending: Promise<void>;
  do {
    pending = queue.current;
    await pending;
  } while (pending !== queue.current);
}
