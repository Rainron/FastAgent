import type { ModelParameterOverride } from '../../shared/model-parameters'
import { listLocalModelCatalog } from '../model-catalog'
import type { IpcRegistrar, MainContext } from '../app-context'

/** 模型连接、本地自建模型与用量总览。 */
export function registerModelIpc(handle: IpcRegistrar, ctx: MainContext) {
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
  handle('usage:overview', (_event, days: number) => ctx.store.getModelUsageOverview(ctx.requireNamespace(), days))
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
