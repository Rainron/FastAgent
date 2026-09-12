import type { HubListing, HubListingContent, HubSourceKind, HubQuery } from '../../shared/types'

/**
 * 安装载荷。与目录条目分开取：远端源的搜索结果只有 metadata，
 * SKILL.md 正文要到用户点安装时才按 ref 拉。
 */
export type InstallPayload =
  | { kind: 'skill'; files: Record<string, string> }
  | {
      kind: 'mcp'
      name: string
      transport: 'stdio' | 'streamable_http'
      command?: string
      args?: string[]
      cwd?: string
      url?: string
      timeoutMs: number
    }
  | {
      kind: 'cli'
      name: string
      executable: string
      versionArgs: string[]
      allowPatterns: string[]
      usage?: string
    }

/** provider 只产出目录侧信息；id / sourceId 由 aggregator 补，安装态由 decorate 补。 */
export type HubListingDraft = Omit<HubListing, 'id' | 'sourceId' | 'installed' | 'installedVersion' | 'updateAvailable' | 'abilityId'>

/** aggregator 的产物：已归属到源，但还不知道本地装没装。 */
export type HubListingUndecorated = Omit<HubListing, 'installed' | 'installedVersion' | 'updateAvailable' | 'abilityId'>

export interface HubListingDetailDraft extends HubListingDraft {
  readme?: string
  contents: HubListingContent[]
}

export interface RegistryProvider {
  readonly id: string
  readonly kind: HubSourceKind
  /** 源的展示名，失败提示要指名道姓 */
  readonly name: string
  search(query: HubQuery, signal: AbortSignal): Promise<HubListingDraft[]>
  detail(ref: string, signal: AbortSignal): Promise<HubListingDetailDraft>
  /** 一条目录项可能带多个能力，逐条落地由 installer 负责。 */
  fetchPayload(ref: string, signal: AbortSignal): Promise<InstallPayload[]>
  /** 只有能枚举完整目录的源才实现（内置 catalog）；远端源返回 undefined。 */
  categories?(signal: AbortSignal): Promise<string[]>
}

export function listingId(sourceId: string, ref: string) {
  return `${sourceId}::${ref}`
}

/** 反解 listingId。ref 自身可能含 `::`，只按第一次出现切开。 */
export function parseListingId(id: string): { sourceId: string; ref: string } | null {
  const index = id.indexOf('::')
  if (index <= 0 || index + 2 >= id.length) return null
  return { sourceId: id.slice(0, index), ref: id.slice(index + 2) }
}
