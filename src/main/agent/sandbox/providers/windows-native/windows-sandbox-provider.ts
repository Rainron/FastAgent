import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { accountModeFor } from '../../../../../shared/sandbox'
import { SandboxError } from '../../sandbox-errors'
import type {
  SandboxCapabilities,
  SandboxCreateOptions,
  SandboxExecuteRequest,
  SandboxProcess,
  SandboxProvider,
  SandboxSession
} from '../../sandbox-types'
import { evaluateCapabilities, type SandboxSetupRecord } from './windows-capabilities'
import { buildRunnerSessionArgs, buildRuntimeGrantArgs, buildWorkspaceGrantArgs } from './windows-sandbox-policy'
import { RunnerClient, type RunnerHandle } from './windows-runner-client'

export interface WindowsSandboxPaths {
  /** fastagent-command-runner.exe */
  runnerPath: string
  /** fastagent-sandbox-setup.exe */
  setupPath: string
  /** %ProgramData%\FastAgent\sandbox */
  stateDir: string
  /** 内置工具链安装目录（数据根下的 runtime）；未安装时为 null，此时不做授权 */
  runtimePath: string | null
}

/** 打包后原生程序放在 resources/sandbox，开发态取 cargo 的 release 产物。 */
export function resolveSandboxPaths(options: { resourcesPath: string; projectRoot: string; packaged: boolean; programData: string; runtimePath?: string | null }): WindowsSandboxPaths {
  const binDir = options.packaged
    ? join(options.resourcesPath, 'sandbox')
    : join(options.projectRoot, 'native', 'target', 'release')
  return {
    runnerPath: join(binDir, 'fastagent-command-runner.exe'),
    setupPath: join(binDir, 'fastagent-sandbox-setup.exe'),
    stateDir: join(options.programData, 'FastAgent', 'sandbox'),
    runtimePath: options.runtimePath ?? null
  }
}

function readSetupRecord(stateDir: string): SandboxSetupRecord | null {
  const path = join(stateDir, 'setup.json')
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SandboxSetupRecord>
    if (typeof parsed.version !== 'string' || typeof parsed.offlineSid !== 'string' || typeof parsed.onlineSid !== 'string') return null
    return { version: parsed.version, offlineSid: parsed.offlineSid, onlineSid: parsed.onlineSid, createdAt: parsed.createdAt ?? '' }
  } catch {
    return null
  }
}

function childHandle(child: ChildProcessWithoutNullStreams): RunnerHandle {
  return {
    write: (payload) => { child.stdin.write(payload) },
    onData: (listener) => { child.stdout.on('data', listener) },
    onClose: (listener) => { child.on('close', (code) => listener(code)) },
    kill: () => { child.kill() }
  }
}

/**
 * Windows 原生进程沙箱：Host 以沙箱账户身份启动 runner，
 * runner 内部再派生 Restricted Token 与 Job Object 执行目标命令。
 */
export class WindowsSandboxProvider implements SandboxProvider {
  private readonly clients = new Map<string, RunnerClient>()

  constructor(
    private readonly paths: WindowsSandboxPaths,
    private readonly platform: string = process.platform,
    private readonly spawnRunner: (args: string[]) => RunnerHandle = (args) => childHandle(spawn(this.paths.runnerPath, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })),
    private readonly spawnVersionProbe: () => ChildProcess = () => spawn(this.paths.runnerPath, ['--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }),
    /** 授权进程与降级提示；前四个参数保持位置形式，测试已经依赖它们。 */
    private readonly options: {
      spawnGrant?: (args: string[]) => ChildProcess
      /** 内置工具链授权失败只降级不中断，用它把原因告诉用户。 */
      onNotice?: (message: string) => void
    } = {}
  ) {}

  private spawnGrant(args: string[]): ChildProcess {
    return this.options.spawnGrant ? this.options.spawnGrant(args) : spawn(this.paths.runnerPath, args, { windowsHide: true })
  }

  async probe(): Promise<SandboxCapabilities> {
    const setup = readSetupRecord(this.paths.stateDir)
    const runnerPresent = existsSync(this.paths.runnerPath)
    return evaluateCapabilities({
      platform: this.platform,
      runnerPresent,
      // 直接问 runner 自己的版本：应用更新后原生程序可能落后于 setup 记录。
      runnerVersion: runnerPresent ? await this.readRunnerVersion() : null,
      setup,
      credentialsPresent: existsSync(join(this.paths.stateDir, 'credentials.bin')),
      now: Date.now()
    })
  }

  private readRunnerVersion(): Promise<string | null> {
    return new Promise((resolve) => {
      let stdout = ''
      let settled = false
      let child: ChildProcess | null = null
      const finish = (version: string | null) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(version)
      }
      const timeout = setTimeout(() => {
        child?.kill()
        finish(null)
      }, 5_000)
      try {
        child = this.spawnVersionProbe()
        child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
        child.on('error', () => finish(null))
        child.on('close', (code) => {
          const version = stdout.trim()
          finish(code === 0 && /^\d+\.\d+\.\d+/.test(version) ? version : null)
        })
      } catch {
        finish(null)
      }
    })
  }

