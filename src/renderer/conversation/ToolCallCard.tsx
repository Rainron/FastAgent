import { useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ToolCallRecord } from '../../shared/types'
import type { ToolCallGroup } from '../activity'
import { toolCallBlocks } from '../ai-response/message-normalizer'
import { MessageBlockRenderer } from '../ai-response/MessageBlockRenderer'
import { ToolCallBlockRenderer } from '../ai-response/blocks/ToolCallBlock'
import type { ToolCallBlock } from '../ai-response/blocks'
import { displayPathValue } from '../ai-response/path-display'
import type { TraceToolStatus } from '../execution-trace'

const toolTitles: Record<string, string> = {
  read: '读取文件',
  grep: '搜索代码',
  find: '查找文件',
  ls: '查看目录',
  edit: '修改文件',
  write: '创建文件',
  patch: '应用补丁',
  bash: '运行命令',
  powershell: '运行命令',
  question: '提问',
  todowrite: '更新待办'
}

/** 正文已经把这些字段排好版了，入参里再列一遍只是噪音。 */
const renderedElsewhere: Record<string, string[]> = {
  write: ['content'],
  patch: ['patch'],
  edit: ['edits'],
  bash: ['command'],
  powershell: ['command']
}

/**
 * 入参值排版：字符串整串是绝对路径时收敛，对象/数组排成多行。
 * 禁止单行原始 JSON——长文本交给列表容器的换行与局部滚动兜底。
 */
function formatArgValue(value: unknown, workspaceRoot: string | null): string {
  if (typeof value === 'string') return displayPathValue(value, workspaceRoot)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 2) ?? ''
}

/** 入参按键值表排版；默认收起，需要核对时再展开，长值靠换行与局部滚动撑住。 */
function ToolArguments({ toolName, args, workspaceRoot }: { toolName: string; args: unknown; workspaceRoot: string | null }) {
  const [open, setOpen] = useState(false)
  const entries = useMemo(() => {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return []
    const skip = renderedElsewhere[toolName] ?? []
    return Object.entries(args as Record<string, unknown>).filter(([key, value]) => !skip.includes(key) && value !== undefined && value !== null && value !== '')
  }, [toolName, args])

  if (!entries.length) return null
  return (
    <div className={`tool-args ${open ? 'open' : ''}`}>
      <button type="button" className="tool-args-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <ChevronDown size={12} />入参 {entries.length} 项
      </button>
      {open && <dl className="tool-args-list">
        {entries.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{formatArgValue(value, workspaceRoot)}</dd></div>)}
      </dl>}
    </div>
  )
}

/** 轨迹组详情里的事件源是动作摘要而不是原始事件流，用这些字段补齐折叠头的展示。 */
export interface ToolCallCardSummary {
  input?: string | null
  status?: TraceToolStatus
  durationMs?: number | null
}

function statusToBlockStatus(status: TraceToolStatus): NonNullable<ToolCallBlock['status']> {
  switch (status) {
    case 'waiting': return 'pending'
    case 'running': return 'streaming'
    case 'failed': return 'error'
    case 'done': return 'completed'
  }
}

/**
 * 单条工具调用记录：独立容器 = 整行可点的摘要行 + 仅在本条下方展开的详情。
 * workspaceRoot 来自回合归属项目，绝对路径只在摘要/详情里以相对路径或文件名出现。
 */
export function ToolCallCard({ turnId, group, summary, workspaceRoot }: { turnId: string; group: ToolCallGroup; summary?: ToolCallCardSummary; workspaceRoot?: string | null }) {
  const [open, setOpen] = useState(false)
  const [record, setRecord] = useState<ToolCallRecord | null>(null)
  const [childCalls, setChildCalls] = useState<ToolCallRecord[]>([])
  const [lookupFailed, setLookupFailed] = useState(false)

  useEffect(() => {
    if (!open || record || lookupFailed) return
    let alive = true
    window.fastAgent.conversations.listToolCalls(turnId)
      .then((calls) => { if (!alive) return; setRecord(calls.find((call) => call.id === group.toolCallId) ?? null); setChildCalls(calls.filter((call) => call.parentToolCallId === group.toolCallId)) })
      .catch(() => { if (alive) setLookupFailed(true) })
    return () => { alive = false }
  }, [open, record, lookupFailed, turnId, group.toolCallId])

  const title = toolTitles[group.toolName] ?? group.toolName
  const root = workspaceRoot ?? null
  const blocks = useMemo(() => toolCallBlocks(group, record, title, root), [group, record, title, root])
  const rawInput = summary?.input !== undefined ? summary.input : (blocks[0] as ToolCallBlock).input
  const head = {
    ...(blocks[0] as ToolCallBlock),
    input: rawInput ? displayPathValue(rawInput, root) : null,
    status: summary?.status ? statusToBlockStatus(summary.status) : (blocks[0] as ToolCallBlock).status
  }
  const body = blocks.slice(1)
  const durationMs = summary?.durationMs !== undefined && summary.durationMs !== null
    ? summary.durationMs
    : group.events.find((event) => event.type === 'tool_result')?.durationMs ?? record?.durationMs ?? null

  return (
    <div className={`tool-call-card ${head.status ?? 'completed'} ${open ? 'open' : ''}`}>
      <button type="button" className="tool-call-summary" onClick={() => setOpen((value) => !value)} aria-expanded={open} title={open ? '收起' : '展开'}>
        <ToolCallBlockRenderer block={head} durationMs={durationMs} />
      </button>
      {open && (
        <div className="tool-call-detail">
          {body.map((block) => <MessageBlockRenderer key={block.id} block={block} />)}
          {!record && !body.length && (lookupFailed ? <div className="tool-call-empty">工具调用记录不可用</div> : <div className="tool-call-empty">记录尚未落库，稍后自动加载…</div>)}
          {record && <ToolArguments toolName={group.toolName} args={record.arguments} workspaceRoot={root} />}
          {childCalls.length > 0 && <div className="tool-call-children"><div className="tool-call-children-title">Sub-agent 工具调用</div>{childCalls.map((child) => <ToolCallCard key={child.id} turnId={turnId} group={{ toolCallId: child.id, toolName: child.toolName, events: [] }} summary={{ input: null, status: child.status === 'success' ? 'done' : child.status === 'running' || child.status === 'waiting_permission' ? 'running' : 'failed', durationMs: child.durationMs }} workspaceRoot={root} />)}</div>}
        </div>
      )}
    </div>
  )
}