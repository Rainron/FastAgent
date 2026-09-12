import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, CircleAlert, GitBranch, Plus, X } from 'lucide-react'
import type { GitOperationResult, GitStatusEntry, GitWorkspaceState } from '../../shared/types'
import { useDismiss } from '../use-dismiss'

/** 分支展示文本：detached 显示短哈希，普通分支显示名称。 */
export function gitBranchLabel(state: GitWorkspaceState): string {
  if (state.detachedHead) return state.headShort ? `detached · ${state.headShort}` : 'detached'
  return state.branch ?? '—'
}

export function GitBranchTrigger({ state, compact, anyRunActive, onCheckout, onCreate, onStopAndCheckout }: {
  /** 非仓库或读取失败时为 null，由调用方决定不渲染。 */
  state: GitWorkspaceState
  /** 窄窗口下只显示图标，避免挤占右侧运行配置。 */
  compact: boolean
  /** 任意会话正在运行：切换分支需要先确认是否停止任务。 */
  anyRunActive: boolean
  onCheckout: (branch: string) => Promise<GitOperationResult>
  onCreate: (name: string) => Promise<GitOperationResult>
  /** 停止当前任务后再切换（「停止任务并切换」确认路径）。 */
  onStopAndCheckout: (branch: string) => Promise<GitOperationResult>
}) {
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  // 确认框与 popover 独立：请求切换时先关 popover，再按条件弹确认。
  const [confirm, setConfirm] = useState<'run' | 'dirty' | null>(null)
  const [pendingBranch, setPendingBranch] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createError, setCreateError] = useState('')
  const [viewingStatus, setViewingStatus] = useState(false)
  const [statusEntries, setStatusEntries] = useState<GitStatusEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const closePopover = useCallback(() => {
    setOpen(false)
    setCreating(false)
    setCreateName('')
    setCreateError('')
    setViewingStatus(false)
    setStatusEntries(null)
  }, [])
  useDismiss(open, closePopover, ref)

  // 打开时拉一次本地分支列表，保证与真实仓库同步（不缓存首屏数据）。
  useEffect(() => {
    if (!open) return
    let alive = true
    void window.fastAgent.git.branches().then((items) => { if (alive) setBranches(items) }).catch(() => { if (alive) setBranches([]) })
    return () => { alive = false }
  }, [open])

  // 状态视图切换到该页时拉取，返回时清空避免展示旧数据。
  useEffect(() => {
    if (!open || !viewingStatus) return
    let alive = true
    setStatusEntries(null)
    void window.fastAgent.git.status().then((entries) => { if (alive) setStatusEntries(entries) }).catch(() => { if (alive) setStatusEntries([]) })
    return () => { alive = false }
  }, [open, viewingStatus])

  function requestSwitch(branch: string) {
    if (branch === state.branch || busy) return
    setPendingBranch(branch)
    setOpen(false)
    // 运行中优先确认是否停止任务；否则脏工作区提示风险；都干净直接切。
    if (anyRunActive) setConfirm('run')
    else if (state.isDirty) setConfirm('dirty')
    else void finishSwitch(branch, false)
  }

  async function finishSwitch(branch: string, stopFirst: boolean) {
    setBusy(true)
    try {
      const result = stopFirst ? await onStopAndCheckout(branch) : await onCheckout(branch)
      // 失败信息由回调方（App 层）用 notice 展示，这里只负责收尾。
      if (result.ok) setOpen(false)
    } finally {
      setBusy(false)
      setConfirm(null)
      setPendingBranch(null)
    }
  }

  async function submitCreate() {
    const name = createName.trim()
    if (!name || busy) return
    setBusy(true)
    setCreateError('')
    try {
      const result = await onCreate(name)
      if (result.ok) setOpen(false)
      else setCreateError(result.error ?? '新建分支失败')
    } finally {
      setBusy(false)
    }
  }

  const label = gitBranchLabel(state)
  return <div className="git-branch-selector" ref={ref}>
    <button className="composer-chip git-branch-trigger" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} title={compact ? `当前分支：${label}` : `Git 分支：${label}`}>
      {state.isDirty && <span className="git-dirty-dot" aria-hidden="true" />}
      <GitBranch size={14} />
      {!compact && <span className="git-branch-label">{label}</span>}
      {!compact && state.isDirty && <span className="git-dirty-count">{state.changedFiles}</span>}
      {!compact && <ChevronDown size={12} />}
    </button>
    {open && <div className="git-branch-menu popover-card" role="menu" aria-label="Git 分支">
      <div className="popover-heading">Git 分支</div>
      <div className="git-branch-list">
        {branches.length === 0
          ? <div className="git-branch-empty">暂无本地分支</div>
          : branches.map((name) => {
            const current = name === state.branch
            return <button key={name} type="button" role="menuitemradio" aria-checked={current} className={`git-branch-item ${current ? 'current' : ''}`} disabled={current} onClick={() => requestSwitch(name)} title={current ? `当前分支：${name}` : `切换到 ${name}`}>
              <span className="git-branch-item-icon">{current ? <Check size={13} /> : <GitBranch size={13} />}</span>
              <span className="git-branch-item-name">{name}</span>
            </button>
          })}
      </div>
      <div className="git-branch-actions">
        {creating ? (
          <div className="git-branch-create">
            <input autoFocus value={createName} onChange={(event) => setCreateName(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); void submitCreate() }
              if (event.key === 'Escape') { event.preventDefault(); setCreating(false); setCreateName(''); setCreateError('') }
            }} placeholder="新分支名称" aria-label="新分支名称" />
            {createError && <span className="git-branch-create-error"><CircleAlert size={11} />{createError}</span>}
            <div className="git-branch-create-row">
              <button className="git-branch-create-cancel" onClick={() => { setCreating(false); setCreateName(''); setCreateError('') }}>取消</button>
              <button className="git-branch-create-submit" disabled={!createName.trim() || busy} onClick={() => void submitCreate()}>创建</button>
            </div>
          </div>
        ) : viewingStatus ? (
          <div className="git-branch-status">
            <div className="git-branch-status-title">工作区状态</div>
            {statusEntries === null
              ? <div className="git-branch-status-loading">正在读取…</div>
              : statusEntries.length === 0
                ? <div className="git-branch-status-clean">工作区干净</div>
                : <div className="git-branch-status-list">{statusEntries.map((entry) => (
                  <div className="git-branch-status-item" key={entry.path + entry.status} title={`状态：${entry.status}`}>
                    <span className="git-branch-status-code">{entry.status.trim() || 'M'}</span>
                    <span className="git-branch-status-path">{entry.path}</span>
                  </div>
                ))}</div>}
            <button className="git-branch-back" onClick={() => setViewingStatus(false)}>返回分支列表</button>
          </div>
        ) : <>
          <button className="git-branch-action" onClick={() => { setCreating(true); setViewingStatus(false) }}><Plus size={13} />新建分支</button>
          <button className="git-branch-action" onClick={() => { setViewingStatus(true); setCreating(false) }}>查看 Git 状态</button>
        </>}
      </div>
    </div>}
    {confirm === 'run' && pendingBranch && <RunSwitchDialog branch={pendingBranch} onCancel={() => { setConfirm(null); setPendingBranch(null) }} onConfirm={() => { void finishSwitch(pendingBranch, true) }} busy={busy} />}
    {confirm === 'dirty' && pendingBranch && <DirtySwitchDialog count={state.changedFiles} branch={pendingBranch} onCancel={() => { setConfirm(null); setPendingBranch(null) }} onConfirm={() => { void finishSwitch(pendingBranch, false) }} busy={busy} />}
  </div>
}

