import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

/**
 * 预览地址规则：工作区文件走自定义协议 fa-preview://，dev server 只认本机回环地址。
 * 纯字符串逻辑，不碰文件系统与 Electron，路径是否真实存在由 preview-files 再查。
 */

export const PREVIEW_SCHEME = 'fa-preview'

/** 右栏默认渲染而不是显示源码的文件类型。 */
export const PREVIEWABLE_PATH_RE = /\.(html?|svg)$/i

export function isPreviewablePath(path: string): boolean {
  return PREVIEWABLE_PATH_RE.test(path)
}

/**
 * 工作区根目录 → 协议里的主机名。
 * 用哈希而不是把路径塞进 URL：盘符、空格、中文都不是合法主机名，且不同根要落在不同源上，
 * 两个项目的预览页互相读不到对方的 localStorage。Windows 路径大小写不敏感，先统一再算。
 */
export function rootToken(root: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = resolve(root)
  const key = platform === 'win32' ? normalized.toLowerCase() : normalized
  return `w-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`
}

/** 相对路径逐段编码，保证 `#`、`?`、空格、中文都原样回到文件名。 */
export function buildPreviewFileUrl(token: string, relativePath: string): string {
  const segments = relativePath.replace(/\\/g, '/').split('/').filter((segment) => segment !== '' && segment !== '.')
  return `${PREVIEW_SCHEME}://${token}/${segments.map(encodeURIComponent).join('/')}`
}

/**
 * 解析 fa-preview:// 地址。解码后的段里出现 `..`、分隔符或 NUL 一律判无效——
 * URL 解析器会先折叠字面 `..`，但 `%2e%2e%2f` 这类编码形式要在这里挡。
 */
export function parsePreviewFileUrl(raw: string): { token: string; relativePath: string } | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== `${PREVIEW_SCHEME}:` || !/^w-[0-9a-f]{16}$/.test(url.hostname)) return null
  const segments: string[] = []
  for (const part of url.pathname.split('/')) {
    if (!part) continue
    let decoded: string
    try {
      decoded = decodeURIComponent(part)
    } catch {
      return null
    }
    if (decoded === '..' || decoded === '.' || /[\\/\0]/.test(decoded)) return null
    segments.push(decoded)
  }
  return { token: url.hostname, relativePath: segments.join('/') }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function effectivePort(url: URL): string {
  return url.port || (url.protocol === 'https:' ? '443' : '80')
}

/**
 * dev server 地址校验：只放行本机回环。
 * 0.0.0.0 是很多 dev server 打印的监听地址，浏览器不一定能直接访问，改写成 127.0.0.1。
 * blockedOrigins 是应用自己的界面源（开发态的 Vite），同端口的回环地址一律拒绝：
 * 那是 FastAgent 本身，放进 iframe 既无意义，同源时还会让页面够到父窗口。
 */
export function checkLocalPreviewUrl(raw: string, blockedOrigins: readonly string[] = []): { ok: true; url: string } | { ok: false; error: string } {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, error: '预览地址无效' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: '预览地址只支持 http/https' }
  if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1'
  if (!LOOPBACK_HOSTS.has(url.hostname)) return { ok: false, error: '只能预览本机地址（localhost / 127.0.0.1 / [::1]）' }
  if (url.username || url.password) return { ok: false, error: '预览地址不能带账号密码' }
  for (const origin of blockedOrigins) {
    let blocked: URL
    try {
      blocked = new URL(origin)
    } catch {
      continue
    }
    if (!LOOPBACK_HOSTS.has(blocked.hostname === '0.0.0.0' ? '127.0.0.1' : blocked.hostname)) continue
    if (effectivePort(blocked) === effectivePort(url)) return { ok: false, error: '这是 FastAgent 自身的界面地址，不能预览' }
  }
  return { ok: true, url: url.toString() }
}

/** 用于响应头改写与权限判定：是不是本机回环上的页面。 */
export function isLoopbackHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}
