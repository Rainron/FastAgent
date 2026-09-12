import type { AgentEvent } from '../../shared/types'

export type BlockStatus = 'pending' | 'streaming' | 'completed' | 'error'

export interface BaseBlock {
  id: string
  type: string
  status?: BlockStatus
}

export interface MarkdownBlock extends BaseBlock {
  type: 'markdown'
  text: string
}

export interface CodeBlock extends BaseBlock {
  type: 'code'
  /** 围栏 info string 的第一段，缺省为 null（不猜语言） */
  language: string | null
  filename: string | null
  code: string
}

export interface DiffBlock extends BaseBlock {
  type: 'diff'
  filename: string | null
  patch: string
  additions: number
  deletions: number
}

export interface FileReferenceBlock extends BaseBlock {
  type: 'fileReference'
  path: string
  line: number | null
  endLine: number | null
}

/** ls / find 的结果：一行一个条目，排成可点开预览的列表而不是一坨纯文本。 */
export interface FileListBlock extends BaseBlock {
  type: 'fileList'
  /** 条目相对的基准目录，空串表示工作区根 */
  base: string
  entries: Array<{ name: string; path: string; kind: 'dir' | 'file' }>
  /** 工具追加的截断/上限提示 */
  note: string | null
}

export type ToolSource = 'builtin' | 'command' | 'mcp' | 'skill' | 'cli' | 'agent'

export interface ToolCallBlock extends BaseBlock {
  type: 'toolCall'
  source: ToolSource
  toolName: string
  title: string
  input: string | null
  permissionResult: string | null
}

export interface ToolResultBlock extends BaseBlock {
  type: 'toolResult'
  toolName: string
  summary: string | null
  detail: string | null
  durationMs: number | null
  additions: number | null
  deletions: number | null
}

export interface TerminalBlock extends BaseBlock {
  type: 'terminal'
  command: string
  output: string
  exitCode: number | null
  cwd: string | null
  durationMs: number | null
}

export interface ErrorBlock extends BaseBlock {
  type: 'error'
  title: string
  detail: string | null
}

export type MessageBlock =
  | MarkdownBlock
  | CodeBlock
  | DiffBlock
  | FileReferenceBlock
  | FileListBlock
  | ToolCallBlock
  | ToolResultBlock
  | TerminalBlock
  | ErrorBlock

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
}

export interface AssistantMessage {
  id: string
  role: 'assistant'
  status: BlockStatus
  blocks: MessageBlock[]
  model?: string
  createdAt: number
  usage?: TokenUsage
}

/** ToolCallCard 用：把一组同 toolCallId 的事件折成 Tool/Terminal block 的数据形状。 */
export interface ToolCallGroupInput {
  toolCallId: string
  toolName: string
  events: AgentEvent[]
}
