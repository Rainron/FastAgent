export interface TrailingThrottle<T> {
  push(value: T): void
  flush(): void
  dispose(): void
}

/** 高频运行时测量最多按给定间隔发送，并保证窗口末尾不会丢掉最新值。 */
export function createTrailingThrottle<T>(intervalMs: number, sink: (value: T) => void): TrailingThrottle<T> {
  let lastSentAt: number | null = null
  let pending: T | undefined
  let timer: ReturnType<typeof setTimeout> | null = null

  const send = (value: T) => {
    lastSentAt = Date.now()
    sink(value)
  }
  const schedule = () => {
    if (timer !== null || pending === undefined) return
    const elapsed = lastSentAt === null ? intervalMs : Date.now() - lastSentAt
    timer = setTimeout(() => {
      timer = null
      if (pending === undefined) return
      const value = pending
      pending = undefined
      send(value)
    }, Math.max(0, intervalMs - elapsed))
  }

  return {
    push(value) {
      if (lastSentAt === null || Date.now() - lastSentAt >= intervalMs) {
        pending = undefined
        if (timer !== null) { clearTimeout(timer); timer = null }
        send(value)
        return
      }
      pending = value
      schedule()
    },
    flush() {
      if (pending === undefined) return
      const value = pending
      pending = undefined
      if (timer !== null) { clearTimeout(timer); timer = null }
      send(value)
    },
    dispose() {
      pending = undefined
      if (timer !== null) clearTimeout(timer)
      timer = null
    }
  }
}
