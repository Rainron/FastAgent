/** 上游错误里可能被原样回显的凭据字段：写日志前整段抹掉。 */
const CREDENTIAL_FIELDS = /("(?:access_token|refresh_token|id_token|client_secret|code|code_verifier)"\s*:\s*")[^"]*(")/g
const LOG_DETAIL_MAX = 300

/**
 * 给日志用的上游原文：界面上只给分类文案，排查却需要真实响应。
 * 这里只抹凭据字段并截断，保留状态码与错误体，足以区分「被网络防护拦截」和「授权服务拒绝」。
 */
export function modelLoginErrorDetail(error: unknown): { message: string; status?: number } {
  const raw = error instanceof Error ? error.message : String(error)
  const redacted = raw.replace(CREDENTIAL_FIELDS, '$1***$2')
  const status = /\((\d{3})\)|with status (\d{3})/.exec(redacted)
  const code = status?.[1] ?? status?.[2]
  return {
    message: redacted.length > LOG_DETAIL_MAX ? `${redacted.slice(0, LOG_DETAIL_MAX)}…` : redacted,
    ...(code ? { status: Number(code) } : {})
  }
}

export function modelLoginError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  // 上游异常可能包含令牌和完整响应，只返回受控分类，不直接展示原文。
  if (message.startsWith('Credential store modify failed')) return '账号凭据保存失败，请检查本地存储后重新登录'
  if (message.startsWith('Kimi Code device authorization failed with status')) {
    const status = /^Kimi Code device authorization failed with status (\d{3})/.exec(message)?.[1]
    return `Kimi Code 设备授权请求失败（HTTP ${status ?? '—'}），请检查应用的网络和代理后重试`
  }
  if (message.startsWith('Invalid Kimi Code device authorization response')) return 'Kimi Code 授权服务响应异常，请重新登录'
  if (message.includes('Kimi Code device authorization expired')) return 'Kimi Code 设备验证码已过期，请重新登录'
  if (message.includes('Kimi Code login was denied')) return 'Kimi Code 授权被拒绝，如需使用请重新登录并确认授权'
  if (message.startsWith('Kimi Code token refresh unauthorized')) return 'Kimi Code 授权已失效，请重新登录'
  if (message.startsWith('Kimi Code device token request failed')) return 'Kimi Code 登录失败，请稍后重新发起授权'
  if (message.startsWith('Kimi Code token refresh failed')) return 'Kimi Code 令牌刷新失败，请稍后重试或重新登录'
  const exchange = /^OpenAI Codex token exchange failed \((\d{3})\)/.exec(message)
  // 403 几乎都是出网被拦，而不是账号问题：浏览器那一步走系统代理成功拿到授权码，
  // 应用这一步直连上游被挡。提示指向代理而不是「账号权限」，否则用户会去反复重登。
  if (exchange) return exchange[1] === '403'
    ? '令牌交换失败（HTTP 403）。网页成功仅表示已收到授权码，应用侧的请求被授权服务拒绝：请确认应用走的是与浏览器相同的代理（系统代理或 HTTPS_PROXY），再重新登录'
    : `令牌交换失败（HTTP ${exchange[1]}）。网页成功仅表示已收到授权码，请检查网络或账号权限后重新登录`
  if (message.startsWith('OpenAI Codex token exchange response missing fields')) return '令牌响应不完整，请重新登录；若仍失败，请检查授权服务'
  if (message === 'Failed to extract accountId from token') return '账号信息解析失败，请确认使用支持 Codex 的 OpenAI 账号后重新登录'
  if (message === 'State mismatch') return '授权回调校验失败，请使用本次登录打开的网页重新授权'
  if (message === 'Missing authorization code') return '未收到授权码，请完成浏览器登录或粘贴完整回调地址'
  if (message === 'fetch failed' || (error instanceof Error && error.name === 'TimeoutError')) return '授权服务网络连接失败，请检查应用的网络和代理。浏览器登录成功不代表应用已完成令牌交换'
  return '账号登录失败，请重试；网页成功仅表示授权码回调完成，不代表令牌交换和本地保存成功'
}
