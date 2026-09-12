export interface StreamChunk {
  turnId: string
  text: string
}

export interface StreamBuffer {
  push(turnId: string, text: string): void
  markThinking(turnId: string): void
  markThinkingEnded(turnId: string): void
  /** 立即冲刷（回合结束、切换会话时调用），没有积压时不触发回调。 */
  flush(): void
  dispose(): void
}

/**
 * token 级 setState 会让整条消息列表按 token 重绘。
 * 这里按 turn 累积文本，在下一帧统一冲刷一次，把 N 次渲染压成 1 次。
 * 默认间隔在浏览器中用 requestAnimationFrame 与显示器同步；长间隔及非浏览器环境用 setTimeout。
 */
export function createStreamBuffer(onFlush: (chunks: StreamChunk[]) => void, intervalMs = 16): StreamBuffer {
  const pending = new Map<string, string>()
  const held = new Map<string, string>()
  const thinkingTurns = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let rafHandle: number | null = null
  const useRaf = intervalMs <= 16 && typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'

  function schedule() {
    if (timer !== null || rafHandle !== null) return
    if (useRaf) {
      rafHandle = window.requestAnimationFrame(() => {
        rafHandle = null
        flush(false)
      })
    } else {
      timer = setTimeout(() => {
        timer = null
        flush(false)
      }, intervalMs)
    }
  }

  function cancel() {
    if (timer !== null) { clearTimeout(timer); timer = null }
    if (rafHandle !== null) { window.cancelAnimationFrame(rafHandle); rafHandle = null }
  }

  function flush(force = true) {
    cancel()
    if (force) {
      for (const [turnId, text] of held) pending.set(turnId, (pending.get(turnId) ?? '') + text)
      held.clear()
      thinkingTurns.clear()
    }
    if (pending.size === 0) return
    const chunks = [...pending.entries()].map(([turnId, text]) => ({ turnId, text }))
    pending.clear()
    onFlush(chunks)
  }

  return {
    push(turnId, text) {
      if (!text) return
      const target = thinkingTurns.has(turnId) ? held : pending
      target.set(turnId, (target.get(turnId) ?? '') + text)
      schedule()
    },
    markThinking(turnId) {
      thinkingTurns.add(turnId)
    },
    markThinkingEnded(turnId) {
      thinkingTurns.delete(turnId)
      const text = held.get(turnId)
      if (text) {
        held.delete(turnId)
        pending.set(turnId, (pending.get(turnId) ?? '') + text)
      }
      if (pending.has(turnId)) schedule()
    },
    flush: () => flush(true),
    dispose() {
      cancel()
      pending.clear()
      held.clear()
      thinkingTurns.clear()
    }
  }
}
