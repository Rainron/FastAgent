import React, { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, GitBranch, GitMerge, GitPullRequestArrow, History, Link, Loader2, Package, Plus, RefreshCw, RefreshCcw, Send, Terminal, X } from 'lucide-react'
import type { GitCommitDetail, GitOperationResult, GitWorkspaceState } from '../../shared/types'
import { useEventCallback } from '../use-event-callback'
import { GitBranchColumn } from './GitBranchColumn'
import { GitCommitColumn } from './GitCommitColumn'
import { GitCommitDetailView } from './GitCommitDetailView'
import { GitConfirmDialog, GitPickDialog, GitPromptDialog, type GitConfirmRequest, type GitPickRequest, type GitPromptRequest } from './GitDialogs'
import { GitDiffView } from './GitDiffView'
import { GitBranchSwitcher, GitMoreMenu, type GitMenuItem } from './GitToolbarMenus'
import { GitWorkingDiff, type GitActiveChange } from './GitWorkingDiff'
import { GitWorkingView } from './GitWorkingView'
import { headLabel, syncLabel } from './git-view'
import { useGitChangeView, useGitPanel } from './hooks/use-git-panel'

/** 面板的两种视图：「更改」看工作区并提交，「历史」翻提交记录。 */
type GitPanelView = 'changes' | 'history'

const UNTRACK_OPTION = '（取消跟踪）'
const RESET_SOFT = 'soft · 改动留在暂存区'
const RESET_MIXED = 'mixed · 改动留在工作区'

interface GitPanelProps {
  open: boolean
  onClose: () => void
  state: GitWorkspaceState | null
  /** 有会话在跑时切分支要先确认停止任务。 */
  anyRunActive: boolean
  /** 生成提交信息用的模型 id；为空时禁用该入口。 */
  modelId: number | null
  onNotice: (message: string) => void
  onCheckout: (branch: string) => Promise<GitOperationResult>
  onStopAndCheckout: (branch: string) => Promise<GitOperationResult>
  /** 把文本塞进输入框（AI 审查 diff、解释提交）。 */
  onPrefillComposer: (text: string) => void
  onRefreshState: () => void
}

/**
 * Git 面板：顶栏是分支切换器与同步动作；主体分「更改 / 历史」两个视图，
 * 左栏挑对象（改动文件 / 提交），右栏整块展示它的差异或详情。
 * 流式输出期间 WorkspaceShell 每帧重渲染，所以整层 memo，传给子组件的回调一律 useEventCallback。
 */
