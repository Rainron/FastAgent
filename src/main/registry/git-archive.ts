import type { HubListingContent, PluginConfigField, PluginPermissionNotice } from '../../shared/types'
import type { HubListingDetailDraft, InstallPayload } from './types'

/**
 * Git 仓库型源的解析：把一个仓库归档解析成目录条目 + 安装载荷。
 * 纯函数，输入是「相对路径 -> 文本」，不碰网络也不碰磁盘。
 *
 * 支持两种仓库形态：
 * 1. Claude Code 风格 marketplace：根目录有 `.claude-plugin/marketplace.json`，每条 plugin 是一个包；
 * 2. 纯 skills 仓库：没有 marketplace.json，扫 `skills/<name>/SKILL.md` 与 `<name>/SKILL.md`。
 */

export interface GitArchiveEntry {
  /** 相对仓库根的路径，已用 / 分隔 */
  path: string
  text: string
}

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** codeload 的归档统一带一层 `repo-ref/` 顶层目录，所有条目共享同一前缀时剥掉。 */
export function stripArchiveRoot(files: Record<string, string>): Record<string, string> {
  const paths = Object.keys(files)
  if (!paths.length) return {}
  const first = paths[0].split('/')[0]
  if (!first || !paths.every((path) => path.startsWith(`${first}/`))) return files
  return Object.fromEntries(paths.map((path) => [path.slice(first.length + 1), files[path]]))
}

