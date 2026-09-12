import type { AgentEvent } from '../shared/types'

export interface TokenEventBatcher {
  emit(event: AgentEvent): void
  flush(): void
  dispose(): void
}

/** 只聚合 provider 的真实文本增量；其他事件前强制 flush，保持原始事件顺序。 */
export function createTokenEventBatcher(send: (event: AgentEvent) => void, intervalMs = 16): TokenEventBatcher {
  let pending: AgentEvent | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function flush() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending) return
    const event = pending
    pending = null
    send(event)
  }

  return {
    emit(event) {
      if (event.type !== 'token') {
        flush()
        send(event)
        return
      }
      pending = pending
        ? { ...pending, text: `${pending.text ?? ''}${event.text ?? ''}` }
        : { ...event }
      if (timer === null) timer = setTimeout(flush, intervalMs)
    },
    flush,
    dispose: flush
  }
}
