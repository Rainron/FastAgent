import { useEffect, useState } from 'react'
import type { AgentRunLedgerEntry } from '../../shared/types'
import { formatElapsed } from '../execution-trace'
import { agentRunStatusLabel, agentTaskStatusLabel, describeTally, runDurationMs, tallyTasks, taskDurationMs } from './agent-ledger'

/**
 * 会话的 Agent 运行台账。数据来自 agent_runs / agent_tasks 两张表，而不是 turn.activity：
 * 重启后 activity 里的「执行中」已经没有进程支撑，台账在启动时收敛成「已中断」，这里显示的是真实结局。
 */
export function AgentRunLedger({ conversationId }: { conversationId: string }) {
  const [entries, setEntries] = useState<AgentRunLedgerEntry[] | null>(null)
  const [now] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    void window.fastAgent.agentRuns.list(conversationId)
      .then((result) => { if (!cancelled) setEntries(result) })
      .catch(() => { if (!cancelled) setEntries([]) })
    return () => { cancelled = true }
  }, [conversationId])

  if (!entries) return <div className="inspector-empty">运行台账加载中</div>
  if (!entries.length) return <div className="inspector-empty">暂无运行记录</div>

  return <div className="inspector-ledger">
    {entries.map((entry) => <div className={`inspector-ledger-run ${entry.run.status}`} key={entry.run.runId}>
      <div className="inspector-ledger-head">
        <span className="inspector-ledger-status">{agentRunStatusLabel(entry.run.status)}</span>
        <span>{entry.run.mode}</span>
        <span>{formatElapsed(runDurationMs(entry.run, now))}</span>
        <span className="inspector-ledger-tally">{describeTally(tallyTasks(entry.tasks))}</span>
      </div>
      {entry.run.error && <div className="inspector-ledger-error">{entry.run.error}</div>}
      {entry.tasks.map((task) => <div className={`inspector-ledger-task ${task.status}`} key={task.taskId}>
        <span className="inspector-ledger-agent">{task.agentName}</span>
        <span className="inspector-ledger-task-status">{agentTaskStatusLabel(task.status)}</span>
        <span>{formatElapsed(taskDurationMs(task, now))}</span>
        <span className="inspector-ledger-goal" title={task.goal}>{task.summary || task.goal}</span>
        {task.error && <span className="inspector-ledger-error">{task.error}</span>}
      </div>)}
    </div>)}
  </div>
}
