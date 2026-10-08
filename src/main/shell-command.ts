import { homedir } from 'node:os'
import { StringDecoder } from 'node:string_decoder'
import { MAX_SHELL_COMMAND_OUTPUT, truncateShellOutput } from '../shared/shell-command'
import type { SandboxPolicy } from '../shared/sandbox'
import type { ShellCommandResult, ShellCommandStatus } from '../shared/types'
import { createShellOperations } from './agent/sandbox/shell-operations'
import { resolveBashPath, resolveShellToolName } from './agent/sandbox/shell-resolver'
import type { SandboxManager } from './agent/sandbox/sandbox-manager'
import type { SandboxSession } from './agent/sandbox/sandbox-types'

/**
 * 输入框 `!命令` 的执行入口。
 *
 * 与 agent 的 shell 工具走同一条后端；独立会话避免依赖 agent 缓存的生命周期，
 * 每次按当前策略建立隔离，沙箱不可用时由管理器决定是否允许降级。
 */

export interface ShellCommandDeps {
  shellPreference: 'bash' | 'powershell'
  bashPath: string
  bundledBash?: string
  workspaceRoot: string | null
  policy: SandboxPolicy
  manager: SandboxManager
  timeoutSeconds: number
  onData(chunk: string): void
}

/** 运行中的 `!` 命令：按 id 索引，供渲染进程随时终止。 */
const running = new Map<string, AbortController>()

export function cancelShellCommand(id: string): boolean {
  const controller = running.get(id)
  if (!controller) return false
  controller.abort()
  return true
}

export function cancelAllShellCommands(): void {
  for (const controller of running.values()) controller.abort()
}

/** 结束时的状态判定抽成纯函数，超时与主动终止都表现为 abort，只能靠标记区分。 */
export function shellCommandStatus(input: { aborted: boolean; timedOut: boolean; failed: boolean; exitCode: number | null }): ShellCommandStatus {
  if (input.timedOut) return 'timeout'
  if (input.aborted) return 'cancelled'
  if (input.failed) return 'failed'
  return input.exitCode === 0 ? 'completed' : 'failed'
}

export async function runShellCommand(id: string, command: string, deps: ShellCommandDeps): Promise<ShellCommandResult> {
  if (running.has(id)) throw new Error('该命令正在执行')
  const bashPath = resolveBashPath({ explicitPath: deps.bashPath, bundledPath: deps.bundledBash }) ?? undefined
  const shellToolName = resolveShellToolName(deps.shellPreference, { explicitPath: deps.bashPath, bundledPath: deps.bundledBash })
  const cwd = deps.workspaceRoot || homedir()
  const controller = new AbortController()
  running.set(id, controller)
  // 超时同样走 abort：本地执行器与沙箱 runner 都只认 signal，两条路径行为一致。
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, deps.timeoutSeconds * 1000)
  const startedAt = Date.now()
  let output = ''
  let truncated = false
  let error: string | null = null
  let exitCode: number | null = null
  let failed = false
  let session: SandboxSession | null = null
  const decoder = new StringDecoder('utf8')
  const append = (text: string) => {
    if (!text) return
    const next = truncateShellOutput(output + text, MAX_SHELL_COMMAND_OUTPUT)
    truncated = truncated || next.truncated
    output = next.text
    deps.onData(text)
  }
  try {
    session = await deps.manager.createSession({ workspacePath: deps.workspaceRoot, policy: deps.policy, shell: shellToolName })
    controller.signal.throwIfAborted()
    if (deps.policy.enabled && session.isolation === 'unsandboxed') {
      append('沙箱不可用，已按设置降级为未隔离执行；命令将以当前用户身份访问本机资源。\n')
    }
    const operations = createShellOperations({ shellToolName, bashPath, session, manager: deps.manager })
    const exit = await operations.exec(command, cwd, {
      signal: controller.signal,
      timeout: deps.timeoutSeconds,
      onData: (chunk) => append(decoder.write(chunk))
    })
    exitCode = exit.exitCode
  } catch (cause) {
    failed = true
    error = cause instanceof Error ? cause.message : String(cause)
  } finally {
    clearTimeout(timer)
    try {
      append(decoder.end())
    } finally {
      try {
        if (session) await deps.manager.destroySession(session)
      } catch (cause) {
        failed = true
        error = error ?? (cause instanceof Error ? cause.message : String(cause))
      } finally {
        running.delete(id)
      }
    }
  }
  const aborted = controller.signal.aborted
  const status = shellCommandStatus({ aborted, timedOut, failed, exitCode })
  return {
    id,
    command,
    status,
    exitCode,
    output,
    truncated,
    // 主动终止与超时不是「执行失败」，把 abort 抛出的噪音错误吞掉，状态本身已经说明问题。
    error: aborted ? null : error,
    cwd,
    shell: shellToolName,
    durationMs: Date.now() - startedAt
  }
}
