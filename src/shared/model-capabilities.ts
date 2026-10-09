import type { LocalModelApi, ModelCapabilities, ModelInputCapability } from './types'

export type CapabilityState = 'unknown' | 'supported' | 'unsupported'
export type CapabilitySource = 'explicit' | 'server' | 'catalog' | 'legacy' | 'default'

export interface CapabilityEvidence {
  state: CapabilityState
  source: CapabilitySource
}

/** 运行时统一使用的模型描述；不包含任何厂商请求 JSON。 */
export interface CanonicalModelProfile {
  provider: string
  modelId: string
  protocol: LocalModelApi
  capabilities: ModelCapabilities
  evidence: Partial<Record<ModelInputCapability, CapabilityEvidence>>
}

const DEFAULT_INPUT: ModelInputCapability[] = ['text']

function addCapability(result: Set<ModelInputCapability>, value: unknown) {
  if (value === 'text' || value === 'image' || value === 'audio' || value === 'file') result.add(value)
}

/** 将服务端、本地配置、连接发现和 Pi 模型的能力声明归一到同一语义。 */
export function normalizeModelCapabilities(input: {
  capabilities?: Partial<ModelCapabilities> | null
  model_kind?: 'chat' | 'multimodal' | null
  vision?: boolean | null
  piInput?: readonly string[] | null
  supports_thinking?: boolean | null
}): ModelCapabilities {
  const result = new Set<ModelInputCapability>(DEFAULT_INPUT)
  for (const value of input.capabilities?.input ?? []) addCapability(result, value)
  for (const value of input.piInput ?? []) addCapability(result, value)
  if (input.model_kind === 'multimodal' || input.vision === true) result.add('image')
  return {
    input: [...DEFAULT_INPUT, ...[...result].filter((value) => value !== 'text')],
    ...(input.capabilities?.thinking === undefined && input.supports_thinking === undefined
      ? {}
      : { thinking: input.capabilities?.thinking ?? Boolean(input.supports_thinking) })
  }
}

export function modelKindForCapabilities(capabilities: ModelCapabilities): 'chat' | 'multimodal' {
  return capabilities.input.includes('image') ? 'multimodal' : 'chat'
}

export function canonicalModelProfile(input: {
  provider: string
  modelId: string
  protocol: LocalModelApi
  capabilities?: Partial<ModelCapabilities> | null
  model_kind?: 'chat' | 'multimodal' | null
  vision?: boolean | null
  piInput?: readonly string[] | null
  supports_thinking?: boolean | null
}): CanonicalModelProfile {
  const capabilities = normalizeModelCapabilities(input)
  const evidence: CanonicalModelProfile['evidence'] = {
    text: { state: 'supported', source: 'default' }
  }
  if (input.capabilities?.input?.includes('image')) evidence.image = { state: 'supported', source: 'explicit' }
  else if (input.piInput?.includes('image')) evidence.image = { state: 'supported', source: 'catalog' }
  else if (input.model_kind === 'multimodal' || input.vision === true) evidence.image = { state: 'supported', source: 'legacy' }
  else evidence.image = { state: 'unknown', source: 'default' }
  return { provider: input.provider, modelId: input.modelId, protocol: input.protocol, capabilities, evidence }
}

export function supportsModelInput(profile: CanonicalModelProfile, capability: ModelInputCapability): boolean {
  return profile.capabilities.input.includes(capability)
}

export type ImageInputMode = 'native' | 'fallback' | 'reject'

/** 统一决定图片走原生、辅助视觉模型还是明确失败；不会把图片静默降级成占位文本。 */
export function resolveImageInputMode(input: { hasImage: boolean; supportsNativeImage: boolean; hasFallback: boolean }): ImageInputMode {
  if (!input.hasImage) return 'native'
  if (input.supportsNativeImage) return 'native'
  if (input.hasFallback) return 'fallback'
  return 'reject'
}

/** 只把 Pi 当前支持的输入能力投影回模型定义，未知能力由后续 serializer 扩展。 */
export function piInputForCapabilities(capabilities: ModelCapabilities): ('text' | 'image')[] {
  return capabilities.input.filter((value): value is 'text' | 'image' => value === 'text' || value === 'image')
}
