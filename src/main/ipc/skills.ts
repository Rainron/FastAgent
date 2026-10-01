import type { SkillDetail } from '../../shared/types'
import { resolveShellToolName } from '../agent/sandbox/shell-resolver'
import { checkSkill } from '../agent/skill/skill-check'
import { buildDistillPrompt, parseSkillDraft } from '../agent/skill/skill-distiller'
import { parseAllowedTools } from '../agent/skill/skill-manifest'
import { availableToolNames } from '../agent/skill/skill-tools'
import { dialog } from 'electron'
import { readFileSync } from 'node:fs'
import type { IpcRegistrar, MainContext } from '../app-context'

/** Skill 的增删改查、版本回退、校验、导入与蒸馏。 */
export function registerSkillsIpc(handle: IpcRegistrar, ctx: MainContext) {
  handle('skills:list', () => ctx.skillRegistry.list())
  handle('skills:get', (_event, name: string) => ctx.skillRegistry.read(name))
  handle('skills:create', (_event, input) => {
    const record = ctx.skillRegistry.create(input)
    ctx.store.upsertAbilityMeta({ abilityType: 'skill', abilityId: record.name, source: 'created', version: record.version })
    return record
  })
  handle('skills:update', (_event, name: string, patch) => ctx.skillRegistry.update(name, patch))
  handle('skills:set-enabled', (_event, name: string, enabled: boolean) => ctx.skillRegistry.setEnabled(name, enabled))
  handle('skills:remove', (_event, name: string) => {
    ctx.skillRegistry.remove(name)
    ctx.store.removeAbilityMeta('skill', name)
  })
  /** Skill 声明的工具能不能用，取决于当前环境；探测一次给校验与详情共用。 */
  function currentToolNames(): string[] {
    return availableToolNames({
      shellToolName: resolveShellToolName(ctx.settings.shellPreference, { explicitPath: ctx.settings.bashPath, bundledPath: ctx.bundledTools.bash }),
      mcpServers: ctx.store.listEnabledMcpRuntimeConfigs().map((config) => ({
        id: config.id,
        tools: (ctx.store.getMcpStatus(config.id)?.tools ?? []).map((tool) => tool.name)
      })),
      cliTools: ctx.store.listCliTools().map((tool) => tool.id),
      subAgentEnabled: ctx.settings.subAgentEnabled
    })
  }
  /**
   * 统一搜索：会话标题、项目知识、Skill、成果各查一次再合并。
   * 每一类都在库里筛完再截断，不把全量读出来在内存里过滤。
   */
  handle('skills:versions', (_event, name: string) => ctx.store.listSkillVersions(name))
  handle('skills:revert', (_event, name: string, revision: number) => ctx.skillRegistry.revert(name, revision))
  // 静态校验，不是试运行：不启动模型也不执行脚本，只查配置与依赖缺不缺。
  handle('skills:check', (_event, name: string) => {
    const detail = ctx.skillRegistry.read(name)
    const directoryName = ctx.skillRegistry.directoryOf(name).split(/[\/]/).filter(Boolean).at(-1) ?? name
    return checkSkill({
      name: detail.name,
      content: readFileSync(detail.filePath, 'utf8'),
      directoryName,
      files: ctx.skillRegistry.files(name).map((file) => file.path),
      availableTools: currentToolNames()
    })
  })
  handle('skills:detail', (_event, name: string): SkillDetail => {
    const detail = ctx.skillRegistry.read(name)
    const meta = ctx.store.getAbilityMeta('skill', name)
    const requiredTools = parseAllowedTools(readFileSync(detail.filePath, 'utf8'))
    const available = new Set(currentToolNames())
    return {
      ...detail,
      files: ctx.skillRegistry.files(name),
      source: meta?.source ?? 'imported',
      pluginId: meta?.pluginId,
      installedAt: meta?.installedAt,
      builtin: meta?.source === 'builtin',
      requiredTools,
      missingTools: requiredTools.filter((tool) => !available.has(tool))
    }
  })
  handle('skills:import', async (_event, options: { format?: 'directory' | 'zip'; onConflict?: 'overwrite' | 'save-as' } = {}) => {
    const zip = options.format === 'zip'
    const result = await dialog.showOpenDialog(ctx.mainWindow!, {
      title: zip ? '导入 Skill 压缩包' : '导入 Skill',
      properties: zip ? ['openFile'] : ['openDirectory', 'openFile'],
      filters: zip ? [{ name: 'ZIP 压缩包', extensions: ['zip'] }] : [{ name: 'Skill 文件', extensions: ['md', 'zip'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const record = ctx.skillRegistry.importFromPath(result.filePaths[0], { onConflict: options.onConflict })
    ctx.store.upsertAbilityMeta({ abilityType: 'skill', abilityId: record.name, source: 'imported', version: record.version })
    return record
  })
  // 技能蒸馏：拿会话末尾若干回合让模型出 SKILL.md 草稿；只返草稿不落库，用户确认后走 skills:create。
  handle('skills:distill', async (_event, conversationId: string, modelId: number | null) => {
    const namespace = ctx.requireNamespace()
    const conversation = ctx.store.getConversation(namespace, conversationId)
    if (!conversation) throw new Error('会话不存在')
    // 一次性用户动作，整段读出来可接受；只挑有助手产出的完整回合。
    const turns = ctx.store.listTurns(namespace, conversationId)
      .filter((turn) => turn.assistantMessage?.text?.trim())
      .map((turn) => ({ user: turn.userMessage.text, assistant: turn.assistantMessage?.text ?? '' }))
    if (!turns.length) throw new Error('会话里没有可提炼的完整回合')
    const credentials = modelId === null ? null : (() => { try { return ctx.resolveModelCredentials(modelId) } catch { return null } })()
    if (!credentials) throw new Error('无法解析当前模型的凭证，请重新选择模型')
    const { promptModelOnce } = await ctx.loadPiRuntime()
    const raw = await promptModelOnce({
      credentials,
      prompt: buildDistillPrompt({ title: conversation.title || '未命名会话', turns }),
      agentDir: ctx.appPaths.agentDir,
      createModelRuntime: ctx.createModelRuntimeForCredentials
    })
    if (/^none$/i.test(raw.trim())) throw new Error('这段会话里没有值得沉淀为技能的方法论')
    const draft = parseSkillDraft(raw)
    if (!draft) throw new Error('提炼结果不符合格式，请重试或换一段会话')
    return draft
  })
}
