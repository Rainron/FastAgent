import type { AbilityType } from './abilities'
import type { PluginConfigField, PluginPermissionNotice } from './plugins'

export type HubSourceKind = 'builtin' | 'git' | 'skillsmp' | 'mcp-registry'

export type HubSourceStatus = 'untested' | 'ready' | 'unreachable' | 'unauthorized'

export interface HubSource {
  id: string
  kind: HubSourceKind
  name: string
  /** git 源为仓库地址；skillsmp / mcp-registry 为 API base URL；builtin 无值 */
  url?: string
  /** git 源锁定的分支或 tag，缺省用仓库默认分支 */
  ref?: string
  enabled: boolean
  /** 随包发布、不可删除的源 */
  builtin: boolean
  sortOrder: number
  hasSecrets: boolean
  status: HubSourceStatus
  statusMessage?: string | null
  checkedAt?: string
  updatedAt: string
}

export interface HubSourceInput {
  id: string
  kind: HubSourceKind
  name: string
  url?: string
  ref?: string
  enabled: boolean
  sortOrder?: number
  /** 只在保存时上行，绝不回传 */
  apiKey?: string
}

/**
 * 目录条目。只带 metadata，安装载荷由 provider 按 ref 惰性拉取——
 * 远端源不可能在搜索结果里内嵌 SKILL.md 正文。
 */
export interface HubListing {
  /** 跨源稳定的展示 id：`${sourceId}::${ref}` */
  id: string
  sourceId: string
  /** provider 内部定位一条目录项的字符串，形态由各 provider 自定 */
  ref: string
  name: string
  displayName: string
  description: string
  abilityType: AbilityType
  author?: string
  version: string
  categories: string[]
  tags: string[]
  /** lucide 图标名，不引外部图片 */
  icon?: string
  homepage?: string
  repository?: string
  publishedAt?: string
  downloadCount?: number
  featured?: boolean
  trending?: number
  permissions: PluginPermissionNotice
  configFields: PluginConfigField[]
  installed: boolean
  installedVersion?: string
  updateAvailable?: boolean
  /** 已安装时指向对应 Ability，用于「打开能力」跳转 */
  abilityId?: string
}

/** 一个目录条目里包含的子资源，安装确认弹层要逐条列出来。 */
export interface HubListingContent {
  kind: AbilityType
  name: string
  description?: string
}

export interface HubListingDetail extends HubListing {
  readme?: string
  contents: HubListingContent[]
}

export type HubInstallState = 'all' | 'not_installed' | 'installed' | 'update_available'

export interface HubQuery {
  keyword?: string
  abilityType?: AbilityType
  category?: string
  /** 按本地安装态过滤；装态由 decorateListings 现算，因此只能在聚合之后筛 */
  installState?: HubInstallState
  /** 不传表示搜所有已启用的源 */
  sourceIds?: string[]
  sort?: 'featured' | 'trending' | 'latest' | 'name'
  /** 各源的抓取上限，与下面的页码无关；hub-service 不传它，好让总条数覆盖全部结果 */
  limit?: number
  /** 从 1 开始 */
  page?: number
  pageSize?: number
}

/** 单源失败不能静默吞掉：少了结果用户必须知道是哪个源没回。 */
export interface HubSourceFailure {
  sourceId: string
  message: string
}

export interface HubSearchResult {
  items: HubListing[]
  failures: HubSourceFailure[]
  /** 各源结果合并去重后的总条数；有源失败时它只覆盖成功返回的那部分 */
  total: number
  page: number
  pageSize: number
}

export interface HubInstalledAbility {
  abilityId: string
  abilityType: AbilityType
  status: 'installed' | 'config_required'
}

/** 检查更新结果：写回了多少条能力的最新版本，以及哪些源没回。 */
export interface HubUpdateCheckResult {
  checked: number
  updated: number
  failures: HubSourceFailure[]
}

/** 一条目录项可能是个包（一个插件带多个 Skill 和一台 MCP Server），安装结果因此是复数。 */
export interface HubInstallResult {
  installed: HubInstalledAbility[]
}
