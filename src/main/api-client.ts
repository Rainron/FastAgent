import type { BootstrapData, CaptchaData, ModelOption, UserProfile } from '../shared/types'

interface ApiEnvelope<T> {
  data: T
  message?: string
  code?: number | string
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

/** 后端调用失败的上报入参；刻意不含请求体与响应体——登录接口的 body 里有密码。 */
export interface ApiErrorReport {
  method: string
  path: string
  status?: number
  message: string
  durationMs: number
}

export class ApiClient {
  private unauthorizedHandler: (() => Promise<string>) | null = null
  private refreshPromise: Promise<string> | null = null
  private errorReporter: ((report: ApiErrorReport) => void) | null = null

  constructor(private readonly baseUrl: string, private accessToken: string | null = null, private readonly timeoutMs = 30_000) {}

  setErrorReporter(reporter: ((report: ApiErrorReport) => void) | null) {
    this.errorReporter = reporter
  }

  private report(report: ApiErrorReport) {
    // 上报本身出错绝不能把原始请求错误盖掉。
    try {
      this.errorReporter?.(report)
    } catch {
      /* 忽略 */
    }
  }

  setAccessToken(token: string | null) {
    this.accessToken = token
  }

  setUnauthorizedHandler(handler: (() => Promise<string>) | null) {
    this.unauthorizedHandler = handler
  }

  private url(path: string) {
    return `${this.baseUrl.replace(/\/$/, '')}${path}`
  }

  private async renewAccessToken() {
    if (!this.unauthorizedHandler) throw new ApiError(401, '登录状态已失效')
    if (!this.refreshPromise) {
      this.refreshPromise = this.unauthorizedHandler()
        .then((token) => {
          this.accessToken = token
          return token
        })
        .finally(() => { this.refreshPromise = null })
    }
    return this.refreshPromise
  }

  async request<T>(path: string, init: RequestInit = {}, allowRefresh = true): Promise<T> {
    const requestToken = this.accessToken
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (requestToken) headers.set('Authorization', `Bearer ${requestToken}`)
    if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
    const signals = [AbortSignal.timeout(this.timeoutMs)]
    if (init.signal) signals.push(init.signal)
    const method = (init.method ?? 'GET').toUpperCase()
    const startedAt = Date.now()
    let response: Response
    try {
      response = await fetch(this.url(path), { ...init, headers, signal: AbortSignal.any(signals) })
    } catch (error) {
      // 连不上 / 超时也是接口问题，且这类最难事后复现，必须留痕。
      this.report({ method, path, message: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt })
      throw error
    }
    const body = await response.text()
    let parsed: ApiEnvelope<T> | null = null
    try {
      parsed = body ? (JSON.parse(body) as ApiEnvelope<T>) : null
    } catch {
      parsed = null
    }
    if (response.status === 401 && allowRefresh && this.unauthorizedHandler) {
      if (this.accessToken === requestToken) await this.renewAccessToken()
      return this.request<T>(path, init, false)
    }
    if (!response.ok) {
      const message = parsed?.message || `请求失败 (${response.status})`
      this.report({ method, path, status: response.status, message, durationMs: Date.now() - startedAt })
      throw new ApiError(response.status, message)
    }
    return (parsed?.data ?? parsed) as T
  }

  captcha() {
    return this.request<CaptchaData>('/api/v1/auth/captcha', {}, false)
  }

  async login(input: { username: string; password: string; captchaId: string; captchaAngle: number; remember: boolean; deviceLabel: string }) {
    return this.request<{ user: UserProfile; access_token: string; refresh_token: string; access_expires_in: number }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: input.username,
        password: input.password,
        captcha_id: input.captchaId,
        captcha_angle: input.captchaAngle,
        remember: input.remember,
        with_refresh: true,
        device_label: input.deviceLabel
      })
    }, false)
  }

  async refresh(refreshToken: string) {
    return this.request<{ access_token: string; refresh_token: string; access_expires_in: number }>('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken })
    }, false)
  }

  me() {
    return this.request<UserProfile>('/api/v1/auth/me')
  }

  async bootstrap(): Promise<BootstrapData> {
    try {
      return await this.request<BootstrapData>('/api/v1/desktop/bootstrap')
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error
      const models = await this.request<{ models: ModelOption[]; default_model_id?: number | null; default_thinking_level?: string | null }>('/api/v1/chat/available-models')
      return {
        user: await this.me(),
        models: models.models,
        default_model_id: models.default_model_id,
        default_thinking_level: models.default_thinking_level,
        schema_version: 'legacy-models-only',
        capabilities: ['local-agent']
      }
    }
  }

  logout(refreshToken: string | null) {
    return this.request<{ ok: boolean }>('/api/v1/auth/logout', {
      method: 'POST',
      body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {})
    }, false)
  }
}
