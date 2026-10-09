import React, { useMemo, useRef, useState } from 'react'
import { Check, Cloud, GitBranch, Link, Package, Pencil, Plus, Search, MoreVertical, Trash2 } from 'lucide-react'
import type { GitBranchInfo, GitRemoteInfo, GitStashEntry } from '../../shared/types'
import { useDismiss } from '../use-dismiss'
import { usePopoverClamp } from '../use-popover-clamp'
import { branchRowBadge, filterBranchInfos, filterRemoteBranches } from './git-view'

interface BranchColumnProps {
  branches: GitBranchInfo[]
  remoteBranches: string[]
  remoteInfos: GitRemoteInfo[]
  stashes: GitStashEntry[]
  selectedBranch: string | null
  busy: boolean
  onSelectBranch: (name: string) => void
  onCheckout: (name: string) => void
  onCreateBranch: () => void
  onRenameBranch: (name: string) => void
  onDeleteBranch: (name: string) => void
  onSetUpstream: (name: string) => void
  onCheckoutRemote: (ref: string) => void
  onAddRemote: () => void
  onEditRemote: (remote: GitRemoteInfo) => void
  onRemoveRemote: (name: string) => void
  onStashApply: (ref: string) => void
  onStashPop: (ref: string) => void
  onStashDrop: (ref: string) => void
  onPreviewStash: (ref: string) => void
}

/** 分支行右侧的操作菜单，逐行独立开合。 */
function BranchMenu({ branch, busy, onRename, onDelete, onSetUpstream }: {
  branch: GitBranchInfo; busy: boolean; onRename: () => void; onDelete: () => void; onSetUpstream: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useDismiss(open, () => setOpen(false), ref)
  usePopoverClamp(menuRef, open)
  return <span className="git-row-menu" ref={ref}>
    <button className="git-icon-button" aria-label={`${branch.name} 的操作`} title="更多操作" aria-expanded={open} disabled={busy}
      onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}><MoreVertical size={13} /></button>
    {open && <div ref={menuRef} className="git-row-menu-list popover-card" role="menu">
      <button role="menuitem" onClick={(event) => { event.stopPropagation(); setOpen(false); onRename() }}>重命名分支</button>
      <button role="menuitem" onClick={(event) => { event.stopPropagation(); setOpen(false); onSetUpstream() }}>设置 upstream</button>
      <button role="menuitem" className="danger" disabled={branch.current}
        title={branch.current ? '不能删除当前分支' : '删除分支'}
        onClick={(event) => { event.stopPropagation(); setOpen(false); onDelete() }}><Trash2 size={13} />删除分支</button>
    </div>}
  </span>
}

