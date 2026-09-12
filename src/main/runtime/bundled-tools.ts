import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

/**
 * 内置工具链：随包二进制在首次启动时安装到数据根（`.fa`）下的 runtime 目录，
 * 之后一切解析都只依赖 `.fa`，与安装目录位置无关（数据根可被 locator 迁走）。
 *
 * 装完只做一件事：把 runtime 的 bin 目录前置进主进程 PATH。这一个动作同时覆盖三条路径——
 * pi 的 `ensureTool`（先查 agentDir/bin，再查 PATH，最后才联网下载）、
 * shell 工具的子进程（env 由主进程 PATH 清洗而来）、doctor 探测。
 * 系统 PATH 不做任何修改。
 */

/** 随包 runtime 的平台目录名，与 scripts/fetch-runtime.mjs 的输出目录一致。 */
export function runtimePlatformKey(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`
}

/** 打包后随包 runtime 在 resources/runtime，开发态取仓库内的 resources/runtime。 */
export function resolveBundledRuntimeSource(options: { resourcesPath: string; projectRoot: string; packaged: boolean; platformKey?: string }): string {
  const root = options.packaged ? join(options.resourcesPath, 'runtime') : join(options.projectRoot, 'resources', 'runtime')
  return join(root, options.platformKey ?? runtimePlatformKey())
}

/** 安装位置：数据根下的 runtime，与 sessions / agent / skills 同级。 */
export function resolveRuntimeInstallDir(dataRoot: string): string {
  return join(dataRoot, 'runtime')
}

export interface RuntimeToolEntry {
  version: string
  /** 相对 runtime 目录的可执行文件路径，如 bin/rg.exe、git/cmd/git.exe */
  path: string
  sha256: string
  /**
   * 是否把所在目录挂进 PATH，缺省为 true。
   * bash 显式设为 false：它在 git/usr/bin 下，把那个目录挂上去会让 PowerShell 会话里的
   * find / sort / date 被 MSYS 版本遮蔽；bash 由 shell-resolver 按绝对路径调用。
   */
  pathEntry?: boolean
}

export interface RuntimeManifest {
  runtimeVersion: string
  tools: Record<string, RuntimeToolEntry>
}

/** 清单解析容错：读不懂就当没有内置工具，回落到 pi 原有解析链，不能让启动挂掉。 */
export function parseRuntimeManifest(raw: string): RuntimeManifest | null {
  try {
    const value = JSON.parse(raw) as Partial<RuntimeManifest>
    if (!value || typeof value !== 'object' || !value.tools || typeof value.tools !== 'object') return null
    const tools: Record<string, RuntimeToolEntry> = {}
    for (const [name, entry] of Object.entries(value.tools)) {
      if (!entry || typeof entry !== 'object') continue
      const { version, path, sha256, pathEntry } = entry as Partial<RuntimeToolEntry>
      if (typeof version !== 'string' || typeof path !== 'string' || typeof sha256 !== 'string') continue
      tools[name] = { version, path, sha256, ...(pathEntry === false ? { pathEntry: false } : {}) }
    }
    return { runtimeVersion: typeof value.runtimeVersion === 'string' ? value.runtimeVersion : 'unknown', tools }
  } catch {
    return null
  }
}

/**
 * 要不要重装。MinGit 是几千个文件的目录树，逐文件比对不划算，
 * 按 runtimeVersion 整体判断：随包版本变了就整份换掉。
 */
export function needsRuntimeInstall(bundled: RuntimeManifest, installed: RuntimeManifest | null, executablesPresent: boolean): boolean {
  if (!installed) return true
  if (installed.runtimeVersion !== bundled.runtimeVersion) return true
  const names = Object.keys(bundled.tools)
  if (names.some((name) => installed.tools[name]?.version !== bundled.tools[name].version)) return true
  // 版本对得上但文件被杀软删了，同样要重装
  return !executablesPresent
}

/** 需要进 PATH 的目录：所有工具可执行文件所在目录去重，顺序稳定（跟清单里的出现顺序）。 */
export function runtimePathEntries(manifest: RuntimeManifest, installDir: string): string[] {
  const seen = new Set<string>()
  const entries: string[] = []
  for (const tool of Object.values(manifest.tools)) {
    if (tool.pathEntry === false) continue
    const dir = dirname(join(installDir, ...tool.path.split('/')))
    if (seen.has(dir)) continue
    seen.add(dir)
    entries.push(dir)
  }
  return entries
}

/**
 * 把 runtime 目录前置进 PATH。Windows 上环境变量键名大小写不定（Path / PATH），
 * 必须按大小写不敏感找到既有键再改，否则会出现两个键同时存在、子进程只认其中一个。
 */
export function prependPathEntries(env: Record<string, string>, entries: readonly string[], separator = delimiter): Record<string, string> {
  if (!entries.length) return env
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH'
  const current = env[key] ?? ''
  const existing = new Set(current.split(separator).filter(Boolean))
  const missing = entries.filter((entry) => !existing.has(entry))
  if (!missing.length) return env
  return { ...env, [key]: current ? `${missing.join(separator)}${separator}${current}` : missing.join(separator) }
}

/** 安装后落在 runtime 目录里的清单副本，用于判断已装版本。 */
export const INSTALLED_MANIFEST_FILE = 'manifest.json'

/** 第三方组件声明，由 scripts/fetch-runtime.mjs 生成，随 runtime 一起复制到数据根。 */
export const RUNTIME_NOTICES_FILE = 'THIRD-PARTY-NOTICES.md'

export interface RuntimeInstallResult {
  /** 本次是否真的复制了文件 */
  installed: boolean
  /** 工具名 → 绝对路径，只包含文件确实存在的 */
  tools: Record<string, string>
  /** 要前置进 PATH 的目录 */
  pathEntries: string[]
}

const EMPTY_RESULT: RuntimeInstallResult = { installed: false, tools: {}, pathEntries: [] }

function readManifestFile(path: string): RuntimeManifest | null {
  if (!existsSync(path)) return null
  try {
    return parseRuntimeManifest(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * 安装随包 runtime 到数据根。任何一步失败都只是回落到 pi 的联网下载与系统 PATH，
 * 内置工具是加速与离线保障，不是运行的必要条件。
 */
export function installBundledRuntime(options: { sourceDir: string; installDir: string; force?: boolean }): RuntimeInstallResult {
  const bundled = readManifestFile(join(options.sourceDir, INSTALLED_MANIFEST_FILE))
  if (!bundled) return EMPTY_RESULT
  const absolute = (entry: RuntimeToolEntry) => join(options.installDir, ...entry.path.split('/'))
  const allPresent = Object.values(bundled.tools).every((entry) => existsSync(absolute(entry)))
  const installedManifest = readManifestFile(join(options.installDir, INSTALLED_MANIFEST_FILE))
  let installed = false
  // force 用于设置页的「修复」：文件被替换或损坏时版本号仍对得上，只能整份重装。
  if (options.force || needsRuntimeInstall(bundled, installedManifest, allPresent)) {
    // 先删再拷：旧版本残留的文件（比如上个 MinGit 的 dll）留着会和新版本混在一起。
    rmSync(options.installDir, { recursive: true, force: true })
    mkdirSync(dirname(options.installDir), { recursive: true })
    cpSync(options.sourceDir, options.installDir, { recursive: true })
    installed = true
  }
  const tools: Record<string, string> = {}
  for (const [name, entry] of Object.entries(bundled.tools)) {
    const path = absolute(entry)
    if (existsSync(path)) tools[name] = path
  }
  return { installed, tools, pathEntries: runtimePathEntries(bundled, options.installDir) }
}
