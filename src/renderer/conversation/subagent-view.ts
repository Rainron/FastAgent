import type { ToolCallRecord } from '../../shared/types'
import type { ExecutionTrace, TraceAction, TraceGroup } from '../execution-trace'

/**
 * 子代理行与右侧详情面板的纯逻辑：从执行轨迹里挑出子代理动作，整理成可展示的数据。
 */

export type SubAgentAction = Extract<TraceAction, { kind: 'subagent' }>

export type SubAgentRowState = 'running' | 'done' | 'failed'

/** 委派时系统追加在任务后面的交接格式要求；展示任务时去掉，否则每条任务都拖着同一段模板。 */
const HANDOFF_PROMPT_MARKER = '请严格按以下格式交接'

function traceGroups(trace: ExecutionTrace): TraceGroup[] {
  const groups = trace.segments
    .filter((segment): segment is { kind: 'group'; group: TraceGroup } => segment.kind === 'group')
    .map((segment) => segment.group)
  if (trace.pendingGroup) groups.push(trace.pendingGroup)
  return groups
}

/** 本轮全部子代理，按委派顺序；同一 taskId 只出现一次。 */
export function collectSubAgents(trace: ExecutionTrace): SubAgentAction[] {
  const seen = new Set<string>()
  const result: SubAgentAction[] = []
  for (const group of traceGroups(trace)) {
    for (const action of group.actions) {
      if (action.kind !== 'subagent' || seen.has(action.taskId)) continue
      seen.add(action.taskId)
      result.push(action)
    }
  }
  return result
}

export function findSubAgent(trace: ExecutionTrace, taskId: string): SubAgentAction | null {
  return collectSubAgents(trace).find((action) => action.taskId === taskId) ?? null
}

export function subAgentRowState(action: SubAgentAction): SubAgentRowState {
  if (action.status === 'running' || action.status === 'waiting') return 'running'
  return action.status === 'failed' ? 'failed' : 'done'
}

export function subAgentStatusText(state: SubAgentRowState): string {
  return state === 'running' ? '执行中' : state === 'failed' ? '失败' : '已完成'
}

/**
 * 子代理用时。回合已经结束而子代理没收到终态事件（进程被杀、旧记录）时，
 * 用回合结束时间封顶，不能让计时一直往上涨。拿不到起点时返回 null。
 */
export function subAgentElapsedMs(action: SubAgentAction, now: number, turnFinishedAt: number | null = null): number | null {
  if (action.startedAt == null) return null
  const end = action.finishedAt ?? (subAgentRowState(action) === 'running' ? turnFinishedAt ?? now : turnFinishedAt)
  if (end == null) return null
  return Math.max(0, end - action.startedAt)
}

export function stripHandoffPrompt(task: string | null | undefined): string {
  if (!task) return ''
  const index = task.indexOf(HANDOFF_PROMPT_MARKER)
  return (index >= 0 ? task.slice(0, index) : task).trim()
}

/** 行内任务预览：去掉交接模板，只取首个非空行。 */
export function subAgentTaskPreview(task: string | null | undefined, max = 80): string {
  const line = stripHandoffPrompt(task).split(/\r?\n/).map((item) => item.trim()).find(Boolean) ?? ''
  return line.length > max ? `${line.slice(0, max)}…` : line
}

/** 子运行的工具调用：按 subAgentRunId 过滤，按开始时间排序。 */
export function subAgentToolCalls(records: ToolCallRecord[], subAgentRunId: string | null | undefined): ToolCallRecord[] {
  if (!subAgentRunId) return []
  return records
    .filter((record) => record.subAgentRunId === subAgentRunId)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

const ARG_PREVIEW_MAX = 120

/** 工具入参一行预览：命令、关键字、路径依次优先（grep 同时带 pattern 和 path 时关键字更能说明在干什么），其余退回截短的 JSON。 */
export function toolCallArgumentPreview(record: ToolCallRecord): string {
  const args = record.arguments
  if (typeof args === 'string') return truncate(args)
  if (!args || typeof args !== 'object') return ''
  const input = args as Record<string, unknown>
  for (const key of ['command', 'pattern', 'query', 'path', 'url']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return truncate(value.trim().split(/\r?\n/)[0] ?? '')
  }
  const json = JSON.stringify(input)
  return json === '{}' ? '' : truncate(json)
}

/** 单次工具调用耗时：不足一秒给毫秒，按秒取整会让快调用全显示成 0 秒。 */
export function formatCallDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return ''
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const seconds = ms / 1000
  return seconds < 60 ? `${Math.round(seconds * 10) / 10}秒` : `${Math.floor(seconds / 60)}分${Math.round(seconds % 60)}秒`
}

export function toolCallStatusText(status: ToolCallRecord['status']): string {
  switch (status) {
    case 'success': return '完成'
    case 'failed': return '失败'
    case 'denied': return '已拒绝'
    case 'cancelled': return '已取消'
    case 'timeout': return '超时'
    case 'waiting_permission': return '等待审批'
    default: return '执行中'
  }
}

function truncate(text: string): string {
  return text.length > ARG_PREVIEW_MAX ? `${text.slice(0, ARG_PREVIEW_MAX)}…` : text
}

/** 交接摘要按固定顺序展开成标题 + 条目；空的段落不出。 */
export function handoffSections(handoff: SubAgentAction['handoff']): Array<{ title: string; items: string[] }> {
  if (!handoff) return []
  const sections: Array<{ title: string; items: string[] }> = [
    { title: '目标', items: handoff.goal ? [handoff.goal] : [] },
    { title: '改动文件', items: handoff.changedFiles ?? [] },
    // 旧记录的交接结构不全，逐项兜空数组，不能因为少一个字段整块面板崩掉。
    { title: '已验证', items: handoff.verified ?? [] },
    { title: '未验证', items: handoff.unverified ?? [] },
    { title: '关键发现', items: handoff.findings ?? [] },
    { title: '关键决定', items: handoff.decisions ?? [] },
    { title: '建议', items: handoff.recommendations ?? [] },
    { title: '剩余步骤', items: handoff.remainingSteps ?? [] }
  ]
  return sections.filter((section) => section.items.length > 0)
}
