import type { Ability, McpAbility, SkillAbility } from '../../../shared/types'
import { abilityStats, isMcp, isSkill, matchesKeyword, sortAbilities, type AbilitySort, type AbilityStats } from './ability-view'

/** 能力页一级 Tab：「发现能力」与「我的能力」。 */
export type AbilitiesPageTab = 'discover' | 'mine'

/** 「我的能力」内部的类型筛选；attention 是跨类型的待办视图，不是第三种可安装能力。 */
export type MineTypeFilter = 'all' | 'skill' | 'mcp' | 'attention'

/**
 * 统一状态筛选。安装/启用/待办/更新对 Skill 与 MCP 通用，
 * 连接异常只对 MCP 有意义，选中时 Skill 一律不匹配。
 */
export type MineStatusFilter = 'all' | 'enabled' | 'disabled' | 'attention' | 'update_available' | 'connection_error'

/** 「我的能力」可展示的能力：仅 Skill 与 MCP，CLI 留给后端与设置页。 */
export type DisplayableAbility = SkillAbility | McpAbility

export const MINE_STATUS_OPTIONS: Array<[MineStatusFilter, string]> = [
  ['all', '全部状态'],
  ['enabled', '已启用'],
  ['disabled', '已停用'],
  ['attention', '待处理'],
  ['update_available', '有更新'],
  ['connection_error', '连接异常']
]

export const MINE_SORT_OPTIONS: Array<[AbilitySort, string]> = [
  ['name', '按名称'],
  ['status', '按状态'],
  ['recent', '按安装时间']
]

export const ABILITIES_TAB_STORAGE_KEY = 'fastagent.abilities.tab'

type TabStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultTabStorage(): TabStorage | null {
  try { return window.sessionStorage } catch { return null }
}

export function readStoredAbilitiesTab(storage: TabStorage | null = defaultTabStorage()): AbilitiesPageTab | null {
  try {
    const value = storage?.getItem(ABILITIES_TAB_STORAGE_KEY)
    return value === 'discover' || value === 'mine' ? value : null
  } catch { return null }
}

/** 只记住用户最近停留在哪个 Tab，应用退出即清空；与「上次会话」那类持久偏好是两回事。 */
export function writeStoredAbilitiesTab(tab: AbilitiesPageTab, storage: TabStorage | null = defaultTabStorage()): void {
  try { storage?.setItem(ABILITIES_TAB_STORAGE_KEY, tab) } catch { /* 存储不可用只丢记忆，不影响页面 */ }
}

/**
 * 首次进入的落点：记住的 Tab 优先；没记住时按「有已安装能力」决定。
 * abilities 为 null 表示尚未加载完，返回 null 让调用方先不动。
 */
export function resolveInitialAbilitiesTab(stored: AbilitiesPageTab | null, abilities: DisplayableAbility[] | null): AbilitiesPageTab | null {
  if (stored) return stored
  if (!abilities) return null
  return abilities.length > 0 ? 'mine' : 'discover'
}

/** 「我的能力」的展示与统计口径：排除 CLI，Skill 在前 MCP 在后。 */
export function displayableAbilities(abilities: Ability[]): DisplayableAbility[] {
  const skills = abilities.filter(isSkill)
  const servers = abilities.filter(isMcp)
  return [...skills, ...servers]
}

/** 统计只算可展示的 Skill 与 MCP：已安装总数恒等于 Skills 数 + MCP 数。 */
export function mineStats(abilities: Ability[]): AbilityStats {
  return abilityStats(displayableAbilities(abilities))
}

/** 待处理与统计行同口径：仅异常与缺配置；有更新走「有更新」筛选，不重复计入。 */
export function mineAttentionAbilities(displayable: DisplayableAbility[]): DisplayableAbility[] {
  return displayable.filter((ability) => ability.status === 'error' || ability.status === 'config_required')
}

/** 类型 chips 选中的行集合，也是分页的作用范围；统计行永远取全量，不经过这里。 */
export function mineRowsForType(displayable: DisplayableAbility[], typeFilter: MineTypeFilter): DisplayableAbility[] {
  switch (typeFilter) {
    case 'skill': return displayable.filter(isSkill)
    case 'mcp': return displayable.filter(isMcp)
    case 'attention': return mineAttentionAbilities(displayable)
    default: return displayable
  }
}

export function matchesMineStatus(ability: Ability, filter: MineStatusFilter): boolean {
  switch (filter) {
    case 'enabled': return ability.enabled
    case 'disabled': return !ability.enabled
    case 'attention': return ability.status === 'error' || ability.status === 'config_required'
    case 'update_available': return ability.status === 'update_available'
    case 'connection_error': return isMcp(ability) && ability.connection.state === 'error'
    default: return true
  }
}

/** MCP 的地址与命令也参与统一搜索，与列表页各自的搜索口径一致。 */
function mineKeywordMatch(ability: DisplayableAbility, keyword: string) {
  if (matchesKeyword(ability, keyword)) return true
  return isMcp(ability) && `${ability.command ?? ''} ${ability.url ?? ''}`.toLowerCase().includes(keyword)
}

export interface MineQuery {
  keyword?: string
  status?: MineStatusFilter
}

export function filterMineRows<T extends DisplayableAbility>(rows: T[], query: MineQuery = {}): T[] {
  const keyword = query.keyword?.trim().toLowerCase()
  return rows.filter((row) => {
    if (query.status && query.status !== 'all' && !matchesMineStatus(row, query.status)) return false
    if (keyword && !mineKeywordMatch(row, keyword)) return false
    return true
  })
}

export function sortMineRows<T extends DisplayableAbility>(rows: T[], sort: AbilitySort = 'name'): T[] {
  return sortAbilities(rows, sort)
}
