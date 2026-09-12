import type { ModelCredentials, ModelOption } from './models'

/** restoring：本地存有账号、正在走续期请求换回登录态，既不算已登录也不算未登录 */
export type AuthState = 'restoring' | 'signed_out' | 'authenticating' | 'ready' | 'locked' | 'revoked'

export interface UserProfile {
  id: string
  username: string
  display_name?: string | null
}

export interface CaptchaData {
  captcha_id: string
  image: string
  expires_in: number
}

export interface AuthSnapshot {
  state: AuthState
  user: UserProfile | null
  backendUrl: string | null
}

export interface BootstrapData {
  user: UserProfile
  models: ModelOption[]
  /** 登录时一次性下发的模型直连凭证，仅主进程可见，不进入渲染进程。 */
  model_credentials?: ModelCredentials[]
  default_model_id?: number | null
  default_thinking_level?: string | null
  schema_version: string
  capabilities?: string[]
}
