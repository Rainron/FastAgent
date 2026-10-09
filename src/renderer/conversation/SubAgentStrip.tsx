import { memo, useEffect, useState } from 'react'
import { Check, ChevronRight, LoaderCircle, X } from 'lucide-react'
import { formatElapsed, subAgentActivityLabel } from '../execution-trace'
import { useSubAgentPanelControl } from './subagent-panel-context'
import { subAgentElapsedMs, subAgentRowState, subAgentStatusText, subAgentTaskPreview, type SubAgentAction } from './subagent-view'

/**
 * 过程头下方的子代理行：不随执行过程折叠，委派出去的每个子任务都常驻一行，
 * 实时显示当前动作与用时；点一行在右侧打开详情，再点收起。
 */
export const SubAgentStrip = memo(function SubAgentStrip({ turnId, subagents, turnFinishedAt }: { turnId: string; subagents: SubAgentAction[]; turnFinishedAt: number | null }) {
  const { selected, toggle } = useSubAgentPanelControl()
  const running = turnFinishedAt === null && subagents.some((action) => subAgentRowState(action) === 'running')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  return <div className="trace-subagents" role="list" aria-label="子代理">
    {subagents.map((action) => {
      // 回合已结束却没收到子代理终态（旧记录、进程被杀）时按已结束展示，不留永久转圈。
      const rawState = subAgentRowState(action)
      const state = rawState === 'running' && turnFinishedAt !== null ? 'done' : rawState
      const active = selected?.turnId === turnId && selected.taskId === action.taskId
      const elapsed = subAgentElapsedMs(action, now, turnFinishedAt)
      const activity = state === 'running' ? subAgentActivityLabel(action) : action.toolCount > 0 ? `${action.toolCount} 个动作` : null
      const preview = subAgentTaskPreview(action.task)
      return <button type="button" role="listitem" key={action.taskId}
        className={`trace-subagent-row ${state}${active ? ' active' : ''}`}
        aria-pressed={active}
        title={active ? '收起子代理详情' : '在右侧查看子代理详情'}
        onClick={() => toggle({ turnId, taskId: action.taskId })}>
        {/* key 跟着状态走：状态一变图标就重新挂载，播一次切换动画，完成那一下看得见 */}
        <span className="trace-subagent-row-icon" key={state} aria-hidden="true">
          {state === 'running' ? <LoaderCircle size={11} className="spin" /> : state === 'failed' ? <X size={11} /> : <Check size={11} />}
        </span>
        <strong className="trace-subagent-row-name">{action.agentName}</strong>
        {preview && <span className="trace-subagent-row-task">{preview}</span>}
        <span className="trace-subagent-row-meta">
          {state === 'failed' ? subAgentStatusText(state) : activity}
          {elapsed !== null && <span className="trace-subagent-row-time">{formatElapsed(elapsed)}</span>}
        </span>
        <ChevronRight size={12} className="trace-subagent-row-chevron" />
      </button>
    })}
  </div>
})
