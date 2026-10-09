import { isAbsolute, normalize } from 'node:path'
import type { GitFileChange, GitOperationResult, GitWorkingChanges } from '../../shared/types'
import { execGit, failureReason } from './exec'
import { parseNumstat } from './commits'
import { parsePorcelain, resolveGitWorkspaceState } from './state'

/**
 * 仓库内相对路径校验：`--` 终止符挡不住 `../` 逃逸，也挡不住把路径当选项解析，
 * 所以路径一律在这里先过一遍再拼进参数。
 */
export function sanitizePaths(paths: string[]): { paths: string[]; error: string | null } {
  const safe: string[] = []
  for (const raw of paths) {
    const value = String(raw ?? '').trim()
    if (!value) continue
    if (value.startsWith('-')) return { paths: [], error: `路径不合法：${value}` }
    if (isAbsolute(value)) return { paths: [], error: `只接受仓库内相对路径：${value}` }
    const normalized = normalize(value).replace(/\\/g, '/')
    if (normalized === '..' || normalized.startsWith('../')) return { paths: [], error: `路径越出仓库：${value}` }
    safe.push(normalized)
  }
  if (!safe.length) return { paths: [], error: '没有选中任何文件' }
  return { paths: safe, error: null }
}

/** porcelain 的 XY 状态码里，X 是暂存区状态、Y 是工作区状态。 */
export function splitStatus(entries: Array<{ status: string; path: string }>): { staged: GitFileChange[]; unstaged: GitFileChange[] } {
  const staged: GitFileChange[] = []
  const unstaged: GitFileChange[] = []
  for (const entry of entries) {
    const index = entry.status[0] ?? ' '
    const worktree = entry.status[1] ?? ' '
    // 重命名条目的路径是 `old -> new`，后续 diff / add 都要用新路径。
    const path = entry.path.includes(' -> ') ? entry.path.split(' -> ')[1] : entry.path
    if (entry.status === '??') {
      unstaged.push({ path, status: '??', additions: 0, deletions: 0, binary: false, untracked: true })
      continue
    }
    if (index !== ' ' && index !== '?') staged.push({ path, status: index, additions: 0, deletions: 0, binary: false, untracked: false })
    if (worktree !== ' ' && worktree !== '?') unstaged.push({ path, status: worktree, additions: 0, deletions: 0, binary: false, untracked: false })
  }
  return { staged, unstaged }
}

/** 把 numstat 的增删行数合并进状态列表，缺统计的（未跟踪文件）保持 0。 */
export function mergeNumstat(changes: GitFileChange[], stats: ReturnType<typeof parseNumstat>): GitFileChange[] {
  const byPath = new Map(stats.map((item) => [item.path, item]))
  return changes.map((change) => {
    const stat = byPath.get(change.path)
    return stat ? { ...change, additions: stat.additions, deletions: stat.deletions, binary: stat.binary } : change
  })
}

/** 工作区改动（已暂存 / 未暂存两组，含增删行数）。 */
export async function listChanges(root: string): Promise<GitWorkingChanges> {
  const status = await execGit(root, ['status', '--porcelain'])
  if (status.code !== 0) return { staged: [], unstaged: [] }
  const split = splitStatus(parsePorcelain(status.stdout))
  const stagedStat = await execGit(root, ['diff', '--cached', '--numstat'])
  const unstagedStat = await execGit(root, ['diff', '--numstat'])
  return {
    staged: mergeNumstat(split.staged, stagedStat.code === 0 ? parseNumstat(stagedStat.stdout) : []),
    unstaged: mergeNumstat(split.unstaged, unstagedStat.code === 0 ? parseNumstat(unstagedStat.stdout) : [])
  }
}

