import { memo, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ExecutionSnapshot, TodoItem, TodoStatus } from '../../shared/types'
import { formatDuration, groupTodosByPhase, todoStats } from './todo-status'

/** TodoPanel 挂在当前 Agent 回合内，跟随该回合的执行状态，不再是页面级模块。 */
export type TodoRunStatus = 'working' | 'done' | 'failed'

const statusMark: Record<TodoStatus, string> = {
  pending: '○',
  in_progress: '●',
  completed: '✓',
  cancelled: '!',
  blocked: '⊘',
  failed: '×',
  skipped: '–'
}

/**
 * Plan 与执行轨迹职责分离：这里只做「准备做什么」，占一行紧凑入口，
 * 完整计划点击后展开；执行轨迹由 ExecutionTrace 承担。
 *
 * 挂在主对话区内，流式期间父组件每帧重渲染，因此 memo + 派生计算 useMemo。
 */
export const TodoPanel = memo(function TodoPanel({ items, status, startedAt, finishedAt, execution }: { items: TodoItem[]; status: TodoRunStatus; startedAt: number | null; finishedAt: number | null; execution?: ExecutionSnapshot }) {
  // 完整计划默认折叠：展开一定是用户主动点的，回合结束不强制收起。
  const [expanded, setExpanded] = useState(false)
  const groups = useMemo(() => groupTodosByPhase(items), [items])
  const stats = useMemo(() => todoStats(items), [items])
  const elapsed = formatDuration((finishedAt ?? startedAt ?? 0) - (startedAt ?? 0))

  const activeStep = execution?.steps.find((step) => step.id === execution.activeStepId)
  const stage = activeStep ? activeStep.position + 1 : stats.stage
  const completedPercent = stats.total > 0 ? `${stats.percent}%` : '0%'
  // 分阶段时进度按阶段名展示，比全局序号更能说明「现在在做哪一段」
  const currentPhase = groups.length > 1 ? groups.find((group) => group.items.some((item) => item.status === 'in_progress'))?.phase ?? null : null
  const progress =
    status === 'working'
      ? <span className="todo-plan-status running">{stats.total > 0 ? `${currentPhase ? `${currentPhase} · ` : ''}阶段 ${stage} / ${stats.total} · 执行中` : '执行中'}</span>
      : status === 'failed'
        ? <span className="todo-plan-status failed">任务中断 · {elapsed}</span>
        : <span className="todo-plan-status done">阶段 {Math.min(stats.completed + 1, stats.total)} / {stats.total} · {completedPercent}</span>

  return (
    <section className="todo-panel" aria-label="任务计划">
      <button className="todo-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} title={expanded ? '收起' : '展开'}>
        <span className="todo-plan-label">Plan</span>
        {progress}
        <ChevronRight size={12} className="todo-toggle-chevron" />
      </button>
      {expanded && groups.map((group) => (
        <div key={group.phase ?? '__flat__'}>
          {group.phase && <div className="todo-phase-label">{group.phase}</div>}
          <ul className="todo-list">
            {group.items.map((item) => (
              <li className={`todo-item ${item.status}`} key={item.id}>
                <span className="todo-item-mark">{statusMark[item.status]}</span>
                <span>{item.content}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
})
