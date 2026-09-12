import { execFile } from 'node:child_process'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { GitOperationResult, GitStatusEntry, GitWorkspaceState } from '../shared/types'

/** 单条 git 命令超时，避免仓库异常时把 IPC 和 UI 卡死。 */
const GIT_TIMEOUT_MS = 5000

export interface GitExecResult {
  code: number
  stdout: string
  stderr: string
  /** git 可执行文件不存在（PATH 里没有 git）。 */
  missing: boolean
}

/**
 * 在 root 下执行 git。参数走 execFile 数组，天然避免 shell 注入；
 * 任何异常（超时/权限/git 缺失）都收敛成结构化结果，由调用方决定如何降级。
 */
export function execGit(root: string, args: string[], timeoutMs = GIT_TIMEOUT_MS): Promise<GitExecResult> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: root, timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (!error) { resolve({ code: 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), missing: false }); return }
      const errno = (error as NodeJS.ErrnoException | null)?.code
      if (errno === 'ENOENT') { resolve({ code: -1, stdout: '', stderr: '', missing: true }); return }
      // 超时错误码是 'ETIMEDOUT'，其余是 git 自身非零退出（code 为数字）。
      const code = typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? error.message), missing: false })
    })
  })
}

/** 解析 porcelain 输出：每行 `XY path`，重命名/复制时 path 可能带 ` -> `。 */
export function parsePorcelain(stdout: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = []
  for (const line of stdout.split(/\r?\n/)) {
    if (line.length < 3) continue
    // porcelain v1 的每行格式固定为两位状态码 + 空格 + 路径。
    entries.push({ status: line.slice(0, 2), path: line.slice(3) })
  }
  return entries
}

/** 空仓库（无任何提交）时通过 symbolic-ref 拿默认分支名；失败返回 null。 */
async function defaultBranchName(root: string): Promise<string | null> {
  const result = await execGit(root, ['symbolic-ref', '--short', 'HEAD'])
  if (result.code !== 0) return null
  const name = result.stdout.trim()
  return name || null
}

/** detached HEAD 的短哈希；无提交时返回 null。 */
async function headShortHash(root: string): Promise<string | null> {
  const result = await execGit(root, ['rev-parse', '--short', 'HEAD'])
  if (result.code !== 0) return null
  const hash = result.stdout.trim()
  return hash || null
}

/**
 * 解析当前工作区的 Git 状态。非仓库或读取失败统一返回 null（UI 隐藏），
 * 是否成功由调用方用日志区分。
 */
export async function resolveGitWorkspaceState(root: string): Promise<GitWorkspaceState | null> {
  const inside = await execGit(root, ['rev-parse', '--is-inside-work-tree'])
  if (inside.code !== 0) return null

  const branchResult = await execGit(root, ['branch', '--show-current'])
  const branch = branchResult.code === 0 ? branchResult.stdout.trim() : ''
  let detachedHead = false
  let headShort: string | null = null
  let currentBranch: string | null = branch || null

  if (!branch) {
    // 无当前分支：可能是 detached HEAD，也可能是还没有任何提交的空仓库。
    const defaultBranch = await defaultBranchName(root)
    if (defaultBranch) {
      currentBranch = defaultBranch
    } else {
      detachedHead = true
      headShort = await headShortHash(root)
    }
  }

  const statusResult = await execGit(root, ['status', '--porcelain'])
  const changedFiles = statusResult.code === 0 ? parsePorcelain(statusResult.stdout).length : 0

  return { isGitRepository: true, branch: currentBranch, detachedHead, headShort, changedFiles, isDirty: changedFiles > 0 }
}

/** 本地分支列表，按名称排序（与 for-each-ref 默认一致）。 */
export async function listLocalBranches(root: string): Promise<string[]> {
  const result = await execGit(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
  if (result.code !== 0) return []
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

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

/** 切换本地分支；成功后带回最新工作区状态。 */
export async function checkoutBranch(root: string, name: string): Promise<GitOperationResult> {
  const result = await execGit(root, ['checkout', name])
  if (result.code !== 0) {
    const reason = result.stderr.trim() || result.stdout.trim() || '切换分支失败'
    return { ok: false, error: reason }
  }
  return { ok: true, state: await resolveGitWorkspaceState(root) }
}

/** 基于当前 HEAD 新建分支并切换过去；成功后带回最新工作区状态。 */
export async function createBranch(root: string, name: string): Promise<GitOperationResult> {
  const invalid = validateBranchName(name)
  if (invalid) return { ok: false, error: invalid }
  const result = await execGit(root, ['checkout', '-b', name.trim()])
  if (result.code !== 0) {
    const reason = result.stderr.trim() || result.stdout.trim() || '新建分支失败'
    return { ok: false, error: reason }
  }
  return { ok: true, state: await resolveGitWorkspaceState(root) }
}

/**
 * 监听 .git 元数据变化（checkout/switch/commit/add/外部切换分支都会触碰这些文件），
 * 触发防抖回调。非 git 仓库或监听失败时静默降级（UI 仍靠 focus 与工具事件兜底刷新）。
 */
export function watchGitMetadata(root: string | null, onChanged: () => void, debounceMs = 300): () => void {
  if (!root) return () => undefined
  const gitDir = join(root, '.git')
  const targets = [join(gitDir, 'HEAD'), join(gitDir, 'index'), join(gitDir, 'refs', 'heads')]
  const watchers: FSWatcher[] = []
  let timer: NodeJS.Timeout | null = null
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChanged, debounceMs)
  }
  for (const target of targets) {
    try {
      if (!existsSync(target)) continue
      watchers.push(watch(target, { persistent: false }, schedule))
    } catch {
      // refs 目录在部分仓库可能缺失或不可监听，忽略单个目标的失败。
    }
  }
  return () => {
    if (timer) clearTimeout(timer)
    for (const watcher of watchers) watcher.close()
  }
}
