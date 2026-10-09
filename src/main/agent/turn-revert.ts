import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { TurnRevertResult } from '../../shared/types'
import type { RevertableFileChange } from '../local-store/artifact-store'
import { snapshotFile } from './file-ledger'
import { resolveToolPath } from './safety/workspace-guard'

/**
 * 把一轮 Agent 改动退回到这一轮开始之前：改过 / 删掉的写回原文，新建的删掉。
 *
 * 只动「写完之后没人再碰过」的文件——磁盘现状的哈希必须等于台账记的改后哈希，
 * 否则说明用户或下一轮又改过，覆盖回去会吞掉那些改动，这类一律跳过并说明原因。
 * 逐个文件处理、互不牵连：一个失败不影响其余文件，结果里分开列出。
 */
export async function revertFileChanges(workspaceRoot: string, changes: RevertableFileChange[]): Promise<TurnRevertResult> {
  const result: TurnRevertResult = { reverted: [], skipped: [] }
  for (const change of changes) {
    const reason = await revertOne(workspaceRoot, change)
    if (reason) result.skipped.push({ path: change.path, reason })
    else result.reverted.push(change.path)
  }
  return result
}

/** 撤销编排用到的台账能力；按接口收窄，测试不必起整个 LocalStore。 */
export interface TurnRevertStore {
  listRevertableFileChanges(namespace: string, turnId: string): RevertableFileChange[]
  markFileChangesReverted(namespace: string, turnId: string, paths: string[]): void
  getConversationRoot(namespace: string, conversationId: string): string | null
}

/**
 * 撤销一整轮：根目录与运行时同一规则（会话归属的项目目录，未归属落到快速工作区），
 * 写回成功的才打撤销标记，跳过的留在台账里，界面仍显示为未撤销。
 */
export async function revertTurn(store: TurnRevertStore, namespace: string, turnId: string, quickWorkspaceDir: string): Promise<TurnRevertResult> {
  const changes = store.listRevertableFileChanges(namespace, turnId)
  if (!changes.length) return { reverted: [], skipped: [] }
  const root = store.getConversationRoot(namespace, changes[0].conversationId) ?? quickWorkspaceDir
  const result = await revertFileChanges(root, changes)
  store.markFileChangesReverted(namespace, turnId, result.reverted)
  return result
}

/** 成功返回 null，否则返回跳过原因。 */
async function revertOne(workspaceRoot: string, change: RevertableFileChange): Promise<string | null> {
  if (change.operation === 'rename') return '重命名暂不支持撤销'
  let absolutePath: string
  try {
    const resolved = resolveToolPath(change.path, workspaceRoot)
    // 越界路径一律不碰：台账里的相对路径换了根目录后可能指到别处
    if (resolved.external) return '文件不在工作区内'
    absolutePath = resolved.absolutePath
  } catch {
    return '路径无效'
  }

  const current = snapshotFile(absolutePath)
  const untouched = change.afterHash === null ? !current.exists : current.exists && current.hash === change.afterHash
  if (!untouched) return '这一轮之后文件又被改过'

  try {
    if (change.operation === 'create') {
      await rm(absolutePath, { force: true })
      return null
    }
    if (change.beforeText === null) return '没有留下改动前的原文'
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, change.beforeText, 'utf8')
    return null
  } catch (error) {
    return error instanceof Error ? error.message : '写入失败'
  }
}
