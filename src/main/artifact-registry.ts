import { existsSync, statSync } from 'node:fs'
import { createArtifactId, inferArtifactType } from '../shared/artifact'
import { resolveToolPath } from './agent/safety/workspace-guard'
import { normalizeWorkspaceRelative } from './workspace-files'
import type { LocalStore } from './local-store'

export interface ArtifactRegistryDeps {
  store: LocalStore
  /** 登记或清除后通知资源面板刷新。 */
  notifyChanged: () => void
}

/** 移除某个工作区相对路径（及其子路径）上已登记的 Artifact，返回是否删掉了记录。 */
export function removeArtifactsUnderPath(store: LocalStore, namespace: string, workspaceId: string, relative: string): boolean {
  const removed = store.listArtifacts(namespace, { workspaceId })
    .filter((artifact) => artifact.path === relative || (artifact.path ?? '').startsWith(`${relative}/`))
  for (const artifact of removed) store.removeArtifact(namespace, artifact.id)
  return removed.length > 0
}

/** 文件 / 目录从 from 移到 to 后，把其下已登记的 Artifact 路径跟着改掉，返回是否改动了记录。 */
export function relocateArtifactsUnderPath(store: LocalStore, namespace: string, workspaceId: string, from: string, to: string): boolean {
  const moved = store.listArtifacts(namespace, { workspaceId })
    .filter((artifact) => artifact.path === from || (artifact.path ?? '').startsWith(`${from}/`))
  for (const artifact of moved) {
    const path = `${to}${(artifact.path as string).slice(from.length)}`
    store.relocateArtifact(namespace, artifact.id, path, path.split('/').pop() || path)
  }
  return moved.length > 0
}

/** 写文件工具成功时登记 Artifact 并广播面板刷新；工作区外 / 非法路径直接忽略。 */
export function registerArtifactForPath(deps: ArtifactRegistryDeps, namespace: string, conversationId: string, turnId: string, runId: string, root: string | null, requested: string, source: string | undefined) {
  if (!root) return
  // 工具入参既可能是相对路径也可能是绝对路径（pi 的 write/edit schema 两者都收），
  // 必须用工具链同一套解析：根目录是这一轮的 cwd，而不是界面当前打开的工作区。
  let resolved: ReturnType<typeof resolveToolPath>
  try {
    resolved = resolveToolPath(requested, root)
  } catch {
    return
  }
  if (resolved.external) return
  // path.relative 在 Windows 给的是 `docs\a.md`，落库必须是 `docs/a.md`，
  // 否则和文件树 / 预览用的相对路径形态对不上，点开就找不到文件。
  const relative = normalizeWorkspaceRelative(resolved.relativePath)
  if (!relative) return
  const name = relative.split('/').pop() || relative
  try {
    // 工具报告改动但文件已不在：补丁删文件的场景。登记一条点不开的产物只会误导，
    // 反过来把旧记录清掉。shell 目标是从命令行静态猜的（可能带 cd 换过目录），
    // 猜错时删掉别人的记录代价太大，只跳过不删。
    if (!existsSync(resolved.absolutePath)) {
      const speculative = source === 'bash' || source === 'powershell'
      if (!speculative && removeArtifactsUnderPath(deps.store, namespace, root, relative)) deps.notifyChanged()
      return
    }
    deps.store.upsertArtifact(namespace, {
      id: createArtifactId(),
      workspaceId: root,
      conversationId,
      // 同一路径在一个会话里只有一条记录，turnId 记的是最近一次写入所属回合。
      turnId,
      agentRunId: runId,
      name,
      type: inferArtifactType(name),
      path: relative,
      size: statSync(resolved.absolutePath).size,
      source: source || 'write'
    })
    deps.notifyChanged()
  } catch (error) {
    console.error('[artifact] 登记失败:', error)
  }
}
