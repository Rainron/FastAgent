import { memo } from 'react'
import { Check, CircleAlert, Clock3, FileDiff, FilePen, FilePlus, FileText, HelpCircle, ListChecks, LoaderCircle, Search, ShieldCheck, Terminal, Wrench, type LucideIcon } from 'lucide-react'
import type { ToolCallBlock as ToolCallBlockData } from '../blocks'

const toolIcons: Record<string, LucideIcon> = {
  read: FileText,
  grep: Search,
  find: Search,
  ls: Search,
  edit: FilePen,
  write: FilePlus,
  patch: FileDiff,
  bash: Terminal,
  powershell: Terminal,
  question: HelpCircle,
  todowrite: ListChecks
}

const sourceLabels: Record<ToolCallBlockData['source'], string | null> = {
  builtin: null,
  command: 'command',
  mcp: 'MCP',
  skill: 'Skill',
  cli: 'CLI',
  agent: 'Agent'
}

export function permissionLabel(value: string | null | undefined): string {
  if (!value) return ''
  const labels: Record<string, string> = { allow: '放行', ask: '待批准', deny: '已拒绝', denied: '已拒绝', once: '仅本次允许', session: '会话内允许', always: '始终允许' }
  return labels[value] ?? value
}

function StatusIcon({ status }: { status: ToolCallBlockData['status'] }) {
  if (status === 'error') return <CircleAlert size={13} className="tool-call-fail" />
  if (status === 'pending') return <ShieldCheck size={13} className="tool-call-deny" />
  if (status === 'streaming') return <LoaderCircle size={13} className="spin" />
  return <Check size={13} className="tool-call-ok" />
}

/** 单条工具调用的摘要行：图标 + 标题 + 入参 + 来源；展开/收起由外层把整行包成按钮实现。 */
function ToolCallBlockView({ block, durationMs }: { block: ToolCallBlockData; durationMs?: number | null }) {
  const Icon = toolIcons[block.toolName] ?? Wrench
  const source = sourceLabels[block.source]
  return (
    <div className="tool-call-row">
      <span className={`tool-call-icon ${block.status ?? 'completed'}`}><Icon size={13} /></span>
      <span className="tool-call-title" title={block.title}>{block.title}</span>
      {block.input && <span className="tool-call-input" title={block.input}>{block.input}</span>}
      {source && <span className="tool-call-source">{source}</span>}
      {durationMs !== undefined && durationMs !== null && <span className="tool-call-duration"><Clock3 size={10} />{durationMs}ms</span>}
      {block.permissionResult && <span className="tool-call-permission">{permissionLabel(block.permissionResult)}</span>}
      <StatusIcon status={block.status} />
    </div>
  )
}

export const ToolCallBlockRenderer = memo(ToolCallBlockView)
