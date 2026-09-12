import type { ModelProviderPreset } from './types'

export const MODEL_PROVIDERS: ModelProviderPreset[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', protocol: 'openai', authModes: ['api-key', 'oauth'], oauthProviderId: 'openai-codex', models: [] },
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'openai', authModes: ['api-key'], models: [] },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'openai', authModes: ['api-key'], models: [] },
  { id: 'kimi', name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', protocol: 'openai', authModes: ['api-key'], models: [] },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai', authModes: ['api-key'], models: [] },
  { id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimaxi.com/v1', protocol: 'openai', authModes: ['api-key'], models: [] },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', protocol: 'anthropic', authModes: ['api-key'], models: [] },
  { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', protocol: 'openai', authModes: ['api-key'], models: [] },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', protocol: 'openai', authModes: ['api-key'], models: [] },
  { id: 'custom', name: '自定义 OpenAI 兼容', baseUrl: '', protocol: 'openai', authModes: ['api-key'], models: [] }
]

export function normalizeConnectionEndpoint(value: string): string {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('请输入有效的模型服务地址') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('模型服务地址只支持不含凭据、查询参数或片段的 HTTP(S) URL')
  return url.toString().replace(/\/+$/, '')
}

export function modelProvider(id: string): ModelProviderPreset {
  const provider = MODEL_PROVIDERS.find((item) => item.id === id)
  if (!provider) throw new Error('未知模型厂商')
  return provider
}
