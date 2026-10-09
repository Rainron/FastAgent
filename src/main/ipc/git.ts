import type {
  GitBranchInfo, GitCommitDetail, GitCommitSummary, GitIntegrationState, GitOperationResult, GitStashEntry,
  GitRemoteInfo, GitStatusEntry, GitWorkingChanges, GitWorkspaceState
} from '../../shared/types'
import type { IpcRegistrar, MainContext } from '../app-context'
import {
  abortIntegration, addRemote, checkoutBranch, commitChanges, commitDetail, commitPatch, countCommits, createBranch, createTrackingBranch,
  deleteBranch, discardFiles, execGit, fetchRemote, fileDiff, integrationStatus, listBranchInfos, listChanges, listCommits,
  listLocalBranches, listRemoteBranches, listRemoteDetails, listRemotes, listStashes, mergeBranch, parsePorcelain, pullCurrent, pushCurrent,
  rebaseOnto, removeRemote, renameBranch, resetHead, resolveGitWorkspaceState, setRemoteUrl, setUpstream, stageFiles, stashApply, stashDrop, stashPatch,
  stashPop, stashPush, unstageFiles, workingDiff
} from '../git'
import { openInTerminal } from '../git/open-external'
import { suggestCommitMessage } from '../git/commit-message'

const NO_WORKSPACE: GitOperationResult = { ok: false, error: '尚未打开工作区' }

