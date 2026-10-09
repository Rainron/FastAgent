import type { GitOperationResult } from '../../shared/types'
import { execGit, failureReason, GIT_NETWORK_TIMEOUT_MS } from './exec'
import { resolveGitWorkspaceState, resolveSyncState } from './state'

/** 远程名列表（origin、upstream…）。 */
export async function listRemotes(root: string): Promise<string[]> {
  const result = await execGit(root, ['remote'])
  if (result.code !== 0) return []
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function validateRemote(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return '远程名不能为空'
  if (trimmed.startsWith('-')) return '远程名不合法'
  if (/[\s~^:?*[\]\\]/.test(trimmed)) return '远程名包含非法字符'
  return null
}

/** URL 不做协议白名单，git 支持的形态太多（ssh、https、file、相对路径）；只挡空值与会被当成选项的开头短横 */
function validateRemoteUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return '仓库地址不能为空'
  if (trimmed.startsWith('-')) return '仓库地址不合法'
  return null
}

/** 远程名与地址；`git remote -v` 同一个远程会出 fetch/push 两行，这里只取 fetch 那条。 */
export async function listRemoteDetails(root: string): Promise<Array<{ name: string; url: string }>> {
  const result = await execGit(root, ['remote', '-v'])
  if (result.code !== 0) return []
  const seen = new Map<string, string>()
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
    if (!match || match[3] !== 'fetch') continue
    seen.set(match[1], match[2])
  }
  return [...seen.entries()].map(([name, url]) => ({ name, url }))
}

/** 新增远程。同名已存在时 git 自己会拒绝，把它的原文透出来即可。 */
export async function addRemote(root: string, name: string, url: string): Promise<GitOperationResult> {
  const invalidName = validateRemote(name)
  if (invalidName) return { ok: false, error: invalidName }
  const invalidUrl = validateRemoteUrl(url)
  if (invalidUrl) return { ok: false, error: invalidUrl }
  const result = await execGit(root, ['remote', 'add', name.trim(), url.trim()])
  if (result.code !== 0) return { ok: false, error: failureReason(result, '添加远程失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root) }
}

/** 改远程地址；仓库搬家或从 https 换成 ssh 时用。 */
export async function setRemoteUrl(root: string, name: string, url: string): Promise<GitOperationResult> {
  const invalidName = validateRemote(name)
  if (invalidName) return { ok: false, error: invalidName }
  const invalidUrl = validateRemoteUrl(url)
  if (invalidUrl) return { ok: false, error: invalidUrl }
  const result = await execGit(root, ['remote', 'set-url', name.trim(), url.trim()])
  if (result.code !== 0) return { ok: false, error: failureReason(result, '修改远程地址失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root) }
}

/** 删除远程。只断开本地与远程的关联，远程仓库本身不受影响。 */
export async function removeRemote(root: string, name: string): Promise<GitOperationResult> {
  const invalid = validateRemote(name)
  if (invalid) return { ok: false, error: invalid }
  const result = await execGit(root, ['remote', 'remove', name.trim()])
  if (result.code !== 0) return { ok: false, error: failureReason(result, '删除远程失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root) }
}

/** fetch 指定远程（默认 origin）并带回最新同步状态。 */
export async function fetchRemote(root: string, remote = 'origin'): Promise<GitOperationResult> {
  const invalid = validateRemote(remote)
  if (invalid) return { ok: false, error: invalid }
  const result = await execGit(root, ['fetch', '--prune', remote.trim()], GIT_NETWORK_TIMEOUT_MS)
  if (result.code !== 0) return { ok: false, error: failureReason(result, 'fetch 失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root), output: (result.stderr || result.stdout).trim() }
}

/**
 * pull 当前分支。只允许快进：--ff-only 避免在桌面端悄悄生成合并提交或触发交互式 rebase；
 * 需要合并时由用户显式走 merge/rebase 入口。
 */
export async function pullCurrent(root: string): Promise<GitOperationResult> {
  const sync = await resolveSyncState(root)
  if (!sync) return { ok: false, error: '当前分支没有 upstream，先设置跟踪分支' }
  const result = await execGit(root, ['pull', '--ff-only'], GIT_NETWORK_TIMEOUT_MS)
  if (result.code !== 0) return { ok: false, error: failureReason(result, 'pull 失败（无法快进时需要先 merge 或 rebase）') }
  return { ok: true, state: await resolveGitWorkspaceState(root), output: (result.stdout || result.stderr).trim() }
}

/**
 * push 当前分支。不提供 --force，强推属于不可逆操作，桌面端不开这个口子。
 *
 * remote 的三种情形：
 * - 没传且已有 upstream：裸 `git push`，走跟踪分支
 * - 没传且无 upstream：`-u origin <branch>` 顺手建立跟踪
 * - 显式传了：`push <remote> <branch>` 推到指定远程；没有 upstream 时一并用 -u 绑上，
 *   否则下次裸 push 又会回到老远程，和用户刚做的选择对不上
 */
export async function pushCurrent(root: string, options: { remote?: string } = {}): Promise<GitOperationResult> {
  const state = await resolveGitWorkspaceState(root)
  if (!state) return { ok: false, error: '当前目录不是 Git 仓库' }
  if (state.detachedHead || !state.branch) return { ok: false, error: 'detached HEAD 无法 push' }
  const sync = await resolveSyncState(root)
  const explicit = options.remote?.trim()
  const args = ['push']
  if (explicit || !sync) {
    const remote = explicit || 'origin'
    const invalid = validateRemote(remote)
    if (invalid) return { ok: false, error: invalid }
    if (!sync) args.push('-u')
    args.push(remote, state.branch)
  }
  const result = await execGit(root, args, GIT_NETWORK_TIMEOUT_MS)
  if (result.code !== 0) return { ok: false, error: failureReason(result, 'push 失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root), output: (result.stderr || result.stdout).trim() }
}
