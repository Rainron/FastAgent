import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTEXT_WINDOW, inferContextWindow, resolveContextWindow } from './model-context-windows'

describe('model context windows', () => {
  it('名字里的容量后缀优先于系列规则', () => {
    expect(inferContextWindow('moonshot-v1-32k')).toBe(32_768)
    expect(inferContextWindow('moonshot-v1-128k')).toBe(131_072)
    // 系列规则会给 kimi 131072，后缀声明 8k 时以后缀为准
    expect(inferContextWindow('moonshot-v1-8k')).toBe(8_192)
  })

  it('按系列推断常见模型', () => {
    expect(inferContextWindow('claude-opus-4-5')).toBe(200_000)
    expect(inferContextWindow('gpt-4o-mini')).toBe(128_000)
    expect(inferContextWindow('gpt-4.1')).toBe(1_047_576)
    expect(inferContextWindow('gemini-2.5-pro')).toBe(1_048_576)
    expect(inferContextWindow('gemini-1.5-pro-002')).toBe(2_097_152)
    expect(inferContextWindow('deepseek-reasoner')).toBe(65_536)
  })

  it('大小写与前缀不影响匹配', () => {
    expect(inferContextWindow('Anthropic/Claude-Sonnet-4-5')).toBe(200_000)
    expect(inferContextWindow('openai/GPT-5')).toBe(400_000)
  })

  it('无法判断时返回 null', () => {
    expect(inferContextWindow('my-private-model')).toBeNull()
    expect(inferContextWindow('')).toBeNull()
    expect(inferContextWindow(null)).toBeNull()
  })

  it('显式配置优先，0 与空都算未配置', () => {
    expect(resolveContextWindow(64_000, 'claude-opus-4-5')).toBe(64_000)
    expect(resolveContextWindow(0, 'claude-opus-4-5')).toBe(200_000)
    expect(resolveContextWindow(null, 'claude-opus-4-5')).toBe(200_000)
    expect(resolveContextWindow(undefined, 'my-private-model')).toBe(DEFAULT_CONTEXT_WINDOW)
  })
})
