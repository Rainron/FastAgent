import type { ArtifactQuery } from '../../shared/types'
import { diffSnapshots, snapshotFile } from '../agent/file-ledger'
import { resolveToolPath } from '../agent/safety/workspace-guard'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IpcRegistrar, MainContext } from '../app-context'

/** 成果列表、版本、恢复与文件变更 diff。 */
export function registerArtifactsIpc(handle: IpcRegistrar, ctx: MainContext) {
  handle('artifacts:list', (_event, query: ArtifactQuery = {}) => ctx.store.listArtifacts(ctx.requireNamespace(), query)
    .map((artifact) => (artifact.path ? { ...artifact, missing: !existsSync(join(artifact.workspaceId, artifact.path)) } : artifact)))
  handle('artifacts:remove', (_event, artifactId: string) => {
    ctx.store.removeArtifact(ctx.requireNamespace(), artifactId)
    ctx.mainWindow?.webContents.send('artifacts:changed')
  })
  // 成果版本：一条记录 = 一个回合改过这个文件一次。不另起版本号，回合本身就是可追溯的标识。
  handle('artifacts:versions', (_event, artifactId: string) => {
    const namespace = ctx.requireNamespace()
    const artifact = ctx.store.getArtifact(namespace, artifactId)
    if (!artifact?.path) return []
    return ctx.store.listFileVersions(namespace, artifact.path, artifact.conversationId ?? null)
  })
  handle('artifacts:versionDiff', (_event, artifactId: string, turnId: string) => {
    const namespace = ctx.requireNamespace()
    const artifact = ctx.store.getArtifact(namespace, artifactId)
    if (!artifact?.path) return null
    return ctx.store.getFileChangeDiff(namespace, turnId, artifact.path)
  })
  /**
   * 恢复到某一回合改动之前：把当时记下的原文写回去。
   * 这是一次真实写盘，因此走与工具链同一套路径校验，越界路径直接拒绝；
   * 恢复本身也被记为一次新变更，用户还能再退回来。
   */
  handle('artifacts:restore', async (_event, artifactId: string, turnId: string) => {
    const namespace = ctx.requireNamespace()
    const artifact = ctx.store.getArtifact(namespace, artifactId)
    if (!artifact?.path) return { ok: false, error: '这条成果没有对应的文件' }
    const original = ctx.store.getFileChangeBeforeText(namespace, turnId, artifact.path)
    if (original === null) return { ok: false, error: '这一版没有留下改动前的原文，无法恢复' }
    let resolved: ReturnType<typeof resolveToolPath>
    try {
      resolved = resolveToolPath(artifact.path, artifact.workspaceId)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '路径无效' }
    }
    if (resolved.external) return { ok: false, error: '目标不在工作区内，拒绝写入' }
    try {
      const before = snapshotFile(resolved.absolutePath)
      await writeFile(resolved.absolutePath, original, 'utf8')
      const after = snapshotFile(resolved.absolutePath)
      const diff = diffSnapshots(before, after)
      // 恢复动作自己也进变更台账：turnId 用恢复回合的合成 id，和 Agent 写入区分开。
      ctx.store.upsertFileChange(namespace, {
        turnId: `restore-${turnId}`,
        conversationId: artifact.conversationId ?? '',
        runId: '',
        path: artifact.path,
        operation: 'update',
        additions: diff.additions,
        deletions: diff.deletions,
        tools: ['restore'],
        beforeHash: before.exists ? before.hash : null,
        afterHash: after.exists ? after.hash : null,
        diff: diff.text || null,
        beforeText: before.exists && before.lines ? before.lines.join('\n') : null
      })
      ctx.store.upsertArtifact(namespace, { ...artifact, size: after.size })
      ctx.mainWindow?.webContents.send('artifacts:changed')
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '恢复失败' }
    }
  })
  // 台账只读：运行与任务由 ctx.runLocalRun / executeSubAgent 写入，界面不修改它们。
  handle('changes:list', (_event, turnId: string) => ctx.store.listFileChanges(ctx.requireNamespace(), turnId))
  handle('changes:diff', (_event, turnId: string, path: string) => ctx.store.getFileChangeDiff(ctx.requireNamespace(), turnId, path))
  // 只放行 http/https：javascript:/file:/data: 交给 shell.openExternal 会直接变成本机代码执行或任意文件打开。
}