/** 顶栏分支切换器的下拉内容：本地分支（含同步角标）、远程、stash。点分支名看它的历史，「切换」才真正检出。 */
export const GitBranchColumn = React.memo(function GitBranchColumn(props: BranchColumnProps) {
  const [query, setQuery] = useState('')
  const branches = useMemo(() => filterBranchInfos(props.branches, query), [props.branches, query])
  const remotes = useMemo(() => filterRemoteBranches(props.remoteBranches, query), [props.remoteBranches, query])
  return <div className="git-branch-pane">
    <div className="git-panel-filter">
      <label className="git-search"><Search size={13} aria-hidden="true" />
        <input autoFocus value={query} placeholder="过滤分支" aria-label="过滤分支" onChange={(event) => setQuery(event.target.value)} />
      </label>
    </div>
    <div className="git-panel-scroll">
      <div className="git-panel-group">本地分支</div>
      {branches.length === 0
        ? <div className="git-panel-empty">没有匹配的分支</div>
        : branches.map((branch) => {
          const badge = branchRowBadge(branch)
          return <div key={branch.name} className={`git-branch-row ${props.selectedBranch === branch.name ? 'selected' : ''} ${branch.current ? 'current' : ''}`}>
            <button className="git-branch-main" onClick={() => props.onSelectBranch(branch.name)} title={`查看 ${branch.name} 的提交历史`}>
              <span className="git-row-icon">{branch.current ? <Check size={13} /> : <GitBranch size={13} />}</span>
              <span className="git-ellipsis">{branch.name}</span>
              {badge && <span className={`git-badge ${badge.tone}`} title={badge.title}>{badge.text}</span>}
            </button>
            {!branch.current && <button className="git-icon-button" disabled={props.busy} title={`切换到 ${branch.name}`} aria-label={`切换到 ${branch.name}`}
              onClick={() => props.onCheckout(branch.name)}>切换</button>}
            <BranchMenu branch={branch} busy={props.busy}
              onRename={() => props.onRenameBranch(branch.name)}
              onDelete={() => props.onDeleteBranch(branch.name)}
              onSetUpstream={() => props.onSetUpstream(branch.name)} />
          </div>
        })}

      <div className="git-panel-group">远程仓库 · {props.remoteInfos.length}</div>
      {/* 一个远程都没有时 push / pull 全部用不了，这里要能直接把它配上 */}
      {props.remoteInfos.length === 0
        ? <div className="git-panel-empty">还没有远程仓库，下方「添加远程」配置后才能 push / pull</div>
        : props.remoteInfos.map((remote) => <div key={remote.name} className="git-branch-row">
          <span className="git-branch-main static" title={`${remote.name}：${remote.url}`}>
            <span className="git-row-icon"><Link size={13} /></span>
            <span className="git-ellipsis"><strong>{remote.name}</strong> <span className="git-remote-url mono">{remote.url}</span></span>
          </span>
          <button className="git-icon-button" disabled={props.busy} title="修改仓库地址" aria-label={`修改 ${remote.name} 的地址`}
            onClick={() => props.onEditRemote(remote)}><Pencil size={13} /></button>
          <button className="git-icon-button danger" disabled={props.busy} title="删除这个远程（不影响远程仓库本身）"
            aria-label={`删除远程 ${remote.name}`} onClick={() => props.onRemoveRemote(remote.name)}><Trash2 size={13} /></button>
        </div>)}

      <div className="git-panel-group">远程分支</div>
      {remotes.length === 0
        ? <div className="git-panel-empty">没有远程分支</div>
        : remotes.map((name) => <div key={name} className="git-branch-row">
          <span className="git-branch-main static" title={name}>
            <span className="git-row-icon"><Cloud size={13} /></span>
            <span className="git-ellipsis mono">{name}</span>
          </span>
          <button className="git-icon-button" disabled={props.busy} title={`检出 ${name} 为本地分支`} onClick={() => props.onCheckoutRemote(name)}>检出</button>
        </div>)}

      <div className="git-panel-group">暂存（stash）· {props.stashes.length}</div>
      {props.stashes.length === 0
        ? <div className="git-panel-empty">没有 stash</div>
        : props.stashes.map((stash) => <div key={stash.ref} className="git-branch-row">
          <button className="git-branch-main" onClick={() => props.onPreviewStash(stash.ref)} title={`${stash.ref}：${stash.message}`}>
            <span className="git-row-icon"><Package size={13} /></span>
            <span className="git-ellipsis">{stash.message || stash.ref}</span>
          </button>
          <button className="git-icon-button" disabled={props.busy} title="恢复并保留 stash" onClick={() => props.onStashApply(stash.ref)}>应用</button>
          <button className="git-icon-button" disabled={props.busy} title="恢复并移除 stash" onClick={() => props.onStashPop(stash.ref)}>弹出</button>
          <button className="git-icon-button danger" disabled={props.busy} title="丢弃这条 stash" aria-label={`丢弃 ${stash.ref}`}
            onClick={() => props.onStashDrop(stash.ref)}><Trash2 size={13} /></button>
        </div>)}
    </div>
    <div className="git-branch-pane-actions">
      <button className="git-text-button" disabled={props.busy} onClick={props.onCreateBranch}><Plus size={13} />新建分支</button>
      <button className="git-text-button" disabled={props.busy} onClick={props.onAddRemote}><Link size={13} />添加远程</button>
    </div>
  </div>
})
