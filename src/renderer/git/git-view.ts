import type { GitBranchInfo, GitFileChange, GitSyncState, GitWorkspaceState } from '../../shared/types'

/** 分支过滤：大小写不敏感的子串匹配，空查询原样返回。 */
export function filterBranchInfos(branches: GitBranchInfo[], query: string): GitBranchInfo[] {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return branches
  return branches.filter((branch) => branch.name.toLowerCase().includes(keyword))
}

/** 远程分支过滤，规则与本地分支一致。 */
export function filterRemoteBranches(remotes: string[], query: string): string[] {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return remotes
  return remotes.filter((name) => name.toLowerCase().includes(keyword))
}

export interface SyncLabel {
  text: string
  tone: 'ok' | 'info' | 'warn'
  title: string
}

/** 同步状态的展示文案：没有 upstream 要明说，否则用 ↑n ↓n。 */
export function syncLabel(sync: GitSyncState | null | undefined, upstreamGone = false): SyncLabel {
  if (upstreamGone) return { text: '远程已删除', tone: 'warn', title: '跟踪的远程分支已不存在' }
  if (!sync) return { text: '无 upstream', tone: 'warn', title: '当前分支没有设置跟踪分支' }
  if (!sync.ahead && !sync.behind) return { text: '已同步', tone: 'ok', title: `与 ${sync.upstream} 一致` }
  const parts: string[] = []
  if (sync.ahead) parts.push(`↑${sync.ahead}`)
  if (sync.behind) parts.push(`↓${sync.behind}`)
  return {
    text: parts.join(' '),
    tone: 'info',
    title: `相对 ${sync.upstream}：领先 ${sync.ahead} 条，落后 ${sync.behind} 条`
  }
}

/**
 * 分支列表里每行要不要挂角标：只有需要处理的状态（领先 / 落后 / 远程已删）才挂。
 * 没 upstream、已同步是常态，本地仓库里几乎每行都是，行行挂标签只会把真正要看的淹掉。
 */
export function branchRowBadge(branch: GitBranchInfo): SyncLabel | null {
  if (branch.upstreamGone) return syncLabel(null, true)
  if (!branch.upstream || (!branch.ahead && !branch.behind)) return null
  return branchSyncLabel(branch)
}

/** 分支行上的同步角标，复用 syncLabel 的规则。 */
export function branchSyncLabel(branch: GitBranchInfo): SyncLabel {
  if (!branch.upstream) return { text: '本地', tone: 'warn', title: '没有跟踪分支' }
  return syncLabel({ upstream: branch.upstream, ahead: branch.ahead, behind: branch.behind }, branch.upstreamGone)
}

const STATUS_TEXT: Record<string, string> = {
  M: '已修改', A: '新增', D: '删除', R: '重命名', C: '复制', U: '冲突', '?': '未跟踪', T: '类型变更'
}

/** 单字符状态码的中文说明，未知码原样回显。 */
export function statusText(status: string): string {
  const code = status.trim().slice(0, 1) || '?'
  return STATUS_TEXT[code] ?? code
}

/** 状态码对应的着色语义：新增偏成功色，删除偏危险色。 */
export function statusTone(status: string): 'add' | 'del' | 'warn' | 'conflict' {
  const code = status.trim().slice(0, 1)
  if (code === 'A' || code === '?') return 'add'
  if (code === 'D') return 'del'
  if (code === 'U') return 'conflict'
  return 'warn'
}

/** 提交时间：今天显示时分，今年省略年份，其余显示完整日期。 */
export function commitDateText(iso: string, now = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  if (sameDay) return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const stamp = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return date.getFullYear() === now.getFullYear() ? stamp : `${date.getFullYear()}-${stamp}`
}

/** 顶栏标题用的分支文本，detached 时显示短哈希。 */
export function headLabel(state: GitWorkspaceState | null): string {
  if (!state) return '—'
  if (state.detachedHead) return state.headShort ? `detached · ${state.headShort}` : 'detached'
  return state.branch ?? '—'
}

/**
 * 提交按钮文案。
 * 暂存区为空时这个按钮会先把未暂存的全部加进去，所以要把「全部」到底包括什么写明白——
 * 未纳管文件在界面上是单独一段，含糊的「暂存全部」会让人以为不包含它们。
 */
export function commitButtonText(stagedCount: number, modifiedCount: number, unversionedCount: number, amend: boolean): string {
  if (amend) return stagedCount ? `修正上次提交（并入 ${stagedCount} 个文件）` : '修正上次提交'
  if (stagedCount) return `提交 ${stagedCount} 个文件`
  const parts: string[] = []
  if (modifiedCount) parts.push(`${modifiedCount} 个已修改`)
  if (unversionedCount) parts.push(`${unversionedCount} 个未纳管`)
  return parts.length ? `暂存 ${parts.join(' + ')}并提交` : '没有可提交的改动'
}

/** 选中集合与当前文件列表求交，列表变化后要把已经消失的路径剔掉。 */
export function retainExisting(selected: Set<string>, files: GitFileChange[]): Set<string> {
  const paths = new Set(files.map((file) => file.path))
  const next = new Set<string>()
  for (const path of selected) if (paths.has(path)) next.add(path)
  return next
}
