import { ApiError } from '../api-client'
import { LocalStore } from '../local-store'
import { applyOverrides } from '../../shared/model-parameters'
import type { ModelOption } from '../../shared/types'
import type { IpcRegistrar, MainContext } from '../app-context'

/** 云端模型清单套上本地覆盖；models 不是数组（缓存损坏）时原样返回。 */
function withModelOverrides<T extends object>(ctx: MainContext, data: T): T {
  const models = (data as { models?: unknown }).models
  if (!Array.isArray(models)) return data
  return { ...data, models: applyOverrides(models as ModelOption[], ctx.store.listModelOverrides()) }
}

/** 登录态、验证码、账号锁定与登录后的资源引导。 */
export function registerAuthIpc(handle: IpcRegistrar, ctx: MainContext) {
  handle('auth:snapshot', () => ctx.authState)
  handle('auth:request-login', () => {
    ctx.broadcastAuth({ state: 'login_requested', user: null, backendUrl: ctx.authState.backendUrl })
    return ctx.authState
  })
  handle('auth:enter-workspace', (_event, modelId?: number) => {
    if (!ctx.store.modelConnections().list().some((connection) => connection.models.some((model) => model.id === modelId)) && !ctx.store.listLocalModels().some((model) => model.id === modelId)) {
      throw new Error('请先配置一个可用的模型连接')
    }
    ctx.broadcastAuth({ state: 'ready', user: null, backendUrl: null })
    return ctx.authState
  })
  handle('auth:captcha', async (_event, url: string) => {
    return ctx.createApiClient(url).captcha()
  })
  handle('auth:login', async (_event, input) => ctx.performLogin(input))
  handle('auth:lock', async () => { await ctx.lockAccount(); return ctx.authState })
  handle('auth:logout', async () => ctx.performLogout())
  handle('resources:bootstrap', async () => {
    try {
      if (!ctx.client || ctx.authState.state !== 'ready') {
        if (ctx.authState.state !== 'ready') throw new Error('当前工作区未就绪')
        return { user: ctx.authState.user ?? { id: 'local', username: '本地工作区' }, models: [], default_model_id: null, default_thinking_level: null, schema_version: 'desktop-local' }
      }
      const { model_credentials: credentials = [], ...bootstrapped } = await ctx.requireClient().bootstrap()
      const sourceNamespace = ctx.accountNamespace()
      const modelIdMap = new Map<number, number>()
      if (sourceNamespace) for (const model of bootstrapped.models) modelIdMap.set(model.id, ctx.store.workspaceModelId(sourceNamespace, model.id))
      const mappedCredentials = credentials.map((credential) => ({ ...credential, id: modelIdMap.get(credential.id) ?? credential.id }))
      ctx.cacheModelCredentials(mappedCredentials)
      // 公开模型列表不带窗口与输出上限，这两项只在凭证里；不补齐的话设置页与上下文面板只能显示默认 128k。
      const data = { ...bootstrapped, default_model_id: bootstrapped.default_model_id === null || bootstrapped.default_model_id === undefined ? bootstrapped.default_model_id : modelIdMap.get(bootstrapped.default_model_id) ?? bootstrapped.default_model_id, models: bootstrapped.models.map((model) => {
        const id = modelIdMap.get(model.id) ?? model.id
        const credential = mappedCredentials.find((item) => item.id === id)
        if (!credential) return { ...model, id }
        return {
          ...model, id,
          context_window: model.context_window ?? credential.context_window ?? null,
          max_tokens: model.max_tokens ?? credential.max_tokens ?? null
        }
      }) }
      if (ctx.backendUrl && ctx.userId) {
        // 凭证走独立加密表，不进明文的 resource_cache。
        if (mappedCredentials.length) ctx.store.saveModelCredentials(LocalStore.namespace(ctx.backendUrl, ctx.userId), mappedCredentials)
        ctx.store.saveResources(ctx.backendUrl, ctx.userId, data as unknown as Record<string, unknown>)
      }
      // 本地覆盖在落缓存之后才套：烤进 resource_cache 的话，清除覆盖要重新登录才看得到效果。
      return withModelOverrides(ctx, data)
    }
    catch (error) {
      if (ctx.backendUrl && ctx.userId) {
        const cached = ctx.store.loadResources(ctx.backendUrl, ctx.userId)
        if (cached && ctx.authState.user && Array.isArray(cached.models)) {
          return withModelOverrides(ctx, { ...cached, user: ctx.authState.user, schema_version: 'desktop-cache' })
        }
      }
      if (error instanceof ApiError && error.status === 401) await ctx.lockAccount('revoked')
      throw error
    }
  })
}
