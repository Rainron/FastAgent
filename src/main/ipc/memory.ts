import type { MemoryCreateInput, MemoryListQuery, MemoryScope, MemoryUpdateInput } from '../../shared/types'
import type { IpcRegistrar, MainContext } from '../app-context'
import { createManualMemory, previewRecall } from '../agent/memory/memory-service'

/** 长期记忆的列表、手动添加、编辑、清空与召回测试。 */
export function registerMemoryIpc(handle: IpcRegistrar, ctx: MainContext) {
  handle('memories:list', (_event, query: MemoryListQuery = {}) => ctx.store.listMemoriesWithSource(ctx.requireNamespace(), query))
  handle('memories:create', (_event, input: MemoryCreateInput) => {
    const created = createManualMemory(ctx.store, ctx.requireNamespace(), input)
    ctx.mainWindow?.webContents.send('memories:changed')
    return created
  })
  handle('memories:preview-recall', (_event, text: string, projectId: string | null) => previewRecall(ctx.store, { namespace: ctx.requireNamespace(), projectId, text, memory: ctx.settings.memory, knowledge: ctx.settings.knowledge }))
  handle('memories:turn-activity', (_event, turnId: string) => ({
    recalled: ctx.store.listMemoryRecallsForTurn(ctx.requireNamespace(), turnId),
    extracted: ctx.store.listMemories(ctx.requireNamespace(), { sourceTurnId: turnId, status: 'all', pageSize: 50 }).items
  }))
  handle('memories:conversation-activity', (_event, conversationId: string) => ctx.store.listMemoryActivityTurnIds(ctx.requireNamespace(), conversationId))
  handle('memories:update', (_event, id: string, patch: MemoryUpdateInput) => {
    const updated = ctx.store.updateMemory(ctx.requireNamespace(), id, patch)
    ctx.mainWindow?.webContents.send('memories:changed')
    return updated
  })
  handle('memories:remove', (_event, id: string) => {
    ctx.store.removeMemory(ctx.requireNamespace(), id)
    ctx.mainWindow?.webContents.send('memories:changed')
  })
  // 清空是物理删除，界面上已有二次确认；scope 缺省表示清掉当前账户的全部记忆。
  handle('memories:clear', (_event, scope?: MemoryScope, scopeId?: string | null) => {
    const removed = ctx.store.clearMemories(ctx.requireNamespace(), scope, scopeId ?? null)
    ctx.mainWindow?.webContents.send('memories:changed')
    return removed
  })
}
