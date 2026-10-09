import { join } from 'node:path'
import type { DshHostState, DshInstallResult, DshPluginActivation, DshPluginRecord, DshSearchHit } from '../../shared/types'
import { selectDshBindings, type DshToolBinding } from '../dsh-bridge'
import { DshHostClient } from './host-client'
import { DshInstaller } from './installer'
import type { DshPluginInput } from '../local-store/dsh-plugin-store'
import { resolvePluginEntry } from './manifest'
import type { DshMountSpec } from './host-protocol'
import { ensureDshRuntime, readPackageVersion, readSeedVersions } from './runtime-seed'

/** 服务只认这几个落库能力，不认识 LocalStore 本身。 */
export interface DshPluginStoreDeps {
  listDshPlugins(): DshPluginRecord[]
  getDshPlugin(name: string): DshPluginRecord | null
  saveDshPlugin(input: DshPluginInput): DshPluginRecord
  setDshPluginEnabled(name: string, enabled: boolean): void
  setDshPluginConfig(name: string, config: Record<string, unknown>): void
  setDshPluginActivation(name: string, activation: DshPluginActivation | null): void
  removeDshPlugin(name: string): void
}

export interface DshServiceOptions {
  /** 插件根目录，appPaths.dshPluginsDir；appPaths 在启动流程后段才赋值，只能按取值函数传 */
  root: () => string
  /** 应用自带的 node_modules，运行时从这里播种 */
  appNodeModules: () => string
  /** 构建产物里的宿主进程入口 */
  hostEntryPath: string
  /** store 是启动后才就绪的可变单例，按取值函数传入，不能捕获快照 */
  store: () => DshPluginStoreDeps
  onCrash?: (reason: string) => void
}

export function createDshService(options: DshServiceOptions) {
  const store = options.store
  const host = new DshHostClient({ root: options.root, entryPath: options.hostEntryPath, onCrash: options.onCrash })
  let hostError: string | undefined
  let runtimeVersion = ''
  let hostPackages: Record<string, string> = {}
  let bindings: DshToolBinding[] = []

  /**
   * 播种必须在 fork 之前，而且宿主与插件要解析到同一份 cordis，
   * 否则 `ctx.plugin()` 跨实例失效。runtimeVersion 同时是给界面看的兼容区间。
   */
  function seed() {
    const appNodeModules = options.appNodeModules()
    if (!runtimeVersion) runtimeVersion = readPackageVersion(appNodeModules, '@deepseek-ai/cordis')
    const seeded = ensureDshRuntime(appNodeModules, join(options.root(), 'node_modules'), runtimeVersion)
    if (!Object.keys(hostPackages).length) hostPackages = readSeedVersions(appNodeModules, seeded.packages)
    return runtimeVersion
  }

  function installer() {
    const hostCordisVersion = seed()
    return new DshInstaller({ root: options.root(), hostCordisVersion, hostPackages })
  }

  function mountSpecs(): DshMountSpec[] {
    return store().listDshPlugins().flatMap((plugin) => {
      if (!plugin.enabled) return []
      const entry = resolvePluginEntry(plugin.installPath, plugin.mainEntry)
      if (!entry) return []
      return [{ name: plugin.name, entry, config: plugin.config }]
    })
  }

  /**
   * 重挂排队串行执行：启动时的后台挂载与用户的启停操作可能同时到达，
   * 交错执行会让先发起、后完成的那次把新结果覆盖成旧的插件集。
   */
  let remountQueue: Promise<unknown> = Promise.resolve()
  function remount(): Promise<Record<string, DshPluginActivation>> {
    const run = remountQueue.then(remountNow, remountNow)
    remountQueue = run.catch(() => undefined)
    return run
  }

  /**
   * 重挂全部启用的插件。卸载走杀进程重起：第三方插件不保证卸得干净，
   * 换进程是唯一能保证状态归零的做法。
   */
  async function remountNow(): Promise<Record<string, DshPluginActivation>> {
    host.stop()
    hostError = undefined
    const specs = mountSpecs()
    // 没有启用的插件就不必起进程，省一个常驻子进程
    if (!specs.length) {
      bindings = []
      for (const plugin of store().listDshPlugins()) store().setDshPluginActivation(plugin.name, null)
      return {}
    }
    try {
      seed()
      const selected = selectDshBindings(await host.mount(specs))
      bindings = selected.bindings
      const activations = selected.activations
      for (const [name, activation] of Object.entries(activations)) store().setDshPluginActivation(name, activation)
      return activations
    } catch (error) {
      hostError = error instanceof Error ? error.message : String(error)
      bindings = []
      throw error
    }
  }

  return {
    /** 挂给 pi 的工具绑定；宿主没跑或全部未激活时为空数组。 */
    bindings: () => bindings,
    host,

    list(): DshPluginRecord[] {
      return store().listDshPlugins()
    },

    state(): DshHostState {
      return { running: host.running, runtimeVersion: runtimeVersion || '未初始化', error: hostError }
    },

    async search(keyword: string, signal: AbortSignal): Promise<DshSearchHit[]> {
      const installed = new Map(store().listDshPlugins().map((plugin) => [plugin.name, plugin.version]))
      const hits = await installer().search(keyword, signal)
      return hits.map((hit) => ({ ...hit, installedVersion: installed.get(hit.name) }))
    },

    async install(name: string, range: string, signal: AbortSignal): Promise<DshInstallResult> {
      const { manifest, installPath, warnings } = await installer().install(name, range, signal)
      // 安装与启用分离：落地一律是停用态，必须用户显式启用。与 MCP 插件安装同一条约定。
      const previous = store().getDshPlugin(name)
      store().saveDshPlugin({
        name: manifest.name,
        version: manifest.version,
        displayName: manifest.name,
        description: manifest.description,
        author: manifest.author,
        homepage: manifest.homepage,
        installPath,
        mainEntry: manifest.main,
        enabled: previous?.enabled ?? false,
        inject: manifest.inject,
        config: previous?.config ?? {}
      })
      const activations = previous?.enabled ? await remount() : {}
      return { name: manifest.name, version: manifest.version, activation: activations[name] ?? null, warnings }
    },

    async uninstall(name: string) {
      installer().uninstall(name)
      store().removeDshPlugin(name)
      await remount()
    },

    async setEnabled(name: string, enabled: boolean) {
      store().setDshPluginEnabled(name, enabled)
      await remount()
    },

    async configure(name: string, config: Record<string, unknown>) {
      store().setDshPluginConfig(name, config)
      await remount()
    },

    remount
  }
}

export type DshService = ReturnType<typeof createDshService>
