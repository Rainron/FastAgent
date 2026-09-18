import { describe, expect, it } from 'vitest'
import type { LocalModelSummary, ModelOption } from '../shared/types'
import { allSectionGroupIds, conversationModelId, expandedModels, expandedSectionModels, filterModelOptions, groupModelsByChannel, initialExpandedChannels, initialExpandedGroups, initialSelectedModelId, localModelToOption, mergeModelOptions, modelMetaLabel, modelSections, modelTabs, modelsForTab, providerOptions, stepModelIndex, thinkingLevelDescription, thinkingLevelShortLabel, thinkingLevelsForModel, triggerModelLabel, visibleModelOptions } from './model-picker'

// 字段含义按后端实际返回：provider 是提供商，protocol 是调用协议。
const models: ModelOption[] = [
  { id: 1, name: 'MiniMax', model_name: 'MiniMax-M3', model_kind: 'chat', provider: 'MiniMax', protocol: 'anthropic', description: '通用对话', supports_thinking: true, thinking_default: 'medium', thinking_profiles: { auto: {}, low: {}, medium: {}, high: {} } },
  { id: 2, name: 'MiniMax', model_name: 'MiniMax-2.7', model_kind: 'chat', provider: 'MiniMax', protocol: 'anthropic', description: '快速问答', supports_thinking: true, thinking_default: 'auto' },
  { id: 3, name: 'Qwen', model_name: 'qwen3.8-max', model_kind: 'chat', provider: 'Qwen', protocol: 'openai' }
]

