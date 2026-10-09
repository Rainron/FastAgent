import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { GitIntegrationState, GitOperationResult } from '../../shared/types'
import { execGit, failureReason } from './exec'
import { validateBranchName, validateRemoteRef } from './branches'
import { resolveGitWorkspaceState } from './state'

/** 冲突文件（未解决的 unmerged 条目）。 */
export async function listConflicts(root: string): Promise<string[]> {
  const result = await execGit(root, ['diff', '--name-only', '--diff-filter=U'])
  if (result.code !== 0) return []
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

/** 合并/变基是否进行中：靠 .git 下的标记文件判断，和 git 自己的判断一致。 */
export async function integrationStatus(root: string): Promise<GitIntegrationState> {
  const gitDir = join(root, '.git')
  const merging = existsSync(join(gitDir, 'MERGE_HEAD'))
  const rebasing = existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'))
  const conflicts = merging || rebasing ? await listConflicts(root) : []
  return { merging, rebasing, conflicts }
}

/** 目标 ref 既可能是本地分支也可能是远程分支，两种校验各放行一种形状。 */
function validateTarget(ref: string): string | null {
  return ref.includes('/') ? validateRemoteRef(ref) : validateBranchName(ref)
}

/** 把指定分支合并进当前分支；冲突时返回冲突文件列表，不自动解决。 */
export async function mergeBranch(root: string, ref: string): Promise<GitOperationResult> {
  const invalid = validateTarget(ref)
  if (invalid) return { ok: false, error: invalid }
  const result = await execGit(root, ['merge', '--no-edit', ref.trim()])
  if (result.code !== 0) {
    const conflicts = await listConflicts(root)
    return { ok: false, error: failureReason(result, '合并失败'), conflicts }
  }
  return { ok: true, state: await resolveGitWorkspaceState(root), output: result.stdout.trim() }
}

/** 把当前分支变基到指定分支；冲突时停在冲突状态，交给用户决定继续还是中止。 */
export async function rebaseOnto(root: string, ref: string): Promise<GitOperationResult> {
  const invalid = validateTarget(ref)
  if (invalid) return { ok: false, error: invalid }
  const result = await execGit(root, ['rebase', ref.trim()])
  if (result.code !== 0) {
    const conflicts = await listConflicts(root)
    return { ok: false, error: failureReason(result, '变基失败'), conflicts }
  }
  return { ok: true, state: await resolveGitWorkspaceState(root), output: result.stdout.trim() }
}

/** 中止进行中的合并或变基，回到操作前的状态。 */
export async function abortIntegration(root: string): Promise<GitOperationResult> {
  const status = await integrationStatus(root)
  if (!status.merging && !status.rebasing) return { ok: false, error: '当前没有进行中的合并或变基' }
  const result = await execGit(root, status.rebasing ? ['rebase', '--abort'] : ['merge', '--abort'])
  if (result.code !== 0) return { ok: false, error: failureReason(result, '中止失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root) }
}
