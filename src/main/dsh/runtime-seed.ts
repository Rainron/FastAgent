import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'

/**
 * 把 dsh 运行时播种到插件目录下的 node_modules。
 *
 * 为什么非这么做不可：插件用 `import '@deepseek-ai/cordis'` 这种裸标识符，
 * Node 只会从插件文件所在目录逐级往上找 node_modules。插件装在用户数据目录，
 * 应用自己的 node_modules 不在它的上级链里，直接 import 必然失败。
 *
 * 更要命的是**同一实例**要求：宿主挂 ToolRuntime 用的 cordis 必须和插件 import 到的
 * 是同一份模块实例，否则 `ctx.plugin()` 跨实例失效。所以宿主也从这份播种目录动态 import，
 * 绝不能静态 import 应用自带的那份。
 */

/** 从这三个包出发扫真实 import，闭包就是运行时需要的全部。 */
export const SEED_ROOTS = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-system-prompt']

/** 运行时只需要这些扩展名；.d.ts 与 sourcemap 白占几倍体积。 */
const RUNTIME_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.json'])

const STAMP_FILE = '.fastagent-dsh-runtime.json'

/** 从一段 JS 里摘出裸模块标识符（相对路径与 node: 内置除外）。 */
export function collectBareSpecifiers(source: string): string[] {
  const found = new Set<string>()
  // 覆盖 `from 'x'`、副作用 `import 'x'`、动态 `import('x')` 与 `require('x')` 四种
  const pattern = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    const specifier = match[1]
    if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) continue
    found.add(packageNameOf(specifier))
  }
  return [...found]
}

/** `@scope/pkg/sub/path` → `@scope/pkg`；`pkg/sub` → `pkg`。 */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * 顺着真实 import 语句求闭包。
 * 不用 package.json 的 peerDependencies：那会把只做类型引用的包（dsh-agent、dsh-session 等）
 * 一起拖进来，白白多出几兆。
 */
export function collectSeedPackages(nodeModules: string, roots: readonly string[] = SEED_ROOTS): string[] {
  const seen = new Set<string>()
  const visit = (name: string) => {
    if (seen.has(name)) return
    const dir = join(nodeModules, name)
    if (!existsSync(join(dir, 'package.json'))) return
    seen.add(name)
    for (const file of walkFiles(dir)) {
      if (extname(file) !== '.js' && extname(file) !== '.mjs' && extname(file) !== '.cjs') continue
      if (file.endsWith('.d.ts')) continue
      for (const specifier of collectBareSpecifiers(readFileSync(file, 'utf8'))) {
        if (specifier !== name) visit(specifier)
      }
    }
  }
  for (const root of roots) visit(root)
  return [...seen].sort()
}

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walkFiles(path)
    else yield path
  }
}

function copyRuntimeFiles(from: string, to: string) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) {
      copyRuntimeFiles(source, target)
      continue
    }
    if (entry.name.endsWith('.d.ts') || !RUNTIME_EXTENSIONS.has(extname(entry.name))) continue
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, readFileSync(source))
  }
}

export interface SeedResult {
  /** 本次是否真的重新复制；已是目标版本时为 false */
  seeded: boolean
  packages: string[]
  runtimeVersion: string
}

/**
 * 确保插件目录下的 node_modules 里有当前版本的 dsh 运行时。
 * 版本戳对不上就整个重铺——dsh 明确会破坏兼容，留旧文件混着比重装风险大。
 */
export function ensureDshRuntime(
  appNodeModules: string,
  targetNodeModules: string,
  runtimeVersion: string,
  roots: readonly string[] = SEED_ROOTS
): SeedResult {
  const stampPath = join(targetNodeModules, STAMP_FILE)
  if (existsSync(stampPath)) {
    try {
      const stamp = JSON.parse(readFileSync(stampPath, 'utf8')) as { runtimeVersion?: string; packages?: string[] }
      if (stamp.runtimeVersion === runtimeVersion && Array.isArray(stamp.packages)) {
        return { seeded: false, packages: stamp.packages, runtimeVersion }
      }
    } catch {
      // 戳坏了当没有，往下重铺
    }
  }

  const packages = collectSeedPackages(appNodeModules, roots)
  if (!packages.length) throw new Error(`未能在 ${appNodeModules} 找到 dsh 运行时，应用安装可能不完整`)

  for (const name of packages) {
    const target = join(targetNodeModules, name)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    copyRuntimeFiles(join(appNodeModules, name), target)
  }

  mkdirSync(targetNodeModules, { recursive: true })
  writeFileSync(stampPath, JSON.stringify({ runtimeVersion, packages }, null, 2), 'utf8')
  return { seeded: true, packages, runtimeVersion }
}

/** 播种出的每个运行时包的版本；安装前判断插件 peer 是否兼容要用。 */
export function readSeedVersions(nodeModules: string, packages: readonly string[]): Record<string, string> {
  const versions: Record<string, string> = {}
  for (const name of packages) {
    try { versions[name] = readPackageVersion(nodeModules, name) } catch { /* 缺 version 的包不参与判断 */ }
  }
  return versions
}

/** 读某个已安装包的版本号，用作运行时版本戳。 */
export function readPackageVersion(nodeModules: string, name: string): string {
  const path = join(nodeModules, name, 'package.json')
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`缺少依赖 ${name}`)
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { version?: string }
  if (!parsed.version) throw new Error(`${name} 的 package.json 没有 version`)
  return parsed.version
}