describe('model picker helpers', () => {
  it('模型列表异步加载时优先使用已保存模型，再回退到服务端默认模型', () => {
    expect(initialSelectedModelId([{ id: 1 }, { id: 3 }], 3, 1)).toBe(1)
    expect(initialSelectedModelId([{ id: 1 }, { id: 3 }], 3, 999)).toBe(3)
    expect(initialSelectedModelId([{ id: 1 }, { id: 3 }], 3)).toBe(3)
    expect(initialSelectedModelId([{ id: 1 }], 3)).toBe(1)
    expect(initialSelectedModelId([{ id: 1 }], null)).toBe(1)
  })

  it('打开会话时用会话绑定的模型，绑定失效才回退到当前选择', () => {
    expect(conversationModelId([{ id: 1 }, { id: 3 }], 3, 1)).toBe(3)
    expect(conversationModelId([{ id: 1 }, { id: 3 }], 999, 1)).toBe(1)
    expect(conversationModelId([{ id: 1 }, { id: 3 }], null, 1)).toBe(1)
    expect(conversationModelId([], 3, null)).toBeNull()
  })

  it('收藏与最近为空时不生成对应分页签', () => {
    expect(modelTabs(models).map((tab) => tab.key)).toEqual(['all'])
    expect(modelTabs(models, { favoriteIds: [3], recentIds: [2] }).map((tab) => [tab.key, tab.count])).toEqual([['all', 3], ['recent', 1], ['favorite', 1]])
  })

  it('最近使用按点击顺序排列', () => {
    expect(modelsForTab(models, 'recent', { recentIds: [3, 1] }).map((model) => model.id)).toEqual([3, 1])
    expect(modelsForTab(models, 'favorite', { favoriteIds: [2] }).map((model) => model.id)).toEqual([2])
  })

  it('按 provider 汇总数量并支持组合过滤', () => {
    expect(providerOptions(models)).toEqual([{ provider: 'MiniMax', count: 2 }, { provider: 'Qwen', count: 1 }])
    expect(visibleModelOptions(models, { tab: 'all', provider: 'MiniMax' }).map((model) => model.id)).toEqual([1, 2])
    expect(visibleModelOptions(models, { tab: 'favorite', favoriteIds: [3], query: 'minimax' }).map((model) => model.id)).toEqual([1, 2])
    expect(filterModelOptions(models, 'qwen3.8').map((model) => model.id)).toEqual([3])
  })

  it('键盘上下移动在列表内循环，空列表返回 -1', () => {
    expect(stepModelIndex(3, 2, 1)).toBe(0)
    expect(stepModelIndex(3, 0, -1)).toBe(2)
    expect(stepModelIndex(0, 0, 1)).toBe(-1)
  })

  it('只为支持思考的模型返回动态档位', () => {
    expect(thinkingLevelsForModel(models[0])).toEqual(['auto', 'off', 'low', 'medium', 'high'])
    expect(thinkingLevelsForModel(models[2])).toEqual([])
    expect(thinkingLevelsForModel({ ...models[0], thinking_default: 'ultra' })).not.toContain('ultra')
    expect(thinkingLevelsForModel({ ...models[1], thinking_level_map: { minimal: null, xhigh: 'xhigh', max: 'max' } })).toEqual(['auto', 'off', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('入口文案只显示模型名，思考强度单独描述', () => {
    expect(triggerModelLabel(models[0])).toBe('MiniMax-M3')
    expect(triggerModelLabel(null)).toBe('选择模型')
    expect(thinkingLevelShortLabel('medium')).toBe('Med')
    expect(thinkingLevelDescription('low')).toBe('更快响应，适合简单任务')
    expect(thinkingLevelDescription('auto')).toBe('跟随模型默认设置，未配置时关闭思考')
    expect(modelMetaLabel(models[0])).toBe('anthropic · Reasoning')
    expect(modelMetaLabel(models[2])).toBe('openai')
  })
})

describe('模型分组与折叠', () => {
  it('按提供商分组而不是按调用协议，组内保持原顺序', () => {
    expect(groupModelsByChannel(models).map((group) => [group.channel, group.models.map((model) => model.id)]))
      .toEqual([['MiniMax', [1, 2]], ['Qwen', [3]]])
  })

  it('默认只展开当前所选模型所在的分组', () => {
    const groups = groupModelsByChannel(models)
    expect(initialExpandedChannels(groups, 3)).toEqual(['Qwen'])
    expect(initialExpandedChannels(groups, 1)).toEqual(['MiniMax'])
  })

  it('没有所选模型时全部折叠，空列表返回空', () => {
    expect(initialExpandedChannels(groupModelsByChannel(models), null)).toEqual([])
    expect(initialExpandedChannels([], 1)).toEqual([])
  })

  it('只有展开的分组参与键盘定位', () => {
    const groups = groupModelsByChannel(models)
    expect(expandedModels(groups, new Set(['Qwen'])).map((model) => model.id)).toEqual([3])
    expect(expandedModels(groups, new Set(['MiniMax', 'Qwen'])).map((model) => model.id)).toEqual([1, 2, 3])
    expect(expandedModels(groups, new Set())).toEqual([])
  })
})

describe('弹层来源分区', () => {
  // provider 是分组标题（连接模型取连接名），name 是厂商名。
  const connectionModels: ModelOption[] = [
    { id: -1, name: 'OpenAI', model_name: 'gpt-5.1', model_kind: 'chat', provider: 'OpenAI', protocol: 'openai', source: 'local', connectionId: 'conn-a', authMode: 'oauth' },
    { id: -2, name: 'OpenAI', model_name: 'gpt-5.1-codex', model_kind: 'chat', provider: 'OpenAI', protocol: 'openai', source: 'local', connectionId: 'conn-a', authMode: 'oauth' },
    { id: -3, name: 'OpenAI', model_name: 'gpt-4.1', model_kind: 'chat', provider: 'OpenAI', protocol: 'openai', source: 'local', connectionId: 'conn-b', authMode: 'api-key' }
  ]
  const mixed = [...models, ...connectionModels]

  it('先按来源分区再按连接/厂商分组，云端与同名连接不会合并', () => {
    const sections = modelSections(mixed)
    expect(sections.map((section) => [section.key, section.count])).toEqual([['connection', 3], ['cloud', 3]])
    expect(sections[0].groups.map((group) => [group.id, group.label, group.meta, group.models.map((model) => model.id)]))
      .toEqual([['connection:conn-a', 'OpenAI', '账号', [-1, -2]], ['connection:conn-b', 'OpenAI', 'API Key', [-3]]])
    expect(sections[1].groups.map((group) => group.id)).toEqual(['cloud:MiniMax', 'cloud:Qwen'])
  })

  it('连接名与厂商名不同的组头带上厂商与认证方式', () => {
    const [section] = modelSections([{ ...connectionModels[0], provider: '公司网关', connectionId: 'conn-c' }])
    expect(section.groups[0].meta).toBe('OpenAI · 账号')
  })

  it('只有单一来源时仍返回一个分区，空列表返回空', () => {
    expect(modelSections(models).map((section) => section.key)).toEqual(['cloud'])
    expect(modelSections(connectionModels).map((section) => section.key)).toEqual(['connection'])
    expect(modelSections([])).toEqual([])
  })

  it('默认只展开所选模型所在分组，键盘定位只算展开的组', () => {
    const sections = modelSections(mixed)
    expect(initialExpandedGroups(sections, 3)).toEqual(['cloud:Qwen'])
    expect(initialExpandedGroups(sections, -3)).toEqual(['connection:conn-b'])
    expect(initialExpandedGroups(sections, null)).toEqual([])
    expect(expandedSectionModels(sections, new Set(['connection:conn-a', 'cloud:Qwen'])).map((model) => model.id)).toEqual([-1, -2, 3])
    expect(expandedSectionModels(sections, new Set())).toEqual([])
    expect(allSectionGroupIds(sections)).toEqual(['connection:conn-a', 'connection:conn-b', 'cloud:MiniMax', 'cloud:Qwen'])
  })
})

describe('本地模型合并', () => {
  const local: LocalModelSummary[] = [
    { id: -1, name: 'Ollama', provider: 'Ollama', protocol: 'openai', model_name: 'qwen2.5:7b', model_kind: 'chat', base_url: 'http://127.0.0.1:11434/v1', hasApiKey: false, supports_thinking: true, thinking_default: 'medium', thinking_profiles: { low: {}, medium: {} }, updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: -2, name: 'DeepSeek', provider: 'DeepSeek', protocol: 'openai', model_name: 'deepseek-chat', model_kind: 'chat', base_url: 'https://api.deepseek.com/v1', hasApiKey: true, updatedAt: '2026-01-01T00:00:00.000Z' }
  ]

  it('本地模型转 ModelOption：负数 id、source 标记、provider 取提供商名', () => {
    const option = localModelToOption(local[0])
    expect(option.id).toBe(-1)
    expect(option.source).toBe('local')
    expect(option.provider).toBe('Ollama')
    expect(option.protocol).toBe('openai')
    expect(option.name).toBe('Ollama')
    expect(option.model_name).toBe('qwen2.5:7b')
    expect(option.supports_thinking).toBe(true)
    expect(option.thinking_default).toBe('medium')
    expect(option.description).toContain('http://127.0.0.1:11434/v1')
    // 密钥字段绝不进入 ModelOption
    expect(option).not.toHaveProperty('hasApiKey')
    expect(option).not.toHaveProperty('base_url')
  })

  it('连接模型按连接名分组，并带上连接归属与认证方式', () => {
    // 连接内的 name 是模型别名（默认等于模型标识），provider 是厂商名。
    const option = localModelToOption({ ...local[1], name: 'deepseek-chat', provider: 'DeepSeek', connectionId: 'conn-a', connectionName: '公司网关', authMode: 'oauth' })
    expect(option.connectionId).toBe('conn-a')
    expect(option.authMode).toBe('oauth')
    expect(option.provider).toBe('公司网关')
    expect(option.name).toBe('DeepSeek')
    expect(modelMetaLabel(option)).toBe('账号')
    // 旧的本地模型没有连接，仍按提供商名分组
    expect(localModelToOption(local[0]).provider).toBe('Ollama')
  })

  it('合并顺序：云端在前，本地在后，id 不冲突', () => {
    const merged = mergeModelOptions(models, local)
    expect(merged.map((model) => model.id)).toEqual([1, 2, 3, -1, -2])
    expect(merged.filter((model) => model.source === 'local')).toHaveLength(2)
    expect(merged.filter((model) => model.source === 'cloud' || model.source === undefined)).toHaveLength(3)
  })

  it('空列表安全：只有云端或只有本地都正常', () => {
    expect(mergeModelOptions(models, [])).toHaveLength(3)
    expect(mergeModelOptions([], local)).toHaveLength(2)
    expect(mergeModelOptions([], [])).toEqual([])
  })
})
