/**
 * 导入时的连接命名：同名一律另存为副本，绝不覆盖本地已有连接——
 * 连接名背后是密钥，覆盖等于悄悄换掉用户正在用的凭据。
 */
export function uniqueConnectionName(name: string, taken: Set<string>): string {
  const base = name.trim() || '模型服务'
  if (!taken.has(base)) return base
  for (let index = 2; ; index += 1) {
    const candidate = `${base} (${index})`
    if (!taken.has(candidate)) return candidate
  }
}
