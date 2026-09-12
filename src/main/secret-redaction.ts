/**
 * 错误消息跨 IPC 前的脱敏：把已知密钥值整段替换掉。
 * MCP Server 常把 token 原样回显在错误里，直接透传就等于把密钥送进渲染进程。
 */
export function redactSecrets(text: string | null | undefined, secrets: Iterable<string>): string | null {
  if (!text) return text ?? null
  let result = text
  // 先替换长值，避免短值是长值子串时留下残片。
  const values = [...secrets].map((value) => value.trim()).filter((value) => value.length >= 4).sort((a, b) => b.length - a.length)
  for (const value of values) {
    result = result.split(value).join('***')
  }
  return result
}

export function secretValuesOf(config: { env?: Record<string, string>; headers?: Record<string, string> } | null | undefined): string[] {
  if (!config) return []
  return [...Object.values(config.env ?? {}), ...Object.values(config.headers ?? {})]
}
