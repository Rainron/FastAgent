import { compareVersions } from '../plugins/semver'
import type { DshCompat } from '../../shared/types'
import { checkDshPackage, satisfiesCordisRange, type DshPackageJson } from './manifest'

/** npm registry 的 packument，只取用得上的字段。 */
export interface Packument {
  'dist-tags'?: Record<string, string>
  versions?: Record<string, PackumentVersion>
}

export interface PackumentVersion {
  version?: string
  dist?: { tarball?: string }
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  scripts?: Record<string, string>
  gypfile?: boolean
}

export const NPM_REGISTRY = 'https://registry.npmjs.org'

/** 作用域包名里的 `/` 要转义，否则会被 registry 当成路径段。 */
export function packumentUrl(name: string, registry = NPM_REGISTRY): string {
  return `${registry}/${name.replace('/', '%2f')}`
}

/**
 * 在 packument 里挑一个满足 range 的版本。
 * range 判定沿用 satisfiesCordisRange 的极简规则（主版本一致 + 不低于下限），
 * 这里不做完整 semver：装的是插件自己的依赖，选最高可用版本即可。
 */
export function resolveVersion(packument: Packument, range = 'latest'): string | null {
  const tags = packument['dist-tags'] ?? {}
  const available = Object.keys(packument.versions ?? {})
  if (!available.length) return null
  if (tags[range]) return tags[range]
  if (range === '*' || range === '') return tags.latest ?? highest(available)

  const exact = available.find((version) => version === range.replace(/^[=v]\s*/, ''))
  if (exact) return exact

  const matched = available.filter((version) => satisfiesCordisRange(range, version))
  return matched.length ? highest(matched) : null
}

function highest(versions: string[]): string {
  return [...versions].sort(compareVersions)[versions.length - 1]
}

/**
 * 带原生扩展的包装不了：宿主不跑 node-gyp，也不该替用户编译任意 C++。
 * 安装前按 packument 的元数据先拦一道，避免下完了才发现装不上。
 */
export function rejectsNativeBuild(version: PackumentVersion): string | null {
  if (version.gypfile) return '包含原生扩展（gypfile），当前不支持'
  const scripts = version.scripts ?? {}
  for (const hook of ['install', 'preinstall', 'postinstall'] as const) {
    if (scripts[hook]) return `声明了 ${hook} 安装脚本，出于安全考虑不执行，因此无法安装`
  }
  return null
}

/**
 * 把一个包的普通依赖摊平成待装清单。
 * peerDependencies 由宿主满足（dsh 插件的 cordis 与 dsh-* 都在这里），一律跳过。
 */
export function runtimeDependencies(version: PackumentVersion): Record<string, string> {
  return { ...version.dependencies }
}

/**
 * 安装前的兼容性预判，输入是 registry 上最新版的元数据（就是那一版的 package.json 加 dist 等字段）。
 * 与安装时走同一套检查，搜索结果上给出的结论和点「安装」后的结果才不会自相矛盾。
 */
export function assessDshCompat(meta: DshPackageJson & PackumentVersion, hostCordisVersion: string, hostPackages: Readonly<Record<string, string>>): DshCompat {
  const native = rejectsNativeBuild(meta)
  if (native) return { level: 'block', reasons: [native] }
  const check = checkDshPackage(meta, hostCordisVersion, hostPackages)
  if (!check.ok) return { level: 'block', reasons: [check.reason] }
  return check.warnings.length ? { level: 'warn', reasons: check.warnings } : { level: 'ok', reasons: [] }
}
