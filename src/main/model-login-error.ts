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
  if (exchange) return `令牌交换失败（HTTP ${exchange[1]}）。网页成功仅表示已收到授权码，请检查网络或账号权限后重新登录`
  if (message.startsWith('OpenAI Codex token exchange response missing fields')) return '令牌响应不完整，请重新登录；若仍失败，请检查授权服务'
  if (message === 'Failed to extract accountId from token') return '账号信息解析失败，请确认使用支持 Codex 的 OpenAI 账号后重新登录'
  if (message === 'State mismatch') return '授权回调校验失败，请使用本次登录打开的网页重新授权'
  if (message === 'Missing authorization code') return '未收到授权码，请完成浏览器登录或粘贴完整回调地址'
  if (message === 'fetch failed' || (error instanceof Error && error.name === 'TimeoutError')) return '授权服务网络连接失败，请检查应用的网络和代理。浏览器登录成功不代表应用已完成令牌交换'
  return '账号登录失败，请重试；网页成功仅表示授权码回调完成，不代表令牌交换和本地保存成功'
}
