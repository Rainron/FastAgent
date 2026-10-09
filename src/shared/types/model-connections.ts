import type { LocalModelApi, LocalModelSummary, LocalModelTestResult } from './models'
import type { ThinkingLevelMap } from './common'
import type { BundleSecretMode } from './bundle'

export type ModelConnectionAuthMode = 'api-key' | 'oauth'
export interface DiscoveredConnectionModel {
  id?: number
  modelId: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  reasoning?: boolean
  /** 模型是否接受图片输入；缺省时按纯文本处理，图片会被运行时替换成占位文本。 */
  vision?: boolean
  thinkingLevelMap?: ThinkingLevelMap
  thinkingDefault?: string
  thinkingProfiles?: Record<string, unknown> | null
  temperature?: number
  /** 单位秒；运行时映射为 pi 的 provider 超时（毫秒）。 */
  timeout?: number
  maxRetries?: number
  extraBody?: Record<string, unknown> | null
  /** 厂商兼容配置（thinkingFormat / maxTokensField 等），直接透传给 pi 模型定义。 */
  compat?: Record<string, unknown> | null
}
export interface ModelProviderPreset {
  id: string
  name: string
  baseUrl: string
  protocol: LocalModelApi
  authModes: ModelConnectionAuthMode[]
  oauthProviderId?: string
  /** 账号登录入口的产品边界说明，例如 Kimi Code 套餐不是通用 Moonshot API。 */
  description?: string
  models: DiscoveredConnectionModel[]
}
export interface ModelConnectionDraft {
  id?: string
  providerId: string
  name?: string
  authMode: ModelConnectionAuthMode
  baseUrl?: string
  apiKey?: string
  headers?: Record<string, string>
  protocol?: LocalModelApi
}
export interface ModelConnectionInput extends ModelConnectionDraft {
  models: DiscoveredConnectionModel[]
}
export interface ModelConnectionSummary {
  id: string
  providerId: string
  name: string
  authMode: ModelConnectionAuthMode
  baseUrl: string
  protocol: LocalModelApi
  hasCredentials: boolean
  status: 'ready' | 'unauthenticated' | 'error'
  models: LocalModelSummary[]
  updatedAt: string
}
export interface ModelLoginState {
  sessionId: string
  connectionId: string
  status: 'pending' | 'input-required' | 'success' | 'error' | 'cancelled' | 'expired'
  url?: string
  userCode?: string
  message?: string
  prompt?: { message: string; placeholder?: string; allowEmpty?: boolean; options?: { id: string; label: string }[] }
  error?: string
}
/** 归档里的一条连接。不带本机主键：模型 id 与连接 id 都是本机的，跨机器没有意义。 */
export interface ModelConnectionArchiveEntry {
  providerId: string
  name: string
  authMode: ModelConnectionAuthMode
  baseUrl: string
  protocol: LocalModelApi
  models: DiscoveredConnectionModel[]
  /** 归档里是否带了这条连接的密钥；账号连接恒为 false。 */
  hasSecrets: boolean
}
export interface ModelConnectionArchiveSecret {
  apiKey?: string
  headers?: Record<string, string>
}
/** 口令加密信封，与能力整包同一套算法与字段名。 */
export interface ModelConnectionArchiveCipher {
  algorithm: 'aes-256-gcm'
  kdf: 'scrypt'
  salt: string
  iv: string
  tag: string
  data: string
}
export interface ModelConnectionsArchive {
  format: 'fastagent-model-connections'
  version: 1
  exportedAt: string
  appVersion?: string
  secrets: BundleSecretMode
  connections: ModelConnectionArchiveEntry[]
  /** plain 档是「连接下标 -> 密钥」，encrypted 档是同结构 JSON 加密后的信封；omit 档不出现。 */
  credentials?: Record<string, ModelConnectionArchiveSecret> | ModelConnectionArchiveCipher
}
export interface ModelConnectionsExportOptions {
  /** 要导出的连接 id；空数组表示没有勾选，服务端会拒绝。 */
  ids: string[]
  /** 连接 id -> 要导出的模型 id；缺省表示该连接的全部模型。 */
  modelIds?: Record<string, string[]>
  secrets: BundleSecretMode
  passphrase?: string
}
export interface ModelConnectionsImportPlan {
  /** 勾选的连接在归档 connections 数组里的下标。 */
  indexes: number[]
  /** 下标（字符串）-> 要导入的模型 id；缺省表示该连接的全部模型。 */
  modelIds?: Record<string, string[]>
  passphrase?: string
}
export interface ModelConnectionsArchivePreview {
  path: string
  needsPassphrase: boolean
  contents: ModelConnectionsArchive | null
}
/** 主进程服务实现的部分；归档相关的几个方法要弹文件对话框，留在 IPC 层。 */
export interface ModelConnectionsCoreApi {
  providers(): Promise<ModelProviderPreset[]>
  list(): Promise<ModelConnectionSummary[]>
  save(input: ModelConnectionInput): Promise<ModelConnectionSummary>
  remove(id: string): Promise<void>
  models(input: ModelConnectionDraft): Promise<DiscoveredConnectionModel[]>
  test(input: ModelConnectionDraft & { modelId: string }): Promise<LocalModelTestResult>
  startLogin(providerId: string, connectionId?: string): Promise<ModelLoginState>
  authState(sessionId: string): Promise<ModelLoginState>
  answerLogin(sessionId: string, value: string): Promise<void>
  cancelLogin(sessionId: string): Promise<void>
  logout(id: string): Promise<void>
}
export interface ModelConnectionsApi extends ModelConnectionsCoreApi {
  /** 导出勾选的连接；弹保存对话框，取消时返回 null，否则返回落地路径。 */
  exportConnections(options: ModelConnectionsExportOptions): Promise<string | null>
  /** 选文件并解析；加密档未给口令时先回 needsPassphrase，由界面追问后再调 previewArchivePath。 */
  previewArchive(passphrase?: string): Promise<ModelConnectionsArchivePreview | null>
  previewArchivePath(path: string, passphrase?: string): Promise<ModelConnectionsArchivePreview>
  /** 按勾选落地，返回新建的连接数。 */
  importConnections(path: string, plan: ModelConnectionsImportPlan): Promise<number>
  /** 读出已保存的 API Key 明文供界面回显；账号连接会报错，OAuth 凭据永不返回。 */
  revealApiKey(id: string): Promise<string>
}
