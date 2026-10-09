import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConversationTurn } from '../../../shared/types'
import type { SubAgentPanelControl, SubAgentSelection } from '../../conversation/subagent-panel-context'

/**
 * 右侧子代理详情面板的开关。与资源面板、会话详情、计划、附件预览同占右侧一栏：
 * 打开它先关掉别的，别的打开时它让位；切会话或所在回合被删（重跑截断）时自动收起。
 */
export function useSubAgentPanel({ conversationId, turns, otherPanelOpen, closeOtherPanels }: {
  conversationId: string | null
  turns: ConversationTurn[]
  otherPanelOpen: boolean
  closeOtherPanels: () => void
}) {
  const [selected, setSelected] = useState<SubAgentSelection | null>(null)
  // toggle 要引用稳定（经 context 下发到 memo 组件），关其他面板的实现走 ref 取最新一份。
  const closeOthersRef = useRef(closeOtherPanels)
  closeOthersRef.current = closeOtherPanels

  const toggle = useCallback((next: SubAgentSelection) => {
    setSelected((current) => {
      if (current?.turnId === next.turnId && current.taskId === next.taskId) return null
      return next
    })
    closeOthersRef.current()
  }, [])
  const close = useCallback(() => setSelected(null), [])

  useEffect(() => { if (otherPanelOpen) setSelected(null) }, [otherPanelOpen])
  useEffect(() => { setSelected(null) }, [conversationId])

  const turn = selected ? turns.find((item) => item.id === selected.turnId) ?? null : null
  useEffect(() => { if (selected && !turn) setSelected(null) }, [selected, turn])

  const control = useMemo<SubAgentPanelControl>(() => ({ selected, toggle }), [selected, toggle])
  return { control, selected, turn, close }
}
