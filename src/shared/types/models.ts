import type { ThinkingLevelMap } from './common'

/** 本地添加模型的接口协议：与 pi 运行时的 Api 类型对应。 */
export type LocalModelApi = 'openai' | 'anthropic' | 'openai-responses'

export interface ModelOption {
  connectionId?: string
  authMode?: 'api-key' | 'oauth'
  id: number
  name: string
  model_name: string
  model_kind: 'chat' | 'multimodal'
  /** 模型提供商，用于分组和展示。 */
  provider: string
  /** 调用协议；旧缓存缺失时由运行时按兼容规则回退。 */
  protocol?: LocalModelApi
  description?: string
  /** 服务端公开的模型能力上限；缺失时运行时按默认值处理。 */
  max_tokens?: number | null
  context_window?: number | null
  thinking_level_map?: ThinkingLevelMap
  supports_thinking?: boolean
  thinking_default?: string
  thinking_profiles?: Record<string, unknown> | null
  /** 模型来源：云端登录下发或本地手动添加；云端模型无此字段（历史数据兼容）。 */
  source?: 'cloud' | 'local'
}

export interface ModelCredentials {
  connectionId?: string
  authMode?: 'api-key' | 'oauth'
  oauthProviderId?: string
  id: number
  name: string
  /** 模型提供商，用于分组和展示。 */
  provider: string
  /** 调用协议；旧凭证缺失时由运行时按旧 provider 兼容。 */
  protocol?: LocalModelApi
  model_name: string
  model_kind?: 'chat' | 'multimodal'
  base_url: string | null
  api_key: string
  headers?: Record<string, string>
  temperature?: number
  max_tokens?: number | null
  context_window?: number | null
  /** 单位秒；会话运行时映射为 pi 的 provider 超时（毫秒）。 */
  timeout?: number
  max_retries?: number
  extra_body?: Record<string, unknown> | null
  /** pi 模型定义的厂商兼容配置（thinkingFormat / maxTokensField 等），云端未下发时为空。 */
  compat?: Record<string, unknown> | null
  thinking_level_map?: ThinkingLevelMap
  supports_thinking?: boolean
  thinking_default?: string
  thinking_profiles?: Record<string, unknown> | null
}

/** 本地模型写操作入参：api_key / headers 为敏感字段，只在提交时传递。 */
export interface LocalModelInput {
  connectionId?: string
  /** 提供商名称，用于分组和展示。 */
  name: string
  provider: string
  /** 调用协议，用于选择运行时适配器。旧配置读取时回退为 provider。 */
  protocol?: LocalModelApi
  model_name: string
  model_kind: 'chat' | 'multimodal'
  base_url: string
  /** 编辑时留空或省略表示保留原值；显式传空字符串表示清空。 */
  api_key?: string
  headers?: Record<string, string>
  temperature?: number
  max_tokens?: number | null
  context_window?: number | null
  timeout?: number
  max_retries?: number
  extra_body?: Record<string, unknown> | null
  thinking_level_map?: ThinkingLevelMap
  supports_thinking?: boolean
  thinking_default?: string
  thinking_profiles?: Record<string, unknown> | null
  compat?: Record<string, unknown> | null
}

/** 本地模型对外只读形态：负数 id（与云端正整数隔离），不含任何密钥。 */
export interface LocalModelSummary {
  connectionId?: string
  /** 所属连接的显示名；模型弹层按连接分组时用作组标题。 */
  connectionName?: string
  authMode?: 'api-key' | 'oauth'
  id: number
  /** 提供商名称，用于分组和展示。 */
  name: string
  provider: string
  /** 调用协议，用于选择运行时适配器。旧配置读取时回退为 provider。 */
  protocol?: LocalModelApi
  model_name: string
  model_kind: 'chat' | 'multimodal'
  base_url: string
  hasApiKey: boolean
  temperature?: number
  max_tokens?: number | null
  context_window?: number | null
  timeout?: number
  max_retries?: number
  extra_body?: Record<string, unknown> | null
  thinking_level_map?: ThinkingLevelMap
  supports_thinking?: boolean
  thinking_default?: string
  thinking_profiles?: Record<string, unknown> | null
  compat?: Record<string, unknown> | null
  updatedAt: string
}

export interface LocalModelTestResult {
  ok: boolean
  error?: string
  latencyMs?: number
}

export interface McpCredentials {
  id: number
  name: string
  description?: string
  transport: 'stdio' | 'streamable_http' | 'sse' | string
  command?: string | null
  args?: string[] | null
  env?: Record<string, string> | null
  url?: string | null
  headers?: Record<string, string> | null
  timeout_seconds?: number
  call_timeout_seconds?: number
  max_calls_per_run?: number
}

export interface ResourceMeta {
  id: number
  name: string
  description?: string
  desktop_allowed?: boolean
  enabled?: boolean
  filename?: string
  size?: number
  sha256?: string | null
  transport?: string
}
