export type ResourceTabKey = 'workspace' | 'artifacts'

/** 每个 Tab 独立的可恢复状态：展开集、滚动位置、搜索词、选中项。 */
export interface ResourceTabState {
  /** 展开的目录（workspace）或组（artifacts）的路径 / id 列表。 */
  expanded: string[]
  scrollTop: number
  search: string
  selected: string | null
}

/** Resource Panel 整体持久化状态：切 Tab / 关闭重开 / 重启后都恢复。 */
export interface ResourcePanelState {
  activeTab: ResourceTabKey
  width: number
  workspace: ResourceTabState
  artifacts: ResourceTabState
}

export const PANEL_STATE_KEY = 'fastagent.resource-panel.v1'
// 文件预览窗口默认更宽：行号列 + 代码/正文需要更多横向空间；最小宽度保证行号与内容不至于挤成一团。
export const DEFAULT_PANEL_WIDTH = 480
export const MIN_PANEL_WIDTH = 320

export function defaultResourcePanelState(): ResourcePanelState {
  return {
    activeTab: 'workspace',
    width: DEFAULT_PANEL_WIDTH,
    workspace: { expanded: [''], scrollTop: 0, search: '', selected: null },
    artifacts: { expanded: [], scrollTop: 0, search: '', selected: null }
  }
}

function clampWidth(width: unknown): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) return DEFAULT_PANEL_WIDTH
  return Math.min(Math.max(Math.round(width), MIN_PANEL_WIDTH), Math.round(window.innerWidth * 0.7))
}

function normalizeTabState(value: unknown): ResourceTabState {
  const item = (value ?? {}) as Partial<ResourceTabState>
  return {
    expanded: Array.isArray(item.expanded) ? item.expanded.filter((entry): entry is string => typeof entry === 'string') : [],
    scrollTop: typeof item.scrollTop === 'number' && Number.isFinite(item.scrollTop) ? item.scrollTop : 0,
    search: typeof item.search === 'string' ? item.search : '',
    selected: typeof item.selected === 'string' ? item.selected : null
  }
}

/** 读 localStorage 并归一化；损坏或缺失时回落默认值。 */
export function loadResourcePanelState(): ResourcePanelState {
  try {
    const raw = window.localStorage.getItem(PANEL_STATE_KEY)
    if (!raw) return defaultResourcePanelState()
    const parsed = JSON.parse(raw) as Partial<ResourcePanelState>
    return {
      activeTab: parsed.activeTab === 'artifacts' ? 'artifacts' : 'workspace',
      width: clampWidth(parsed.width),
      workspace: normalizeTabState(parsed.workspace),
      artifacts: normalizeTabState(parsed.artifacts)
    }
  } catch {
    return defaultResourcePanelState()
  }
}

export function saveResourcePanelState(state: ResourcePanelState) {
  try {
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(state))
  } catch {
    // 存储满 / 被禁用时静默失败，不阻断面板使用。
  }
}

/** 纯函数：更新某个 Tab 的子状态，其它字段原样保留。 */
export function updateTabState(state: ResourcePanelState, tab: ResourceTabKey, patch: Partial<ResourceTabState>): ResourcePanelState {
  const nextTab = { ...state[tab], ...patch }
  return { ...state, [tab]: nextTab }
}
