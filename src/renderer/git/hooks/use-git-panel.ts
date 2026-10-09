import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  GitBranchInfo, GitCommitDetail, GitCommitSummary, GitIntegrationState, GitOperationResult, GitRemoteInfo, GitStashEntry, GitWorkingChanges
} from '../../../shared/types'
import { toggleCollapsed, type ChangeViewMode } from '../change-tree'

export const COMMIT_PAGE_SIZE = 50

/** 面板右栏的展示对象：要么是未提交改动，要么是某条提交。 */
export type GitPanelTarget = { kind: 'working' } | { kind: 'commit'; hash: string }

const EMPTY_CHANGES: GitWorkingChanges = { staged: [], unstaged: [] }
const EMPTY_INTEGRATION: GitIntegrationState = { merging: false, rebasing: false, conflicts: [] }

/**
 * Git 面板的数据源：分支、远程、stash、提交列表与选中提交详情、工作区改动。
 * 所有写操作都走 runAction，统一收敛「置忙 → 执行 → 通知 → 重载」这套流程。
 */
export function useGitPanel(open: boolean, currentBranch: string | null, onNotice: (message: string) => void) {
  const [branches, setBranches] = useState<GitBranchInfo[]>([])
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [remotes, setRemotes] = useState<string[]>([])
  const [remoteInfos, setRemoteInfos] = useState<GitRemoteInfo[]>([])
  const [stashes, setStashes] = useState<GitStashEntry[]>([])
  const [integration, setIntegration] = useState<GitIntegrationState>(EMPTY_INTEGRATION)
  const [changes, setChanges] = useState<GitWorkingChanges>(EMPTY_CHANGES)
  const [commits, setCommits] = useState<GitCommitSummary[]>([])
  const [commitTotal, setCommitTotal] = useState(0)
  const [detail, setDetail] = useState<GitCommitDetail | null>(null)
  const [selectedBranch, setSelectedBranch] = useState<string | null>(currentBranch)
  const [target, setTarget] = useState<GitPanelTarget>({ kind: 'working' })
  const [busy, setBusy] = useState(false)
  const [loadingCommits, setLoadingCommits] = useState(false)
  // 面板关闭后仍可能有在途请求，用世代号丢弃迟到的结果，避免把旧仓库的数据写回来。
  const generation = useRef(0)

  const reloadOverview = useCallback(async () => {
    const token = ++generation.current
    const [branchList, remoteRefs, remoteNames, remoteInfoList, stashList, integrationState, workingChanges] = await Promise.all([
      window.fastAgent.git.branchInfos().catch(() => [] as GitBranchInfo[]),
      window.fastAgent.git.remoteBranches().catch(() => [] as string[]),
      window.fastAgent.git.remotes().catch(() => [] as string[]),
      window.fastAgent.git.remoteDetails().catch(() => [] as GitRemoteInfo[]),
      window.fastAgent.git.stashes().catch(() => [] as GitStashEntry[]),
      window.fastAgent.git.integration().catch(() => EMPTY_INTEGRATION),
      window.fastAgent.git.changes().catch(() => EMPTY_CHANGES)
    ])
    if (token !== generation.current) return
    setBranches(branchList)
    setRemoteBranches(remoteRefs)
    setRemotes(remoteNames)
    setRemoteInfos(remoteInfoList)
    setStashes(stashList)
    setIntegration(integrationState)
    setChanges(workingChanges)
  }, [])

  const loadCommits = useCallback(async (ref: string | null) => {
    setLoadingCommits(true)
    const token = generation.current
    try {
      const [list, total] = await Promise.all([
        window.fastAgent.git.commits(ref ?? '', COMMIT_PAGE_SIZE, 0).catch(() => [] as GitCommitSummary[]),
        window.fastAgent.git.commitCount(ref ?? '').catch(() => 0)
      ])
      if (token !== generation.current) return
      setCommits(list)
      setCommitTotal(total)
    } finally {
      setLoadingCommits(false)
    }
  }, [])

  const loadMoreCommits = useCallback(async () => {
    setLoadingCommits(true)
    try {
      const more = await window.fastAgent.git.commits(selectedBranch ?? '', COMMIT_PAGE_SIZE, commits.length).catch(() => [] as GitCommitSummary[])
      if (more.length) setCommits((current) => [...current, ...more])
    } finally {
      setLoadingCommits(false)
    }
  }, [commits.length, selectedBranch])

  // 打开面板、或外部切了分支时，重新对齐到当前分支并拉全量数据。
  useEffect(() => {
    if (!open) return
    setSelectedBranch(currentBranch)
    void reloadOverview()
  }, [open, currentBranch, reloadOverview])

  useEffect(() => {
    if (!open) return
    void loadCommits(selectedBranch)
  }, [open, selectedBranch, loadCommits])

  // 选中提交后拉详情；切回未提交改动时清空，避免右栏残留上一条提交。
  useEffect(() => {
    if (!open || target.kind !== 'commit') { setDetail(null); return }
    let alive = true
    setDetail(null)
    void window.fastAgent.git.commitDetail(target.hash)
      .then((value) => { if (alive) setDetail(value) })
      .catch(() => { if (alive) setDetail(null) })
    return () => { alive = false }
  }, [open, target])

  // 外部（终端 / 其他窗口）改了仓库也要跟上。
  useEffect(() => {
    if (!open) return
    return window.fastAgent.git.onChanged(() => {
      void reloadOverview()
      void loadCommits(selectedBranch)
    })
  }, [open, reloadOverview, loadCommits, selectedBranch])

  /**
   * 统一的写操作入口：执行期间禁用交互，成功给 successText、失败把 git 的原文透出来，
   * 无论成败都重载面板数据（失败时仓库状态也可能已经变了，比如冲突）。
   */
  const runAction = useCallback(async (
    action: () => Promise<GitOperationResult>,
    options: { success: string; failure: string }
  ): Promise<GitOperationResult> => {
    setBusy(true)
    try {
      const result = await action()
      onNotice(result.ok ? options.success : `${options.failure}：${result.error ?? '未知错误'}`)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      onNotice(`${options.failure}：${message}`)
      return { ok: false, error: message }
    } finally {
      setBusy(false)
      await reloadOverview()
      await loadCommits(selectedBranch)
    }
  }, [onNotice, reloadOverview, loadCommits, selectedBranch])

  const selectedBranchInfo = useMemo(
    () => branches.find((branch) => branch.name === selectedBranch) ?? null,
    [branches, selectedBranch]
  )

  return {
    branches, remoteBranches, remotes, remoteInfos, stashes, integration, changes, commits, commitTotal, detail,
    selectedBranch, selectedBranchInfo, target, busy, loadingCommits,
    setSelectedBranch, setTarget, reloadOverview, loadMoreCommits, runAction
  }
}

