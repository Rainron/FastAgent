import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fetchBuffer, fetchJson } from '../registry/fetcher'
import { checkDshPackage, isValidPackageName, pluginInstallDir, type DshManifest, type DshPackageJson } from './manifest'
import { assessDshCompat, NPM_REGISTRY, packumentUrl, rejectsNativeBuild, resolveVersion, runtimeDependencies, type Packument, type PackumentVersion } from './npm-registry'
import type { DshCompat } from '../../shared/types'
import { extractNpmTarball } from './tar'

export interface DshInstallerOptions {
  /** 插件根目录，通常是 appPaths.dshPluginsDir */
  root: string
  /** 宿主播种的 cordis 版本，用来判定插件兼容性 */
  hostCordisVersion: string
  /** 播种的全部运行时包版本，用来提醒其他 dsh peer 的兼容性；缺省不提醒 */
  hostPackages?: Readonly<Record<string, string>>
  registry?: string
  fetchImpl?: typeof fetch
}

export interface InstalledPlugin {
  manifest: DshManifest
  installPath: string
  warnings: string[]
}

/** 搜索结果逐个拉最新版元数据做兼容预判：并发上限与单个超时都压小，慢的那个不拖住整页结果。 */
const COMPAT_CONCURRENCY = 8
const COMPAT_TIMEOUT_MS = 8_000

/** 一个插件最多带这么多层依赖，挡住畸形 packument 造出的无限展开。 */
const MAX_DEPENDENCIES = 200

export class DshInstaller {
  private readonly registry: string

  constructor(private readonly options: DshInstallerOptions) {
    this.registry = options.registry ?? NPM_REGISTRY
  }

  /**
   * 装一个 dsh 插件及其普通依赖。
   * peerDependencies 一律不装：cordis 与 dsh-* 由宿主播种目录提供，
   * 装第二份会造出两个 cordis 实例，`ctx.plugin()` 当场失效。
   */
  async install(name: string, range: string, signal: AbortSignal): Promise<InstalledPlugin> {
    if (!isValidPackageName(name)) throw new Error(`非法的 npm 包名：${name}`)
    const { version, meta } = await this.resolve(name, range, signal)

    const files = await this.download(meta, signal)
    const packageJson = readPackageJson(files, name)
    const check = checkDshPackage(packageJson, this.options.hostCordisVersion, this.options.hostPackages)
    if (!check.ok) throw new Error(check.reason)

    const installPath = pluginInstallDir(this.options.root, name)
    // 重装先清干净：dsh 会破坏兼容，残留旧文件比重下一遍风险大
    rmSync(installPath, { recursive: true, force: true })
    writeFiles(installPath, files)

    await this.installDependencies(check.manifest, installPath, signal)
    return { manifest: { ...check.manifest, version }, installPath, warnings: check.warnings }
  }

  uninstall(name: string): void {
    if (!isValidPackageName(name)) throw new Error(`非法的 npm 包名：${name}`)
    rmSync(pluginInstallDir(this.options.root, name), { recursive: true, force: true })
  }

  /** 在 npm registry 上按关键字找插件；registry 的 text search 直接可用。 */
  async search(keyword: string, signal: AbortSignal): Promise<Array<{ name: string; version: string; description: string; author?: string; publishedAt?: string; homepage?: string; compat?: DshCompat }>> {
    const url = `${this.registry}/-/v1/search?text=${encodeURIComponent(keyword)}&size=50`
    const payload = await fetchJson<{ objects?: Array<{ package?: Record<string, unknown> }> }>(url, { signal, fetchImpl: this.options.fetchImpl })
    const hits = (payload.objects ?? []).flatMap((item) => {
      const pkg = item.package ?? {}
      const name = typeof pkg.name === 'string' ? pkg.name : null
      if (!name) return []
      return [{
        name,
        version: typeof pkg.version === 'string' ? pkg.version : '',
        description: typeof pkg.description === 'string' ? pkg.description : '',
        author: typeof (pkg.publisher as { username?: string } | undefined)?.username === 'string' ? (pkg.publisher as { username: string }).username : undefined,
        publishedAt: typeof pkg.date === 'string' ? pkg.date : undefined,
        homepage: typeof (pkg.links as { homepage?: string } | undefined)?.homepage === 'string' ? (pkg.links as { homepage: string }).homepage : undefined
      }]
    })
    const compat = await mapLimit(hits, COMPAT_CONCURRENCY, (hit) => this.assess(hit.name, signal))
    return hits.map((hit, index) => compat[index] ? { ...hit, compat: compat[index] } : hit)
  }

