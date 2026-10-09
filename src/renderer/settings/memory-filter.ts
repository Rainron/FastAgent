import type { MemoryListItem, MemoryListQuery, MemoryRecord, MemoryScope, ModelOption } from '../../shared/types'

/** 记忆管理页的作用域筛选；project 用 projectId，与记忆的 scopeId 同一口径。 */
export type MemoryScopeFilter = { kind: 'all' } | { kind: 'global' } | { kind: 'project'; projectId: string }

export function memoryListQuery(filter: MemoryScopeFilter, page: number, pageSize: number, keyword = ''): MemoryListQuery {
  const base: MemoryListQuery = { page, pageSize, keyword: keyword.trim() || undefined }
  if (filter.kind === 'global') return { ...base, scope: 'global' }
  if (filter.kind === 'project') return { ...base, scope: 'workspace', scopeId: filter.projectId }
  return base
}

/** 清空的作用域参数；「全部」传空对象，主进程据此清掉当前账户所有记忆。 */
export function memoryClearTarget(filter: MemoryScopeFilter): { scope?: MemoryScope; scopeId?: string | null } {
  if (filter.kind === 'global') return { scope: 'global', scopeId: null }
  if (filter.kind === 'project') return { scope: 'workspace', scopeId: filter.projectId }
  return {}
}

export function describeMemoryClearTarget(filter: MemoryScopeFilter, projectName?: string): string {
  if (filter.kind === 'global') return '全局记忆'
  if (filter.kind === 'project') return `项目「${projectName ?? filter.projectId}」的记忆`
  return '当前账户的全部记忆'
}

export interface MemoryExtractModelChoice {
  id: number
  label: string
  /** 配置的模型已不在可用列表里，仅为保留选中值而补出来的一项。 */
  missing: boolean
}

/**
 * 提取模型下拉的可选项。已配置但列表里查不到的模型（下架或删除）单独补一行：
 * 直接落回「跟随会话模型」会让用户以为设置没生效。
 */
export function memoryExtractModelChoices(
  models: ReadonlyArray<Pick<ModelOption, 'id' | 'provider' | 'model_name'>>,
  selectedId: number | null
): MemoryExtractModelChoice[] {
  const choices = models.map((model) => ({ id: model.id, label: `${model.provider} · ${model.model_name}`, missing: false }))
  if (selectedId !== null && !choices.some((choice) => choice.id === selectedId)) {
    choices.unshift({ id: selectedId, label: `已失效的模型 #${selectedId}`, missing: true })
  }
  return choices
}

/** 列表里每条记忆的作用域说明；项目已被移除时保留可读提示，不显示裸 id。 */
export function describeMemoryScope(memory: Pick<MemoryRecord, 'scope' | 'scopeId'>, projectNames: Readonly<Record<string, string>>): string {
  if (memory.scope === 'global') return '全局'
  if (memory.scope === 'agent') return `Sub-agent · ${memory.scopeId ?? '未指定'}`
  if (!memory.scopeId) return '项目'
  return `项目 · ${projectNames[memory.scopeId] ?? '已移除的项目'}`
}

/** 来源一栏：有来源会话就给标题并允许跳转；会话已删只留说明，手动添加的没有来源。 */
export function describeMemorySource(memory: Pick<MemoryListItem, 'sourceConversationId' | 'sourceConversationTitle'>): { label: string; conversationId: string | null } {
  if (!memory.sourceConversationId) return { label: '手动添加', conversationId: null }
  if (memory.sourceConversationTitle === null) return { label: '来源对话已删除', conversationId: null }
  return { label: memory.sourceConversationTitle || '未命名对话', conversationId: memory.sourceConversationId }
}

/**
 * 新增记忆的默认作用域：正在看某个项目的记忆就落到那个项目，
 * 否则落到当前打开的项目，都没有才是全局——跟用户此刻关注的范围走。
 */
export function defaultCreateScope(filter: MemoryScopeFilter, currentProjectId: string | null, projectIds: readonly string[]): string {
  if (filter.kind === 'project') return filter.projectId
  if (filter.kind === 'global') return 'global'
  return currentProjectId && projectIds.includes(currentProjectId) ? currentProjectId : 'global'
}

/** 作用域下拉值转成创建参数：'global' 以外的值都是 projectId。 */
export function memoryCreateScope(value: string): { scope: 'global' | 'workspace'; scopeId: string | null } {
  return value === 'global' ? { scope: 'global', scopeId: null } : { scope: 'workspace', scopeId: value }
}
