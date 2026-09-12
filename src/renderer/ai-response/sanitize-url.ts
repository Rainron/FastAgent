const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

/** 只有 http/https 允许交给主进程 shell.openExternal；javascript:/file:/data: 一律拒绝。 */
export function isExternalHttpUrl(value: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(value).protocol)
  } catch {
    return false
  }
}

/**
 * 决定 Markdown 链接能不能渲染成可点的 <a>。
 * 返回 null 表示这个 href 不安全，调用方应退化为纯文本。
 */
export function sanitizeLinkHref(href: string | undefined | null): string | null {
  if (!href) return null
  const trimmed = href.trim()
  if (!trimmed) return null
  // 站内锚点没有协议，不经过 shell，安全。
  if (trimmed.startsWith('#')) return trimmed
  return isExternalHttpUrl(trimmed) ? trimmed : null
}
