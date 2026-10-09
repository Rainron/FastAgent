import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DSH_PROVIDED_SERVICES, type DshPluginActivation, type DshToolSummary } from '../../shared/types'
import { parseInjectList } from './manifest'
import type { DshHostRequest, DshHostResponse, DshMountSpec } from './host-protocol'

/**
 * dsh 插件宿主。跑在 Electron 的 utilityProcess 里，不是主进程：
 * dsh 插件是任意第三方 Node 代码，不能让它碰到 store、账号 token 和主进程句柄。
 *
 * 这里所有 dsh 相关模块都必须**动态 import 绝对路径**，指向用户数据目录下播种的那份运行时。
 * 静态 import 会解析到应用自带的 node_modules，跟插件 import 到的 cordis 是两个不同实例，
 * `ctx.plugin()` 会静默失效——这是最容易踩且最难查的坑。
 */

const runtimeDir: string = process.env.FASTAGENT_DSH_RUNTIME ?? ''
if (!runtimeDir) throw new Error('缺少 FASTAGENT_DSH_RUNTIME，宿主无法定位 dsh 运行时')

function send(message: DshHostResponse) {
  process.parentPort.postMessage(message)
}

async function importFrom(packageName: string, subPath: string) {
  return import(pathToFileURL(join(runtimeDir, packageName, subPath)).href)
}

interface MountedPlugin {
  tools: Set<string>
}

async function main() {
  const { Context } = await importFrom('@deepseek-ai/cordis', 'lib/index.js')
  const { SystemPrompt } = await importFrom('@deepseek-ai/dsh-system-prompt', 'lib/index.js')
  const { ToolRuntime } = await importFrom('@deepseek-ai/dsh-tools', 'lib/index.js')

  const ctx = new Context()
  ctx.plugin(SystemPrompt)
  ctx.plugin(ToolRuntime)
  await settle()
  if (!ctx.tools) throw new Error('dsh ToolRuntime 未能激活，运行时播种可能不完整')

  const mounted = new Map<string, MountedPlugin>()
  const running = new Map<number, AbortController>()

  async function mount(specs: DshMountSpec[]): Promise<Record<string, DshPluginActivation>> {
    const activations: Record<string, DshPluginActivation> = {}
    for (const spec of specs) {
      activations[spec.name] = await mountOne(spec)
    }
    return activations
  }

  async function mountOne(spec: DshMountSpec): Promise<DshPluginActivation> {
    let module: Record<string, unknown>
    try {
      module = await import(pathToFileURL(spec.entry).href)
    } catch (error) {
      return { status: 'failed', message: `加载失败：${describe(error)}` }
    }

    const plugin = (module.default ?? module) as { inject?: unknown; apply?: unknown }
    const inject = parseInjectList(plugin.inject)
    const missing = inject.filter((name) => !DSH_PROVIDED_SERVICES.includes(name as typeof DSH_PROVIDED_SERVICES[number]))
    // Cordis 对未满足的 inject 是挂起 fiber 而不是抛错，不提前拦就会表现成静默失灵
    if (missing.length) return { status: 'inactive', missingServices: missing }
    if (typeof plugin.apply !== 'function') return { status: 'failed', message: '插件没有导出 apply 函数' }

    const before = new Set(ctx.tools.schemas().map((schema: DshToolSummary) => schema.name))
    try {
      ctx.plugin(plugin, spec.config)
      await settle()
    } catch (error) {
      return { status: 'failed', message: describe(error) }
    }

    const tools = ctx.tools.schemas().filter((schema: DshToolSummary) => !before.has(schema.name))
    mounted.set(spec.name, { tools: new Set(tools.map((schema: DshToolSummary) => schema.name)) })
    return { status: 'active', tools }
  }

  process.parentPort.on('message', (event: { data: DshHostRequest }) => {
    void handle(event.data)
  })

  async function handle(request: DshHostRequest) {
    try {
      if (request.kind === 'mount') {
        send({ kind: 'mounted', id: request.id, activations: await mount(request.specs) })
        return
      }
      if (request.kind === 'cancel') {
        running.get(request.target)?.abort()
        return
      }
      const controller = new AbortController()
      running.set(request.id, controller)
      try {
        const result = await ctx.tools.execute({
          callId: request.callId,
          name: request.tool,
          arguments: request.arguments,
          signal: controller.signal
        })
        send({ kind: 'executed', id: request.id, isError: Boolean(result.isError), text: renderContent(result.content) })
      } finally {
        running.delete(request.id)
      }
    } catch (error) {
      send({ kind: 'failed', id: request.id, message: describe(error) })
    }
  }

  send({ kind: 'ready' })
}

/** Cordis 的挂载是异步生效的，注册完要让出一轮事件循环才能读到服务。 */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 工具结果是 ContentBlock 数组，pi 那边只收文本。 */
function renderContent(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : JSON.stringify(content ?? null)
  return content
    .map((block) => (block && typeof block === 'object' && 'text' in block ? String((block as { text: unknown }).text) : JSON.stringify(block)))
    .join('\n')
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

main().catch((error) => {
  send({ kind: 'failed', id: -1, message: describe(error) })
  process.exit(1)
})
