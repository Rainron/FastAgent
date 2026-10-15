import { realpath } from 'node:fs/promises'
import { relative } from 'node:path'
import { containsPath, resolveWorkspaceFile } from './workspace-files'

export async function openWorkspaceFile(root: string | null, path: string, expectedRoot: string | undefined, openPath: (path: string) => Promise<string>): Promise<string> {
  if (!root) return '尚未打开工作区'
  if (expectedRoot !== undefined && relative(root, expectedRoot) !== '') return '工作区已切换，请重新打开文件预览'
  try {
    const absolute = await realpath(resolveWorkspaceFile(root, path))
    if (!containsPath(await realpath(root), absolute)) return '只能打开工作区内的文件'
    return await openPath(absolute)
  } catch (error) {
    return error instanceof Error ? error.message : '无法打开文件'
  }
}