/** 暂存指定文件（含未跟踪文件的新增）。 */
export async function stageFiles(root: string, paths: string[]): Promise<GitOperationResult> {
  const { paths: safe, error } = sanitizePaths(paths)
  if (error) return { ok: false, error }
  const result = await execGit(root, ['add', '--', ...safe])
  if (result.code !== 0) return { ok: false, error: failureReason(result, '暂存失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root) }
}

/** 取消暂存；仓库还没有任何提交时 restore --staged 不可用，回退到 rm --cached。 */
export async function unstageFiles(root: string, paths: string[]): Promise<GitOperationResult> {
  const { paths: safe, error } = sanitizePaths(paths)
  if (error) return { ok: false, error }
  const result = await execGit(root, ['restore', '--staged', '--', ...safe])
  if (result.code === 0) return { ok: true, state: await resolveGitWorkspaceState(root) }
  const fallback = await execGit(root, ['rm', '--cached', '-r', '--', ...safe])
  if (fallback.code !== 0) return { ok: false, error: failureReason(result, '取消暂存失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root) }
}

/** 提交已暂存内容；amend 时并入上一条提交。 */
export async function commitChanges(root: string, message: string, options: { amend?: boolean } = {}): Promise<GitOperationResult> {
  const text = message.trim()
  if (!text) return { ok: false, error: '提交信息不能为空' }
  const args = ['commit', '-m', text]
  if (options.amend) args.push('--amend')
  const result = await execGit(root, args)
  if (result.code !== 0) return { ok: false, error: failureReason(result, '提交失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root), output: result.stdout.trim() }
}

/**
 * 丢弃改动：已跟踪文件回到 HEAD（同时清掉暂存），未跟踪文件直接删除。
 * 不可恢复，调用方必须先做二次确认。
 */
export async function discardFiles(root: string, paths: string[], options: { untracked?: string[] } = {}): Promise<GitOperationResult> {
  const tracked = sanitizePaths(paths)
  const untracked = options.untracked?.length ? sanitizePaths(options.untracked) : { paths: [], error: null }
  if (tracked.error && untracked.error) return { ok: false, error: tracked.error }
  if (untracked.error && options.untracked?.length) return { ok: false, error: untracked.error }
  if (tracked.paths.length) {
    const result = await execGit(root, ['restore', '--staged', '--worktree', '--', ...tracked.paths])
    if (result.code !== 0) {
      // 空仓库（无 HEAD）时 restore 没有可回退的源，改用 checkout 兜一次。
      const fallback = await execGit(root, ['checkout', '--', ...tracked.paths])
      if (fallback.code !== 0) return { ok: false, error: failureReason(result, '丢弃改动失败') }
    }
  }
  if (untracked.paths.length) {
    const result = await execGit(root, ['clean', '-f', '-d', '--', ...untracked.paths])
    if (result.code !== 0) return { ok: false, error: failureReason(result, '删除未跟踪文件失败') }
  }
  return { ok: true, state: await resolveGitWorkspaceState(root) }
}

/** 回退最近一次提交；soft 保留暂存，mixed 只保留工作区改动。 */
export async function resetHead(root: string, mode: 'soft' | 'mixed'): Promise<GitOperationResult> {
  const result = await execGit(root, ['reset', mode === 'soft' ? '--soft' : '--mixed', 'HEAD~1'])
  if (result.code !== 0) return { ok: false, error: failureReason(result, '回退提交失败') }
  return { ok: true, state: await resolveGitWorkspaceState(root) }
}

/** 单个文件的 diff；staged 为 true 取暂存区与 HEAD 的差异。 */
export async function fileDiff(root: string, path: string, staged: boolean, untracked = false): Promise<string> {
  const { paths: safe, error } = sanitizePaths([path])
  if (error) return ''
  if (untracked) {
    // 未跟踪文件没有 diff 可比，用 --no-index 与空设备比，得到完整新增内容。
    const added = await execGit(root, ['diff', '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', safe[0]])
    return added.stdout
  }
  const args = ['diff']
  if (staged) args.push('--cached')
  args.push('--', safe[0])
  const result = await execGit(root, args)
  return result.code === 0 ? result.stdout : ''
}

/** 未跟踪文件一次最多带多少个进 diff：新文件可能很多，全量拼接会把上下文撑爆。 */
const UNTRACKED_DIFF_LIMIT = 20

/**
 * 全部未提交改动的合并 diff（含已暂存），用于交给模型审查或生成提交信息。
 * `git diff` 看不见未跟踪文件，但「新加的文件」恰恰是审查时最该看的，所以额外用
 * --no-index 逐个补上，不去动索引（intent-to-add 会污染用户的暂存区）。
 */
export async function workingDiff(root: string, options: { stagedOnly?: boolean } = {}): Promise<string> {
  const args = ['diff']
  if (options.stagedOnly) args.push('--cached')
  else args.push('HEAD')
  const result = await execGit(root, args)
  // 空仓库没有 HEAD，退回只看暂存区。
  const tracked = result.code === 0 ? result.stdout : (await execGit(root, ['diff', '--cached'])).stdout
  if (options.stagedOnly) return tracked
  const untracked = await untrackedDiff(root)
  return untracked ? `${tracked}${tracked.endsWith('\n') || !tracked ? '' : '\n'}${untracked}` : tracked
}

/** 未跟踪文件的新增内容，逐个与空设备比。 */
async function untrackedDiff(root: string): Promise<string> {
  const listed = await execGit(root, ['ls-files', '--others', '--exclude-standard'])
  if (listed.code !== 0) return ''
  const paths = listed.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, UNTRACKED_DIFF_LIMIT)
  const chunks: string[] = []
  for (const path of paths) {
    const diff = await fileDiff(root, path, false, true)
    if (diff.trim()) chunks.push(diff)
  }
  return chunks.join('')
}

/** diff 摘要（--stat），提交信息生成时先给模型看这个再补正文。 */
export async function diffStat(root: string, options: { stagedOnly?: boolean } = {}): Promise<string> {
  const args = ['diff', '--stat']
  if (options.stagedOnly) args.push('--cached')
  else args.push('HEAD')
  const result = await execGit(root, args)
  if (result.code === 0) return result.stdout
  const staged = await execGit(root, ['diff', '--stat', '--cached'])
  return staged.code === 0 ? staged.stdout : ''
}
