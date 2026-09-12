import type { AbilityType } from './abilities'

export type PluginStatus =
  | 'not_installed' | 'downloading' | 'installing' | 'config_required'
  | 'installed' | 'enabled' | 'disabled' | 'update_available' | 'error'

export interface PluginPermissionNotice {
  runsLocalCode: boolean
  networkAccess: boolean
  fileAccess: boolean
  /** 可能执行的命令，安装前展示 */
  commands?: string[]
  /** 需要的环境变量名（只有 key，无值） */
  envKeys?: string[]
}

export interface PluginConfigField {
  key: string
  label: string
  target: 'env' | 'header' | 'url' | 'command' | 'args' | 'cwd'
  required: boolean
  /** true 则 UI 遮挡、不落普通日志 */
  secret: boolean
  placeholder?: string
  description?: string
}

export interface Plugin {
  id: string
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
  publishedAt: string
  downloadCount?: number
  featured?: boolean
  trending?: number
  permissions: PluginPermissionNotice
  configFields: PluginConfigField[]
  readme?: string
  installed: boolean
  installedVersion?: string
  updateAvailable?: boolean
  /** 已安装时指向对应 Ability，用于「打开能力」跳转 */
  abilityId?: string
}

export type PluginDetail = Plugin

export interface PageQuery {
  /** 从 1 开始；超出范围由服务端夹取到最后一页 */
  page?: number
  pageSize?: number
  includeArchived?: boolean
  keyword?: string
  projectId?: string | null
}

export interface PageResult<T> {
  items: T[]
  /** 满足当前查询条件的总条数，页码分页器要靠它算总页数 */
  total: number
  page: number
  pageSize: number
}

export interface PluginQuery extends PageQuery {
  keyword?: string
  abilityType?: AbilityType
  category?: string
  sort?: 'featured' | 'trending' | 'latest' | 'name'
}

export interface PluginInstallResult {
  abilityId: string
  abilityType: AbilityType
  status: 'installed' | 'config_required'
}
