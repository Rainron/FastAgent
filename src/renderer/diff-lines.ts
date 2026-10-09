export type DiffLineKind = 'add' | 'del' | 'meta' | 'hunk' | 'context'

export interface DiffLine {
  id: number
  text: string
  kind: DiffLineKind
}

/** 判定 unified diff 的单行类型；`+++`/`---` 是文件头，要排在 add/del 之前判断。 */
export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('index ')) return 'meta'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'context'
}

/** 把 patch 文本切成带类型的行；末尾空行丢弃，避免每段 diff 后面多一条空行。 */
export function toDiffLines(patch: string): DiffLine[] {
  const rows = patch.split('\n')
  while (rows.length && !rows[rows.length - 1].trim()) rows.pop()
  return rows.map((text, index) => ({ id: index, text, kind: classifyDiffLine(text) }))
}

/** diff 的增删行数统计，用于在文件行上显示 +x -y。 */
export function countDiffLines(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of patch.split('\n')) {
    const kind = classifyDiffLine(line)
    if (kind === 'add') additions += 1
    if (kind === 'del') deletions += 1
  }
  return { additions, deletions }
}
