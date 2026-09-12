import type { ConversationTurn, ToolCallRecord } from '../../shared/types'
import { stripThinkBlocks } from '../../shared/think-blocks'
import type { AssistantMessage, BlockStatus, FileListBlock, MessageBlock, ToolCallGroupInput, ToolSource } from './blocks'
import { parseBlocks } from './block-parser'
import { languageFromPath } from './highlight'
import { displayPath, displayPathValue } from './path-display'

const BUILTIN_TOOLS = new Set(['read', 'grep', 'find', 'ls', 'edit', 'write', 'patch', 'bash', 'powershell', 'question', 'todowrite', 'model'])
const TERMINAL_TOOLS = new Set(['bash', 'powershell'])

export function toolSource(toolName: string, explicit?: ToolSource | null): ToolSource {
  if (explicit) return explicit
  if (TERMINAL_TOOLS.has(toolName)) return 'command'
  if (toolName.startsWith('cli__')) return 'cli'
  if (BUILTIN_TOOLS.has(toolName)) return 'builtin'
  if (toolName === 'agent') return 'agent'
  if (toolName === 'skill') return 'skill'
  // 本地 MCP Server 桥接进来的工具名不在内置集合里。
  return 'mcp'
}

function messageStatus(turn: ConversationTurn): BlockStatus {
  if (turn.status === 'working') return 'streaming'
  if (turn.status === 'failed') return 'error'
  return 'completed'
}

/**
 * 旧数据里 assistantMessage 只有一个字符串，这里统一转成 blocks。
 * 不落库：blocks 每次渲染从 text 派生，历史会话无需迁移即可打开。
 * answerStart：执行轨迹已把正文前段归档为说明文本，正文区只渲染从该偏移开始的最终回答。
 */
export function normalizeAssistantMessage(turn: ConversationTurn, answerStart = 0): AssistantMessage | null {
  // 已落库的旧回合正文里可能还带着模型内联的 `<think>` 推理，渲染前剥掉，思考只从折叠层看。
  const text = stripThinkBlocks((turn.assistantMessage?.text ?? '').slice(answerStart))
  const failure = turn.status === 'failed' ? turn.activity?.events.filter((event) => event.type === 'failed').at(-1)?.detail ?? null : null
  const cancelled = turn.status === 'cancelled'
  if (!text && !failure && !cancelled) return null
  const status = messageStatus(turn)
  const blocks: MessageBlock[] = parseBlocks(text, turn.id)
  if (failure) blocks.push({ id: `${turn.id}-error`, type: 'error', title: '执行失败', detail: failure, status: 'error' })
  else if (cancelled) blocks.push({ id: `${turn.id}-cancelled`, type: 'error', title: '已取消', detail: null, status: 'completed' })
  // 流式阶段最后一个块仍在增长，前面的块不再变化。
  if (status === 'streaming' && blocks.length) {
    const last = blocks[blocks.length - 1]
    blocks[blocks.length - 1] = { ...last, status: 'streaming' }
  }
  return {
    id: turn.id,
    role: 'assistant',
    status,
    blocks,
    createdAt: Date.parse(turn.assistantMessage?.createdAt ?? turn.createdAt) || 0
  }
}

/** blocks 的纯文本形态，用于「复制为纯文本」。 */
export function blocksToPlainText(blocks: MessageBlock[]): string {
  return blocks.map((block) => {
    switch (block.type) {
      case 'markdown': return block.text
      case 'code': return block.code
      case 'diff': return block.patch
      case 'terminal': return `$ ${block.command}\n${block.output}`
      case 'toolResult': return block.summary ?? block.detail ?? ''
      case 'error': return block.detail ? `${block.title}: ${block.detail}` : block.title
      default: return ''
    }
  }).filter(Boolean).join('\n\n')
}

function resultField(result: unknown, key: string): number | null {
  const value = (result as Record<string, unknown> | null)?.[key]
  return typeof value === 'number' ? value : null
}

