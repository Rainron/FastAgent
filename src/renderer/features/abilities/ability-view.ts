import type { Ability, AbilitySource, AbilityStatus, AbilityType, CliAbility, McpAbility, McpConnectionSnapshot, SkillAbility } from '../../../shared/types'

/** 状态色调 token，与 styles.css 的 --status-* 变量一一对应，插件页复用同一映射。 */
export type StatusTone = 'ok' | 'muted' | 'warn' | 'error' | 'accent'

export interface StatusPresentation {
  label: string
  tone: StatusTone
}

const ABILITY_STATUS: Record<AbilityStatus, StatusPresentation> = {
  ready: { label: '正常可用', tone: 'ok' },
  disabled: { label: '已禁用', tone: 'muted' },
  config_required: { label: '需要配置', tone: 'warn' },
  update_available: { label: '有更新', tone: 'warn' },
  error: { label: '异常', tone: 'error' }
}

const CONNECTION_STATUS: Record<McpConnectionSnapshot['state'], StatusPresentation> = {
  connected: { label: '已连接', tone: 'ok' },
  disconnected: { label: '未连接', tone: 'muted' },
  unknown: { label: '未测试', tone: 'muted' },
  error: { label: '连接失败', tone: 'error' }
}

const PENDING_STATUS = {
  installing: { label: '安装中', tone: 'accent' },
  updating: { label: '更新中', tone: 'accent' },
  uninstalling: { label: '卸载中', tone: 'accent' },
  importing: { label: '导入中', tone: 'accent' },
  connecting: { label: '连接中', tone: 'accent' },
  testing: { label: '测试中', tone: 'accent' },
  saving: { label: '保存中', tone: 'accent' }
} as const satisfies Record<string, StatusPresentation>

export type PendingKind = keyof typeof PENDING_STATUS

export function abilityStatusPresentation(status: AbilityStatus): StatusPresentation {
  return ABILITY_STATUS[status]
}

export function connectionPresentation(state: McpConnectionSnapshot['state']): StatusPresentation {
  return CONNECTION_STATUS[state]
}

export function pendingPresentation(kind: PendingKind): StatusPresentation {
  return PENDING_STATUS[kind]
}

export const SOURCE_LABELS: Record<AbilitySource, string> = {
  builtin: '内置',
  marketplace: '插件市场',
  imported: '本地导入',
  created: '手动创建'
}

export const TYPE_LABELS: Record<AbilityType, string> = {
  skill: 'Skill',
  mcp: 'MCP Server',
  cli: 'CLI 工具'
}

export type AbilityStatusFilter = 'all' | 'enabled' | 'disabled' | 'error' | 'update_available'
export type AbilitySourceFilter = 'all' | AbilitySource
export type AbilitySort = 'name' | 'status' | 'recent'
export type McpStatusFilter = 'all' | 'connected' | 'disconnected' | 'error' | 'disabled'

export interface AbilityFilterOptions {
  keyword?: string
  status?: AbilityStatusFilter
  source?: AbilitySourceFilter
}

function matchesKeyword(ability: Ability, keyword: string) {
  return [ability.name, ability.displayName, ability.description ?? '', ability.author ?? '']
    .join(' ')
    .toLowerCase()
    .includes(keyword)
}

function matchesStatus(ability: Ability, filter: AbilityStatusFilter) {
  switch (filter) {
    case 'enabled': return ability.enabled
    case 'disabled': return !ability.enabled
    case 'error': return ability.status === 'error' || ability.status === 'config_required'
    case 'update_available': return ability.status === 'update_available'
    default: return true
  }
}

export function filterAbilities<T extends Ability>(abilities: T[], options: AbilityFilterOptions = {}): T[] {
  const keyword = options.keyword?.trim().toLowerCase()
  return abilities.filter((ability) => {
    if (options.source && options.source !== 'all' && ability.source !== options.source) return false
    if (options.status && !matchesStatus(ability, options.status)) return false
    if (keyword && !matchesKeyword(ability, keyword)) return false
    return true
  })
}

// 需要处理的状态排前面，用户打开页面第一眼看到的就是待办。
const STATUS_WEIGHT: Record<AbilityStatus, number> = { error: 0, config_required: 1, update_available: 2, ready: 3, disabled: 4 }

export function sortAbilities<T extends Ability>(abilities: T[], sort: AbilitySort = 'name'): T[] {
  const byName = (a: Ability, b: Ability) => a.displayName.localeCompare(b.displayName)
  const copy = [...abilities]
  switch (sort) {
    case 'status':
      return copy.sort((a, b) => STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status] || byName(a, b))
    case 'recent':
      return copy.sort((a, b) => (b.installedAt ?? '').localeCompare(a.installedAt ?? '') || byName(a, b))
    default:
      return copy.sort(byName)
  }
}

/** 概览页的待办清单：异常、缺配置、有更新的能力，按 STATUS_WEIGHT 排序。 */
export function abilitiesNeedingAttention<T extends Ability>(abilities: T[]): T[] {
  return sortAbilities(abilities.filter((ability) => ability.status === 'error' || ability.status === 'config_required' || ability.status === 'update_available'), 'status')
}

/** 概览页的「最近安装」：没有 installedAt 的（内置能力）不参与排序，否则会顶在最前。 */
export function recentlyInstalledAbilities<T extends Ability>(abilities: T[], limit = 5): T[] {
  return sortAbilities(abilities.filter((ability) => Boolean(ability.installedAt)), 'recent').slice(0, limit)
}

export function filterMcpAbilities(abilities: McpAbility[], filter: McpStatusFilter, keyword?: string): McpAbility[] {
  const text = keyword?.trim().toLowerCase()
  return abilities.filter((ability) => {
    if (text && !matchesKeyword(ability, text) && !(ability.command ?? ability.url ?? '').toLowerCase().includes(text)) return false
    switch (filter) {
      case 'connected': return ability.connection.state === 'connected'
      case 'disconnected': return ability.connection.state === 'disconnected' || ability.connection.state === 'unknown'
      case 'error': return ability.connection.state === 'error' || ability.status === 'config_required'
      case 'disabled': return !ability.enabled
      default: return true
    }
  })
}

export interface AbilityStats {
  total: number
  skills: number
  mcp: number
  enabled: number
  connectionOk: number
  connectionFailed: number
}

export function abilityStats(abilities: Ability[]): AbilityStats {
  const mcp = abilities.filter((ability): ability is McpAbility => ability.type === 'mcp')
  return {
    total: abilities.length,
    skills: abilities.filter((ability) => ability.type === 'skill').length,
    mcp: mcp.length,
    enabled: abilities.filter((ability) => ability.enabled).length,
    connectionOk: mcp.filter((ability) => ability.connection.state === 'connected').length,
    connectionFailed: mcp.filter((ability) => ability.connection.state === 'error').length
  }
}

export function isSkill(ability: Ability): ability is SkillAbility {
  return ability.type === 'skill'
}

export function isMcp(ability: Ability): ability is McpAbility {
  return ability.type === 'mcp'
}

export function isCli(ability: Ability): ability is CliAbility {
  return ability.type === 'cli'
}

/** 只有明确知道来源可卸载才显示卸载入口；内置能力永远不显示。 */
export function canUninstall(ability: Ability) {
  return ability.source !== 'builtin'
}

export function transportLabel(ability: McpAbility) {
  return ability.transport === 'stdio' ? `stdio · ${ability.command ?? '缺少命令'}` : `HTTP · ${ability.url ?? '缺少 URL'}`
}
