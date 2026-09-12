import type { HubQuery, HubSource } from '../../../shared/types'
import { fetchBuffer, fetchJson, type FetchLimits } from '../fetcher'
import { sortListings } from '../listing-filter'
import type { HubListingDetailDraft, HubListingDraft, InstallPayload, RegistryProvider } from '../types'

export const DEFAULT_SKILLSMP_URL = 'https://skillsmp.com'

/**
 * 该源索引的 skill 大量藏在巨型 monorepo 里（实测 openclaw/openclaw 的归档就超过 32MB 上限），
 * 所以这里按目录逐文件取，而不是像 Git 源那样拉整个仓库归档再切。
 */
const MAX_SKILL_FILES = 60
const MAX_SKILL_DEPTH = 4
const MAX_SKILL_FILE_BYTES = 1024 * 1024

/** SkillsMP 只做索引，不托管内容：安装时要回 GitHub 拉原仓库。 */
interface SkillsMpRecord {
  id?: unknown
  name?: unknown
  author?: unknown
  description?: unknown
  githubUrl?: unknown
  stars?: unknown
  updatedAt?: unknown
  branch?: unknown
  route?: {
    ownerSlug?: unknown
    repoSlug?: unknown
    sourceSkillPath?: unknown
  }
}

interface GithubContentEntry {
  name?: unknown
  type?: unknown
  size?: unknown
  download_url?: unknown
}

export interface SkillsMpDeps {
  fetchImpl?: typeof fetch
  limits?: Partial<FetchLimits>
  pageSize?: number
  /** 源上存的 API Key；该站当前不要求，但留出鉴权位。 */
  apiKey?: string | null
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** ref 要能独立还原出「哪个仓库、哪个分支、哪个目录」，否则安装时还得再查一次索引。 */
export function skillsMpRef(owner: string, repo: string, branch: string, skillDir: string) {
  return `${owner}/${repo}@${branch}:${skillDir}`
}

export function parseSkillsMpRef(ref: string): { owner: string; repo: string; branch: string; dir: string } | null {
  const match = ref.match(/^([^/]+)\/([^@]+)@([^:]+):(.*)$/)
  if (!match) return null
  return { owner: match[1], repo: match[2], branch: match[3], dir: match[4] }
}

/** `.agents/skills/foo/SKILL.md` → `.agents/skills/foo` */
function dirOfSkillPath(path: string) {
  return path.replace(/\\/g, '/').replace(/\/?SKILL\.md$/i, '').replace(/^\/+|\/+$/g, '')
}

function toDraft(record: SkillsMpRecord): HubListingDraft | null {
  const name = textOf(record.name)
  const owner = textOf(record.route?.ownerSlug)
  const repo = textOf(record.route?.repoSlug)
  const skillPath = textOf(record.route?.sourceSkillPath)
  if (!name || !owner || !repo || !skillPath) return null
  const branch = textOf(record.branch) ?? 'HEAD'
  const updatedAt = typeof record.updatedAt === 'number' ? new Date(record.updatedAt * 1000).toISOString() : undefined
  return {
    ref: skillsMpRef(owner, repo, branch, dirOfSkillPath(skillPath)),
    name,
    displayName: name,
    description: textOf(record.description) ?? '',
    abilityType: 'skill',
    author: textOf(record.author) ?? owner,
    version: '0.0.0',
    categories: [],
    tags: [],
    publishedAt: updatedAt,
    // stars 不是下载量，但它是这个站唯一的热度信号，用来给「热门」排序。
    trending: typeof record.stars === 'number' ? record.stars : undefined,
    repository: textOf(record.githubUrl) ?? `https://github.com/${owner}/${repo}`,
    // 索引站只给 SKILL.md 元信息，带不带 scripts/ 要列目录才知道，先按未知处理。
    permissions: UNKNOWN_PERMISSIONS,
    configFields: []
  }
}

/**
 * 索引站的搜索结果不足以判断这个 skill 会不会跑代码（实测 agent-transcript 就带 scripts/）。
 * 未知时按「会跑」呈现：安装前宁可多警示一次，也不能给出「只提供文本指令」这种假保证。
 */
const UNKNOWN_PERMISSIONS = { runsLocalCode: true, networkAccess: false, fileAccess: true }

/**
 * SkillsMP：GitHub 上 SKILL.md 的聚合索引。
 * 搜索走它的 API，安装绕开它直接回源仓库拉归档——它本身不托管文件。
 */
export class SkillsMpProvider implements RegistryProvider {
  readonly id: string
  readonly kind = 'skillsmp' as const
  readonly name: string
  private readonly baseUrl: string

  constructor(source: HubSource, private readonly deps: SkillsMpDeps = {}) {
    this.id = source.id
    this.name = source.name
    this.baseUrl = (source.url?.trim() || DEFAULT_SKILLSMP_URL).replace(/\/$/, '')
  }

  private headers() {
    return this.deps.apiKey ? { authorization: `Bearer ${this.deps.apiKey}` } : undefined
  }

