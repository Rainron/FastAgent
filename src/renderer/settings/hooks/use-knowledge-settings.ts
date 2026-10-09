import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KbEntry, KbSource, KbSourceKind, KbSourcePreview, ProjectRecord } from '../../../shared/types'
import { describeIndexResult } from '../kb-source-view'

interface Draft { id?: string; title: string; content: string }

export function useKnowledgeSettings(onNotice: (notice: string) => void) {
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null)
  const [projectId, setProjectId] = useState('')
  const [entries, setEntries] = useState<KbEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [sources, setSources] = useState<KbSource[]>([])
  // 待确认的导入：选完路径先看范围预览，用户点确认才真正建来源并写库。
  const [pending, setPending] = useState<KbSourcePreview | null>(null)
  const [busy, setBusy] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const requestId = useRef(0)
  const projectRef = useRef(projectId)
  projectRef.current = projectId

  useEffect(() => {
    let cancelled = false
    void window.fastAgent.projects.list().then((list) => {
      if (cancelled) return
      const active = list.filter((project) => !project.archived)
      setProjects(active)
      setProjectId((current) => active.some((project) => project.id === current) ? current : active[0]?.id ?? '')
    }).catch(() => { if (!cancelled) setError('项目列表加载失败，请重试') })
    return () => { cancelled = true }
  }, [revision])

  const load = useCallback(async () => {
    if (!projectId) return
    const request = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const [list, nextSources] = await Promise.all([window.fastAgent.knowledgeBase.list(projectId), window.fastAgent.knowledgeBase.listSources(projectId)])
      if (request !== requestId.current || projectRef.current !== projectId) return
      setEntries(list)
      setSources(nextSources)
      setSelectedId((current) => list.some((entry) => entry.id === current) ? current : list[0]?.id ?? null)
    } catch { if (request === requestId.current) setError('知识库加载失败，请重试') }
    finally { if (request === requestId.current) setLoading(false) }
  }, [projectId])

  useEffect(() => {
    setEntries([])
    setSources([])
    setSelectedId(null)
    setPending(null)
    setConfirmingDelete(false)
    void load()
    return () => { requestId.current += 1 }
  }, [load])
  useEffect(() => window.fastAgent.knowledgeBase.onChanged((changed) => {
    if (changed === projectId) void load()
  }), [projectId, load])
  function reload() { setError(null); setRevision((value) => value + 1); void load() }

  // 列表加载后草稿可能指向已不存在的条目，编辑态随之失效
  const selected = useMemo(() => entries.find((entry) => entry.id === selectedId) ?? null, [entries, selectedId])

  async function save() {
    if (!draft || !projectId || saving || busy) return
    setSaving(true)
    try {
      const saved = await window.fastAgent.knowledgeBase.save(projectId, draft)
      const list = await window.fastAgent.knowledgeBase.list(projectId)
      setEntries(list)
      setSelectedId(saved.id)
      setDraft(null)
      onNotice(draft.id ? '知识条目已更新' : '知识条目已保存')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '知识条目保存失败')
    } finally { setSaving(false) }
  }

  async function remove(entryId: string) {
    if (busy || saving) return
    setBusy(true)
    try {
      await window.fastAgent.knowledgeBase.remove(projectId, entryId)
      const list = await window.fastAgent.knowledgeBase.list(projectId)
      setEntries(list)
      setSelectedId(list[0]?.id ?? null)
      setDraft(null)
      setConfirmingDelete(false)
      onNotice('知识条目已删除')
    } catch { onNotice('知识条目删除失败') } finally { setBusy(false) }
  }

  async function pickSource(kind: KbSourceKind) {
    try {
      const preview = await window.fastAgent.knowledgeBase.pickSource(kind)
      if (preview) setPending(preview)
    } catch (error) { onNotice(error instanceof Error ? error.message : '选择来源失败') }
  }

  async function confirmImport() {
    if (!pending || !projectId || busy) return
    setBusy(true)
    try {
      const result = await window.fastAgent.knowledgeBase.addSource(projectId, { path: pending.path, kind: pending.kind })
      setPending(null)
      onNotice(describeIndexResult(result))
      await load()
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '导入失败')
    } finally { setBusy(false) }
  }

  async function refreshSource(sourceId: string) {
    if (busy) return
    setBusy(true)
    try { onNotice(describeIndexResult(await window.fastAgent.knowledgeBase.refreshSource(sourceId))); await load() }
    catch (error) { onNotice(error instanceof Error ? error.message : '重新索引失败') }
    finally { setBusy(false) }
  }

  async function removeSource(sourceId: string) {
    if (busy) return
    setBusy(true)
    try {
      await window.fastAgent.knowledgeBase.removeSource(sourceId)
      onNotice('已解绑来源，其条目已删除')
      await load()
    } catch { onNotice('解绑来源失败') } finally { setBusy(false) }
  }

  function pick(entryId: string) {
    // 有未保存草稿时切走即放弃：取消按钮就是显式的退出通道，弹窗确认反而打断节奏。
    setDraft(null)
    setConfirmingDelete(false)
    setSelectedId(entryId)
  }

  return { loading, error, reload, projects, projectId, setProjectId, entries, selectedId, draft, setDraft, saving, confirmingDelete, setConfirmingDelete, sources, pending, setPending, busy, selected, save, remove, pickSource, confirmImport, refreshSource, removeSource, pick }
}
