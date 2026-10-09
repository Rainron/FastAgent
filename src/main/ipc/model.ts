import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelParameterOverride } from '../../shared/model-parameters'
import type { ModelConnectionsExportOptions, ModelConnectionsImportPlan, ModelUsageWindow } from '../../shared/types'
import { listLocalModelCatalog } from '../model-catalog'
import { attributeRateLimits } from '../rate-limit-attribution'
import type { IpcRegistrar, MainContext } from '../app-context'
import { fileStamp, pickFile, saveToFile } from './file-dialogs'

const ARCHIVE_FILTERS: Electron.FileFilter[] = [{ name: 'FastAgent 模型服务归档', extensions: ['json'] }]

/** 模型连接、本地自建模型与用量总览。 */
export function registerModelIpc(handle: IpcRegistrar, ctx: MainContext) {
  function previewArchive(path: string, passphrase?: string) {
    const text = readFileSync(path, 'utf8')
    if (!passphrase && ctx.modelConnectionService.archiveNeedsPassphrase(text)) return { path, needsPassphrase: true, contents: null }
    return { path, needsPassphrase: false, contents: ctx.modelConnectionService.previewArchive(text, passphrase) }
  }

  handle('model-connections:providers', () => ctx.modelConnectionService.providers())
  handle('model-connections:list', () => ctx.modelConnectionService.list())
  handle('model-connections:save', (_event, input) => ctx.modelConnectionService.save(input))
  handle('model-connections:remove', (_event, id: string) => ctx.modelConnectionService.remove(id))
  handle('model-connections:models', (_event, input) => ctx.modelConnectionService.models(input))
  handle('model-connections:test', (_event, input) => ctx.modelConnectionService.test(input))
  handle('model-connections:start-login', (_event, providerId: string, connectionId?: string) => ctx.modelConnectionService.startLogin(providerId, connectionId))
  handle('model-connections:auth-state', (_event, sessionId: string) => ctx.modelConnectionService.authState(sessionId))
  handle('model-connections:answer-login', (_event, sessionId: string, value: string) => ctx.modelConnectionService.answerLogin(sessionId, value))
  handle('model-connections:cancel-login', (_event, sessionId: string) => ctx.modelConnectionService.cancelLogin(sessionId))
  handle('model-connections:logout', (_event, id: string) => ctx.modelConnectionService.logout(id))
  handle('model-connections:export', (_event, options: ModelConnectionsExportOptions) =>
    saveToFile(ctx.mainWindow, join(ctx.appPaths.exportsDir, `fastagent-model-services-${fileStamp()}.json`), ctx.modelConnectionService.exportConnections(options), ARCHIVE_FILTERS))
  handle('model-connections:import-preview', async (_event, passphrase?: string) => {
    const path = await pickFile(ctx.mainWindow, ARCHIVE_FILTERS)
    return path ? previewArchive(path, passphrase) : null
  })
  handle('model-connections:import-preview-path', (_event, path: string, passphrase?: string) => previewArchive(path, passphrase))
  handle('model-connections:import', (_event, path: string, plan: ModelConnectionsImportPlan) =>
    ctx.modelConnectionService.importConnections(readFileSync(path, 'utf8'), plan))
  handle('model-connections:reveal-key', (_event, id: string) => ctx.modelConnectionService.revealApiKey(id))
  handle('usage:overview', (_event, window: ModelUsageWindow) => ctx.store.getModelUsageOverview(ctx.requireNamespace(), window))
  // 订阅额度：主进程只在模型请求的响应头里顺手读，读不到就返回空数组，界面据此不显示这一段。
  handle('usage:limits', async () => attributeRateLimits(ctx.rateLimitMonitor.list(), await ctx.modelConnectionService.list()))
  handle('models:localList', () => listLocalModelCatalog(ctx.store))
  handle('models:testDialogue', (_event, id: number) => ctx.testModelDialogue(id))
  // 云端模型的本地参数覆盖。连接内模型不走这里：它们的参数直接写进自己的 payload。
  handle('models:listOverrides', () => [...ctx.store.listModelOverrides()].map(([key, override]) => ({ key, override })))
  handle('models:setOverride', (_event, provider: string, modelName: string, override: ModelParameterOverride) => {
    const saved = ctx.store.setModelOverride(provider, modelName, override)
    ctx.invalidateModelCredentialCache()
    return saved
  })
}