  async search(query: HubQuery, signal: AbortSignal): Promise<HubListingDraft[]> {
    // 这个源只有 Skill，按别的类型筛选时不必打网络。
    if (query.abilityType && query.abilityType !== 'skill') return []
    const url = new URL(`${this.baseUrl}/api/skills`)
    const keyword = query.keyword?.trim()
    if (keyword) url.searchParams.set('q', keyword)
    url.searchParams.set('limit', String(query.limit ?? this.deps.pageSize ?? 24))
    const body = await fetchJson<{ skills?: unknown }>(url.href, { signal, limits: this.deps.limits, fetchImpl: this.deps.fetchImpl, headers: this.headers() })
    const records = Array.isArray(body.skills) ? body.skills as SkillsMpRecord[] : []
    const drafts = records.flatMap((record) => {
      const draft = toDraft(record)
      return draft ? [draft] : []
    })
    return sortListings(drafts, query.sort)
  }

  /**
   * ref 自带定位信息，详情不需要回查索引。
   * 但要额外列一次目录：安装弹层的权限告示以这里为准，必须说实话。
   */
  async detail(ref: string, signal: AbortSignal): Promise<HubListingDetailDraft> {
    const parsed = parseSkillsMpRef(ref)
    if (!parsed) throw new Error(`无法解析条目定位串：${ref}`)
    const name = parsed.dir.split('/').at(-1) ?? parsed.repo
    let permissions = UNKNOWN_PERMISSIONS
    try {
      const entries = await this.listDir(parsed.owner, parsed.repo, parsed.branch, parsed.dir, signal)
      const scripted = entries.some((entry) => entry.type === 'dir' && textOf(entry.name) === 'scripts')
      permissions = { runsLocalCode: scripted, networkAccess: false, fileAccess: scripted }
    } catch {
      // 列不到（限流等）就保持「未知即按会跑」，不改成更宽松的说法。
    }
    return {
      ref,
      name,
      displayName: name,
      description: `来自 ${parsed.owner}/${parsed.repo} 的 Skill`,
      abilityType: 'skill',
      author: parsed.owner,
      version: '0.0.0',
      categories: [],
      tags: [],
      repository: `https://github.com/${parsed.owner}/${parsed.repo}`,
      permissions,
      configFields: [],
      contents: [{ kind: 'skill', name }]
    }
  }

  private async listDir(owner: string, repo: string, branch: string, dir: string, signal: AbortSignal): Promise<GithubContentEntry[]> {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${dir.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`
    const body = await fetchJson<GithubContentEntry[] | GithubContentEntry>(url, {
      signal,
      limits: this.deps.limits,
      fetchImpl: this.deps.fetchImpl,
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'fastagent-desktop' }
    })
    return Array.isArray(body) ? body : [body]
  }

  /** 逐层取 GitHub 目录内容。只走该 skill 目录，不碰仓库其余部分。 */
  private async collect(
    owner: string,
    repo: string,
    branch: string,
    dir: string,
    signal: AbortSignal,
    into: Record<string, string>,
    prefix = '',
    depth = 0
  ): Promise<void> {
    if (depth > MAX_SKILL_DEPTH) return
    for (const entry of await this.listDir(owner, repo, branch, dir, signal)) {
      const name = textOf(entry.name)
      if (!name) continue
      if (Object.keys(into).length >= MAX_SKILL_FILES) throw new Error(`Skill 目录文件数超过 ${MAX_SKILL_FILES} 上限`)
      if (entry.type === 'dir') {
        await this.collect(owner, repo, branch, `${dir}/${name}`, signal, into, `${prefix}${name}/`, depth + 1)
        continue
      }
      if (entry.type !== 'file') continue
      const size = typeof entry.size === 'number' ? entry.size : 0
      if (size > MAX_SKILL_FILE_BYTES) throw new Error(`${prefix}${name} 超过单文件 ${MAX_SKILL_FILE_BYTES} 字节上限`)
      const downloadUrl = textOf(entry.download_url)
      if (!downloadUrl) continue
      const buffer = await fetchBuffer(downloadUrl, { signal, limits: this.deps.limits, fetchImpl: this.deps.fetchImpl })
      into[`${prefix}${name}`] = new TextDecoder('utf8').decode(buffer)
    }
  }

  async fetchPayload(ref: string, signal: AbortSignal): Promise<InstallPayload[]> {
    const parsed = parseSkillsMpRef(ref)
    if (!parsed) throw new Error(`无法解析条目定位串：${ref}`)
    const files: Record<string, string> = {}
    try {
      await this.collect(parsed.owner, parsed.repo, parsed.branch, parsed.dir, signal, files)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 未鉴权的 GitHub API 是每小时 60 次，撞限时给的是 403，直接透传太难懂。
      if (/请求失败 403/.test(message)) throw new Error('GitHub API 调用频率已达上限（未登录每小时 60 次），请稍后再试')
      throw error
    }
    if (!files['SKILL.md']) throw new Error(`${parsed.owner}/${parsed.repo} 的 ${parsed.dir} 下没有 SKILL.md`)
    return [{ kind: 'skill', files }]
  }
}
