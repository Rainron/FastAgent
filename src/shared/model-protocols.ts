import type { LocalModelApi } from './types'

export type PiModelApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages'

export interface ModelProtocolAdapter {
  protocol: LocalModelApi
  piApi: PiModelApi
  defaultBaseUrl: string
  modelsUrl(baseUrl: string): string
  chatUrl(baseUrl: string): string
}

const ADAPTERS: Record<LocalModelApi, ModelProtocolAdapter> = {
  openai: {
    protocol: 'openai',
    piApi: 'openai-completions',
    defaultBaseUrl: 'https://api.openai.com/v1',
    modelsUrl: (baseUrl) => `${baseUrl}/models`,
    chatUrl: (baseUrl) => `${baseUrl}/chat/completions`
  },
  'openai-responses': {
    protocol: 'openai-responses',
    piApi: 'openai-responses',
    defaultBaseUrl: 'https://api.openai.com/v1',
    modelsUrl: (baseUrl) => `${baseUrl}/models`,
    chatUrl: (baseUrl) => `${baseUrl}/responses`
  },
  anthropic: {
    protocol: 'anthropic',
    piApi: 'anthropic-messages',
    defaultBaseUrl: 'https://api.anthropic.com',
    modelsUrl: (baseUrl) => `${baseUrl.replace(/\/v1$/, '')}/v1/models`,
    chatUrl: (baseUrl) => `${baseUrl.replace(/\/v1$/, '')}/v1/messages`
  }
}

/** 兼容旧配置：只有 provider 恰好是历史协议名时才把它当作 protocol。 */
export function resolveModelProtocol(protocol?: string | null, provider?: string | null): LocalModelApi {
  if (protocol === 'anthropic' || protocol === 'openai-responses' || protocol === 'openai') return protocol
  if (provider === 'anthropic' || provider === 'openai-responses' || provider === 'openai') return provider
  return 'openai'
}

export function modelProtocolAdapter(protocol?: string | null, provider?: string | null): ModelProtocolAdapter {
  return ADAPTERS[resolveModelProtocol(protocol, provider)]
}

export function modelBaseUrl(protocol?: string | null, provider?: string | null, baseUrl?: string | null): string {
  return baseUrl || modelProtocolAdapter(protocol, provider).defaultBaseUrl
}

/**
 * 换模型后要不要固化摘要、重开 pi session。
 *
 * pi 的 session 是 provider 中立的，换模型只追加一条 model_change 条目。实测
 * MiniMax-M3 → deepseek-v4-flash-vision-exp（两个不同 provider，同为 openai 协议）
 * 直接续跑，完整历史与暗号都在，没有任何一次压缩。所以「换 provider 就重开」是过度保守：
 * 它白烧一次摘要调用，还把工具调用等无法进摘要的细节丢掉。
 *
 * 真正有风险的是**跨协议**——Anthropic 的 thinking 签名块之类的不透明内容，
 * 换到另一套协议不保证还能被接受。只有那时才值得重开。
 *
 * @param priorProtocols 这条会话此前跑过的模型协议；解析不出来时传 null 表示「不确定」，
 *                       按保守处理照旧重开。
 */
export function needsSessionRebuild(priorProtocols: LocalModelApi[] | null, nextProtocol: LocalModelApi): boolean {
  if (priorProtocols === null) return true
  return priorProtocols.some((protocol) => protocol !== nextProtocol)
}