function resultText(result: unknown): string | null {
  if (typeof result === 'string') return result
  if (!result || typeof result !== 'object') return null
  const record = result as Record<string, unknown>
  for (const key of ['stdout', 'output', 'summary', 'text']) {
    if (typeof record[key] === 'string') return record[key] as string
  }
  return null
}

function stringField(source: unknown, key: string): string | null {
  const value = (source as Record<string, unknown> | null)?.[key]
  return typeof value === 'string' && value ? value : null
}

/** 统一成 `a/b` 形式，去掉反斜杠、`.` 段和首尾斜杠。 */
function normalizeRelative(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter((segment) => segment !== '' && segment !== '.').join('/')
}

/** ls / find 的正文末尾会追加 `\n\n[…]` 形式的截断提示，排版时要和条目分开。 */
function splitTrailingNote(text: string): { body: string; note: string | null } {
  const match = /\n\n\[([^\]]*)\]\s*$/.exec(text)
  if (!match) return { body: text.trimEnd(), note: null }
  return { body: text.slice(0, match.index).trimEnd(), note: match[1] }
}

/** 条目已经包含基准目录（前缀相同）就不再重复拼接 base。 */
function joinWithBase(base: string, entry: string): string {
  const relative = normalizeRelative(entry)
  if (!base) return relative
  if (!relative) return base
  const baseWithSep = base.endsWith('/') ? base : `${base}/`
  return relative.startsWith(baseWithSep) || relative === base ? relative : `${base}/${relative}`
}

/**
 * ls 输出的是目录内的条目名（目录带 `/` 后缀），find 输出的是工作区相对路径。
 * 两者都转成「基准目录 + 条目」，列表里才能直接点开预览。
 * - 基准目录为空时直接使用结果路径。
 * - 结果已经包含基准目录时不重复拼接（ls 在子目录里仍返回 base 前缀的情况）。
 * - 结果为基于子目录的相对路径时再补上基准目录。
 */
function fileListBlock(id: string, toolName: string, text: string, inputPath: string | null, workspaceRoot: string | null): FileListBlock | null {
  const { body, note } = splitTrailingNote(text)
  if (!body || body === '(empty directory)') return null
  const base = normalizeRelative(inputPath ? displayPath(inputPath, workspaceRoot) : '')
  const entries = body.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const kind = line.endsWith('/') ? 'dir' as const : 'file' as const
    const raw = kind === 'dir' ? line.slice(0, -1) : line
    const normalized = normalizeRelative(raw)
    // ls 的输出往往是子目录条目名，find 的输出是工作区相对路径——都要拼上 base 才能预览。
    const full = joinWithBase(base, normalized)
    const displayName = toolName === 'ls' ? (normalized.split('/').pop() || normalized) : full
    return { name: displayName, path: full, kind }
  })
  if (!entries.length) return null
  return { id, type: 'fileList', base, entries, note }
}

/**
 * 非 shell 工具的结果排版：能还原成 diff / 代码 / 文件列表的就用对应 block，
 * 剩下的（grep、MCP 工具等）才退回纯文本的 ToolResultBlock。
 */
