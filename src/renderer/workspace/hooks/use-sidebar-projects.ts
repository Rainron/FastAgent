import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConversationRunState } from '../../../shared/types'
import type { CompactionStates } from '../../conversation/compaction-state'
import type { WorkspaceProject } from '../workspace-types'
import { activeProjectIdsFromStates, applyProjectOrder, groupProjectsByActivity, writeProjectOrder } from '../project-order'
import { useProjectReorder } from './use-project-reorder'

export function useSidebarProjects(projects: WorkspaceProject[], runStates: Record<string, ConversationRunState>, compactionStates: CompactionStates, selectedProjectId: string | null, searchOpen: boolean) {
  const activeProjects = useMemo(() => projects.filter((project) => !project.archived), [projects])
  const runStateList = useMemo(() => Object.values(runStates), [runStates])
  const [compactionProjectIds, setCompactionProjectIds] = useState<Record<string, string | null>>({})
  const requestedCompactionIds = useRef(new Set<string>())
  useEffect(() => {
    const knownRunIds = new Set(runStateList.map((state) => state.conversationId))
    const missing = Object.entries(compactionStates).filter(([id, state]) => state.status === 'running' && !knownRunIds.has(id) && !requestedCompactionIds.current.has(id)).map(([id]) => id)
    if (!missing.length) return
    for (const id of missing) requestedCompactionIds.current.add(id)
    // 归属查询只读且幂等，不跟随 effect 取消：运行中这个 effect 每次状态变化都会重跑，
    // 一旦按取消丢弃结果，id 已经记进「已请求」，这条会话的归属就再也补不回来（工作区永远不显示为活动）。
    void Promise.all(missing.map(async (id) => {
      try {
        const conversation = await window.fastAgent.conversations.get(id)
        return { id, projectId: conversation?.projectId ?? null, resolved: true }
      } catch { return { id, projectId: null, resolved: false } }
    })).then((entries) => {
      setCompactionProjectIds((current) => {
        const next = { ...current }
        for (const entry of entries) if (entry.resolved) next[entry.id] = entry.projectId
        return next
      })
      // 查失败的不记账，留给下一次状态变化重试；查到的（即使确实没有归属）留在「已请求」集合里，避免每次状态变化重打 IPC。
      for (const entry of entries) if (!entry.resolved) requestedCompactionIds.current.delete(entry.id)
    })
  }, [runStateList, compactionStates])
  const activeIds = useMemo(() => activeProjectIdsFromStates(runStateList, compactionStates, compactionProjectIds), [runStateList, compactionStates, compactionProjectIds])
  const groupById = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project.archived ? 'archived' : activeIds.has(project.id) ? 'active' : 'idle'])), [projects, activeIds])
  const reorder = useProjectReorder(!searchOpen, projects, groupById)
  const ordered = useMemo(() => applyProjectOrder(activeProjects, reorder.order), [activeProjects, reorder.order])
  const display = useMemo(() => groupProjectsByActivity(ordered, activeIds), [ordered, activeIds])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(selectedProjectId ? [selectedProjectId] : []))
  const [listExpanded, setListExpanded] = useState(false)
  const collapsedByClick = useRef<string | null>(null)
  const knownProjectIds = useRef<Set<string> | null>(null)
  const [newProjectId, setNewProjectId] = useState<string | null>(null)
  useEffect(() => {
    const currentIds = new Set(activeProjects.map((project) => project.id))
    // 首帧项目列表还是空的（异步加载），拿它当基线会把已有项目全判成新建，
    // 顺手把手动排序覆盖成服务端顺序并落盘。等真正拿到项目再建立基线。
    if (!currentIds.size) return
    if (!knownProjectIds.current) { knownProjectIds.current = currentIds; return }
    const added = [...currentIds].filter((id) => !knownProjectIds.current?.has(id))
    knownProjectIds.current = currentIds
    if (!added.length) return
    setNewProjectId(added[added.length - 1])
    const next = [...added, ...reorder.order.filter((id) => !added.includes(id))]
    reorder.setOrder(next)
    writeProjectOrder(window.localStorage, next)
  }, [activeProjects, reorder.order, reorder.setOrder])
  useEffect(() => {
    if (!selectedProjectId) return
    if (collapsedByClick.current === selectedProjectId) { collapsedByClick.current = null; return }
    setExpanded((current) => current.has(selectedProjectId) ? current : new Set(current).add(selectedProjectId))
  }, [selectedProjectId])
  const toggle = useCallback((id: string) => setExpanded((current) => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  }), [])
  const selectAndToggle = useCallback((id: string, fromSearch: boolean) => {
    if (fromSearch) setExpanded((current) => current.has(id) ? current : new Set(current).add(id))
    else {
      if (expanded.has(id) && selectedProjectId !== id) collapsedByClick.current = id
      toggle(id)
    }
  }, [expanded, selectedProjectId, toggle])
  return { activeProjects, runStateList, activeIds, display, expanded, toggle, selectAndToggle, listExpanded, setListExpanded, newProjectId, reorder }
}
