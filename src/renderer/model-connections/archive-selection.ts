/**
 * 导入导出弹层的两级勾选：连接 -> 连接内模型。
 * 选择表只记「被选中的连接 -> 被选中的模型 id」；连接不在表里就是没选。
 * 连接本身没有模型时用空数组表示「选中但无模型」，与「取消选中」区分开。
 */
export interface ArchiveEntryModel {
  id: string
  label: string
}
export interface ArchiveEntry {
  key: string
  name: string
  meta: string
  note?: string
  models: ArchiveEntryModel[]
}
export type ArchiveSelection = Record<string, string[]>

export function selectAll(entries: ArchiveEntry[]): ArchiveSelection {
  return Object.fromEntries(entries.map((entry) => [entry.key, entry.models.map((model) => model.id)]))
}

export function entryState(selection: ArchiveSelection, entry: ArchiveEntry): 'none' | 'partial' | 'all' {
  const picked = selection[entry.key]
  if (!picked) return 'none'
  return picked.length === entry.models.length ? 'all' : 'partial'
}

/** 连接级勾选：整选或整不选，不保留上一次的部分选择——部分状态只由模型级勾选产生。 */
export function toggleEntry(selection: ArchiveSelection, entry: ArchiveEntry): ArchiveSelection {
  const next = { ...selection }
  if (next[entry.key]) delete next[entry.key]
  else next[entry.key] = entry.models.map((model) => model.id)
  return next
}

/** 模型级勾选：取消最后一个模型等于取消整条连接，避免导出一条没有模型的空连接。 */
export function toggleModel(selection: ArchiveSelection, entry: ArchiveEntry, modelId: string): ArchiveSelection {
  const next = { ...selection }
  const picked = next[entry.key] ?? []
  const remaining = picked.includes(modelId) ? picked.filter((id) => id !== modelId) : [...picked, modelId]
  if (remaining.length) next[entry.key] = entry.models.map((model) => model.id).filter((id) => remaining.includes(id))
  else delete next[entry.key]
  return next
}

export function setEntryModels(selection: ArchiveSelection, entry: ArchiveEntry, modelIds: string[]): ArchiveSelection {
  const next = { ...selection }
  if (modelIds.length) next[entry.key] = modelIds
  else delete next[entry.key]
  return next
}

export function selectedCount(selection: ArchiveSelection): { entries: number; models: number } {
  const values = Object.values(selection)
  return { entries: values.length, models: values.reduce((total, ids) => total + ids.length, 0) }
}
