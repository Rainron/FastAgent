import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import type { FileOperation } from '../../shared/types'

/** 单个文件在某一时刻的状态；不存在时 exists 为 false，其余字段无意义。 */
export interface FileSnapshot {
  exists: boolean
  hash: string
  /** 文本行；二进制或超大文件为 null，此时只能按存在性判断操作类型。 */
  lines: string[] | null
  size: number
}

/**
 * 超过这个大小不读内容：只算存在性与哈希。
 * Agent 写的源码文件几乎都在几十 KB 量级，几 MB 的多半是构建产物或数据集，
 * 为它们做逐行 diff 只会把主进程卡住。
 */
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
/** 剥掉公共前后缀后仍超过这个行数就不做精确 diff，退化成整段增删计数。 */
export const MAX_DIFF_LINES = 3000
/** 单文件 diff 文本落库上限，超出截断（展开层只是给人看的）。 */
export const MAX_DIFF_TEXT_BYTES = 64 * 1024

const MISSING: FileSnapshot = { exists: false, hash: '', lines: null, size: 0 }

/** 文件不存在时的空快照，调用方可以直接当基线用。 */
export function missingSnapshot(): FileSnapshot {
  return MISSING
}

/** 读取文件当前状态；读不到（不存在 / 无权限 / 是目录）一律当作不存在。 */
export function snapshotFile(absolutePath: string): FileSnapshot {
  try {
    const stat = statSync(absolutePath)
    if (!stat.isFile()) return MISSING
    if (stat.size > MAX_SNAPSHOT_BYTES) {
      return { exists: true, hash: `size:${stat.size}:${stat.mtimeMs}`, lines: null, size: stat.size }
    }
    const buffer = readFileSync(absolutePath)
    const hash = createHash('sha1').update(buffer).digest('hex')
    // NUL 字节判定二进制：逐行 diff 对二进制没有意义，也会把控制字符写进库
    const binary = buffer.includes(0)
    return { exists: true, hash, lines: binary ? null : buffer.toString('utf8').split('\n'), size: stat.size }
  } catch {
    return MISSING
  }
}

export interface SnapshotDiff {
  additions: number
  deletions: number
  /** unified 风格的展示用 diff；无法逐行比较时为空串。 */
  text: string
}

function commonPrefix(before: string[], after: string[]): number {
  let index = 0
  while (index < before.length && index < after.length && before[index] === after[index]) index += 1
  return index
}

function commonSuffix(before: string[], after: string[], prefix: number): number {
  let index = 0
  while (
    index < before.length - prefix
    && index < after.length - prefix
    && before[before.length - 1 - index] === after[after.length - 1 - index]
  ) index += 1
  return index
}

/**
 * 最长公共子序列表；只在剥掉公共前后缀后的小块上跑，规模由 MAX_DIFF_LINES 兜住。
 */
function lcsTable(before: string[], after: string[]): Uint32Array {
  const width = after.length + 1
  const table = new Uint32Array((before.length + 1) * width)
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = before[i] === after[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  return table
}

/**
 * 逐行比较两份快照，给出增删行数与可展示的 diff 文本。
 * 先剥公共前后缀，中段过大时不再求最优对齐，直接按「旧段全删、新段全增」计数——
 * 数字仍然是这次改动的真实规模，只是失去逐行对齐的展示价值。
 */
export function diffSnapshots(before: FileSnapshot, after: FileSnapshot): SnapshotDiff {
  const beforeLines = before.exists ? before.lines : []
  const afterLines = after.exists ? after.lines : []
  if (beforeLines === null || afterLines === null) return { additions: 0, deletions: 0, text: '' }
  const prefix = commonPrefix(beforeLines, afterLines)
  const suffix = commonSuffix(beforeLines, afterLines, prefix)
  const beforeMid = beforeLines.slice(prefix, beforeLines.length - suffix)
  const afterMid = afterLines.slice(prefix, afterLines.length - suffix)
  if (!beforeMid.length && !afterMid.length) return { additions: 0, deletions: 0, text: '' }
  if (beforeMid.length > MAX_DIFF_LINES || afterMid.length > MAX_DIFF_LINES) {
    return { additions: afterMid.length, deletions: beforeMid.length, text: '' }
  }

  const width = afterMid.length + 1
  const table = lcsTable(beforeMid, afterMid)
  const parts: string[] = []
  let additions = 0
  let deletions = 0
  let i = 0
  let j = 0
  while (i < beforeMid.length && j < afterMid.length) {
    if (beforeMid[i] === afterMid[j]) {
      parts.push(` ${beforeMid[i]}`)
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      parts.push(`-${beforeMid[i]}`)
      deletions += 1
      i += 1
    } else {
      parts.push(`+${afterMid[j]}`)
      additions += 1
      j += 1
    }
  }
  for (; i < beforeMid.length; i += 1) {
    parts.push(`-${beforeMid[i]}`)
    deletions += 1
  }
  for (; j < afterMid.length; j += 1) {
    parts.push(`+${afterMid[j]}`)
    additions += 1
  }
  // 上下文只留改动段前后各三行，整文件贴进来没人看
  const context = 3
  const head = beforeLines.slice(Math.max(0, prefix - context), prefix).map((line) => ` ${line}`)
  const tailStart = beforeLines.length - suffix
  const tail = beforeLines.slice(tailStart, Math.min(beforeLines.length, tailStart + context)).map((line) => ` ${line}`)
  const body = [...head, ...parts, ...tail].join('\n')
  return { additions, deletions, text: body.length > MAX_DIFF_TEXT_BYTES ? `${body.slice(0, MAX_DIFF_TEXT_BYTES)}\n…（diff 过长已截断）` : body }
}

/**
 * 由「本轮基线」与当前状态判断这个文件在本轮的最终操作；没有实质变化返回 null。
 * 基线是该文件本轮第一次被写工具碰之前的样子，所以同一文件改多少次都只得出一个结论：
 * create → update 仍是 create，create → delete 归零（返回 null，记录该被摘掉），
 * update → delete 是 delete。不需要额外的合并规则表。
 */
export function classifyOperation(baseline: FileSnapshot, current: FileSnapshot): FileOperation | null {
  if (!baseline.exists && current.exists) return 'create'
  if (baseline.exists && !current.exists) return 'delete'
  if (!baseline.exists && !current.exists) return null
  return baseline.hash === current.hash ? null : 'update'
}
