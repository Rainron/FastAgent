import { defineTool, type BashOperations, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import type { AgentEvent } from '../../../shared/types'

/**
 * 后台命令工具。
 *
 * 普通 shell 工具要等命令退出才返回，起一个开发服务器就等于把整轮卡在那条命令上；
 * 模型只能用 `&` 把它甩到后台，可那样既拿不到日志也没法关。这里把「启动 → 看日志 →
 * 停掉」做成三个显式工具，进程活到会话结束，输出留在环形缓冲里随时可查。
 *
 * 进程隔离仍走同一份 BashOperations：沙箱开着时后台进程一样在沙箱账户下，
 * 由 runner 的会话级 Job 兜底回收，不存在绕过沙箱的第二条执行路径。
 */

/** 每个后台任务最多留这么多字节输出；超出丢弃最早的部分。 */
const MAX_OUTPUT_BYTES = 128 * 1024

/**
 * 后台任务不设业务超时，但沙箱协议要求一个具体值，取 runner 支持的上限（约 24 天）。
 * 单位是秒，与 BashOperations.exec 的 timeout 一致。
 */
const BACKGROUND_TIMEOUT_SECONDS = 2_147_483

/** pi 的工具白名单要按名字放行，注册了不列进去等于没注册。 */
export const BACKGROUND_SHELL_TOOL_NAMES = ['shell_background', 'shell_background_output', 'shell_background_stop'] as const

export type BackgroundTaskStatus = 'running' | 'exited' | 'stopped' | 'failed'

export interface BackgroundTask {
  id: string
  name: string
  command: string
  cwd: string
  status: BackgroundTaskStatus
  startedAt: number
  finishedAt: number | null
  exitCode: number | null
  error: string | null
}

interface TaskRecord extends BackgroundTask {
  controller: AbortController
  /** 环形缓冲：只保留末尾 MAX_OUTPUT_BYTES，长跑服务的日志不会把内存吃穿 */
  output: string
  droppedBytes: number
}

/** 各分支的 details 形状必须一致，否则 pi 按首个分支推断出的类型对不上后面的返回。 */
interface BackgroundToolDetails {
  task: BackgroundTask | null
  tasks: BackgroundTask[]
}

export interface BackgroundShellContext {
  cwd: string
  operations: BashOperations
  env?: Record<string, string>
  emit?: (event: Omit<AgentEvent, 'runId'>) => void
}

class BackgroundShellRegistry {
  private readonly tasks = new Map<string, TaskRecord>()
  private sequence = 0

  list(): BackgroundTask[] {
    return [...this.tasks.values()].map(publicTask)
  }

  get(id: string): TaskRecord | undefined {
    return this.tasks.get(id)
  }

  start(context: BackgroundShellContext, input: { command: string; cwd?: string; name?: string }): TaskRecord {
    const id = `bg-${++this.sequence}`
    const cwd = input.cwd?.trim() || context.cwd
    const controller = new AbortController()
    const record: TaskRecord = {
      id,
      name: input.name?.trim() || input.command.trim().slice(0, 40),
      command: input.command,
      cwd,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      exitCode: null,
      error: null,
      controller,
      output: '',
      droppedBytes: 0
    }
    this.tasks.set(id, record)
    // 刻意不 await：这条 Promise 的意义只是把终态写回台账，工具本身立刻返回。
    void context.operations.exec(input.command, cwd, {
      env: context.env,
      signal: controller.signal,
      timeout: BACKGROUND_TIMEOUT_SECONDS,
      onData: (chunk) => appendOutput(record, chunk.toString('utf8'))
    }).then(({ exitCode }) => {
      record.exitCode = exitCode
      // 主动停掉的进程退出码没有意义，状态以「谁结束了它」为准。
      record.status = controller.signal.aborted ? 'stopped' : 'exited'
      record.finishedAt = Date.now()
    }).catch((error: unknown) => {
      record.status = controller.signal.aborted ? 'stopped' : 'failed'
      record.error = error instanceof Error ? error.message : String(error)
      record.finishedAt = Date.now()
    })
    return record
  }

  stop(id: string): TaskRecord | null {
    const record = this.tasks.get(id)
    if (!record) return null
    if (record.status === 'running') {
      record.controller.abort()
      record.status = 'stopped'
      record.finishedAt = Date.now()
    }
    return record
  }

  stopAll() {
    for (const record of this.tasks.values()) {
      if (record.status === 'running') {
        record.controller.abort()
        record.status = 'stopped'
        record.finishedAt = Date.now()
      }
    }
    this.tasks.clear()
  }
}

function publicTask(record: TaskRecord): BackgroundTask {
  const { controller: _controller, output: _output, droppedBytes: _dropped, ...rest } = record
  return rest
}

/** 追加输出并按字节上限裁掉最早的部分。 */
export function appendOutput(record: { output: string; droppedBytes: number }, chunk: string) {
  record.output += chunk
  if (record.output.length <= MAX_OUTPUT_BYTES) return
  const overflow = record.output.length - MAX_OUTPUT_BYTES
  record.output = record.output.slice(overflow)
  record.droppedBytes += overflow
}

/** 取末尾若干行；行数非正时按 1 行处理。 */
export function tailLines(text: string, lines: number): string {
  const all = text.split('\n')
  return all.slice(-Math.max(1, lines)).join('\n')
}

export function describeTask(task: BackgroundTask): string {
  const elapsed = Math.round(((task.finishedAt ?? Date.now()) - task.startedAt) / 1000)
  const tail = task.status === 'running'
    ? `已运行 ${elapsed}s`
    : task.status === 'failed'
      ? `失败：${task.error ?? '未知原因'}`
      : `${task.status === 'stopped' ? '已停止' : '已退出'}（退出码 ${task.exitCode ?? '未知'}，运行 ${elapsed}s）`
  return `${task.id} [${task.name}] ${tail}\n  命令：${task.command}\n  目录：${task.cwd}`
}

/** 一个会话一份台账：后台进程要跨轮存活，不能挂在单次 run 上。 */
const registries = new Map<string, BackgroundShellRegistry>()

function registryKey(namespace: string, conversationId: string) {
  return `${namespace}\u0000${conversationId}`
}

function registryFor(namespace: string, conversationId: string): BackgroundShellRegistry {
  const key = registryKey(namespace, conversationId)
  let registry = registries.get(key)
  if (!registry) {
    registry = new BackgroundShellRegistry()
    registries.set(key, registry)
  }
  return registry
}

/** 会话运行时销毁时调用：把还在跑的后台进程一并停掉，不留跨会话残留。 */
export function stopBackgroundShells(namespace: string, conversationId: string) {
  const key = registryKey(namespace, conversationId)
  registries.get(key)?.stopAll()
  registries.delete(key)
}

export interface BackgroundShellToolsOptions {
  namespace: string
  conversationId: string
  /** 每次调用现取执行上下文：沙箱会话与 cwd 逐轮变化，捕获首轮闭包会执行到旧会话上。 */
  resolveContext: () => BackgroundShellContext
}

export function createBackgroundShellTools(options: BackgroundShellToolsOptions): ToolDefinition[] {
  const registry = () => registryFor(options.namespace, options.conversationId)

  const start = defineTool({
    name: 'shell_background',
    label: 'Background shell',
    description: '在后台启动长期运行的命令（开发服务器、watch 进程等），立即返回任务 id，不等它退出。进程存活到会话结束或被显式停止。',
    promptSnippet: 'Start a long-running command in the background and keep it alive',
    promptGuidelines: [
      'Use shell_background for servers, watchers, and anything that does not terminate on its own. Never start these with the normal shell tool — it blocks until the process exits.',
      'Do not append & or use start/nohup inside the command; shell_background already detaches it.',
      'After starting, poll shell_background_output to confirm the process came up before depending on it.',
      'Stop what you started with shell_background_stop once it is no longer needed.'
    ],
    parameters: Type.Object({
      command: Type.String({ description: '要在后台执行的命令' }),
      cwd: Type.Optional(Type.String({ description: '工作目录；省略时用当前工作区根' })),
      name: Type.Optional(Type.String({ description: '便于识别的短名称，如 "api server"' }))
    }),
    async execute(_toolCallId, params) {
      const context = options.resolveContext()
      const record = registry().start(context, params)
      context.emit?.({
        type: 'tool_result',
        tool: 'shell_background',
        detail: `后台任务已启动：${record.id}`,
        status: 'completed'
      })
      return {
        content: [{ type: 'text', text: `后台任务已启动：${record.id}（${record.name}）。用 shell_background_output 查看输出，用 shell_background_stop 停止。` }],
        details: { task: publicTask(record) }
      }
    }
  })

  const output = defineTool({
    name: 'shell_background_output',
    label: 'Background output',
    description: '查看后台任务的输出与状态。省略 id 时列出全部后台任务。',
    promptSnippet: 'Inspect output and status of background tasks',
    promptGuidelines: [
      'Call this after shell_background to verify the process actually started instead of assuming it did.'
    ],
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: '任务 id；省略则列出全部' })),
      lines: Type.Optional(Type.Number({ description: '返回末尾多少行输出，默认 100' }))
    }),
    async execute(_toolCallId, params): Promise<{ content: Array<{ type: 'text'; text: string }>; details: BackgroundToolDetails; isError?: boolean }> {
      const store = registry()
      if (!params.id) {
        const tasks = store.list()
        const text = tasks.length ? tasks.map(describeTask).join('\n') : '当前没有后台任务。'
        return { content: [{ type: 'text', text }], details: { task: null, tasks } }
      }
      const record = store.get(params.id)
      if (!record) return { content: [{ type: 'text', text: `没有这个后台任务：${params.id}` }], details: { task: null, tasks: [] }, isError: true }
      const task = publicTask(record)
      const dropped = record.droppedBytes ? `\n（早期输出已丢弃 ${record.droppedBytes} 字节）` : ''
      const body = record.output ? tailLines(record.output, params.lines ?? 100) : '（暂无输出）'
      return {
        content: [{ type: 'text', text: `${describeTask(task)}${dropped}\n--- 输出 ---\n${body}` }],
        details: { task, tasks: [] }
      }
    }
  })

  const stop = defineTool({
    name: 'shell_background_stop',
    label: 'Stop background',
    description: '停止一个后台任务及其派生进程。',
    promptSnippet: 'Stop a background task started with shell_background',
    parameters: Type.Object({
      id: Type.String({ description: '要停止的任务 id' })
    }),
    async execute(_toolCallId, params): Promise<{ content: Array<{ type: 'text'; text: string }>; details: BackgroundToolDetails; isError?: boolean }> {
      const record = registry().stop(params.id)
      if (!record) return { content: [{ type: 'text', text: `没有这个后台任务：${params.id}` }], details: { task: null, tasks: [] }, isError: true }
      return {
        content: [{ type: 'text', text: `后台任务 ${record.id} 已停止。` }],
        details: { task: publicTask(record), tasks: [] }
      }
    }
  })

  return [start, output, stop]
}
