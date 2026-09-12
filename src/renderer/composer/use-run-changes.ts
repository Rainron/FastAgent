import { useEffect, useRef, useState } from 'react'
import type { AgentRunChanges } from '../../shared/types'
import { EMPTY_RUN_CHANGES } from './run-changes'

/**
 * 订阅某一轮的文件变更聚合。
 * 数据源是主进程的变更账本（工具调用前后的快照对比），不是文件监听——
 * 监听分不清是 Agent 改的还是用户 / IDE / 构建改的。
 * 刷新由 file_changed 事件触发：工具调用级频率，防抖一下就够，不必逐 token 推。
 */
export function useRunChanges(turnId: string | null): AgentRunChanges {
  const [changes, setChanges] = useState<AgentRunChanges>(EMPTY_RUN_CHANGES)
  const timer = useRef<number | null>(null)
  // 切轮后旧请求可能才回来，用代次丢弃过期结果
  const seq = useRef(0)

  useEffect(() => {
    seq.current += 1
    if (!turnId) {
      setChanges(EMPTY_RUN_CHANGES)
      return
    }
    const current = seq.current
    const load = () => {
      window.fastAgent.changes.list(turnId)
        .then((result) => { if (seq.current === current) setChanges(result) })
        .catch(() => undefined)
    }
    // 切到这一轮（含历史回合）先拉一次，之后跟着事件走
    load()
    const off = window.fastAgent.chat.onEvent((event) => {
      if (event.turnId !== turnId) return
      const terminal = event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled' || event.type === 'interrupted'
      if (event.type !== 'file_changed' && !terminal) return
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(load, terminal ? 0 : 120)
    })
    return () => {
      off()
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [turnId])

  return changes
}
