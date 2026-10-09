/** 预览目标的纯逻辑：路径比对（决定改动后是否自动刷新）与副标题展示。 */

/** 统一成 `a/b` 形式再比较：工具事件里的路径可能带 `./` 或反斜杠。 */
export function normalizePreviewPath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter((segment) => segment !== '' && segment !== '.').join('/')
}

export function isSamePreviewPath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return normalizePreviewPath(a).toLowerCase() === normalizePreviewPath(b).toLowerCase()
}

/**
 * 一个页面引用的样式、脚本、图片改了也要刷新：同目录（或子目录）下的文件变更都算。
 * 样稿目录通常只装这一个页面的资源，按目录判不会误刷别的预览。
 */
export function affectsPreview(previewPath: string | null, changedPath: string | null | undefined): boolean {
  if (!previewPath || !changedPath) return false
  const page = normalizePreviewPath(previewPath).toLowerCase()
  const changed = normalizePreviewPath(changedPath).toLowerCase()
  if (page === changed) return true
  const slash = page.lastIndexOf('/')
  // 页面在工作区根目录时不按目录判：根目录下任何改动都刷新就太频繁了。
  if (slash < 0) return false
  return changed.startsWith(`${page.slice(0, slash)}/`)
}

/** 副标题：文件给相对路径，dev server 给去掉协议的地址。 */
export function previewSubtitle(target: { url: string | null; path: string | null }): string {
  if (target.path) return target.path
  if (!target.url) return ''
  return target.url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

export function isHtmlPath(path: string): boolean {
  return /\.html?$/i.test(path)
}
