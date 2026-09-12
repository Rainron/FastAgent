import type { HubQuery, HubSource } from '../../../shared/types'
import { extractArchive, fetchBuffer, type FetchLimits } from '../fetcher'
import { parseGitArchive, type ParsedPackage } from '../git-archive'
import { matchesHubQuery, sortListings } from '../listing-filter'
import type { HubListingDetailDraft, HubListingDraft, InstallPayload, RegistryProvider } from '../types'

/**
 * 仓库地址 → 归档下载地址。走各托管方的 archive 端点而不是 `git clone`：
 * 桌面端不能假设用户机器上有 git，且归档是单次 HTTP，能套用统一的大小与重定向限制。
 */
export function archiveUrlFor(repoUrl: string, ref?: string): string {
  const trimmed = repoUrl.trim().replace(/\.git$/, '').replace(/\/$/, '')
  if (/\.zip$/i.test(trimmed)) return trimmed
  const url = new URL(trimmed)
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length < 2) throw new Error(`无法从仓库地址推断归档地址：${repoUrl}`)
  const [owner, repo] = segments
  // 缺省用 HEAD：codeload / GitLab 都接受，不需要先探出默认分支名。
  const target = ref?.trim() || 'HEAD'
  const host = url.hostname.toLowerCase()
  if (host === 'github.com' || host === 'www.github.com') return `https://codeload.github.com/${owner}/${repo}/zip/${encodeURIComponent(target)}`
  if (host === 'gitlab.com' || host.startsWith('gitlab.')) return `${url.origin}/${owner}/${repo}/-/archive/${encodeURIComponent(target)}/${repo}-${encodeURIComponent(target)}.zip`
  throw new Error(`暂不支持该托管方的仓库归档，请直接填 .zip 地址：${repoUrl}`)
}

export interface GitProviderDeps {
  fetchImpl?: typeof fetch
  limits?: Partial<FetchLimits>
  /** 归档缓存有效期。搜索、详情、安装在同一次会话里共用一份下载。 */
  ttlMs?: number
  now?: () => number
}

export class GitMarketplaceProvider implements RegistryProvider {
  readonly id: string
  readonly kind = 'git' as const
  readonly name: string
  private cache: { at: number; packages: ParsedPackage[] } | null = null
  private inflight: Promise<ParsedPackage[]> | null = null

  constructor(private readonly source: HubSource, private readonly deps: GitProviderDeps = {}) {
    this.id = source.id
    this.name = source.name
  }

  private async load(signal: AbortSignal): Promise<ParsedPackage[]> {
    const now = this.deps.now ?? Date.now
    const ttl = this.deps.ttlMs ?? 5 * 60_000
    if (this.cache && now() - this.cache.at < ttl) return this.cache.packages
    // 搜索与随后的安装几乎同时发生，并发时只下载一次。
    if (this.inflight) return this.inflight
    this.inflight = (async () => {
      if (!this.source.url) throw new Error(`源 ${this.source.name} 未配置仓库地址`)
      const archiveUrl = archiveUrlFor(this.source.url, this.source.ref)
      const buffer = await fetchBuffer(archiveUrl, {
        signal,
        limits: this.deps.limits,
        fetchImpl: this.deps.fetchImpl,
        // 源地址是用户自己填的，内网 Git 服务器是正当用法；归档里带出来的地址仍走严格档。
        allowPrivateHost: true,
        allowHttp: true
      })
      const decoder = new TextDecoder('utf8')
      const raw = Object.fromEntries(Object.entries(extractArchive(buffer)).map(([path, data]) => [path.replace(/\\/g, '/'), decoder.decode(data)]))
      const packages = parseGitArchive(raw)
      this.cache = { at: now(), packages }
      return packages
    })().finally(() => { this.inflight = null })
    return this.inflight
  }

  async search(query: HubQuery, signal: AbortSignal): Promise<HubListingDraft[]> {
    const packages = await this.load(signal)
    const matched = packages.map((item) => item.detail).filter((detail) => matchesHubQuery(detail, query))
    const sorted = sortListings(matched, query.sort)
    return query.limit ? sorted.slice(0, query.limit) : sorted
  }

  async detail(ref: string, signal: AbortSignal): Promise<HubListingDetailDraft> {
    const found = (await this.load(signal)).find((item) => item.ref === ref)
    if (!found) throw new Error(`源 ${this.name} 上不存在条目：${ref}`)
    return found.detail
  }

  async fetchPayload(ref: string, signal: AbortSignal): Promise<InstallPayload[]> {
    const found = (await this.load(signal)).find((item) => item.ref === ref)
    if (!found) throw new Error(`源 ${this.name} 上不存在条目：${ref}`)
    return found.payloads
  }

  async categories(signal: AbortSignal): Promise<string[]> {
    const packages = await this.load(signal)
    return [...new Set(packages.flatMap((item) => item.detail.categories))].sort((a, b) => a.localeCompare(b))
  }
}
