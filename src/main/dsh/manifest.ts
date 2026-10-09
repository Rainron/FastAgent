import { isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { compareVersions } from '../plugins/semver'
import { satisfiesRange } from './semver-range'

/** package.json 里我们关心的那几个字段。其余一律忽略。 */
export interface DshPackageJson {
  name?: unknown
  version?: unknown
  description?: unknown
  type?: unknown
  main?: unknown
  author?: unknown
  homepage?: unknown
  keywords?: unknown
  dependencies?: unknown
  peerDependencies?: unknown
}

export const CORDIS_PACKAGE = '@deepseek-ai/cordis'

export type DshManifestCheck =
  /** warnings 不挡安装，但要让用户知道挂载时可能出问题 */
  | { ok: true; manifest: DshManifest; warnings: string[] }
  | { ok: false; reason: string }

export interface DshManifest {
  name: string
  version: string
  description: string
  author?: string
  homepage?: string
  /** main 字段的相对路径，未声明时按 Node 惯例回落 index.js */
  main: string
  inject: string[]
  /** peerDependencies 里声明的 cordis 版本区间 */
  cordisRange: string
  /** 需要递归安装的普通依赖；peerDependencies 由宿主满足，不在其中 */
  dependencies: Record<string, string>
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') result[key] = raw
  }
  return result
}

/**
 * Cordis 的 inject 有两种写法：`['tools']` 与 `{ required: [...], optional: [...] }`。
 * 只有 required 会挡住激活，optional 缺了插件照样跑，所以这里只收 required。
 */
export function parseInjectList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (value && typeof value === 'object') {
    return parseInjectList((value as { required?: unknown }).required)
  }
  return []
}

/** 区间里每个分支的下限版本都与宿主同一大版本且不高于宿主。 */
function sameMajorAndNotOlder(range: string, hostVersion: string): boolean {
  const major = (value: string) => value.split('.', 1)[0]
  const bases = range.split('||').map((part) => part.trim().replace(/^[\^~>=v\s]+/, '').split(/\s+/)[0]).filter(Boolean)
  return bases.length > 0 && bases.some((base) => major(base) === major(hostVersion) && compareVersions(hostVersion, base) >= 0)
}

/**
 * range 判定走 npm 语义（见 semver-range）；遇到看不懂的写法才退回旧的极简判法：
 * 主版本一致 + 不低于下限，只拦明显跨大版本的包。
 */
export function satisfiesCordisRange(range: string, hostVersion: string): boolean {
  const exact = satisfiesRange(range, hostVersion, { includePrerelease: true })
  if (exact !== null) return exact
  const base = range.replace(/^[\^~>=v\s]+/, '').trim()
  if (!base) return true
  const major = (value: string) => value.split('.', 1)[0]
  if (major(base) !== major(hostVersion)) return false
  return compareVersions(hostVersion, base) >= 0
}

/**
 * 判定一个已解包的 npm 包是不是可挂载的 dsh 插件。
 * 拒绝的理由要能直接显示给用户，所以每条都写成一句话。
 */
export function checkDshPackage(pkg: DshPackageJson, hostCordisVersion: string, hostPackages: Readonly<Record<string, string>> = {}): DshManifestCheck {
  const name = asString(pkg.name)
  const version = asString(pkg.version)
  if (!name || !version) return { ok: false, reason: 'package.json 缺少 name 或 version' }
  if (pkg.type !== 'module') return { ok: false, reason: `${name} 不是 ESM 包（package.json 的 type 不是 module），dsh 插件必须是 ESM` }

  const peers = asRecord(pkg.peerDependencies)
  const cordisRange = peers[CORDIS_PACKAGE]
  if (!cordisRange && peers.cordis) return { ok: false, reason: `${name} 依赖的是旧的 cordis 包而不是 ${CORDIS_PACKAGE}，当前宿主无法加载` }
  if (!cordisRange) return { ok: false, reason: `${name} 的 peerDependencies 里没有 ${CORDIS_PACKAGE}，不是 dsh 插件` }
  const warnings: string[] = []
  if (!satisfiesCordisRange(cordisRange, hostCordisVersion)) {
    // 钉死的旧补丁版（如 4.0.1）不该挡住同一大版本里更新的宿主：npm 对 peer 不符也只是警告
    if (!sameMajorAndNotOlder(cordisRange, hostCordisVersion)) {
      return { ok: false, reason: `${name} 要求 cordis ${cordisRange}，当前宿主是 ${hostCordisVersion}，版本不兼容` }
    }
    warnings.push(`声明需要 cordis ${cordisRange}，当前宿主是 ${hostCordisVersion}（同一大版本），通常可用`)
  }

  return {
    ok: true,
    warnings: [...warnings, ...dshPeerWarnings(peers, hostPackages)],
    manifest: {
      name,
      version,
      description: asString(pkg.description) ?? '',
      author: typeof pkg.author === 'string' ? pkg.author : asString((pkg.author as { name?: unknown } | undefined)?.name),
      homepage: asString(pkg.homepage),
      main: asString(pkg.main) ?? 'index.js',
      // inject 声明在模块源码里而不是 package.json，挂载后才知道真实值；这里先给空。
      inject: [],
      cordisRange,
      dependencies: asRecord(pkg.dependencies)
    }
  }
}

/**
 * cordis 之外的 dsh peer：宿主播种了但版本对不上的、宿主根本没有的，分别说明。
 * 只提醒不拦截——peer 里常混着只在浏览器端用到的包，真正挡住激活的是挂载时的 inject 检查。
 * 未传入宿主包清单时无从判断，不产生提醒。
 */
export function dshPeerWarnings(peers: Readonly<Record<string, string>>, hostPackages: Readonly<Record<string, string>>): string[] {
  if (!Object.keys(hostPackages).length) return []
  const warnings: string[] = []
  const missing: string[] = []
  for (const [peer, range] of Object.entries(peers)) {
    if (peer === CORDIS_PACKAGE || !peer.startsWith('@deepseek-ai/')) continue
    const hostVersion = hostPackages[peer]
    if (!hostVersion) { missing.push(peer.replace('@deepseek-ai/', '')); continue }
    if (satisfiesRange(range, hostVersion, { includePrerelease: true }) === false) warnings.push(`需要 ${peer.replace('@deepseek-ai/', '')} ${range}，当前宿主是 ${hostVersion}，接口可能不兼容`)
  }
  if (missing.length) warnings.push(`依赖宿主未提供的 ${missing.join('、')}，可能无法激活`)
  return warnings
}

/** 插件 inject 了宿主没提供的服务时，Cordis 会挂起 fiber。返回缺的那几个。 */
export function missingServices(inject: string[], provided: readonly string[]): string[] {
  const available = new Set(provided)
  return inject.filter((name) => !available.has(name))
}

/**
 * 把 main 解析成绝对路径，并确保它没跑出包目录。
 * main 来自第三方 package.json，`"main": "../../etc/passwd"` 这种必须挡掉。
 */
export function resolvePluginEntry(packageDir: string, main: string): string | null {
  if (isAbsolute(main)) return null
  const root = resolve(packageDir)
  const entry = resolve(root, main)
  return entry === root || entry.startsWith(root + sep) ? entry : null
}

/** npm 包名转安装目录名：作用域包的 `/` 不能直接进路径。 */
export function packageDirName(name: string): string {
  return name.replace('/', '+')
}

/** 校验 npm 包名，挡掉能穿出安装目录的名字。 */
export function isValidPackageName(name: string): boolean {
  return /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)
}

export function pluginInstallDir(root: string, name: string): string {
  return normalize(join(root, packageDirName(name)))
}
