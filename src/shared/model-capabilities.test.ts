import { describe, expect, it } from 'vitest'
import { canonicalModelProfile, modelKindForCapabilities, normalizeModelCapabilities, piInputForCapabilities, resolveImageInputMode, supportsModelInput } from './model-capabilities'

describe('model capabilities', () => {
  it('兼容旧 model_kind、vision 和 Pi input', () => {
    const capabilities = normalizeModelCapabilities({ model_kind: 'multimodal', vision: true, piInput: ['text', 'image'] })
    expect(capabilities.input).toEqual(['text', 'image'])
    expect(modelKindForCapabilities(capabilities)).toBe('multimodal')
    expect(piInputForCapabilities(capabilities)).toEqual(['text', 'image'])
  })

  it('默认只接受文本，并保留未来能力声明', () => {
    const capabilities = normalizeModelCapabilities({ capabilities: { input: ['text', 'audio', 'file'] } })
    expect(capabilities.input).toEqual(['text', 'audio', 'file'])
    expect(piInputForCapabilities(capabilities)).toEqual(['text'])
  })

  it('profile 记录能力来源，但不承担协议序列化', () => {
    const profile = canonicalModelProfile({ provider: 'gateway', modelId: 'vision', protocol: 'openai', vision: true })
    expect(profile.evidence.image).toEqual({ state: 'supported', source: 'legacy' })
    expect(supportsModelInput(profile, 'image')).toBe(true)
  })

  it('图片路由在没有 native/fallback 能力时明确拒绝', () => {
    expect(resolveImageInputMode({ hasImage: false, supportsNativeImage: false, hasFallback: false })).toBe('native')
    expect(resolveImageInputMode({ hasImage: true, supportsNativeImage: true, hasFallback: false })).toBe('native')
    expect(resolveImageInputMode({ hasImage: true, supportsNativeImage: false, hasFallback: true })).toBe('fallback')
    expect(resolveImageInputMode({ hasImage: true, supportsNativeImage: false, hasFallback: false })).toBe('reject')
  })
})