function formattedResultBlocks(
  group: ToolCallGroupInput,
  record: ToolCallRecord | null,
  detail: string | null,
  durationMs: number | null,
  status: BlockStatus,
  workspaceRoot: string | null
): MessageBlock[] {
  const id = `${group.toolCallId}-result`
  const args = record?.arguments ?? null
  const summary = resultText(record?.result)
  const additions = resultField(record?.result, 'additions')
  const deletions = resultField(record?.result, 'deletions')
  // 文件名只展示相对路径或文件名，不泄露绝对路径。
  const rawFilePath = stringField(args, 'path')
  const filePath = rawFilePath ? displayPath(rawFilePath, workspaceRoot) : null
  const fallback: MessageBlock = {
    id,
    type: 'toolResult',
    toolName: group.toolName,
    summary,
    detail,
    durationMs: durationMs ?? record?.durationMs ?? null,
    additions,
    deletions,
    status
  }
  if (status === 'error' || status === 'pending') return [fallback]

  // edit：主进程把逐行 diff 一起落了库
  const diff = stringField(record?.result, 'diff')
  if (diff) return [{ id, type: 'diff', filename: filePath, patch: diff, additions: additions ?? 0, deletions: deletions ?? 0, status }]

  // patch：入参本身就是标准 unified diff
  const patch = group.toolName === 'patch' ? stringField(args, 'patch') : null
  if (patch) return [{ id, type: 'diff', filename: null, patch, additions: additions ?? 0, deletions: deletions ?? 0, status }]

  // write：结果只有「写了多少字节」，真正该看的是写进去的内容
  const written = group.toolName === 'write' ? stringField(args, 'content') : null
  if (written) return [{ id, type: 'code', language: languageFromPath(filePath), filename: filePath, code: written, status }]

  if (group.toolName === 'read' && summary) {
    return [{ id, type: 'code', language: languageFromPath(filePath), filename: filePath, code: summary, status }]
  }

  if ((group.toolName === 'ls' || group.toolName === 'find') && summary) {
    const listing = fileListBlock(id, group.toolName, summary, filePath, workspaceRoot)
    if (listing) return [listing]
  }

  return [fallback]
}

/**
 * 把一组同 toolCallId 的事件（可选叠加已落库的完整记录）折成 block 数据。
 * shell 工具走 TerminalBlock，其余走 formattedResultBlocks。
 */
export function toolCallBlocks(group: ToolCallGroupInput, record: ToolCallRecord | null, title: string, workspaceRoot: string | null = null): MessageBlock[] {
  const blocks: MessageBlock[] = []
  const startEvent = group.events.find((event) => event.input) ?? group.events[0]
  const resultEvent = [...group.events].reverse().find((event) => event.type === 'tool_result')
  const waiting = group.events.at(-1)?.type === 'approval_required' || group.events.at(-1)?.type === 'question_required'
  const failed = resultEvent?.status === 'failed' || record?.status === 'failed' || record?.status === 'denied'
  const status: BlockStatus = waiting ? 'pending' : failed ? 'error' : resultEvent ? 'completed' : 'streaming'

  blocks.push({
    id: `${group.toolCallId}-call`,
    type: 'toolCall',
    source: toolSource(group.toolName, record?.source ?? startEvent?.source),
    toolName: group.toolName,
    title,
    input: startEvent?.input ? displayPathValue(startEvent.input, workspaceRoot) : null,
    permissionResult: resultEvent?.permissionResult ?? record?.permissionResult ?? null,
    status
  })

  if (!resultEvent && !record) return blocks

  if (TERMINAL_TOOLS.has(group.toolName)) {
    const cwd = (record?.arguments as { cwd?: string } | null)?.cwd ?? null
    blocks.push({
      id: `${group.toolCallId}-terminal`,
      type: 'terminal',
      command: startEvent?.input ?? (record?.arguments as { command?: string } | null)?.command ?? group.toolName,
      output: resultText(record?.result) ?? resultEvent?.detail ?? '',
      exitCode: resultField(record?.result, 'exitCode') ?? resultField(record?.result, 'code'),
      cwd: cwd ? displayPath(cwd, workspaceRoot) : null,
      durationMs: resultEvent?.durationMs ?? record?.durationMs ?? null,
      status
    })
  } else {
    blocks.push(...formattedResultBlocks(group, record, resultEvent?.detail ?? null, resultEvent?.durationMs ?? null, status, workspaceRoot))
  }

  const error = record?.error ?? (failed ? resultEvent?.detail ?? null : null)
  if (error) blocks.push({ id: `${group.toolCallId}-error`, type: 'error', title: record?.status === 'denied' ? '已拒绝' : '工具执行失败', detail: error, status: 'error' })
  return blocks
}
