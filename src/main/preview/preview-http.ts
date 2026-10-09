/** fa-preview 协议响应用到的纯函数：MIME 映射与 iframe 拦截头的剥离。 */

const MIME_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  wasm: 'application/wasm',
  pdf: 'application/pdf'
}

export function mimeTypeFor(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return MIME_TYPES[extension] ?? 'application/octet-stream'
}

/**
 * 去掉阻止被嵌入的响应头：X-Frame-Options 整条删，CSP 只删 frame-ancestors 指令，其余指令原样保留——
 * 页面自己的脚本/样式约束不该因为被预览就失效。
 * 头名大小写不定（Electron 按服务端原样给），比较时统一小写。
 */
export function stripFrameBlockingHeaders(headers: Record<string, string[]>): Record<string, string[]> {
  const next: Record<string, string[]> = {}
  for (const [name, values] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (lower === 'x-frame-options') continue
    if (lower === 'content-security-policy') {
      const kept = values
        .map((value) => value.split(';').map((directive) => directive.trim()).filter((directive) => directive && !/^frame-ancestors(\s|$)/i.test(directive)).join('; '))
        .filter(Boolean)
      if (kept.length) next[name] = kept
      continue
    }
    next[name] = values
  }
  return next
}
