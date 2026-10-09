import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentRunChanges } from '../../../shared/types'

/**
 * 某一轮的文件变更台账。卡片只在回合结束后挂载，台账此时已写完，
 * 所以挂载拉一次即可，不订阅事件——长会话里每轮一个监听器，每个流式事件都要过一遍。
 * 撤销后由调用方 reload。
 */
export function useTurnChanges(turnId: string): { changes: AgentRunChanges | null; reload: () => void } {
  const [changes, setChanges] = useState<AgentRunChanges | null>(null)
  // 回合切换或卸载后回来的旧请求直接丢掉
  const seq = useRef(0)

  const reload = useCallback(() => {
    const current = ++seq.current
    window.fastAgent.changes.list(turnId)
      .then((result) => { if (seq.current === current) setChanges(result) })
      .catch(() => undefined)
  }, [turnId])

  useEffect(() => {
    reload()
    return () => { seq.current += 1 }
  }, [reload])

  return { changes, reload }
}