export const GitPanel = React.memo(function GitPanel(props: GitPanelProps) {
  const panel = useGitPanel(props.open, props.state?.branch ?? null, props.onNotice)
  const changeView = useGitChangeView()
  const [view, setView] = useState<GitPanelView>('changes')
  const [activeChange, setActiveChange] = useState<GitActiveChange | null>(null)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [confirm, setConfirm] = useState<GitConfirmRequest | null>(null)
  const [prompt, setPrompt] = useState<GitPromptRequest | null>(null)
  const [pick, setPick] = useState<GitPickRequest | null>(null)
  const [stashPreview, setStashPreview] = useState<{ ref: string; patch: string } | null>(null)
  const [syncing, setSyncing] = useState(false)

  // 历史视图总要有一条提交在右栏：进来时、换分支后选中的提交不在新列表里时，都落到最新一条
  const { commits, target, setTarget } = panel
  useEffect(() => {
    if (view !== 'history' || !commits.length) return
    if (target.kind === 'commit' && commits.some((commit) => commit.hash === target.hash)) return
    setTarget({ kind: 'commit', hash: commits[0].hash })
  }, [view, commits, target, setTarget])

  const activeFile = useMemo(() => {
    if (!activeChange) return null
    const pool = activeChange.staged ? panel.changes.staged : panel.changes.unstaged
    return pool.find((file) => file.path === activeChange.path) ?? null
  }, [activeChange, panel.changes])

  const closeDialogs = () => { setConfirm(null); setPrompt(null); setPick(null); setBranchMenuOpen(false) }
  // 分支下拉里的动作多半要弹对话框：对话框一出来就把下拉收掉，免得两层浮层叠在一起
  const dialogOpen = Boolean(confirm || prompt || pick || stashPreview)
  useEffect(() => { if (dialogOpen) setBranchMenuOpen(false) }, [dialogOpen])
  /** 面板里的写操作大多要顺带刷新输入框上的分支胶囊。 */
  const run = async (action: () => Promise<GitOperationResult>, success: string, failure: string) => {
    closeDialogs()
    const result = await panel.runAction(action, { success, failure })
    props.onRefreshState()
    return result
  }

  // 在分支列表里点分支名 = 看它的历史：切到历史视图并收起下拉
  const handleSelectBranch = useEventCallback((name: string) => {
    panel.setSelectedBranch(name)
    setView('history')
    setBranchMenuOpen(false)
  })
  const handleSwitchView = useEventCallback((next: GitPanelView) => {
    setView(next)
    if (next === 'changes') panel.setTarget({ kind: 'working' })
  })
  const handleSelectCommit = useEventCallback((hash: string) => panel.setTarget({ kind: 'commit', hash }))
  const handleLoadMore = useEventCallback(() => { void panel.loadMoreCommits() })

  /** 切分支复用 WorkspaceShell 的逻辑：运行中先确认停任务，脏工作区提示风险。 */
  const handleCheckout = useEventCallback((branch: string) => {
    setBranchMenuOpen(false)
    const finish = async (stopFirst: boolean) => {
      closeDialogs()
      await (stopFirst ? props.onStopAndCheckout(branch) : props.onCheckout(branch))
      await panel.reloadOverview()
      props.onRefreshState()
    }
    if (props.anyRunActive) {
      setConfirm({
        title: `切换到 ${branch}？`, chip: '有任务正在运行', confirmLabel: '停止任务并切换',
        description: '切换分支会影响正在进行的文件操作，会先停止当前任务再切换。',
        onConfirm: () => void finish(true)
      })
      return
    }
    if (props.state?.isDirty) {
      setConfirm({
        title: `切换到 ${branch}？`, chip: `${props.state.changedFiles} 个未提交改动`, confirmLabel: '继续切换',
        description: '不会自动暂存或丢弃你的改动；有冲突时 git 会拒绝切换。',
        onConfirm: () => void finish(false)
      })
      return
    }
    void finish(false)
  })

  const handleCreateBranch = useEventCallback(() => setPrompt({
    title: '新建分支', description: `基于当前 HEAD（${headLabel(props.state)}）创建并切换`, label: '分支名', placeholder: 'feat/新功能',
    confirmLabel: '创建并切换',
    onSubmit: (value) => void run(() => window.fastAgent.git.create(value), `已创建并切换到 ${value}`, '新建分支失败')
  }))

  const handleRenameBranch = useEventCallback((name: string) => setPrompt({
    title: '重命名分支', description: `当前名称：${name}`, label: '新名称', initialValue: name, confirmLabel: '重命名',
    validate: (value) => value === name ? '新名称与原名称相同' : null,
    onSubmit: (value) => void run(() => window.fastAgent.git.renameBranch(name, value), `已重命名为 ${value}`, '重命名分支失败')
  }))

  const handleDeleteBranch = useEventCallback((name: string) => setConfirm({
    title: `删除分支 ${name}？`, confirmLabel: '删除', danger: true,
    description: '只删除本地分支，远程分支不受影响。未合并的分支会先被拒绝，再由你决定是否强制删除。',
    onConfirm: () => void (async () => {
      const result = await run(() => window.fastAgent.git.deleteBranch(name), `已删除分支 ${name}`, '删除分支失败')
      if (result.needsForce) {
        setConfirm({
          title: `强制删除 ${name}？`, chip: '分支尚未合并', confirmLabel: '强制删除', danger: true,
          description: '这个分支上的提交在别处没有副本，删除后只能靠 reflog 找回。',
          onConfirm: () => void run(() => window.fastAgent.git.deleteBranch(name, true), `已强制删除分支 ${name}`, '删除分支失败')
        })
      }
    })()
  }))

  const handleSetUpstream = useEventCallback((name: string) => setPick({
    title: `为 ${name} 设置 upstream`, description: '选择要跟踪的远程分支', emptyText: '没有可用的远程分支',
    options: [UNTRACK_OPTION, ...panel.remoteBranches],
    onPick: (value) => void run(
      () => window.fastAgent.git.setUpstream(name, value === UNTRACK_OPTION ? null : value),
      value === UNTRACK_OPTION ? '已取消跟踪' : `已跟踪 ${value}`, '设置 upstream 失败'
    )
  }))

  const handleCheckoutRemote = useEventCallback((ref: string) => setConfirm({
    title: `检出 ${ref}？`, confirmLabel: '检出为本地分支',
    description: '会新建同名本地分支并跟踪该远程分支，然后切换过去。',
    onConfirm: () => void run(() => window.fastAgent.git.createTracking(ref), `已检出 ${ref}`, '检出远程分支失败')
  }))

  /** 外部改动一般会经 onChanged 自动同步，但 git 钩子之外的操作（手改 config、别的客户端）不会触发 */
  const handleRefresh = useEventCallback(() => {
    void panel.reloadOverview()
    props.onRefreshState()
  })

  const handleAddRemote = useEventCallback(() => setPrompt({
    title: '添加远程仓库', description: '配置后才能 push / pull；名字通常用 origin',
    label: '远程名', placeholder: 'origin', initialValue: 'origin', confirmLabel: '添加',
    secondary: { label: '仓库地址', placeholder: 'git@github.com:用户名/仓库.git 或 https://…' },
    onSubmit: (name, url) => void run(() => window.fastAgent.git.addRemote(name, url), `已添加远程 ${name}`, '添加远程失败')
  }))

  const handleEditRemote = useEventCallback((remote: { name: string; url: string }) => setPrompt({
    title: `修改 ${remote.name} 的地址`, description: '仓库搬家、或从 https 换成 ssh 时用',
    label: '远程名', initialValue: remote.name, confirmLabel: '保存',
    secondary: { label: '仓库地址', initialValue: remote.url },
    validate: (name) => name === remote.name ? null : '暂不支持改名，请删除后重新添加',
    onSubmit: (_name, url) => void run(() => window.fastAgent.git.setRemoteUrl(remote.name, url), `已更新 ${remote.name} 的地址`, '修改远程地址失败')
  }))

  const handleRemoveRemote = useEventCallback((name: string) => setConfirm({
    title: `删除远程 ${name}？`, confirmLabel: '删除', danger: true,
    description: '只断开本地与该远程的关联，远程仓库本身和上面的提交都不受影响。跟踪这个远程的分支会失去 upstream。',
    onConfirm: () => void run(() => window.fastAgent.git.removeRemote(name), `已删除远程 ${name}`, '删除远程失败')
  }))

  const handleStashPush = useEventCallback(() => setPrompt({
    title: '暂存当前改动', description: '未跟踪文件也会一并收走', label: '备注', placeholder: '可选：这次暂存的说明',
    confirmLabel: '暂存', validate: () => null,
    onSubmit: (value) => void run(() => window.fastAgent.git.stashPush(value, true), '已暂存当前改动', 'stash 失败')
  }))
  const handleStashApply = useEventCallback((ref: string) => void run(() => window.fastAgent.git.stashApply(ref), `已应用 ${ref}`, 'stash apply 失败'))
  const handleStashPop = useEventCallback((ref: string) => void run(() => window.fastAgent.git.stashPop(ref), `已弹出 ${ref}`, 'stash pop 失败'))
  const handleStashDrop = useEventCallback((ref: string) => setConfirm({
    title: `丢弃 ${ref}？`, confirmLabel: '丢弃', danger: true, description: '这条 stash 里的改动会被永久删除。',
    onConfirm: () => void run(() => window.fastAgent.git.stashDrop(ref), `已丢弃 ${ref}`, 'stash drop 失败')
  }))
  const handlePreviewStash = useEventCallback((ref: string) => {
    void window.fastAgent.git.stashPatch(ref)
      .then((patch) => setStashPreview({ ref, patch }))
      .catch(() => props.onNotice('读取 stash 内容失败'))
  })

  const handleStage = useEventCallback((paths: string[]) => void run(() => window.fastAgent.git.stage(paths), `已暂存 ${paths.length} 个文件`, '暂存失败'))
  const handleUnstage = useEventCallback((paths: string[]) => void run(() => window.fastAgent.git.unstage(paths), `已取消暂存 ${paths.length} 个文件`, '取消暂存失败'))
  const handleCommit = useEventCallback((message: string, amend: boolean, stageAllFirst: boolean) => void (async () => {
    if (stageAllFirst && !amend) {
      const staged = await window.fastAgent.git.stage(panel.changes.unstaged.map((file) => file.path))
      if (!staged.ok) { props.onNotice(`暂存失败：${staged.error ?? '未知错误'}`); return }
    }
    await run(() => window.fastAgent.git.commit(message, { amend }), amend ? '已修正上次提交' : '已提交', '提交失败')
  })())

  const handleDiscard = useEventCallback((tracked: string[], untracked: string[]) => setConfirm({
    title: `丢弃 ${tracked.length + untracked.length} 个文件的改动？`, confirmLabel: '丢弃', danger: true,
    chip: untracked.length ? `其中 ${untracked.length} 个未跟踪文件会被删除` : undefined,
    description: '已跟踪文件会回到 HEAD 的状态，未跟踪文件会被直接删除，两者都无法撤销。',
    onConfirm: () => void run(() => window.fastAgent.git.discard(tracked, untracked), '已丢弃选中改动', '丢弃改动失败')
  }))

  const handleReset = useEventCallback(() => setPick({
    title: '回退最近一次提交', description: '选择改动的去向', options: [RESET_MIXED, RESET_SOFT], emptyText: '', searchable: false,
    onPick: (value) => void run(
      () => window.fastAgent.git.reset(value === RESET_SOFT ? 'soft' : 'mixed'),
      '已回退最近一次提交', '回退提交失败'
    )
  }))

  const handleSuggestMessage = useEventCallback(async () => {
    const result = await window.fastAgent.git.suggestCommitMessage(props.modelId)
    if (!result.message) { props.onNotice(`生成提交信息失败：${result.error ?? '未知错误'}`); return null }
    return result.message
  })

  const handleReviewWithModel = useEventCallback(() => {
    void window.fastAgent.git.workingDiff().then((diff) => {
      if (!diff.trim()) { props.onNotice('当前没有未提交改动'); return }
      props.onPrefillComposer(`帮我审查下面这份未提交的改动，指出问题与风险：\n\n\`\`\`diff\n${diff}\n\`\`\``)
      props.onClose()
    }).catch(() => props.onNotice('读取 diff 失败'))
  })

  const handleAskAboutCommit = useEventCallback((detail: GitCommitDetail) => {
    props.onPrefillComposer(`解释这条提交做了什么、为什么这么改：\n\n${detail.shortHash} ${detail.subject}\n${detail.body}\n\n改动文件：\n${detail.files.map((file) => `- ${file.path} (+${file.additions} -${file.deletions})`).join('\n')}`)
    props.onClose()
  })

  const handleCopyHash = useEventCallback((hash: string) => {
    void navigator.clipboard.writeText(hash).then(() => props.onNotice('已复制完整哈希')).catch(() => props.onNotice('复制失败'))
  })

  const handleSync = useEventCallback((kind: 'fetch' | 'pull' | 'push') => void (async () => {
    setSyncing(true)
    try {
      const labels = { fetch: ['已同步远程引用', 'fetch 失败'], pull: ['已拉取远程提交', 'pull 失败'], push: ['已推送到远程', 'push 失败'] } as const
      const action = kind === 'fetch' ? () => window.fastAgent.git.fetch() : kind === 'pull' ? () => window.fastAgent.git.pull() : () => window.fastAgent.git.push()
      await run(action, labels[kind][0], labels[kind][1])
    } finally {
      setSyncing(false)
    }
  })())

  /** 多远程仓库才给这个入口：只有一个 origin 时选来选去没有意义 */
  const handlePushTo = useEventCallback(() => setPick({
    title: '推送到指定远程', description: `当前分支：${headLabel(props.state)}`, emptyText: '没有配置任何远程',
    options: panel.remotes,
    onPick: (remote) => void (async () => {
      setSyncing(true)
      try {
        await run(() => window.fastAgent.git.push(remote), `已推送到 ${remote}`, `推送到 ${remote} 失败`)
      } finally {
        setSyncing(false)
      }
    })()
  }))

  const handleIntegrate = useEventCallback((kind: 'merge' | 'rebase') => setPick({
    title: kind === 'merge' ? '合并分支到当前分支' : '把当前分支变基到',
    description: '冲突时会停下来并列出冲突文件，不会自动解决',
    emptyText: '没有可选的分支',
    options: [...panel.branches.filter((branch) => !branch.current).map((branch) => branch.name), ...panel.remoteBranches],
    onPick: (value) => void run(
      () => kind === 'merge' ? window.fastAgent.git.merge(value) : window.fastAgent.git.rebase(value),
      kind === 'merge' ? `已合并 ${value}` : `已变基到 ${value}`,
      kind === 'merge' ? '合并失败' : '变基失败'
    )
  }))

  const handleAbort = useEventCallback(() => setConfirm({
    title: '中止进行中的操作？', confirmLabel: '中止', danger: true,
    description: '会回到合并或变基开始前的状态，期间已解决的冲突会丢失。',
    onConfirm: () => void run(() => window.fastAgent.git.abortIntegration(), '已中止', '中止失败')
  }))

  const handleOpenTerminal = useEventCallback(() => {
    void window.fastAgent.git.openTerminal().then((result) => {
      if (!result.ok) props.onNotice(`打开终端失败：${result.error ?? '未知错误'}`)
    })
  })

  if (!props.open) return null
  const sync = syncLabel(props.state?.sync)
  const busy = panel.busy || syncing
  const changedCount = panel.changes.staged.length + panel.changes.unstaged.length
  const integrating = panel.integration.merging || panel.integration.rebasing
  const hasUpstream = Boolean(props.state?.sync)
  const moreItems: GitMenuItem[] = [
    ...(panel.remotes.length > 0 ? [{ key: 'pushTo', label: '推送到指定远程…', icon: <Send size={14} />, disabled: busy, onSelect: handlePushTo }] : []),
    { key: 'merge', label: '合并分支到当前分支…', icon: <GitMerge size={14} />, disabled: busy, separatorBefore: panel.remotes.length > 0, onSelect: () => handleIntegrate('merge') },
    { key: 'rebase', label: '变基当前分支到…', icon: <GitPullRequestArrow size={14} />, disabled: busy, onSelect: () => handleIntegrate('rebase') },
    { key: 'branch', label: '新建分支…', icon: <Plus size={14} />, disabled: busy, separatorBefore: true, onSelect: handleCreateBranch },
    { key: 'stash', label: '暂存当前改动（stash）…', icon: <Package size={14} />, disabled: busy || !changedCount, onSelect: handleStashPush },
    { key: 'remote', label: '添加远程仓库…', icon: <Link size={14} />, disabled: busy, onSelect: handleAddRemote }
  ]

  return <div className="git-panel-overlay" role="dialog" aria-modal="true" aria-label="Git 面板"
    onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) props.onClose() }}>
    <div className="git-panel">
      <div className="git-panel-head">
        <GitBranchSwitcher label={headLabel(props.state)} open={branchMenuOpen} onOpenChange={setBranchMenuOpen}>
          <GitBranchColumn branches={panel.branches} remoteBranches={panel.remoteBranches} remoteInfos={panel.remoteInfos}
            onAddRemote={handleAddRemote} onEditRemote={handleEditRemote} onRemoveRemote={handleRemoveRemote} stashes={panel.stashes}
            selectedBranch={panel.selectedBranch} busy={busy}
            onSelectBranch={handleSelectBranch} onCheckout={handleCheckout} onCreateBranch={handleCreateBranch}
            onRenameBranch={handleRenameBranch} onDeleteBranch={handleDeleteBranch} onSetUpstream={handleSetUpstream}
            onCheckoutRemote={handleCheckoutRemote} onStashApply={handleStashApply}
            onStashPop={handleStashPop} onStashDrop={handleStashDrop} onPreviewStash={handlePreviewStash} />
        </GitBranchSwitcher>
        <span className={`git-sync-state ${sync.tone}`} title={sync.title}>{sync.text}</span>
        {integrating && <span className="git-sync-state warn">{panel.integration.merging ? '合并中' : '变基中'}</span>}
        {integrating && <button className="git-tool-button danger" disabled={busy} onClick={handleAbort}>中止</button>}
        <span className="git-grow" />
        {busy && <Loader2 size={14} className="git-spin" aria-label="执行中" />}
        <button className="git-tool-button" disabled={busy} title="从远程拉取最新引用，不改动工作区" onClick={() => handleSync('fetch')}><RefreshCcw size={14} />Fetch</button>
        <button className="git-tool-button" disabled={busy || !hasUpstream} title={hasUpstream ? '拉取并合并远程提交' : '当前分支没有 upstream'} onClick={() => handleSync('pull')}>
          <ArrowDown size={14} />Pull{props.state?.sync?.behind ? <span className="git-tool-count">{props.state.sync.behind}</span> : null}
        </button>
        <button className="git-tool-button" disabled={busy || !panel.remotes.length} title={panel.remotes.length ? '推送当前分支' : '还没有配置远程仓库'} onClick={() => handleSync('push')}>
          <ArrowUp size={14} />Push{props.state?.sync?.ahead ? <span className="git-tool-count">{props.state.sync.ahead}</span> : null}
        </button>
        <GitMoreMenu items={moreItems} />
        <span className="git-toolbar-divider" aria-hidden="true" />
        <button className="git-tool-button icon" disabled={busy} title="重新读取分支、远程、stash 与改动" aria-label="刷新" onClick={handleRefresh}><RefreshCw size={14} /></button>
        <button className="git-tool-button icon" disabled={busy} title="在系统终端里打开仓库目录" aria-label="打开终端" onClick={handleOpenTerminal}><Terminal size={14} /></button>
        <button className="git-tool-button icon" aria-label="关闭 Git 面板" title="关闭" onClick={props.onClose}><X size={15} /></button>
      </div>
      {panel.integration.conflicts.length > 0 && <div className="git-conflict-banner">
        存在 {panel.integration.conflicts.length} 个冲突文件，解决后暂存它们再继续：{panel.integration.conflicts.join('、')}
      </div>}
      <div className="git-panel-body">
        <div className="git-side">
          <div className="git-view-tabs" role="tablist" aria-label="Git 视图">
            <button role="tab" aria-selected={view === 'changes'} className={view === 'changes' ? 'on' : ''} onClick={() => handleSwitchView('changes')}>
              更改{changedCount > 0 && <span className="git-tab-count">{changedCount}</span>}
            </button>
            <button role="tab" aria-selected={view === 'history'} className={view === 'history' ? 'on' : ''} onClick={() => handleSwitchView('history')}>
              <History size={13} />历史
            </button>
          </div>
          {view === 'changes'
            ? <GitWorkingView changes={panel.changes} busy={busy}
              canSuggestMessage={props.modelId !== null}
              viewMode={changeView.mode} collapsedDirs={changeView.collapsedDirs}
              active={activeChange} onActivate={setActiveChange}
              onViewModeChange={changeView.setMode} onToggleDir={changeView.toggleDir}
              onStage={handleStage} onUnstage={handleUnstage} onCommit={handleCommit} onDiscard={handleDiscard}
              onReset={handleReset} onReviewWithModel={handleReviewWithModel} onSuggestMessage={handleSuggestMessage}
              onNotice={props.onNotice} />
            : <GitCommitColumn branch={panel.selectedBranch} commits={panel.commits} total={panel.commitTotal}
              loading={panel.loadingCommits} selectedHash={panel.target.kind === 'commit' ? panel.target.hash : null}
              onSelectCommit={handleSelectCommit} onLoadMore={handleLoadMore} />}
        </div>
        {view === 'changes'
          ? <GitWorkingDiff active={activeChange} file={activeFile} />
          : <GitCommitDetailView detail={panel.target.kind === 'commit' ? panel.detail : null} empty={!panel.commits.length} onCopyHash={handleCopyHash} onAskModel={handleAskAboutCommit} />}
      </div>
    </div>
    {confirm && <GitConfirmDialog request={confirm} busy={busy} onCancel={() => setConfirm(null)} />}
    {prompt && <GitPromptDialog request={prompt} busy={busy} onCancel={() => setPrompt(null)} />}
    {pick && <GitPickDialog request={pick} busy={busy} onCancel={() => setPick(null)} />}
    {stashPreview && <div className="approval-overlay" role="dialog" aria-modal="true" aria-label="stash 内容"
      onPointerDown={(event) => { if (event.target === event.currentTarget) setStashPreview(null) }}>
      <div className="approval-dialog git-stash-preview">
        <div className="approval-header">
          <span className="approval-icon"><GitBranch size={16} /></span>
          <div className="approval-heading"><strong>{stashPreview.ref}</strong><small>stash 内容预览</small></div>
          <button className="icon-button" aria-label="关闭" title="关闭" onClick={() => setStashPreview(null)}><X size={14} /></button>
        </div>
        <div className="approval-body"><GitDiffView patch={stashPreview.patch} empty="这条 stash 没有文本改动" /></div>
      </div>
    </div>}
  </div>
})
