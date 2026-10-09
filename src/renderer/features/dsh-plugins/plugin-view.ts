import type { DshPluginActivation, DshPluginRecord, DshSearchHit } from '../../../shared/types'
import type { StatusPresentation } from '../abilities/ability-view'

/** 卡片上那行状态文案与色调。激活失败与「缺能力未激活」必须分开说，否则用户无从判断该不该报 bug。 */
export interface ActivationPresentation {
  tone: 'ok' | 'warn' | 'error' | 'idle'
  label: string
  detail?: string
}

export function presentActivation(plugin: DshPluginRecord): ActivationPresentation {
  if (!plugin.enabled) return { tone: 'idle', label: '已停用' }
  const activation = plugin.activation
  if (!activation) return { tone: 'idle', label: '待挂载' }
  switch (activation.status) {
    case 'active':
      // 有工具因重名没接入时要说出来，否则用户只会看到「插件的工具怎么少了」
      return activation.conflicts?.length
        ? { tone: 'warn', label: `已激活 · ${activation.tools.length} 个工具`, detail: `${activation.conflicts.join('、')} 与内置工具或其他插件重名，未接入对话` }
        : { tone: 'ok', label: `已激活 · ${activation.tools.length} 个工具` }
    case 'inactive':
      return {
        tone: 'warn',
        label: '未激活',
        // 说清是宿主没实现那个 seam，不是插件坏了
        detail: `插件需要 ${activation.missingServices.join('、')} 能力，当前宿主只提供工具注册`
      }
    default:
      return { tone: 'error', label: '加载失败', detail: activation.message }
  }
}

/** 徽章复用「能力」页那套色调枚举，同一种状态在两个页面必须同色；那边的「无状态」叫 muted。 */
export function activationBadge(plugin: DshPluginRecord): StatusPresentation {
  const { tone, label } = presentActivation(plugin)
  return { tone: tone === 'idle' ? 'muted' : tone, label }
}

/** 已激活插件贡献的工具名，用于在卡片上列出它到底往对话里加了什么。 */
export function activationTools(activation: DshPluginActivation | null): string[] {
  return activation?.status === 'active' ? activation.tools.map((tool) => tool.name) : []
}

export function countActiveTools(plugins: DshPluginRecord[]): number {
  return plugins.reduce((total, plugin) => total + (plugin.enabled ? activationTools(plugin.activation).length : 0), 0)
}

export interface PluginStats {
  total: number
  enabled: number
  tools: number
  attention: number
}

/** 顶部统计卡。「需要处理」与筛选 chips 的口径必须一致，否则数字点进去对不上行。 */
export function pluginStats(plugins: DshPluginRecord[]): PluginStats {
  return {
    total: plugins.length,
    enabled: plugins.filter((plugin) => plugin.enabled).length,
    tools: countActiveTools(plugins),
    attention: plugins.filter((plugin) => {
      const tone = presentActivation(plugin).tone
      return tone === 'warn' || tone === 'error'
    }).length
  }
}

export type PluginFilter = 'all' | 'enabled' | 'problem'

export function filterPlugins(plugins: DshPluginRecord[], filter: PluginFilter, keyword: string): DshPluginRecord[] {
  const needle = keyword.trim().toLowerCase()
  return plugins.filter((plugin) => {
    if (filter === 'enabled' && !plugin.enabled) return false
    if (filter === 'problem') {
      const tone = presentActivation(plugin).tone
      if (tone !== 'warn' && tone !== 'error') return false
    }
    if (!needle) return true
    return [plugin.name, plugin.displayName, plugin.description, plugin.author ?? ''].join(' ').toLowerCase().includes(needle)
  })
}

/** 搜索结果里已装的那条要能一眼看出是「已装」还是「可更新」。 */
export type SearchHitState = 'installable' | 'installed' | 'upgradable'

export function hitState(hit: DshSearchHit): SearchHitState {
  if (!hit.installedVersion) return 'installable'
  return hit.installedVersion === hit.version ? 'installed' : 'upgradable'
}

/** 搜索结果上的兼容标记。没有预判结果时不给标记，不把「没拉到元数据」说成「不兼容」。 */
export function presentCompat(hit: DshSearchHit): { tone: 'warn' | 'error'; label: string; detail: string } | null {
  if (!hit.compat || hit.compat.level === 'ok') return null
  return hit.compat.level === 'block'
    ? { tone: 'error', label: '无法安装', detail: hit.compat.reasons.join('；') }
    : { tone: 'warn', label: '可能无法激活', detail: hit.compat.reasons.join('；') }
}

const COMPAT_ORDER = { ok: 0, unknown: 1, warn: 2, block: 3 } as const

/**
 * 能用的排前面：npm 按关键字搜 dsh 会混进 CLI、SDK、浏览器端组件这类装不上的包，
 * 不排序的话真正能装的插件常被挤到后面。同档内保持 registry 的相关度顺序。
 */
export function sortHits(hits: DshSearchHit[]): DshSearchHit[] {
  return hits
    .map((hit, index) => ({ hit, index, rank: COMPAT_ORDER[hit.compat?.level ?? 'unknown'] }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ hit }) => hit)
}

/** 安装完成的提示：有兼容提醒就一并说出来，否则用户启用后看到「未激活」会一头雾水。 */
export function installNotice(result: { name: string; version: string; warnings?: string[] }): string {
  const base = `已安装 ${result.name}@${result.version}，需手动启用`
  return result.warnings?.length ? `${base}；注意：${result.warnings.join('；')}` : base
}
