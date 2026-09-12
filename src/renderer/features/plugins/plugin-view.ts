import type { Plugin, PluginConfigField, PluginQuery, PluginStatus } from '../../../shared/types'
import type { StatusPresentation } from '../abilities/ability-view'

/**
 * 内置插件条目与 Hub 目录条目共用的最小形状。
 * 两边字段同源，卡片与状态机不需要知道自己在渲染哪一种；
 * 差别只在 Hub 条目的 publishedAt 等字段可缺省。
 */
export type CatalogItem =
  Pick<Plugin, 'id' | 'name' | 'displayName' | 'description' | 'abilityType' | 'version' | 'categories' | 'tags' | 'permissions' | 'configFields' | 'installed'>
  & Partial<Pick<Plugin, 'icon' | 'author' | 'downloadCount' | 'publishedAt' | 'installedVersion' | 'updateAvailable' | 'abilityId' | 'repository' | 'homepage' | 'featured' | 'trending'>>

/** 插件卡片的状态机：由本地安装态推导，与能力状态共用同一套色调 token。 */
export function pluginStatus(plugin: Pick<CatalogItem, 'installed' | 'updateAvailable'>, pending?: 'installing' | 'uninstalling'): PluginStatus {
  if (pending === 'installing') return 'installing'
  if (pending === 'uninstalling') return 'installing'
  if (!plugin.installed) return 'not_installed'
  if (plugin.updateAvailable) return 'update_available'
  return 'installed'
}

const STATUS_PRESENTATION: Record<PluginStatus, StatusPresentation> = {
  not_installed: { label: '未安装', tone: 'muted' },
  downloading: { label: '下载中', tone: 'accent' },
  installing: { label: '安装中', tone: 'accent' },
  config_required: { label: '需要配置', tone: 'warn' },
  installed: { label: '已安装', tone: 'ok' },
  enabled: { label: '已启用', tone: 'ok' },
  disabled: { label: '已禁用', tone: 'muted' },
  update_available: { label: '有更新', tone: 'warn' },
  error: { label: '安装失败', tone: 'error' }
}

export function pluginStatusPresentation(status: PluginStatus): StatusPresentation {
  return STATUS_PRESENTATION[status]
}

export interface PrimaryAction {
  label: string
  /** 需要先收集配置才能安装 */
  needsConfig: boolean
  disabled: boolean
  kind: 'install' | 'update' | 'open'
}

/** 主按钮随状态切换；安装中一律禁用，避免重复触发。 */
export function primaryAction(plugin: Pick<CatalogItem, 'installed' | 'abilityId' | 'configFields'>, status: PluginStatus): PrimaryAction {
  const needsConfig = plugin.configFields.some((field) => field.required)
  if (status === 'installing' || status === 'downloading') return { label: '安装中…', needsConfig, disabled: true, kind: 'install' }
  if (status === 'update_available') return { label: '更新', needsConfig, disabled: false, kind: 'update' }
  if (plugin.installed) return { label: '打开能力', needsConfig: false, disabled: !plugin.abilityId, kind: 'open' }
  return { label: needsConfig ? '配置并安装' : '安装', needsConfig, disabled: false, kind: 'install' }
}

export const SORT_OPTIONS: Array<[NonNullable<PluginQuery['sort']>, string]> = [
  ['featured', '推荐'],
  ['trending', '热门'],
  ['latest', '最新'],
  ['name', '名称']
]

/** 必填项是否都已填写，决定「安装 / 保存并启用」是否可点。 */
export function missingRequiredFields(fields: PluginConfigField[], values: Record<string, string>): string[] {
  return fields.filter((field) => field.required && !values[field.key]?.trim()).map((field) => field.key)
}

export function permissionNotices(plugin: Pick<CatalogItem, 'permissions'>): string[] {
  const notices: string[] = []
  if (plugin.permissions.runsLocalCode) notices.push('会在本机启动进程并执行命令')
  if (plugin.permissions.networkAccess) notices.push('会访问外部网络')
  if (plugin.permissions.fileAccess) notices.push('会读写本地文件')
  if (plugin.permissions.envKeys?.length) notices.push(`需要环境变量：${plugin.permissions.envKeys.join('、')}`)
  if (plugin.permissions.commands?.length) notices.push(`可能执行：${plugin.permissions.commands.join('；')}`)
  return notices
}

/** 未知来源：没有仓库地址也没有作者时，安装前必须给出明确警示。 */
export function isUnknownSource(plugin: Pick<CatalogItem, 'repository' | 'homepage'>) {
  return !plugin.repository && !plugin.homepage
}
