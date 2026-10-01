import type { KbSourceKind } from '../../shared/types'
import { previewSource } from '../knowledge/kb-indexer'
import { DEFAULT_EXCLUDES } from '../knowledge/source-scan'
import { dialog } from 'electron'
import { basename } from 'node:path'
import type { IpcRegistrar, MainContext } from '../app-context'

/** 项目知识库条目与知识来源。 */
export function registerKbIpc(handle: IpcRegistrar, ctx: MainContext) {
  handle('kb:list', (_event, projectId: string) => ctx.store.listKbEntries(ctx.requireNamespace(), projectId))
  handle('kb:save', (_event, projectId: string, input: { id?: string; title: string; content: string }) => {
    const saved = ctx.store.saveKbEntry(ctx.requireNamespace(), projectId, input)
    ctx.mainWindow?.webContents.send('kb:changed', projectId)
    return saved
  })
  handle('kb:remove', (_event, projectId: string, entryId: string) => {
    ctx.store.removeKbEntry(ctx.requireNamespace(), projectId, entryId)
    ctx.mainWindow?.webContents.send('kb:changed', projectId)
  })
  handle('kb:listSources', (_event, projectId: string) => ctx.store.knowledgeBase.listSources(ctx.requireNamespace(), projectId))
  // 导入按「先选路径 → 预览范围 → 确认后建来源并索引」三步；预览不写库。
  handle('kb:pickSource', async (_event, kind: KbSourceKind) => {
    const result = await dialog.showOpenDialog({
      title: kind === 'directory' ? '选择要绑定的目录' : '选择要导入的文件',
      properties: [kind === 'directory' ? 'openDirectory' : 'openFile'],
      filters: kind === 'file' ? [{ name: '可索引文档', extensions: ['md', 'markdown', 'mdx', 'txt', 'text', 'pdf', 'json', 'yaml', 'yml', 'ts', 'tsx', 'js', 'py', 'go', 'rs', 'java', 'sql'] }] : undefined
    })
    if (result.canceled || !result.filePaths.length) return null
    return previewSource(result.filePaths[0], kind)
  })
  handle('kb:previewSource', (_event, path: string, kind: KbSourceKind, excludes?: string[]) => previewSource(path, kind, excludes))
  handle('kb:addSource', async (_event, projectId: string, input: { path: string; kind: KbSourceKind; title?: string; excludes?: string[] }) => {
    const namespace = ctx.requireNamespace()
    const source = ctx.store.knowledgeBase.createSource(namespace, {
      projectId,
      kind: input.kind,
      path: input.path,
      title: input.title?.trim() || basename(input.path) || input.path,
      excludes: input.excludes ?? DEFAULT_EXCLUDES
    })
    const result = await ctx.runKbIndex(namespace, source)
    ctx.mainWindow?.webContents.send('kb:changed', projectId)
    return result
  })
  handle('kb:refreshSource', async (_event, sourceId: string) => {
    const namespace = ctx.requireNamespace()
    const source = ctx.store.knowledgeBase.requireSource(namespace, sourceId)
    const result = await ctx.runKbIndex(namespace, source)
    ctx.mainWindow?.webContents.send('kb:changed', source.projectId)
    return result
  })
  handle('kb:removeSource', (_event, sourceId: string) => {
    const namespace = ctx.requireNamespace()
    const source = ctx.store.knowledgeBase.getSource(namespace, sourceId)
    ctx.store.knowledgeBase.removeSource(namespace, sourceId)
    if (source) ctx.mainWindow?.webContents.send('kb:changed', source.projectId)
  })
}
