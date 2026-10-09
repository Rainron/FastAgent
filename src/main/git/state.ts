import { existsSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { GitStatusEntry, GitSyncState, GitWorkspaceState } from '../../shared/types'
import { execGit } from './exec'

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

/** `rev-list --left-right --count` 的输出是 `behind<TAB>ahead`，解析失败按 0 处理。 */
export function parseAheadBehind(stdout: string): { ahead: number; behind: number } {
  const parts = stdout.trim().split(/\s+/)
  const behind = Number(parts[0])
  const ahead = Number(parts[1])
  return { ahead: Number.isFinite(ahead) ? ahead : 0, behind: Number.isFinite(behind) ? behind : 0 }
}

/**
 * 当前分支与其 upstream 的领先/落后条数。没有配置 upstream（或远程引用还没 fetch 下来）返回 null，
 * 调用方据此展示「无 upstream」而不是 0/0。
 */
export async function resolveSyncState(root: string): Promise<GitSyncState | null> {
  const upstream = await execGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (upstream.code !== 0) return null
  const name = upstream.stdout.trim()
  if (!name) return null
  const counts = await execGit(root, ['rev-list', '--left-right', '--count', `${name}...HEAD`])
  if (counts.code !== 0) return { upstream: name, ahead: 0, behind: 0 }
  return { upstream: name, ...parseAheadBehind(counts.stdout) }
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
  const sync = detachedHead ? null : await resolveSyncState(root)

  return { isGitRepository: true, branch: currentBranch, detachedHead, headShort, changedFiles, isDirty: changedFiles > 0, sync }
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
