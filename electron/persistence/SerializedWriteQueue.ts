const queues = new Map<string, Promise<void>>()

/** Serializes related persistence operations without changing their payloads. */
export async function enqueueSerializedWrite<T>(key: string, operation: () => Promise<T> | T): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(operation)
  const marker = current.then(() => undefined, () => undefined)
  queues.set(key, marker)
  try {
    return await current
  } finally {
    if (queues.get(key) === marker) queues.delete(key)
  }
}
