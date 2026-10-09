import type { GitCommitDetail, GitCommitFile, GitCommitSummary } from '../../shared/types'
import { execGit } from './exec'

const FIELD = '\x1f'
const RECORD = '\x1e'
/** 顺序与 parseCommitRecords 的解构一一对应，改动要同步。 */
const LOG_FORMAT = ['%H', '%h', '%P', '%an', '%ae', '%aI', '%s', '%D'].join(FIELD) + RECORD

export function parseCommitRecords(stdout: string): GitCommitSummary[] {
  return stdout.split(RECORD)
    .map((record) => record.replace(/^\r?\n/, ''))
    .filter((record) => record.trim())
    .map((record) => {
      const [hash, shortHash, parents, author, email, date, subject, refs] = record.split(FIELD)
      return {
        hash: (hash ?? '').trim(),
        shortHash: (shortHash ?? '').trim(),
        parents: (parents ?? '').trim().split(/\s+/).filter(Boolean),
        author: author ?? '',
        email: email ?? '',
        date: (date ?? '').trim(),
        subject: subject ?? '',
        refs: (refs ?? '').split(',').map((ref) => ref.trim()).filter(Boolean)
      }
    })
    .filter((commit) => commit.hash)
}

/** `--numstat` 的每行是 `新增\t删除\t路径`；二进制文件的数字位是 `-`。 */
export function parseNumstat(stdout: string): GitCommitFile[] {
  const files: GitCommitFile[] = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const [added, deleted, ...rest] = parts
    const path = rest.join('\t')
    const binary = added === '-' || deleted === '-'
    files.push({
      path,
      additions: binary ? 0 : Number(added) || 0,
      deletions: binary ? 0 : Number(deleted) || 0,
      binary
    })
  }
  return files
}

/** `--name-status` 的每行是 `状态\t路径`；重命名是 `R100\t旧路径\t新路径`，取新路径。 */
export function parseNameStatus(stdout: string): Array<{ status: string; path: string }> {
  const entries: Array<{ status: string; path: string }> = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length < 2) continue
    const status = parts[0].slice(0, 1)
    entries.push({ status, path: parts[parts.length - 1] })
  }
  return entries
}

/** 指定 ref 的提交列表（不含合并进来的分叉细节以外的过滤），按时间倒序。 */
export async function listCommits(root: string, ref: string, limit = 50, skip = 0): Promise<GitCommitSummary[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 1, 1), 500)
  const safeSkip = Math.max(Math.trunc(skip) || 0, 0)
  const args = ['log', `--format=${LOG_FORMAT}`, `--max-count=${safeLimit}`, `--skip=${safeSkip}`]
  // ref 为空表示当前 HEAD；`--` 终止参数解析，避免分支名被当作路径或选项。
  if (ref) args.push(ref)
  args.push('--')
  const result = await execGit(root, args)
  if (result.code !== 0) return []
  return parseCommitRecords(result.stdout)
}

/** 某个 ref 上的提交总数；空仓库或非法 ref 返回 0。 */
export async function countCommits(root: string, ref: string): Promise<number> {
  const args = ['rev-list', '--count', ref || 'HEAD', '--']
  const result = await execGit(root, args)
  if (result.code !== 0) return 0
  return Number(result.stdout.trim()) || 0
}

/** 单条提交的完整信息：元数据 + 完整提交信息正文 + 改动文件统计。 */
export async function commitDetail(root: string, hash: string): Promise<GitCommitDetail | null> {
  if (!hash.trim() || hash.trim().startsWith('-')) return null
  const meta = await execGit(root, ['log', '-1', `--format=${LOG_FORMAT}`, hash.trim(), '--'])
  if (meta.code !== 0) return null
  const [summary] = parseCommitRecords(meta.stdout)
  if (!summary) return null
  const body = await execGit(root, ['log', '-1', '--format=%B', hash.trim(), '--'])
  const stat = await execGit(root, ['show', '--numstat', '--format=', hash.trim(), '--'])
  const names = await execGit(root, ['show', '--name-status', '--format=', hash.trim(), '--'])
  const statusByPath = new Map(names.code === 0 ? parseNameStatus(names.stdout).map((item) => [item.path, item.status]) : [])
  const files = (stat.code === 0 ? parseNumstat(stat.stdout) : []).map((file) => ({ ...file, status: statusByPath.get(file.path) ?? 'M' }))
  return { ...summary, body: body.code === 0 ? body.stdout.replace(/\s+$/, '') : summary.subject, files }
}

/** 提交的 patch；带 path 时只取该文件，避免大提交一次拉全量。 */
export async function commitPatch(root: string, hash: string, path?: string | null): Promise<string> {
  if (!hash.trim() || hash.trim().startsWith('-')) return ''
  const args = ['show', '--patch', '--format=', hash.trim(), '--']
  if (path) args.push(path)
  const result = await execGit(root, args)
  return result.code === 0 ? result.stdout : ''
}
