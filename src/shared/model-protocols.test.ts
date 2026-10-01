import { describe, expect, it } from 'vitest'
import { modelBaseUrl, modelProtocolAdapter, needsSessionRebuild, resolveModelProtocol } from './model-protocols'

describe('model protocol adapters', () => {
  it('按协议选择 Pi API 与默认地址', () => {
    expect(modelProtocolAdapter('anthropic').piApi).toBe('anthropic-messages')
    expect(modelProtocolAdapter('openai-responses').piApi).toBe('openai-responses')
    expect(modelProtocolAdapter('openai').piApi).toBe('openai-completions')
    expect(modelBaseUrl('anthropic')).toBe('https://api.anthropic.com')
  })

  it('旧配置缺少 protocol 时只兼容历史 provider 协议值', () => {
    expect(resolveModelProtocol(undefined, 'anthropic')).toBe('anthropic')
    expect(resolveModelProtocol(undefined, 'custom-gateway')).toBe('openai')
    expect(resolveModelProtocol('openai-responses', 'custom-gateway')).toBe('openai-responses')
  })

  it('集中处理模型列表与对话地址的协议差异', () => {
    const anthropic = modelProtocolAdapter('anthropic')
    expect(anthropic.modelsUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com/v1/models')
    expect(anthropic.chatUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com/v1/messages')
    expect(modelProtocolAdapter('openai-responses').chatUrl('https://gateway.example/v1')).toBe('https://gateway.example/v1/responses')
  })
})

describe('needsSessionRebuild', () => {
  it('同协议换 provider 直接续跑，不重开 session', () => {
    // MiniMax → DeepSeek 实测：两个不同 provider、同为 openai 协议，历史完整保留
    expect(needsSessionRebuild(['openai'], 'openai')).toBe(false)
    expect(needsSessionRebuild(['openai', 'openai'], 'openai')).toBe(false)
  })

  it('跨协议才重开', () => {
    expect(needsSessionRebuild(['openai'], 'anthropic')).toBe(true)
    expect(needsSessionRebuild(['anthropic'], 'openai')).toBe(true)
    expect(needsSessionRebuild(['openai'], 'openai-responses')).toBe(true)
  })

  it('会话里混过多套协议时，只要有一套和新模型不同就重开', () => {
    expect(needsSessionRebuild(['openai', 'anthropic'], 'openai')).toBe(true)
  })

  it('新会话没跑过任何模型时不需要重开', () => {
    expect(needsSessionRebuild([], 'openai')).toBe(false)
    expect(needsSessionRebuild([], 'anthropic')).toBe(false)
  })

  it('协议解析不出来时保守重开，不拿不确定的历史去赌', () => {
    expect(needsSessionRebuild(null, 'openai')).toBe(true)
  })
})
