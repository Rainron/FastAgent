import { existsSync } from 'node:fs'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

/** 草稿文件名前缀，用于校验 IPC 传回的路径确实是本模块创建的临时文件 */
const DRAFT_PREFIX = 'fastagent-draft-'

/** Ctrl+G 外部编辑的草稿文件路径，放系统临时目录，带时间戳避免并发冲突 */
export function draftFilePath(now = Date.now()): string {
  return join(tmpdir(), `${DRAFT_PREFIX}${now}.md`)
}

/** 把当前输入框内容写入草稿文件 */
export function createDraft(text: string, path: string): void {
  writeFileSync(path, text, 'utf8')
}

/** 读回草稿内容；文件被用户删掉时返回 null，由调用方决定保持原文 */
export function readDraft(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** 回填完成后删除草稿，不在临时目录留垃圾 */
export function removeDraft(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch {
    // 删除失败可以忽略，临时目录会被系统回收
  }
}

/**
 * 用设置里指定的编辑器可执行文件打开草稿；返回是否成功启动。
 * 未配置或路径不存在时返回 false，调用方退回系统默认应用。
 * 走 spawn 不经过 shell，路径里的空格不需要手工转义。
 */
export function launchConfiguredEditor(draftPath: string, editorPath: string, onSpawnError?: () => void): boolean {
  const trimmed = editorPath?.trim() ?? ''
  if (!trimmed || !existsSync(trimmed)) return false
  try {
    const child = spawn(trimmed, [draftPath], { detached: true, stdio: 'ignore' })
    // spawn 成功返回后仍可能异步失败（权限、依赖缺失），不监听 error 会击穿主进程
    child.on('error', () => onSpawnError?.())
    // 启动后主进程不等待编辑器退出；回填时机由窗口 focus 事件决定
    child.unref()
    return true
  } catch {
    return false
  }
}

/** 校验路径是本模块创建的草稿文件（直接位于临时目录下），防止渲染进程借 IPC 读写任意文件 */
export function isDraftPath(path: string): boolean {
  return dirname(path) === tmpdir() && basename(path).startsWith(DRAFT_PREFIX) && basename(path).endsWith('.md')
}
