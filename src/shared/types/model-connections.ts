import type { LocalModelApi, LocalModelSummary, LocalModelTestResult } from './models'

export type ModelConnectionAuthMode = 'api-key' | 'oauth'
export interface DiscoveredConnectionModel {
  id?: number
  modelId: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  reasoning?: boolean
}
export interface ModelProviderPreset {
  id: string
  name: string
  baseUrl: string
  protocol: LocalModelApi
  authModes: ModelConnectionAuthMode[]
  oauthProviderId?: string
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
export interface ModelConnectionsApi {
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
