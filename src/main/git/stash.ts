import type { GitOperationResult, GitStashEntry } from '../../shared/types'
import { execGit, failureReason } from './exec'
import { resolveGitWorkspaceState } from './state'

const FIELD = '\x1f'
const RECORD = '\x1e'

export function parseStashList(stdout: string): GitStashEntry[] {
  return stdout.split(RECORD)
    .map((record) => record.replace(/^\r?\n/, ''))
    .filter((record) => record.trim())
    .map((record) => {
      const [ref, message, date] = record.split(FIELD)
      return { ref: (ref ?? '').trim(), message: (message ?? '').trim(), date: (date ?? '').trim() }
    })
    .filter((entry) => entry.ref)
}

/** stash 引用形如 `stash@{0}`，只接受这个形状，避免把任意 ref 传进 drop。 */
export function validateStashRef(ref: string): string | null {
  return /^stash@\{\d+\}$/.test(ref.trim()) ? null : 'stash 引用不合法'
}

export async function listStashes(root: string): Promise<GitStashEntry[]> {
  const result = await execGit(root, ['stash', 'list', `--format=%gd${FIELD}%s${FIELD}%aI${RECORD}`])
  if (result.code !== 0) return []
  return parseStashList(result.stdout)
}

/** 把当前改动存起来；includeUntracked 决定未跟踪文件是否一并收走。 */
export async function stashPush(root: string, message: string, options: { includeUntracked?: boolean } = {}): Promise<GitOperationResult> {
  const args = ['stash', 'push']
  if (options.includeUntracked) args.push('--include-untracked')
  const text = message.trim()
  if (text) args.push('-m', text)
  const result = await execGit(root, args)
  if (result.code !== 0) return { ok: false, error: failureReason(result, 'stash 失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root), output: result.stdout.trim() }
}

/** 恢复并移除指定 stash；冲突时 git 会拒绝，原样把错误透出去。 */
export async function stashPop(root: string, ref: string): Promise<GitOperationResult> {
  const invalid = validateStashRef(ref)
  if (invalid) return { ok: false, error: invalid }
  const result = await execGit(root, ['stash', 'pop', ref.trim()])
  if (result.code !== 0) return { ok: false, error: failureReason(result, 'stash pop 失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root), output: result.stdout.trim() }
}

/** 只恢复不移除。 */
export async function stashApply(root: string, ref: string): Promise<GitOperationResult> {
  const invalid = validateStashRef(ref)
  if (invalid) return { ok: false, error: invalid }
  const result = await execGit(root, ['stash', 'apply', ref.trim()])
  if (result.code !== 0) return { ok: false, error: failureReason(result, 'stash apply 失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root), output: result.stdout.trim() }
}

/** 丢弃 stash，不可恢复，调用方需要先确认。 */
export async function stashDrop(root: string, ref: string): Promise<GitOperationResult> {
  const invalid = validateStashRef(ref)
  if (invalid) return { ok: false, error: invalid }
  const result = await execGit(root, ['stash', 'drop', ref.trim()])
  if (result.code !== 0) return { ok: false, error: failureReason(result, 'stash drop 失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root) }
}

/** stash 里某条记录的 patch，用于在面板里预览。 */
export async function stashPatch(root: string, ref: string): Promise<string> {
  if (validateStashRef(ref)) return ''
  const result = await execGit(root, ['stash', 'show', '--patch', ref.trim()])
  return result.code === 0 ? result.stdout : ''
}