  /** 单个包的兼容预判；拉不到元数据就不下结论（返回 undefined），不能把网络问题说成「不兼容」。 */
  private async assess(name: string, signal: AbortSignal): Promise<DshCompat | undefined> {
    if (!isValidPackageName(name) || signal.aborted) return undefined
    try {
      const meta = await fetchJson<DshPackageJson & PackumentVersion>(`${packumentUrl(name, this.registry)}/latest`, {
        signal,
        fetchImpl: this.options.fetchImpl,
        limits: { timeoutMs: COMPAT_TIMEOUT_MS, maxBytes: 2 * 1024 * 1024 }
      })
      return assessDshCompat(meta, this.options.hostCordisVersion, this.options.hostPackages ?? {})
    } catch {
      return undefined
    }
  }

  private async resolve(name: string, range: string, signal: AbortSignal) {
    const packument = await fetchJson<Packument>(packumentUrl(name, this.registry), { signal, fetchImpl: this.options.fetchImpl })
    const version = resolveVersion(packument, range)
    if (!version) throw new Error(`${name} 没有满足 ${range} 的版本`)
    const meta = packument.versions?.[version]
    if (!meta?.dist?.tarball) throw new Error(`${name}@${version} 缺少下载地址`)
    const rejection = rejectsNativeBuild(meta)
    if (rejection) throw new Error(`${name}@${version} ${rejection}`)
    return { version, meta }
  }

  private async download(meta: PackumentVersion, signal: AbortSignal) {
    const buffer = await fetchBuffer(meta.dist!.tarball!, { signal, fetchImpl: this.options.fetchImpl })
    return extractNpmTarball(buffer)
  }

  /**
   * 把全部传递依赖摊平装进插件自己的 node_modules。
   * 扁平化后先到先得：插件的依赖树通常很浅，为版本冲突再搭一层嵌套不值得。
   */
  private async installDependencies(manifest: DshManifest, installPath: string, signal: AbortSignal) {
    const pending = Object.entries(manifest.dependencies)
    const done = new Set<string>()
    while (pending.length) {
      if (done.size >= MAX_DEPENDENCIES) throw new Error(`${manifest.name} 的依赖超过 ${MAX_DEPENDENCIES} 个，拒绝安装`)
      const [name, range] = pending.shift()!
      if (done.has(name) || !isValidPackageName(name)) continue
      done.add(name)

      const { meta } = await this.resolve(name, range, signal)
      const files = await this.download(meta, signal)
      writeFiles(join(installPath, 'node_modules', name), files)
      pending.push(...Object.entries(runtimeDependencies(meta)))
    }
  }
}

function readPackageJson(files: Record<string, Uint8Array>, name: string): DshPackageJson {
  const raw = files['package.json']
  if (!raw) throw new Error(`${name} 的包里没有 package.json`)
  try {
    return JSON.parse(new TextDecoder('utf8').decode(raw)) as DshPackageJson
  } catch {
    throw new Error(`${name} 的 package.json 不是合法 JSON`)
  }
}

function writeFiles(dir: string, files: Record<string, Uint8Array>) {
  for (const [path, content] of Object.entries(files)) {
    // 装的是原生扩展就当场停手：宿主不跑 node-gyp，留着只会在挂载时炸
    if (path.endsWith('.node')) throw new Error(`包内含原生扩展 ${path}，当前不支持`)
    const target = join(dir, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
}

/** 按并发上限逐个处理，结果与输入同序。 */
async function mapLimit<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(lanes)
  return results
}