  async initialize(): Promise<SandboxCapabilities> {
    if (this.platform !== 'win32') throw new SandboxError('unsupported')
    if (!existsSync(this.paths.setupPath)) throw new SandboxError('not_initialized')
    await this.runElevatedSetup()
    return this.probe()
  }

  async createSession(options: SandboxCreateOptions): Promise<SandboxSession> {
    if (this.platform !== 'win32') throw new SandboxError('unsupported')
    if (!existsSync(this.paths.runnerPath)) throw new SandboxError('not_initialized')
    const accountMode = accountModeFor(options.policy)
    const session: SandboxSession = {
      id: `sandbox-${randomUUID()}`,
      workspacePath: options.workspacePath,
      accountMode,
      policy: options.policy,
      isolation: 'sandboxed',
      createdAt: Date.now()
    }
    if (options.workspacePath) await this.grantWorkspace(accountMode, options.workspacePath)
    // 内置工具链授权失败不该拖垮整个会话：沙箱内退回系统 PATH 上的工具，
    // 比「因为 git 授不了权而根本进不去沙箱」要好。
    if (this.paths.runtimePath) {
      try {
        await this.grantRuntime(accountMode, this.paths.runtimePath)
      } catch {
        this.options.onNotice?.(`内置工具链授权失败，沙箱内将只能使用系统 PATH 上的工具：${this.paths.runtimePath}`)
      }
    }
    const args = buildRunnerSessionArgs(session.id, accountMode, options.policy, options.shell)
    const handle = this.spawnRunner(['--session', JSON.stringify(args)])
    const client = new RunnerClient(handle)
    // 等 worker 的握手：沙箱身份没建立起来就不返回会话，任务在这里停住，
    // 而不是等到第一条命令才失败。
    try {
      await client.ready
    } catch (error) {
      client.dispose()
      throw error
    }
    this.clients.set(session.id, client)
    return session
  }

  async execute(session: SandboxSession, request: SandboxExecuteRequest): Promise<SandboxProcess> {
    const client = this.clients.get(session.id)
    if (!client) throw new SandboxError('runner_failed')
    return client.exec(request)
  }

  async terminate(session: SandboxSession, processId: string): Promise<void> {
    this.clients.get(session.id)?.cancel(processId)
  }

  async destroySession(session: SandboxSession): Promise<void> {
    const client = this.clients.get(session.id)
    this.clients.delete(session.id)
    client?.dispose()
  }

  /** 工作区授权走 runner 的子命令，属主是当前用户，不需要 UAC。 */
  private grantWorkspace(accountMode: 'offline' | 'online', workspacePath: string) {
    return this.grant(buildWorkspaceGrantArgs(accountMode, workspacePath), workspacePath)
  }

  /** 内置工具链授权，同样不需要 UAC；只授只读+执行。 */
  private grantRuntime(accountMode: 'offline' | 'online', runtimePath: string) {
    return this.grant(buildRuntimeGrantArgs(accountMode, runtimePath), runtimePath)
  }

  private grant(args: string[], target: string) {
    return new Promise<void>((resolve, reject) => {
      const child = this.spawnGrant(args)
      child.on('error', () => reject(new SandboxError('broken')))
      child.on('close', (code) => code === 0 ? resolve() : reject(new SandboxError('filesystem_denied', { target })))
    })
  }

  /** setup.exe 自带 requireAdministrator 清单，Start-Process -Verb RunAs 触发一次 UAC。 */
  private runElevatedSetup() {
    return new Promise<void>((resolve, reject) => {
      const child = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Start-Process -FilePath '${this.paths.setupPath.replace(/'/g, "''")}' -Verb RunAs -Wait`
      ], { windowsHide: true })
      child.on('error', () => reject(new SandboxError('broken')))
      child.on('close', (code) => code === 0 ? resolve() : reject(new SandboxError('broken')))
    })
  }
}
