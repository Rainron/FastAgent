import { relative } from 'node:path'
import { normalizeWorkspaceRelative, resolveWorkspaceFile } from '../workspace-files'
import type { IpcRegistrar, MainContext } from '../app-context'

/** 页面预览：工作区文件转预览地址、连通性探测、系统浏览器打开、对话卡片缩略图。 */
export function registerPreviewIpc(handle: IpcRegistrar, ctx: MainContext) {
  // 资源面板里点开的 .html：按当前工作区解析（越界抛错），登记根目录后给出 fa-preview 地址。
  handle('preview:file-url', (_event, path: string) => {
    const root = ctx.workspaceRoot
    const absolute = resolveWorkspaceFile(root, String(path ?? ''))
    return ctx.previewService.fileUrl(root as string, normalizeWorkspaceRelative(relative(root as string, absolute)))
  })
  handle('preview:probe', (_event, url: string) => ctx.previewService.probe(String(url ?? '')))
  handle('preview:open-external', (_event, url: string) => ctx.previewService.openExternal(String(url ?? '')))
  handle('preview:screenshot', (_event, conversationId: string, toolCallId: string) => ctx.previewService.readScreenshot(String(conversationId ?? ''), String(toolCallId ?? '')))
}
