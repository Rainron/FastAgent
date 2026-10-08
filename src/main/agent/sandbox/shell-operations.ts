import {
  createLocalBashOperations,
  createLocalPowerShellOperations,
  type BashOperations
} from '@earendil-works/pi-coding-agent'
import { delimiter, dirname, join } from 'node:path'
import { sanitizeEnvironment } from '../../../shared/sandbox'
import type { SandboxManager } from './sandbox-manager'
import type { SandboxSession } from './sandbox-types'

export interface ShellOperationsContext {
  shellToolName: 'bash' | 'powershell'
  /** 已通过可用性探测的 bash 路径；Windows 上必带，交给 pi 免去再次解析（可能解析到 WSL stub） */
  bashPath?: string
  session: SandboxSession | null
  manager: SandboxManager | null
  /** 主进程环境变量来源，测试里可注入 */
  hostEnv?: Record<string, string | undefined>
}

const MAX_TIMEOUT_MS = 2_147_483_647
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000

/** Pi shell 的超时单位是秒，沙箱 runner 的协议单位是整数毫秒。 */
export function resolveSandboxTimeoutMs(timeout: number | undefined): number | undefined {
  if (timeout === undefined) return undefined
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error('Invalid timeout: must be a finite number of seconds')
  }
  const timeoutMs = timeout * 1000
  if (timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`)
  }
  return Math.max(1, Math.round(timeoutMs))
}

/**
 * 沙箱内的 bash 由 runner 自己解析：它按 PATH 找 bash.exe，而内置 bash 在 git/usr/bin 下、
 * 刻意不进 PATH（否则 PowerShell 会话里的 find/sort/date 会被 MSYS 版本遮蔽）。
 * runner 提供了 FASTAGENT_SANDBOX_BASH 这个显式入口，用它把路径直接告诉沙箱。
 */
function withBashEnvironment(env: Record<string, string>, context: ShellOperationsContext): Record<string, string> {
  if (context.shellToolName !== 'bash' || !context.bashPath) return env

  // pi 的本地 backend 会把自身 bin 目录加进 PATH；原生 runner 不会继承这层逻辑。
  // Windows 上内置 Git Bash 的 bash.exe 旁边才有 head/tr/grep 等 POSIX 工具，
  // 只传宿主 PATH 时 runner 可能只能看到 System32 和少量 GUI 环境路径。
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  const current = env[pathKey] ?? ''
  const bashDir = dirname(context.bashPath)
  const gitRoot = basenameInsensitive(bashDir) === 'bin' && basenameInsensitive(dirname(bashDir)) === 'usr'
    ? dirname(dirname(bashDir))
    : dirname(bashDir)
  const candidates = [
    join(gitRoot, 'usr', 'bin'),
    join(gitRoot, 'bin'),
    join(gitRoot, 'cmd')
  ]
  const entries = current.split(delimiter).filter(Boolean)
  const additions = candidates.filter((candidate) => !entries.some((entry) => entry.toLowerCase() === candidate.toLowerCase()))
  return {
    ...env,
    [pathKey]: [...additions, ...entries].join(delimiter),
    FASTAGENT_SANDBOX_BASH: context.bashPath
  }
}

function basenameInsensitive(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const index = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'))
  return normalized.slice(index + 1).toLowerCase()
}

/**
 * 沙箱账户不是工作区属主，git 2.35+ 的 safe.directory 校验会对每条 git 命令报
 * dubious ownership 并以 128 退出——沙箱内 git 全线不可用。
 * 用 GIT_CONFIG_* 只在子进程里放行本次工作区，不去改用户的 gitconfig；
 * Windows 路径连正斜杠写法一起登记（git 报错信息里用的就是正斜杠），避免形态不同导致校验落空。
 */
export function sandboxGitConfigEnv(workspacePath: string | null): Record<string, string> {
  if (!workspacePath) return {}
  const forward = workspacePath.replace(/\\/g, '/')
  const paths = forward === workspacePath ? [workspacePath] : [workspacePath, forward]
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(paths.length) }
  paths.forEach((path, index) => {
    env[`GIT_CONFIG_KEY_${index}`] = 'safe.directory'
    env[`GIT_CONFIG_VALUE_${index}`] = path
  })
  return env
}

/**
 * shell 工具唯一的执行入口：沙箱会话存在走 SandboxManager，否则退回 pi 的本地执行。
 * 两条路径都先清洗环境变量，模型 API Key 在任何情况下都不进入子进程。
 */
export function createShellOperations(source: ShellOperationsContext | (() => ShellOperationsContext)): BashOperations {
  const current = () => typeof source === 'function' ? source() : source
  // 本地执行器按「工具名 + bash 路径」缓存后惰性创建：上下文每轮刷新，
  // 用户在设置里改 shell 偏好或 bash 路径后，下一轮就能用上新配置。
  const localCache = new Map<string, BashOperations>()
  const localOperations = (context: ShellOperationsContext): BashOperations => {
    const key = `${context.shellToolName}|${context.bashPath ?? ''}`
    let operations = localCache.get(key)
    if (!operations) {
      operations = context.shellToolName === 'powershell'
        ? createLocalPowerShellOperations()
        : createLocalBashOperations(context.bashPath ? { shellPath: context.bashPath } : undefined)
      localCache.set(key, operations)
    }
    return operations
  }

  return {
    exec: async (command, cwd, options) => {
      const context = current()
      const env = sanitizeEnvironment(context.hostEnv ?? process.env, options.env ?? {})
      const sandboxed = context.session?.isolation === 'sandboxed' && context.manager
      if (!sandboxed || !context.session || !context.manager) {
        return localOperations(context).exec(command, cwd, { ...options, env: withBashEnvironment(env, context) })
      }
      const sandboxProcess = await context.manager.execute(context.session, {
        command,
        cwd,
        // git 配置放最后：调用方若带了自己的 GIT_CONFIG_COUNT，索引会和这里的键错位，宁可覆盖掉。
        env: { ...withBashEnvironment(env, context), ...sandboxGitConfigEnv(context.session.workspacePath) },
        timeoutMs: options.timeout === undefined
          ? context.session.policy.process.timeoutMs
          : resolveSandboxTimeoutMs(options.timeout),
        signal: options.signal,
        onData: (chunk) => options.onData(chunk)
      })
      return sandboxProcess.exit
    }
  }
}
