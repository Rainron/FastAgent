import { describe, expect, it } from 'vitest'
import { ContextMeter, type ContextMeterInput } from './context-meter'

function input(patch: Partial<ContextMeterInput> = {}): ContextMeterInput {
  return {
    modelId: 1,
    provider: 'openai',
    contextWindow: 128_000,
    systemPrompt: 'system prompt',
    summary: 'summary',
    turns: [
      { user: '你好', assistant: '你好，有什么可以帮你？', tools: [{ name: 'read', input: '{}', result: 'file content' }] }
    ],
    attachments: ['attachment text'],
    ...patch
  }
}

describe('ContextMeter', () => {
  it('按统一组成计算上下文，并分别返回各项 token 数', () => {
    const result = new ContextMeter().measure(input())

    expect(result.modelId).toBe(1)
    expect(result.provider).toBe('openai')
    expect(result.contextWindow).toBe(128_000)
    expect(result.systemTokens).toBeGreaterThan(0)
    expect(result.messageTokens).toBeGreaterThan(0)
    expect(result.toolTokens).toBeGreaterThan(0)
    expect(result.attachmentTokens).toBeGreaterThan(0)
    expect(result.summaryTokens).toBeGreaterThan(0)
    expect(result.estimatedTokens).toBe(
      result.systemTokens + result.messageTokens + result.toolTokens + result.attachmentTokens + result.summaryTokens
    )
  })

  it('切换模型只改变模型窗口与计量元数据，不复用旧窗口', () => {
    const meter = new ContextMeter()
    const small = meter.measure(input({ modelId: 1, contextWindow: 16_000 }))
    const large = meter.measure(input({ modelId: 2, provider: 'anthropic', contextWindow: 200_000 }))

    expect(small.contextWindow).toBe(16_000)
    expect(large.contextWindow).toBe(200_000)
    expect(large.modelId).toBe(2)
    expect(large.provider).toBe('anthropic')
    expect(large.estimatedTokens).toBe(small.estimatedTokens)
  })

  it('使用真实 usage 时校准总量，同时保留分类占比', () => {
    const result = new ContextMeter().measure(input({ usage: { inputTokens: 321, outputTokens: 7 } }))

    expect(result.estimatedTokens).toBe(321)
    expect(result.messageTokens).toBeGreaterThan(0)
    expect(result.toolTokens).toBeGreaterThan(0)
    expect(result.systemTokens).toBeGreaterThan(0)
    expect(result.summaryTokens).toBeGreaterThan(0)
    expect(result.attachmentTokens).toBeGreaterThan(0)
    expect(result.messageTokens + result.toolTokens + result.systemTokens + result.summaryTokens + result.attachmentTokens).toBe(321)
    expect(result.countingMethod).toBe('provider-usage')
  })

  it('CJK 字符按每字约 1 token 估算，中文上下文不被低估', () => {
    const chinese = new ContextMeter().measure(input({ turns: [{ user: '你'.repeat(400), assistant: '好'.repeat(400) }] }))
    const latin = new ContextMeter().measure(input({ turns: [{ user: 'a'.repeat(400), assistant: 'b'.repeat(400) }] }))

    expect(chinese.messageTokens).toBeGreaterThan(latin.messageTokens * 3)
  })
})