/** 运行中切换分支的确认：停止当前任务后再切换。 */
function RunSwitchDialog({ branch, onCancel, onConfirm, busy }: { branch: string; onCancel: () => void; onConfirm: () => void; busy: boolean }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel, busy])
  return <div className="approval-overlay" role="dialog" aria-modal="true" aria-label="切换分支" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <div className="approval-dialog">
      <div className="approval-header">
        <span className="approval-icon doom_loop"><GitBranch size={16} /></span>
        <div className="approval-heading">
          <strong>切换分支？</strong>
          <small>当前 Agent 正在此分支执行任务</small>
        </div>
        <button className="icon-button" aria-label="取消" title="取消" onClick={onCancel} disabled={busy}><X size={14} /></button>
      </div>
      <div className="approval-body">
        <div className="approval-meta"><span className="approval-chip risk"><CircleAlert size={11} />正在运行</span></div>
        <p className="approval-note">切换分支可能影响正在进行的文件操作和 Git 状态。切换前会先停止当前任务，并等待相关文件操作结束。</p>
      </div>
      <div className="approval-actions">
        <button className="approval-secondary" onClick={onCancel} disabled={busy}>取消</button>
        <button className="approval-primary" onClick={onConfirm} disabled={busy}>{busy ? '正在停止并切换…' : `停止任务并切换到 ${branch}`}</button>
      </div>
    </div>
  </div>
}

/** 脏工作区切换的确认：提示风险，但保留用户选择权（不做 stash/reset）。 */
function DirtySwitchDialog({ count, branch, onCancel, onConfirm, busy }: { count: number; branch: string; onCancel: () => void; onConfirm: () => void; busy: boolean }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel, busy])
  return <div className="approval-overlay" role="dialog" aria-modal="true" aria-label="切换分支" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <div className="approval-dialog">
      <div className="approval-header">
        <span className="approval-icon doom_loop"><GitBranch size={16} /></span>
        <div className="approval-heading">
          <strong>切换到 {branch}？</strong>
          <small>工作区存在未提交修改</small>
        </div>
        <button className="icon-button" aria-label="取消" title="取消" onClick={onCancel} disabled={busy}><X size={14} /></button>
      </div>
      <div className="approval-body">
        <div className="approval-meta"><span className="approval-chip risk"><CircleAlert size={11} />{count} 个未提交修改</span></div>
        <p className="approval-note">切换分支可能产生冲突或无法完成切换。不会自动暂存或丢弃你的修改，冲突时 git 会拒绝切换。</p>
      </div>
      <div className="approval-actions">
        <button className="approval-secondary" onClick={onCancel} disabled={busy}>取消</button>
        <button className="approval-primary" onClick={onConfirm} disabled={busy}>{busy ? '正在切换…' : '继续切换'}</button>
      </div>
    </div>
  </div>
}
