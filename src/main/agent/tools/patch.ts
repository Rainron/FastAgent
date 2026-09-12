import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { resolveToolPath } from '../safety/workspace-guard'

export interface PatchLine {
  kind: ' ' | '-' | '+'
  text: string
}

export interface PatchHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: PatchLine[]
}

export interface PatchFile {
  path: string
  oldPath: string
  /** true 表示 +++ /dev/null（删除文件） */
  deletion: boolean
  /** true 表示 --- /dev/null（新建文件） */
  creation: boolean
  hunks: PatchHunk[]
}

export interface FilesChanged {
  path: string
  additions: number
  deletions: number
}

export class PatchApplyError extends Error {
  constructor(public readonly filePath: string, public readonly hunkIndex: number, message: string) {
    super(message)
    this.name = 'PatchApplyError'
  }
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

function stripPrefix(headerPath: string): string {
  return headerPath === '/dev/null' ? headerPath : headerPath.replace(/^[ab]\//, '')
}

export function parseUnifiedPatch(patchText: string): PatchFile[] {
  const rawLines = String(patchText ?? '').replace(/\r\n/g, '\n').split('\n')
  const files: PatchFile[] = []
  let current: PatchFile | null = null
  let index = 0
  while (index < rawLines.length) {
    const line = rawLines[index]
    if (line.startsWith('diff --git ') || line.startsWith('index ') || line.startsWith('new file mode') || line.startsWith('deleted file mode') || line.trim() === '') {
      index += 1
      continue
    }
    if (line.startsWith('--- ')) {
      if (current && current.hunks.length === 0) throw new PatchApplyError(current.path, 0, '文件块缺少 hunk')
      const oldPath = stripPrefix(line.slice(4).trim())
      const plusLine = rawLines[index + 1]
      if (!plusLine || !plusLine.startsWith('+++ ')) {
        throw new PatchApplyError(oldPath, 0, `文件头缺少 +++ 行（第 ${index + 1} 行附近）`)
      }
      const newPath = stripPrefix(plusLine.slice(4).trim())
      current = {
        path: newPath,
        oldPath,
        deletion: newPath === '/dev/null',
        creation: oldPath === '/dev/null',
        hunks: []
      }
      files.push(current)
      index += 2
      continue
    }
    const hunkMatch = line.match(HUNK_HEADER)
    if (hunkMatch && current) {
      const lines: PatchLine[] = []
      index += 1
      while (index < rawLines.length) {
        const content = rawLines[index]
        if (content.startsWith('@@ ') || content.startsWith('--- ') || content.startsWith('diff --git ')) break
        if (content === '') {
          // 补丁文本尾部换行产生的空行，跳过
          index += 1
          continue
        }
        const kind = content[0]
        if (kind === ' ' || kind === '-' || kind === '+') {
          lines.push({ kind, text: content.slice(1) })
        } else if (content === '\\ No newline at end of file') {
          // 忽略 no-newline 标记，统一按 \n 结尾处理
        } else {
          throw new PatchApplyError(current.path, current.hunks.length, `hunk 内出现无法解析的行：${content.slice(0, 40)}（第 ${index + 1} 行）`)
        }
        index += 1
      }
      current.hunks.push({
        oldStart: Number(hunkMatch[1]),
        oldCount: hunkMatch[2] ? Number(hunkMatch[2]) : 1,
        newStart: Number(hunkMatch[3]),
        newCount: hunkMatch[4] ? Number(hunkMatch[4]) : 1,
        lines
      })
      continue
    }
    throw new PatchApplyError(current?.path ?? '', current?.hunks.length ?? 0, `无法解析补丁行：${line.slice(0, 60)}（第 ${index + 1} 行）`)
  }
  if (current && current.hunks.length === 0) {
    throw new PatchApplyError(current.path, 0, '文件块缺少 hunk')
  }
  return files
}

/** 严格上下文匹配：hunk 按原文件行号定位，逐行核对 ' ' 与 '-' 行，全部命中才算通过。 */
export function applyPatchToContent(content: string, patch: PatchFile): { content: string; additions: number; deletions: number } {
  const endsWithNewline = content.endsWith('\n')
  const lines = endsWithNewline ? content.slice(0, -1).split('\n') : content.split('\n')
  let additions = 0
  let deletions = 0
  let delta = 0
  for (let hunkIndex = 0; hunkIndex < patch.hunks.length; hunkIndex++) {
    const hunk = patch.hunks[hunkIndex]
    // 前序 hunk 已改过文件，后续 hunk 的 oldStart 仍是原文件坐标，按累计偏移换算
    const at = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1 + delta
    if (hunk.oldStart !== 0 && at < 0) {
      throw new PatchApplyError(patch.path, hunkIndex, `hunk 起始行越界：oldStart=${hunk.oldStart}`)
    }
    if (at > lines.length) {
      throw new PatchApplyError(patch.path, hunkIndex, `hunk 起始行 ${hunk.oldStart} 超出文件行数 ${lines.length}`)
    }
    let cursor = at
    let oldConsumed = 0
    let removed = 0
    for (const line of hunk.lines) {
      if (line.kind === '-' || line.kind === ' ') {
        const actual = lines[cursor]
        // CRLF 文件行尾的 \r 不参与匹配；输出保留原行文本
        if (actual === undefined || actual.replace(/\r$/, '') !== line.text) {
          throw new PatchApplyError(patch.path, hunkIndex, `上下文不匹配（期望 ${line.kind === '-' ? '-' : ' '}${line.text.slice(0, 40)}，实际 ${actual ?? '<EOF>'}），位置：原文件第 ${cursor + 1} 行`)
        }
        cursor += 1
        oldConsumed += 1
        if (line.kind === '-') removed += 1
      }
    }
    if (hunk.oldStart !== 0 && oldConsumed !== hunk.oldCount) {
      throw new PatchApplyError(patch.path, hunkIndex, `hunk 声明消耗 ${hunk.oldCount} 行，实际匹配 ${oldConsumed} 行`)
    }
    if (hunk.oldStart === 0 && oldConsumed !== 0) {
      throw new PatchApplyError(patch.path, hunkIndex, '新文件 hunk 不应消耗已有行')
    }
    // 重建：上下文行保留原文件文本，'-' 行删除，'+' 行插入，顺序与 hunk 一致
    let consumedPos = at
    const out: string[] = []
    for (const line of hunk.lines) {
      if (line.kind === ' ' || line.kind === '-') {
        if (line.kind === ' ') out.push(lines[consumedPos])
        consumedPos += 1
      } else {
        out.push(line.text)
      }
    }
    const rebuilt = [...lines.slice(0, at), ...out, ...lines.slice(cursor)]
    delta += out.length - (cursor - at)
    additions += hunk.lines.filter((line) => line.kind === '+').length
    deletions += removed
    lines.splice(0, lines.length, ...rebuilt)
  }
  const result = lines.join('\n')
  // 统一以换行结尾（git patch 语义）；空文件除外
  const finalContent = result === '' ? result : result.endsWith('\n') ? result : `${result}\n`
  return { content: finalContent, additions, deletions }
}

/** 应用整个补丁：全部命中才落盘，任一失败保持原状并抛出定位信息。 */
export function applyPatchToWorkspace(patchText: string, workspaceRoot: string): FilesChanged[] {
  const files = parseUnifiedPatch(patchText)
  if (!files.length) throw new Error('补丁为空，没有可应用的文件')

  type Plan = { file: PatchFile; absolutePath: string; nextContent: string; additions: number; deletions: number; original: string | null }
  const plans: Plan[] = []
  for (const file of files) {
    const target = file.path === '/dev/null' ? file.oldPath : file.path
    // patch 是直接写盘工具，不能把绝对路径降级成“外部目录审批”；否则一次误批就会越过工作区。
    if (path.isAbsolute(target) || path.win32.isAbsolute(target) || target.startsWith('\\\\')) {
      throw new PatchApplyError(target, 0, `只能修改工作区内的文件：${target}`)
    }
    const resolved = resolveToolPath(target, workspaceRoot)
    if (resolved.external) throw new PatchApplyError(target, 0, `只能修改工作区内的文件：${target}`)
    const absolutePath = resolved.absolutePath
    if (file.creation && existsSync(absolutePath)) {
      throw new PatchApplyError(file.path, 0, `新建文件已存在：${absolutePath}`)
    }
    if (!file.creation && !file.deletion && !existsSync(absolutePath)) {
      throw new PatchApplyError(file.path, 0, `文件不存在：${absolutePath}`)
    }
    const original = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : null
    const applied = applyPatchToContent(original ?? '', file)
    plans.push({ file, absolutePath, nextContent: applied.content, additions: applied.additions, deletions: applied.deletions, original })
  }

  // 全部通过后统一落盘；写失败时回滚已写入的文件
  const written: Array<{ absolutePath: string; original: string | null; existed: boolean }> = []
  try {
    for (const plan of plans) {
      if (plan.file.deletion) {
        if (plan.original !== null) unlinkSync(plan.absolutePath)
      } else {
        const dir = path.dirname(plan.absolutePath)
        if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
        writeFileSync(plan.absolutePath, plan.nextContent, 'utf8')
      }
      written.push({ absolutePath: plan.absolutePath, original: plan.original, existed: plan.original !== null })
    }
  } catch (error) {
    for (const item of written.reverse()) {
      try {
        if (item.existed) writeFileSync(item.absolutePath, item.original ?? '', 'utf8')
        else if (existsSync(item.absolutePath)) unlinkSync(item.absolutePath)
      } catch { /* 回滚失败不再抛出，原始错误优先 */ }
    }
    throw error
  }
  return plans.map((plan) => ({ path: plan.absolutePath, additions: plan.additions, deletions: plan.deletions }))
}

export function createPatchTool(): ToolDefinition {
  return defineTool({
    name: 'patch',
    label: 'Patch',
    description: '按 unified diff（git patch 格式）新建、修改或删除文件：逐 hunk 严格上下文匹配，任一 hunk 不匹配则整体不落盘。',
    promptSnippet: 'Apply unified diffs to files with strict context matching',
    promptGuidelines: [
      'Use patch to create, modify, or delete files with unified diffs when the change spans multiple hunks or files; for single-file single-hunk changes prefer edit.'
    ],
    parameters: Type.Object({
      patch: Type.String({ description: 'unified diff 文本' })
    }),
    async execute(_toolCallId, params, signal, _onUpdate, extensionCtx) {
      if (signal?.aborted) throw new Error('执行已取消')
      const filesChanged = applyPatchToWorkspace(params.patch, extensionCtx.cwd)
      const additions = filesChanged.reduce((sum, file) => sum + file.additions, 0)
      const deletions = filesChanged.reduce((sum, file) => sum + file.deletions, 0)
      const summary = filesChanged.map((file) => `- ${path.basename(file.path)} (+${file.additions} -${file.deletions})`).join('\n')
      return {
        content: [{ type: 'text', text: `已应用补丁：${filesChanged.length} 个文件（+${additions} -${deletions}）\n${summary}` }],
        details: { filesChanged }
      }
    }
  })
}