/** Git 状态、分支、提交浏览、改动与提交、远程同步、stash 与合并变基。 */
export function registerGitIpc(handle: IpcRegistrar, ctx: MainContext) {
  /** 写操作统一在这里兜底：无工作区直接拒绝，成功后广播让所有窗口刷新。 */
  const write = (run: (root: string) => Promise<GitOperationResult>) => async (): Promise<GitOperationResult> => {
    if (!ctx.workspaceRoot) return NO_WORKSPACE
    const result = await run(ctx.workspaceRoot)
    if (result.ok) ctx.broadcastGitChanged()
    return result
  }

  handle('git:state', async (): Promise<GitWorkspaceState | null> => {
    if (!ctx.workspaceRoot) return null
    try {
      return await resolveGitWorkspaceState(ctx.workspaceRoot)
    } catch (error) {
      // 读取失败降级隐藏，并记录日志便于事后排查（git 缺失/仓库损坏/权限等）。
      console.warn('Failed to resolve Git workspace state', error)
      return null
    }
  })
  handle('git:branches', (): Promise<string[]> => ctx.workspaceRoot ? listLocalBranches(ctx.workspaceRoot) : Promise.resolve([]))
  handle('git:branchInfos', (): Promise<GitBranchInfo[]> => ctx.workspaceRoot ? listBranchInfos(ctx.workspaceRoot) : Promise.resolve([]))
  handle('git:remoteBranches', (): Promise<string[]> => ctx.workspaceRoot ? listRemoteBranches(ctx.workspaceRoot) : Promise.resolve([]))
  handle('git:remotes', (): Promise<string[]> => ctx.workspaceRoot ? listRemotes(ctx.workspaceRoot) : Promise.resolve([]))
  handle('git:remoteDetails', (): Promise<GitRemoteInfo[]> => ctx.workspaceRoot ? listRemoteDetails(ctx.workspaceRoot) : Promise.resolve([]))
  handle('git:addRemote', (_event, name: string, url: string) => write((root) => addRemote(root, name, url))())
  handle('git:setRemoteUrl', (_event, name: string, url: string) => write((root) => setRemoteUrl(root, name, url))())
  handle('git:removeRemote', (_event, name: string) => write((root) => removeRemote(root, name))())
  handle('git:status', async (): Promise<GitStatusEntry[]> => {
    if (!ctx.workspaceRoot) return []
    const result = await execGit(ctx.workspaceRoot, ['status', '--porcelain'])
    if (result.code !== 0) return []
    return parsePorcelain(result.stdout)
  })
  handle('git:changes', (): Promise<GitWorkingChanges> => ctx.workspaceRoot ? listChanges(ctx.workspaceRoot) : Promise.resolve({ staged: [], unstaged: [] }))
  handle('git:integration', (): Promise<GitIntegrationState> => ctx.workspaceRoot ? integrationStatus(ctx.workspaceRoot) : Promise.resolve({ merging: false, rebasing: false, conflicts: [] }))

  handle('git:commits', (_event, ref: string, limit?: number, skip?: number): Promise<GitCommitSummary[]> =>
    ctx.workspaceRoot ? listCommits(ctx.workspaceRoot, ref, limit, skip) : Promise.resolve([]))
  handle('git:commitCount', (_event, ref: string): Promise<number> => ctx.workspaceRoot ? countCommits(ctx.workspaceRoot, ref) : Promise.resolve(0))
  handle('git:commitDetail', (_event, hash: string): Promise<GitCommitDetail | null> => ctx.workspaceRoot ? commitDetail(ctx.workspaceRoot, hash) : Promise.resolve(null))
  handle('git:commitPatch', (_event, hash: string, path?: string | null): Promise<string> => ctx.workspaceRoot ? commitPatch(ctx.workspaceRoot, hash, path) : Promise.resolve(''))
  handle('git:fileDiff', (_event, path: string, staged: boolean, untracked?: boolean): Promise<string> =>
    ctx.workspaceRoot ? fileDiff(ctx.workspaceRoot, path, Boolean(staged), Boolean(untracked)) : Promise.resolve(''))
  handle('git:workingDiff', (_event, stagedOnly?: boolean): Promise<string> =>
    ctx.workspaceRoot ? workingDiff(ctx.workspaceRoot, { stagedOnly: Boolean(stagedOnly) }) : Promise.resolve(''))
  handle('git:stashes', (): Promise<GitStashEntry[]> => ctx.workspaceRoot ? listStashes(ctx.workspaceRoot) : Promise.resolve([]))
  handle('git:stashPatch', (_event, ref: string): Promise<string> => ctx.workspaceRoot ? stashPatch(ctx.workspaceRoot, ref) : Promise.resolve(''))

  handle('git:checkout', (_event, branch: string) => write((root) => checkoutBranch(root, branch))())
  handle('git:create', (_event, name: string) => write((root) => createBranch(root, name))())
  handle('git:createTracking', (_event, remoteRef: string, localName?: string) => write((root) => createTrackingBranch(root, remoteRef, localName))())
  handle('git:deleteBranch', (_event, name: string, force?: boolean) => write((root) => deleteBranch(root, name, Boolean(force)))())
  handle('git:renameBranch', (_event, from: string, to: string) => write((root) => renameBranch(root, from, to))())
  handle('git:setUpstream', (_event, branch: string, remoteRef: string | null) => write((root) => setUpstream(root, branch, remoteRef))())

  handle('git:stage', (_event, paths: string[]) => write((root) => stageFiles(root, paths))())
  handle('git:unstage', (_event, paths: string[]) => write((root) => unstageFiles(root, paths))())
  handle('git:commit', (_event, message: string, options?: { amend?: boolean }) => write((root) => commitChanges(root, message, options ?? {}))())
  handle('git:discard', (_event, paths: string[], untracked?: string[]) => write((root) => discardFiles(root, paths, { untracked }))())
  handle('git:reset', (_event, mode: 'soft' | 'mixed') => write((root) => resetHead(root, mode === 'soft' ? 'soft' : 'mixed'))())

  handle('git:fetch', (_event, remote?: string) => write((root) => fetchRemote(root, remote || 'origin'))())
  handle('git:pull', () => write((root) => pullCurrent(root))())
  handle('git:push', (_event, remote?: string) => write((root) => pushCurrent(root, { remote }))())

  handle('git:stashPush', (_event, message: string, includeUntracked?: boolean) => write((root) => stashPush(root, message ?? '', { includeUntracked: Boolean(includeUntracked) }))())
  handle('git:stashPop', (_event, ref: string) => write((root) => stashPop(root, ref))())
  handle('git:stashApply', (_event, ref: string) => write((root) => stashApply(root, ref))())
  handle('git:stashDrop', (_event, ref: string) => write((root) => stashDrop(root, ref))())

  handle('git:merge', (_event, ref: string) => write((root) => mergeBranch(root, ref))())
  handle('git:rebase', (_event, ref: string) => write((root) => rebaseOnto(root, ref))())
  handle('git:abortIntegration', () => write((root) => abortIntegration(root))())

  handle('git:openTerminal', () => ctx.workspaceRoot ? openInTerminal(ctx.workspaceRoot) : Promise.resolve({ ok: false, error: '尚未打开工作区' }))
  handle('git:suggestCommitMessage', (_event, modelId?: number | null): Promise<{ message: string | null; error?: string }> => {
    if (!ctx.workspaceRoot) return Promise.resolve({ message: null, error: '尚未打开工作区' })
    const credentials = typeof modelId === 'number' ? ctx.resolveModelCredentials(modelId) : null
    if (!credentials) return Promise.resolve({ message: null, error: '请先选择可用模型' })
    return suggestCommitMessage(ctx.workspaceRoot, credentials)
  })
}
