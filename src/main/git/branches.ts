import type { GitBranchInfo, GitOperationResult } from '../../shared/types'
import { execGit, failureReason } from './exec'
import { resolveGitWorkspaceState } from './state'

/** ref 名称里的非法字符；按 git check-ref-format 的约束收窄，防止参数混乱。 */
const INVALID_REF_CHARS = /[\s~^:?*[\]\\]+|@{|\.\.|^[/-]|\/\/|\.lock$|\.$|\.\.$/

/** 新建分支名校验；返回错误信息，合法时返回 null。 */
export function validateBranchName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return '分支名不能为空'
  if (trimmed.length > 255) return '分支名过长'
  if (trimmed.startsWith('--')) return '分支名不能以 -- 开头'
  if (INVALID_REF_CHARS.test(trimmed)) return '分支名包含非法字符'
  return null
}

/** 远程 ref（origin/feat/x）允许带一层远程名，其余约束与本地分支一致。 */
export function validateRemoteRef(ref: string): string | null {
  const trimmed = ref.trim()
  if (!trimmed) return '远程分支不能为空'
  if (trimmed.startsWith('-')) return '远程分支名不合法'
  if (/[\s~^:?*[\]\\]|@{|\.\./.test(trimmed)) return '远程分支名包含非法字符'
  return null
}

/** 本地分支列表，按名称排序（与 for-each-ref 默认一致）。 */
export async function listLocalBranches(root: string): Promise<string[]> {
  const result = await execGit(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
  if (result.code !== 0) return []
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

/** `%(upstream:track)` 形如 `[ahead 2, behind 1]` / `[gone]` / 空串。 */
export function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  const ahead = /ahead (\d+)/.exec(track)
  const behind = /behind (\d+)/.exec(track)
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0, gone: track.includes('gone') }
}

/** 字段分隔符用 \x1f，记录分隔符用 \x1e：分支名与提交主题里都不可能出现这两个控制字符。 */
const FIELD = '\x1f'
const RECORD = '\x1e'
const BRANCH_FORMAT = ['%(refname:short)', '%(upstream:short)', '%(upstream:track)', '%(committerdate:iso8601)', '%(contents:subject)', '%(HEAD)'].join(FIELD) + RECORD

export function parseBranchInfos(stdout: string): GitBranchInfo[] {
  return stdout.split(RECORD)
    .map((record) => record.replace(/^\r?\n/, ''))
    .filter((record) => record.trim())
    .map((record) => {
      const [name, upstream, track, date, subject, head] = record.split(FIELD)
      const { ahead, behind, gone } = parseTrack(track ?? '')
      return {
        name: (name ?? '').trim(),
        current: (head ?? '').trim() === '*',
        upstream: (upstream ?? '').trim() || null,
        upstreamGone: gone,
        ahead,
        behind,
        lastCommitDate: (date ?? '').trim(),
        lastCommitSubject: (subject ?? '').trim()
      }
    })
    .filter((branch) => branch.name)
}

/** 本地分支详情（含 upstream 与领先/落后），按最近提交时间倒序。 */
export async function listBranchInfos(root: string): Promise<GitBranchInfo[]> {
  const result = await execGit(root, ['for-each-ref', `--format=${BRANCH_FORMAT}`, '--sort=-committerdate', 'refs/heads'])
  if (result.code !== 0) return []
  return parseBranchInfos(result.stdout)
}

/** 远程跟踪分支名（origin/main 形式），排除 origin/HEAD 这种符号引用。 */
export async function listRemoteBranches(root: string): Promise<string[]> {
  const result = await execGit(root, ['for-each-ref', '--format=%(refname:short)%(symref)', '--sort=refname', 'refs/remotes'])
  if (result.code !== 0) return []
  return result.stdout.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    // 带 symref 的是 origin/HEAD -> origin/main 这类别名，检出它没有意义。
    .filter((line) => !line.includes('refs/heads/'))
    .filter((name) => !name.endsWith('/HEAD'))
}

/** 切换本地分支；成功后带回最新工作区状态。 */
export async function checkoutBranch(root: string, name: string): Promise<GitOperationResult> {
  const result = await execGit(root, ['checkout', name])
  if (result.code !== 0) return { ok: false, error: failureReason(result, '切换分支失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root) }
}

/** 基于当前 HEAD 新建分支并切换过去；成功后带回最新工作区状态。 */
export async function createBranch(root: string, name: string): Promise<GitOperationResult> {
  const invalid = validateBranchName(name)
  if (invalid) return { ok: false, error: invalid }
  const result = await execGit(root, ['checkout', '-b', name.trim()])
  if (result.code !== 0) return { ok: false, error: failureReason(result, '新建分支失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root) }
}

/** 基于远程分支建立同名本地跟踪分支并切换过去。 */
export async function createTrackingBranch(root: string, remoteRef: string, localName?: string): Promise<GitOperationResult> {
  const invalidRemote = validateRemoteRef(remoteRef)
  if (invalidRemote) return { ok: false, error: invalidRemote }
  // 默认去掉第一段远程名：origin/feat/x -> feat/x。
  const target = (localName ?? remoteRef.trim().split('/').slice(1).join('/')).trim()
  const invalid = validateBranchName(target)
  if (invalid) return { ok: false, error: invalid }
  const result = await execGit(root, ['checkout', '-b', target, '--track', remoteRef.trim()])
  if (result.code !== 0) return { ok: false, error: failureReason(result, '检出远程分支失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root) }
}

/** 删除本地分支；force 为 true 时用 -D 强删未合并分支。 */
export async function deleteBranch(root: string, name: string, force = false): Promise<GitOperationResult> {
  const invalid = validateBranchName(name)
  if (invalid) return { ok: false, error: invalid }
  const result = await execGit(root, ['branch', force ? '-D' : '-d', name.trim()])
  if (result.code !== 0) {
    const reason = failureReason(result, '删除分支失败')
    // -d 拒绝未合并分支时，把「需要强制」透出去，由 UI 弹二次确认。
    return { ok: false, error: reason, needsForce: !force && /not fully merged/i.test(reason) }
  }
  return { ok: true, state: await resolveGitWorkspaceState(root) }
}

/** 重命名分支（不带 -M，重名时直接失败，不覆盖已有分支）。 */
export async function renameBranch(root: string, from: string, to: string): Promise<GitOperationResult> {
  const invalidFrom = validateBranchName(from)
  if (invalidFrom) return { ok: false, error: invalidFrom }
  const invalidTo = validateBranchName(to)
  if (invalidTo) return { ok: false, error: invalidTo }
  const result = await execGit(root, ['branch', '-m', from.trim(), to.trim()])
  if (result.code !== 0) return { ok: false, error: failureReason(result, '重命名分支失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root) }
}

/** 为分支设置 upstream；remoteRef 传空表示取消跟踪。 */
export async function setUpstream(root: string, branch: string, remoteRef: string | null): Promise<GitOperationResult> {
  const invalid = validateBranchName(branch)
  if (invalid) return { ok: false, error: invalid }
  if (!remoteRef) {
    const cleared = await execGit(root, ['branch', '--unset-upstream', branch.trim()])
    if (cleared.code !== 0) return { ok: false, error: failureReason(cleared, '取消 upstream 失败') }
    return { ok: true, state: await resolveGitWorkspaceState(root) }
  }
  const invalidRemote = validateRemoteRef(remoteRef)
  if (invalidRemote) return { ok: false, error: invalidRemote }
  const result = await execGit(root, ['branch', `--set-upstream-to=${remoteRef.trim()}`, branch.trim()])
  if (result.code !== 0) return { ok: false, error: failureReason(result, '设置 upstream 失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root) }
}
