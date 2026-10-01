import { mergeProfiles, sanitizeOverrides, validateProfileDraft } from '../../shared/permission-profiles'
import type { StoredPermissionProfile } from '../../shared/permission-profiles'
import type { PermissionAction } from '../../shared/permission-rules'
import type { ConversationPageQuery, ConversationTurn } from '../../shared/types'
import { reevaluatePendingApprovals } from '../approval-bridge'
import { buildConversationHtml, buildConversationMarkdown, exportFormatFromPath, sanitizeFilename } from '../conversation-export'
import { breadcrumb } from '../logging/logger'
import { dialog, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CompactionError } from '../compaction-error'
import type { IpcRegistrar, MainContext } from '../app-context'

/** 会话详情、上下文策略与压缩、会话与回合的增删改查。 */
export function registerConversationIpc(handle: IpcRegistrar, ctx: MainContext) {
  handle('conversation:listDetailed', () => ctx.store.listConversationsDetailed(ctx.requireNamespace()))
  handle('conversation:listDetailed-page', (_event, query: ConversationPageQuery = {}) => ctx.store.listConversationsDetailedPage(ctx.requireNamespace(), query, Boolean(query.includeArchived)))
  handle('conversations:stats', (_event, includeArchived = false) => ctx.store.conversationStats(ctx.requireNamespace(), includeArchived))
  handle('conversation:getInspector', (_event, conversationId: string) => ctx.store.getConversationInspector(ctx.requireNamespace(), conversationId))
  handle('conversation:updateContextPolicy', (_event, conversationId: string, patch) => ctx.store.updateContextPolicy(ctx.requireNamespace(), conversationId, patch))
  handle('conversation:compactNow', async (_event, conversationId: string, modelId?: number | null) => {
    const namespace = ctx.requireNamespace()
    const credentials = modelId === null || modelId === undefined ? ctx.credentialsForConversation(namespace, conversationId) : ctx.resolveModelCredentials(modelId)
    const key = `${namespace}:${conversationId}`
    if (ctx.activeCompactions.has(key)) throw new CompactionError('COMPACTION_MODEL_ERROR', '当前会话正在压缩')
    return ctx.conversationRuns.run(ctx.conversationRuntimeKey(namespace, conversationId), () => ctx.compactConversation(namespace, conversationId, 'manual', credentials))
  })
  handle('conversation:cancelCompaction', (_event, conversationId: string) => {
    ctx.activeCompactions.get(`${ctx.requireNamespace()}:${conversationId}`)?.abort()
  })
  handle('conversation:getCompactionHistory', (_event, conversationId: string) => ctx.store.listCompactionHistory(ctx.requireNamespace(), conversationId))
  // 切换模型后按目标模型重算：各模型的运行时快照与上下文窗口彼此独立。
  // 通道名必须与 preload 暴露的 refreshContext 逐字一致：不一致时渲染进程拿到的是
  // 「No handler registered」，而调用点又把错误吞掉，表现为换模型后上下文面板毫无反应。
  handle('conversation:refreshContext', (_event, conversationId: string, modelId: number | null) => {
    const namespace = ctx.requireNamespace()
    return ctx.refreshContext(namespace, conversationId, ctx.contextWindowFor(namespace, conversationId, modelId), modelId)
  })
  handle('conversation:model-usage', (_event, conversationId: string, turnId?: string) => ctx.store.getModelUsage(ctx.requireNamespace(), conversationId, turnId))
  handle('conversations:list', () => ctx.store.listConversations(ctx.requireNamespace()))
  // 重载后恢复上次会话用：目标可能不在最近列表第一页，只靠分页结果找不到。
  handle('conversations:get', (_event, conversationId: string) => ctx.store.getConversation(ctx.requireNamespace(), conversationId))
  handle('conversations:list-page', (_event, query: ConversationPageQuery = {}) => ctx.store.listConversationsPage(ctx.requireNamespace(), query, Boolean(query.includeArchived)))
  handle('conversations:history', (_event, conversationId: string) => ctx.store.listTurns(ctx.requireNamespace(), conversationId))
  handle('turns:create', (_event, input) => {
    const namespace = ctx.requireNamespace()
    return ctx.store.createTurn(namespace, input.conversationId, { userMessage: { text: input.prompt, createdAt: input.createdAt }, attachments: input.attachments || [], runtimeConfig: { modelId: input.modelId ?? null, thinkingLevel: input.thinkingLevel || 'auto', mode: input.mode, permission: input.permission || null, project: ctx.store.getConversationRoot(namespace, input.conversationId) }, createdAt: input.createdAt })
  })
  handle('turns:update', (_event, turnId: string, patch) => ctx.store.updateTurn(ctx.requireNamespace(), turnId, patch))
  handle('turns:delete', (_event, turnId: string) => ctx.store.deleteTurn(ctx.requireNamespace(), turnId))
  handle('turns:restore', (_event, turn: ConversationTurn) => ctx.store.restoreTurn(ctx.requireNamespace(), turn))
  handle('conversations:listToolCalls', (_event, turnId: string) => ctx.store.listToolCalls(ctx.requireNamespace(), turnId))
  handle('conversations:contextSources', (_event, turnId: string) => ctx.store.listTurnContextSources(ctx.requireNamespace(), turnId))
  handle('conversations:contextSourceTurns', (_event, conversationId: string) => ctx.store.listContextSourceTurnIds(ctx.requireNamespace(), conversationId))
  handle('conversations:listTodos', (_event, conversationId: string) => ctx.store.listTodos(ctx.requireNamespace(), conversationId))
  handle('conversations:listPermissionRules', () => ctx.store.listPermissionRules(ctx.requireNamespace()))
  handle('conversations:upsertPermissionRule', (_event, rule: { toolKey: string; pattern: string; action: PermissionAction }) => {
    const namespace = ctx.requireNamespace()
    ctx.store.upsertPermissionRule(namespace, rule)
    return ctx.store.listPermissionRules(namespace)
  })
  handle('conversations:removePermissionRule', (_event, toolKey: string, pattern: string) => ctx.store.removePermissionRule(ctx.requireNamespace(), toolKey, pattern))
  handle('conversations:listPermissionProfiles', () => mergeProfiles(ctx.store.listPermissionProfiles(ctx.requireNamespace())))
  handle('conversations:savePermissionProfile', (_event, profile: StoredPermissionProfile) => {
    const namespace = ctx.requireNamespace()
    const existing = mergeProfiles(ctx.store.listPermissionProfiles(namespace))
    const current = existing.find((item) => item.id === profile.id)
    // 新建档位才做重名与标识校验；改已有档位只要求名称非空。
    if (!current) {
      const error = validateProfileDraft({ id: profile.id, label: profile.label, hint: profile.hint, base: profile.base }, existing)
      if (error) throw new Error(error)
    } else if (!profile.label.trim()) {
      throw new Error('档位名称不能为空')
    }
    ctx.store.savePermissionProfile(namespace, {
      id: profile.id,
      label: profile.label.trim(),
      hint: profile.hint.trim(),
      // 内置档的 base 与 builtin 不接受改写，否则出厂规则就找不回来了。
      base: current?.builtin ? (current.base) : profile.base,
      builtin: current?.builtin ?? false,
      overrides: sanitizeOverrides(profile.overrides),
      position: current?.position ?? existing.length
    })
    return mergeProfiles(ctx.store.listPermissionProfiles(namespace))
  })
  handle('conversations:removePermissionProfile', (_event, profileId: string) => {
    const namespace = ctx.requireNamespace()
    ctx.store.removePermissionProfile(namespace, profileId)
    return mergeProfiles(ctx.store.listPermissionProfiles(namespace))
  })
  handle('conversations:create', (_event, input: { title: string; projectId?: string | null }) => {
    const namespace = ctx.requireNamespace()
    const id = `conversation-${randomUUID()}`
    return ctx.store.createConversation(namespace, { id, title: input.title, projectId: input.projectId ?? null })
  })
  handle('conversations:setModel', (_event, conversationId: string, modelId: number | null) => {
    ctx.store.setConversationModelId(ctx.requireNamespace(), conversationId, modelId)
  })
  handle('chat:set-permission', (_event, runId: string, preset: import('../../shared/types').PermissionPreset | null) => {
    // 只对还在跑的 run 生效；已结束的 run 写进去只会变成永不清理的残留。
    const run = ctx.activeRuns.get(runId)
    if (!run) return false
    if (run.namespace !== ctx.requireNamespace()) throw new Error('运行不属于当前工作区')
    if (preset === null || !mergeProfiles(ctx.store.listPermissionProfiles(run.namespace)).some((profile) => profile.id === preset)) throw new Error('权限档位不存在')
    ctx.store.updateTurn(run.namespace, run.turnId, { runtimeConfig: { permission: preset } })
    ctx.runPermissionOverrides.set(runId, preset)
    reevaluatePendingApprovals(runId)
    breadcrumb('run', `permission ${runId} -> ${preset ?? 'default'}`)
    return true
  })
  // 已有 session 文件时以它所在目录为准：迁移前的老会话仍指向旧布局，按计算值会打开一个空目录。
  handle('conversations:openSessionDirectory', (_event, conversationId: string) => {
    const namespace = ctx.requireNamespace()
    const sessionFile = ctx.store.getConversationSessionFile(namespace, conversationId)
    const directory = sessionFile ? dirname(sessionFile) : ctx.conversationSessionDir(namespace, conversationId)
    mkdirSync(directory, { recursive: true })
    return shell.openPath(directory)
  })
  handle('conversations:rename', (_event, conversationId: string, title: string) => ctx.store.renameConversation(ctx.requireNamespace(), conversationId, title))
  // 弹保存对话框导出会话；格式由对话框选的过滤器（扩展名）决定，取消时返回 null。
  handle('conversations:export', async (_event, conversationId: string) => {
    const namespace = ctx.requireNamespace()
    const conversation = ctx.store.getConversation(namespace, conversationId)
    if (!conversation) throw new Error('会话不存在')
    const turns = ctx.store.listTurns(namespace, conversationId)
    const options: Electron.SaveDialogOptions = {
      defaultPath: join(ctx.appPaths.exportsDir, `${sanitizeFilename(conversation.title)}-${new Date().toISOString().slice(0, 10)}.md`),
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'HTML', extensions: ['html'] },
      ],
    }
    const result = ctx.mainWindow ? await dialog.showSaveDialog(ctx.mainWindow, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    const content = exportFormatFromPath(result.filePath) === 'html'
      ? buildConversationHtml(conversation, turns)
      : buildConversationMarkdown(conversation, turns)
    writeFileSync(result.filePath, content, 'utf8')
    return result.filePath
  })
  handle('conversations:archive', (_event, conversationId: string) => ctx.store.archiveConversation(ctx.requireNamespace(), conversationId))
  handle('conversations:remove', (_event, conversationId: string) => {
    const namespace = ctx.requireNamespace()
    ctx.store.deleteModelUsage(namespace, conversationId)
    ctx.store.removeConversation(namespace, conversationId)
  })
  handle('conversations:clear', (_event, conversationId: string) => {
    const namespace = ctx.requireNamespace()
    if (!ctx.store.getConversation(namespace, conversationId)) throw new Error('会话不存在')
    const deleted = ctx.store.clearConversationTurns(namespace, conversationId)
    // 清空后当前会话的运行时缓存立即失效，下次发送会重建全新上下文。
    void ctx.conversationRuntimeCache.invalidate(ctx.conversationRuntimeKey(namespace, conversationId))
    return { deleted }
  })
}