function parseJson<T>(text: string | undefined): T | null {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function frontmatterOf(content: string): Record<string, string> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return null
  const fields: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (pair) fields[pair[1].toLowerCase()] = pair[2].trim().replace(/^["']|["']$/g, '')
  }
  return fields
}

export interface ParsedSkill {
  /** 相对仓库根的 skill 目录 */
  dir: string
  name: string
  description: string
  version?: string
  author?: string
  license?: string
}

/** 找出归档里所有合法的 skill 目录。深度不限，但 SKILL.md 必须直接位于该目录下。 */
export function findSkills(files: Record<string, string>): ParsedSkill[] {
  return Object.keys(files)
    .filter((path) => path.split('/').at(-1) === 'SKILL.md')
    .flatMap((path) => {
      const fields = frontmatterOf(files[path])
      const name = fields?.name
      const description = fields?.description
      if (!name || !description || !SKILL_NAME.test(name)) return []
      const dir = path.slice(0, -'SKILL.md'.length).replace(/\/$/, '')
      return [{ dir, name, description, version: fields.version, author: fields.author, license: fields.license }]
    })
    .sort((a, b) => a.dir.localeCompare(b.dir))
}

/** 把某个 skill 目录下的全部文件收成安装载荷，路径改为相对该目录。 */
export function skillPayload(files: Record<string, string>, dir: string): InstallPayload {
  const prefix = dir ? `${dir}/` : ''
  const payload: Record<string, string> = {}
  for (const [path, text] of Object.entries(files)) {
    if (!path.startsWith(prefix)) continue
    const relative = path.slice(prefix.length)
    // 只收该目录自身的内容，不把嵌套的另一个 skill 一起打包进来。
    if (relative !== 'SKILL.md' && relative.split('/').includes('SKILL.md')) continue
    payload[relative] = text
  }
  return { kind: 'skill', files: payload }
}

interface McpServerConfig {
  command?: unknown
  args?: unknown
  cwd?: unknown
  url?: unknown
  type?: unknown
  transport?: unknown
  timeoutMs?: unknown
}

/** 解析插件目录里的 `.mcp.json`（与 Claude Code 同格式：{ mcpServers: { name: {...} } }）。 */
export function mcpPayloads(text: string | undefined): InstallPayload[] {
  const parsed = parseJson<{ mcpServers?: Record<string, McpServerConfig> }>(text)
  const servers = parsed?.mcpServers
  if (!servers || typeof servers !== 'object') return []
  return Object.entries(servers).flatMap(([name, config]) => {
    if (!config || typeof config !== 'object') return []
    const url = typeof config.url === 'string' && config.url.trim() ? config.url.trim() : undefined
    const command = typeof config.command === 'string' && config.command.trim() ? config.command.trim() : undefined
    const transport = url || config.type === 'http' || config.transport === 'streamable_http' ? 'streamable_http' as const : 'stdio' as const
    if (transport === 'stdio' && !command) return []
    if (transport === 'streamable_http' && !url) return []
    return [{
      kind: 'mcp' as const,
      name,
      transport,
      command,
      args: Array.isArray(config.args) ? config.args.filter((item): item is string => typeof item === 'string') : undefined,
      cwd: typeof config.cwd === 'string' && config.cwd.trim() ? config.cwd.trim() : undefined,
      url,
      timeoutMs: typeof config.timeoutMs === 'number' && config.timeoutMs > 0 ? config.timeoutMs : 10_000
    }]
  })
}

interface MarketplaceManifest {
  name?: unknown
  owner?: { name?: unknown }
  plugins?: Array<{
    name?: unknown
    source?: unknown
    description?: unknown
    version?: unknown
    author?: unknown
    category?: unknown
    /** 显式列出该包包含哪些 skill 目录；多个包共用 `source: "./"` 时靠它区分 */
    skills?: unknown
  }>
}

interface PluginManifest {
  name?: unknown
  description?: unknown
  version?: unknown
  author?: unknown | { name?: unknown }
  homepage?: unknown
  repository?: unknown
  license?: unknown
  keywords?: unknown
}

/** `./skills/xlsx` / `./` / `skills/xlsx/` 一律归一成不带首尾斜杠的相对路径。 */
function relativeDir(value: string) {
  return value.trim().replace(/^\.\/?/, '').replace(/\/+$/, '')
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function authorOf(value: unknown): string | undefined {
  if (typeof value === 'string') return textOf(value)
  if (value && typeof value === 'object') return textOf((value as { name?: unknown }).name)
  return undefined
}

/** 归档里一个「包目录」的解析结果：条目元信息 + 该包能装出来的全部能力。 */
export interface ParsedPackage {
  ref: string
  detail: HubListingDetailDraft
  payloads: InstallPayload[]
}

/** Git 源的条目不声明配置项；需要密钥的 MCP 由用户装完后在能力页补。 */
const NO_CONFIG: PluginConfigField[] = []

/**
 * MCP Server 一定要跑本地进程或联网，安装前必须明说。
 * Skill 只是文本，除非它带了 scripts/ 才算会跑代码。
 */
function permissionsOf(payloads: InstallPayload[], files: Record<string, string>, skillDirs: string[]): PluginPermissionNotice {
  const stdio = payloads.some((payload) => payload.kind === 'mcp' && payload.transport === 'stdio')
  const http = payloads.some((payload) => payload.kind === 'mcp' && payload.transport === 'streamable_http')
  const cli = payloads.some((payload) => payload.kind === 'cli')
  // 只看真正会被装进来的 skill 目录：包目录下没被选中的兄弟 skill 带不带脚本与本条目无关。
  const hasScripts = skillDirs.some((dir) => {
    const prefix = dir ? `${dir}/` : ''
    return Object.keys(files).some((path) => path.startsWith(prefix) && /(^|\/)scripts\//.test(path.slice(prefix.length)))
  })
  return {
    runsLocalCode: stdio || cli || hasScripts,
    networkAccess: http || stdio,
    fileAccess: stdio || cli,
    commands: payloads.flatMap((payload) => (payload.kind === 'mcp' && payload.command ? [payload.command] : payload.kind === 'cli' ? [payload.executable] : []))
  }
}

function contentsOf(payloads: InstallPayload[], skills: ParsedSkill[]): HubListingContent[] {
  const fromPayloads = payloads.flatMap<HubListingContent>((payload) =>
    payload.kind === 'skill' ? [] : [{ kind: payload.kind, name: payload.name }])
  return [
    ...skills.map<HubListingContent>((skill) => ({ kind: 'skill', name: skill.name, description: skill.description })),
    ...fromPayloads
  ]
}

interface PackageOptions {
  /** 目录里查 plugin.json / .mcp.json / README 的基准路径 */
  dir: string
  /** 条目在源上的定位串。marketplace 里多个包可能共用同一个 dir，ref 必须另取。 */
  ref?: string
  /** 显式限定要收哪些 skill 目录；不传则收 dir 下的全部 */
  skillDirs?: string[]
  overrides?: { name?: string; description?: string; version?: string; author?: string; categories?: string[] }
}

function packageAt(files: Record<string, string>, options: PackageOptions): ParsedPackage | null {
  const { dir, skillDirs } = options
  const overrides = options.overrides ?? {}
  const ref = options.ref ?? dir
  const prefix = dir ? `${dir}/` : ''
  const manifest = parseJson<PluginManifest>(files[`${prefix}.claude-plugin/plugin.json`])
  const allSkills = findSkills(files)
  const skills = skillDirs
    ? skillDirs.flatMap((target) => allSkills.filter((skill) => skill.dir === target))
    : allSkills.filter((skill) => skill.dir === dir || skill.dir.startsWith(prefix))
  const payloads: InstallPayload[] = [
    ...skills.map((skill) => skillPayload(files, skill.dir)),
    ...mcpPayloads(files[`${prefix}.mcp.json`])
  ]
  if (!payloads.length) return null

  const name = overrides.name ?? textOf(manifest?.name) ?? skills[0]?.name ?? dir.split('/').at(-1) ?? dir
  const description = overrides.description
    ?? textOf(manifest?.description)
    ?? (skills.length === 1 ? skills[0].description : `包含 ${contentsOf(payloads, skills).length} 项能力`)
  const keywords = Array.isArray(manifest?.keywords) ? manifest.keywords.filter((item): item is string => typeof item === 'string') : []
  const primary = skills.length ? 'skill' as const : payloads[0].kind === 'cli' ? 'cli' as const : 'mcp' as const
  return {
    ref,
    payloads,
    detail: {
      ref,
      name,
      displayName: name,
      description,
      abilityType: primary,
      author: overrides.author ?? authorOf(manifest?.author) ?? skills[0]?.author,
      version: overrides.version ?? textOf(manifest?.version) ?? skills[0]?.version ?? '0.0.0',
      categories: overrides.categories ?? [],
      tags: keywords,
      homepage: textOf(manifest?.homepage),
      repository: textOf(manifest?.repository),
      permissions: permissionsOf(payloads, files, skills.map((skill) => skill.dir)),
      configFields: NO_CONFIG,
      readme: files[`${prefix}README.md`],
      contents: contentsOf(payloads, skills)
    }
  }
}

/**
 * 解析整个归档。marketplace.json 里 source 指向别的仓库的条目会被跳过——
 * 那是另一个源的内容，用户应该把那个仓库单独加成源，而不是由我们递归下载。
 */
export function parseGitArchive(rawFiles: Record<string, string>): ParsedPackage[] {
  const files = stripArchiveRoot(rawFiles)
  const marketplace = parseJson<MarketplaceManifest>(files['.claude-plugin/marketplace.json'])
  if (marketplace && Array.isArray(marketplace.plugins)) {
    return marketplace.plugins.flatMap((entry) => {
      const source = textOf(entry.source)
      // 只有相对路径的 source 才在本归档里；`owner/repo` 或 git URL 一律跳过。
      if (!source || !source.startsWith('.')) return []
      const dir = relativeDir(source)
      const name = textOf(entry.name)
      const skillDirs = Array.isArray(entry.skills)
        ? entry.skills.filter((item): item is string => typeof item === 'string').map(relativeDir)
        : undefined
      const parsed = packageAt(files, {
        dir,
        // 多个包共用 `source: "./"` 时（anthropics/skills 就是这样），dir 区分不开，用包名当 ref。
        ref: name || dir,
        skillDirs,
        overrides: {
          name,
          description: textOf(entry.description),
          version: textOf(entry.version),
          author: authorOf(entry.author),
          categories: textOf(entry.category) ? [textOf(entry.category) as string] : []
        }
      })
      return parsed ? [parsed] : []
    })
  }
  // 没有 marketplace.json：整个仓库当 skills 集合，一个 skill 目录一条。
  return findSkills(files).flatMap((skill) => {
    const parsed = packageAt(files, { dir: skill.dir, skillDirs: [skill.dir] })
    return parsed ? [parsed] : []
  })
}
