import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, MemoryRecord, ModelOption, PageResult, ProjectRecord } from '../../../shared/types'
import { DEFAULT_PAGE_SIZE } from '../../../shared/pagination'
import { describeMemoryClearTarget, memoryClearTarget, memoryExtractModelChoices, memoryListQuery, type MemoryScopeFilter } from '../memory-filter'

const EMPTY_PAGE: PageResult<MemoryRecord> = { items: [], total: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE }

export function useMemorySettings(settings: AppSettings, models: ModelOption[], onNotice: (notice: string) => void) {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [filter, setFilter] = useState<MemoryScopeFilter>({ kind: 'all' })
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [data, setData] = useState<PageResult<MemoryRecord>>(EMPTY_PAGE)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // 原生 confirm 关闭后不把焦点还给 webContents，改用两段式确认。
  const [confirmingClear, setConfirmingClear] = useState(false)

  const projectNames = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project.name])), [projects])
  const extractModelChoices = useMemo(() => memoryExtractModelChoices(models, settings.memory.extractModelId), [models, settings.memory.extractModelId])

  const requestId = useRef(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    const request = ++requestId.current
    setLoading(true)
    setError(null)
    void window.fastAgent.memories.list(memoryListQuery(filter, page, pageSize, keyword))
      .then((next) => { if (request === requestId.current) setData(next) })
      .catch(() => { if (request === requestId.current) setError('记忆列表加载失败，请重试') })
      .finally(() => { if (request === requestId.current) setLoading(false) })
  }, [filter, page, pageSize, keyword, onNotice])

  useEffect(() => { void window.fastAgent.projects.list().then(setProjects).catch(() => undefined) }, [])
  useEffect(() => { load(); return () => { requestId.current += 1 } }, [load])
  useEffect(() => window.fastAgent.memories.onChanged(() => load()), [load])

  const changeFilter = (value: string) => {
    setPage(1)
    setConfirmingClear(false)
    setFilter(value === 'all' ? { kind: 'all' } : value === 'global' ? { kind: 'global' } : { kind: 'project', projectId: value })
  }

  const startEdit = (memory: MemoryRecord) => {
    setEditingId(memory.id)
    setDraft(memory.content)
  }

  const saveEdit = async () => {
    const content = draft.trim()
    if (!editingId || !content || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await window.fastAgent.memories.update(editingId, { content })
      setEditingId(null)
      load()
    } catch {
      onNotice('记忆保存失败')
    } finally { busyRef.current = false; setBusy(false) }
  }

  const remove = async (id: string) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await window.fastAgent.memories.remove(id)
      load()
    } catch {
      onNotice('记忆删除失败')
    } finally { busyRef.current = false; setBusy(false) }
  }

  const clear = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const target = memoryClearTarget(filter)
    try {
      const removed = await window.fastAgent.memories.clear(target.scope, target.scopeId)
      setConfirmingClear(false)
      setPage(1)
      load()
      onNotice(`已清空 ${removed} 条记忆`)
    } catch {
      onNotice('清空记忆失败')
    } finally { busyRef.current = false; setBusy(false) }
  }

  const selected = filter.kind === 'project' ? filter.projectId : filter.kind
  const clearLabel = describeMemoryClearTarget(filter, filter.kind === 'project' ? projectNames[filter.projectId] : undefined)

  return { busy, projects, filter, keyword, setKeyword, setPage, setPageSize, data, editingId, setEditingId, draft, setDraft, confirmingClear, setConfirmingClear, projectNames, extractModelChoices, changeFilter, startEdit, saveEdit, remove, clear, selected, clearLabel, loading, error, load }
}
