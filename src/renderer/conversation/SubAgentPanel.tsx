import { memo, useEffect, useMemo, useState } from 'react'
import { Bot, Check, LoaderCircle, X } from 'lucide-react'
import type { ConversationTurn, ToolCallRecord } from '../../shared/types'
import { buildExecutionTrace, formatElapsed, subAgentActivityLabel } from '../execution-trace'
import { findSubAgent, formatCallDuration, handoffSections, stripHandoffPrompt, subAgentElapsedMs, subAgentRowState, subAgentStatusText, subAgentToolCalls, toolCallArgumentPreview, toolCallStatusText } from './subagent-view'

/**
 * 右侧子代理详情：任务全文、实时动作、工具调用时间线与交接摘要。
 * 子 Agent 的流式正文不回传主进程，能看的就是它调了哪些工具和最后交回来的摘要。
 */
export const SubAgentPanel = memo(function SubAgentPanel({ turn, taskId, onClose }: { turn: ConversationTurn; taskId: string; onClose: () => void }) {
  const events = turn.activity?.events
  const trace = useMemo(() => buildExecutionTrace(events ?? []), [events])
  const action = useMemo(() => findSubAgent(trace, taskId), [trace, taskId])
  const turnFinishedAt = turn.activity?.finishedAt ? Date.parse(turn.activity.finishedAt) : null
  const rawState = action ? subAgentRowState(action) : 'done'
  const state = rawState === 'running' && turnFinishedAt !== null ? 'done' : rawState
  const running = state === 'running'
  const [now, setNow] = useState(() => Date.now())
  const [records, setRecords] = useState<ToolCallRecord[] | null>(null)

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  // 工具调用记录在主进程库里；按进度信号（动作数、当前动作、状态）变化重取，不逐帧拉。
  const refreshKey = action ? `${action.subAgentRunId ?? ''}|${action.toolCount}|${action.activity ?? ''}|${action.activityTarget ?? ''}|${state}` : ''
  useEffect(() => {
    if (!action?.subAgentRunId) { setRecords([]); return }
    let cancelled = false
    void window.fastAgent.conversations.listToolCalls(turn.id)
      .then((result) => { if (!cancelled) setRecords(result) })
      .catch(() => { if (!cancelled) setRecords([]) })
    return () => { cancelled = true }
    // refreshKey 已经涵盖 action 里会变的字段，依赖整个 action 会随每次轨迹重算重复请求。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn.id, refreshKey])

  const calls = useMemo(() => subAgentToolCalls(records ?? [], action?.subAgentRunId), [records, action?.subAgentRunId])
  const elapsed = action ? subAgentElapsedMs(action, now, turnFinishedAt) : null
  const task = stripHandoffPrompt(action?.task)
  const sections = handoffSections(action?.handoff)
  const activity = action && running ? subAgentActivityLabel(action) : null

  return <aside className="artifact-panel subagent-panel" aria-label="子代理详情">
    <div className="artifact-header">
      <div className="artifact-heading">
        <span className="artifact-heading-icon" aria-hidden="true"><Bot size={15} /></span>
        <div className="artifact-heading-text">
          <strong>{action ? `子代理 · ${action.agentName}` : '子代理'}</strong>
          <small>{action ? subAgentStatusText(state) : '记录不存在'}{elapsed !== null ? ` · ${formatElapsed(elapsed)}` : ''}{action && action.toolCount > 0 ? ` · ${action.toolCount} 个动作` : ''}</small>
        </div>
      </div>
      <div className="artifact-actions"><button className="icon-button" onClick={onClose} aria-label="关闭子代理详情" title="关闭"><X size={16} /></button></div>
    </div>
    {!action ? <div className="artifact-empty"><Bot /><span>这个子代理的记录已经不在当前回合里。</span></div> : <div className="subagent-panel-scroll">
      {activity && <section className="subagent-panel-section">
        <h3>当前动作</h3>
        <div className="subagent-panel-live"><LoaderCircle size={12} className="spin" />{activity}</div>
      </section>}
      {state === 'failed' && action.error && <section className="subagent-panel-section">
        <h3>失败原因</h3>
        <p className="subagent-panel-error">{action.error}</p>
      </section>}
      <section className="subagent-panel-section">
        <h3>任务</h3>
        {task ? <p className="subagent-panel-task">{task}</p> : <p className="subagent-panel-muted">没有记录任务描述</p>}
      </section>
      <section className="subagent-panel-section">
        <h3>工具调用{calls.length > 0 ? ` · ${calls.length}` : ''}</h3>
        {records === null ? <p className="subagent-panel-muted">加载中…</p>
          : calls.length === 0 ? <p className="subagent-panel-muted">{running ? '等待第一个动作…' : '没有工具调用记录'}</p>
            : <ol className="subagent-panel-calls">
              {calls.map((call) => <li key={call.id} className={`subagent-panel-call ${call.status}`}>
                <span className="subagent-panel-call-icon" aria-hidden="true">{call.status === 'running' || call.status === 'waiting_permission' ? <LoaderCircle size={11} className="spin" /> : call.status === 'success' ? <Check size={11} /> : <X size={11} />}</span>
                <span className="subagent-panel-call-name">{call.toolName}</span>
                <span className="subagent-panel-call-args" title={toolCallArgumentPreview(call)}>{toolCallArgumentPreview(call)}</span>
                <span className="subagent-panel-call-meta">{call.status === 'success' ? formatCallDuration(call.durationMs) : toolCallStatusText(call.status)}</span>
              </li>)}
            </ol>}
      </section>
      {sections.length > 0 && <section className="subagent-panel-section">
        <h3>交接摘要</h3>
        <dl className="subagent-panel-handoff">
          {sections.map((section) => <div key={section.title}>
            <dt>{section.title}</dt>
            {section.items.map((item, index) => <dd key={index}>{item}</dd>)}
          </div>)}
        </dl>
      </section>}
      {state !== 'running' && <p className="subagent-panel-note">结果已回传主 Agent，由主 Agent 复核后采用。</p>}
    </div>}
  </aside>
})