/**
 * 未提交改动的视图模式与目录折叠状态。
 * 落在 client_preferences 而不是组件 state：调完视图重启还得再调一次的话，这个开关就白做了。
 * 读回来之前不写库，否则默认值会把存过的覆盖掉。
 */
export function useGitChangeView() {
  const [view, setView] = useState<{ mode: ChangeViewMode; collapsedDirs: ReadonlySet<string> }>(
    () => ({ mode: 'folder', collapsedDirs: new Set<string>() })
  )
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    void window.fastAgent.preferences.get()
      .then((preferences) => {
        if (!alive) return
        const stored = preferences.gitChangeView
        if (stored) setView({ mode: stored.mode ?? 'folder', collapsedDirs: new Set(stored.collapsedDirs ?? []) })
      })
      .catch(() => undefined)
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!loaded) return
    void window.fastAgent.preferences.update({ gitChangeView: { mode: view.mode, collapsedDirs: [...view.collapsedDirs] } })
  }, [loaded, view])

  const setMode = useCallback((mode: ChangeViewMode) => setView((current) => ({ ...current, mode })), [])
  const toggleDir = useCallback(
    (path: string) => setView((current) => ({ ...current, collapsedDirs: toggleCollapsed(current.collapsedDirs, path) })),
    []
  )

  return { mode: view.mode, collapsedDirs: view.collapsedDirs, setMode, toggleDir }
}
