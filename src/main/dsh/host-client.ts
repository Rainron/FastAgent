import { utilityProcess, type UtilityProcess } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DshPluginActivation } from '../../shared/types'
import { DSH_HOST_READY_TIMEOUT_MS, DSH_TOOL_TIMEOUT_MS, type DshHostRequest, type DshHostResponse, type DshMountSpec } from './host-protocol'

export interface DshHostClientOptions {
  /** 插件根目录；播种出来的 node_modules 就在它下面。延后取值，启动早期还没解析出来 */
  root: () => string
  /** 宿主进程入口，构建产物里的 dsh-host.js */
  entryPath: string
  /** 崩溃上报，交给调用方决定是否提示用户 */
  onCrash?: (reason: string) => void
}

interface Pending {
  resolve(response: DshHostResponse): void
  reject(error: Error): void
}

export interface DshToolCallResult {
  isError: boolean
  text: string
}

/**
 * 主进程侧的宿主客户端。只负责进程生命周期与请求配对，不含任何插件语义。
 * 卸载与热重载一律是「杀掉重起」：Cordis 虽然支持 unload，但第三方插件不一定卸得干净，
 * 换进程是唯一能保证状态归零的做法。
 */
export class DshHostClient {
  private child: UtilityProcess | null = null
  private ready: Promise<void> | null = null
  private readonly pending = new Map<number, Pending>()
  private nextId = 1

  constructor(private readonly options: DshHostClientOptions) {}

  get running() {
    return this.child !== null
  }

  /** 播种目录也是插件依赖的解析根，必须先于 fork 建好。 */
  private ensureRoot() {
    mkdirSync(join(this.options.root(), 'node_modules'), { recursive: true })
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready
    this.ensureRoot()
    this.ready = new Promise<void>((resolve, reject) => {
      const child = utilityProcess.fork(this.options.entryPath, [], {
        serviceName: 'fastagent-dsh-host',
        env: { ...process.env, FASTAGENT_DSH_RUNTIME: join(this.options.root(), 'node_modules') },
        stdio: 'ignore'
      })
      // stop() 之后旧进程的事件还会陆续到达（kill 是异步的），此时 this.child 可能已是新进程。
      // 所有回调先确认自己还是当前进程，否则旧进程的 exit 会把新进程的引用清掉，
      // 后续请求撞上空指针，新进程也成了没人管的孤儿。
      const current = () => this.child === child
      const timer = setTimeout(() => {
        reject(new Error(`dsh 插件宿主 ${DSH_HOST_READY_TIMEOUT_MS} 毫秒内没有就绪`))
        if (!current()) return
        this.teardown('启动超时')
        child.kill()
      }, DSH_HOST_READY_TIMEOUT_MS)

      child.on('message', (message: DshHostResponse) => {
        if (!current()) return
        if (message.kind === 'ready') {
          clearTimeout(timer)
          resolve()
          return
        }
        // 主流程尚未就绪时的失败要变成启动失败，不能只落到 pending 上
        if (message.kind === 'failed' && message.id === -1) {
          clearTimeout(timer)
          reject(new Error(message.message))
          this.teardown(message.message)
          return
        }
        this.settle(message)
      })

      child.on('exit', (code) => {
        clearTimeout(timer)
        const reason = `dsh 插件宿主退出（code ${code}）`
        reject(new Error(reason))
        // 被 stop() 主动换下的旧进程：状态早已清理，kill 造成的非零退出码也不是崩溃
        if (!current()) return
        this.teardown(reason)
        if (code !== 0) this.options.onCrash?.(reason)
      })

      this.child = child
    })
    return this.ready
  }

  private settle(message: DshHostResponse) {
    if (!('id' in message)) return
    const waiter = this.pending.get(message.id)
    if (!waiter) return
    this.pending.delete(message.id)
    if (message.kind === 'failed') waiter.reject(new Error(message.message))
    else waiter.resolve(message)
  }

  private teardown(reason: string) {
    for (const waiter of this.pending.values()) waiter.reject(new Error(reason))
    this.pending.clear()
    this.child = null
    this.ready = null
  }

  private allocate() {
    return this.nextId++
  }

  private cancel(target: number) {
    this.child?.postMessage({ kind: 'cancel', id: this.allocate(), target } satisfies DshHostRequest)
  }

  private request(id: number, message: DshHostRequest, timeoutMs: number): Promise<DshHostResponse> {
    return new Promise<DshHostResponse>((resolve, reject) => {
      // 等 ready 期间宿主可能被 stop() 或重挂换掉，这里不能假定进程还在
      const child = this.child
      if (!child) {
        reject(new Error('dsh 插件宿主已停止'))
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.cancel(id)
        reject(new Error('dsh 插件调用超时'))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (response) => { clearTimeout(timer); resolve(response) },
        reject: (error) => { clearTimeout(timer); reject(error) }
      })
      child.postMessage(message)
    })
  }

  /** 起进程并挂载给定插件；返回每个插件的激活结果。 */
  async mount(specs: DshMountSpec[]): Promise<Record<string, DshPluginActivation>> {
    await this.start()
    const id = this.allocate()
    const response = await this.request(id, { kind: 'mount', id, specs }, DSH_HOST_READY_TIMEOUT_MS)
    return response.kind === 'mounted' ? response.activations : {}
  }

  async execute(callId: string, tool: string, args: unknown, signal: AbortSignal): Promise<DshToolCallResult> {
    if (!this.child) throw new Error('dsh 插件宿主未运行')
    const id = this.allocate()
    const abort = () => this.cancel(id)
    signal.addEventListener('abort', abort, { once: true })
    try {
      const response = await this.request(id, { kind: 'execute', id, callId, tool, arguments: args }, DSH_TOOL_TIMEOUT_MS)
      return response.kind === 'executed' ? { isError: response.isError, text: response.text } : { isError: true, text: '宿主返回了未知响应' }
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  /** 停掉宿主。重新 mount 时会自动再起一个。 */
  stop() {
    const child = this.child
    this.teardown('dsh 插件宿主已停止')
    child?.kill()
  }
}
