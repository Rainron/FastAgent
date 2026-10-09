import type { PreviewToolDetails } from '../../shared/types'

/**
 * 从落库的工具结果里取出预览摘要。结果是 JSON 列，旧数据、截断或手改过的记录都可能缺字段，
 * 这里逐项校验，形状不对就当没有，卡片退回只显示摘要行。
 */
export function readPreviewDetails(result: unknown): PreviewToolDetails | null {
  if (!result || typeof result !== 'object') return null
  const preview = (result as { preview?: unknown }).preview
  if (!preview || typeof preview !== 'object') return null
  const item = preview as Partial<PreviewToolDetails>
  const target = item.target
  if (!target || typeof target.url !== 'string' || !target.url) return null
  const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0)
  return {
    target: { url: target.url, title: typeof target.title === 'string' ? target.title : '', path: typeof target.path === 'string' ? target.path : null },
    status: item.status === 'timeout' || item.status === 'failed' ? item.status : 'ok',
    httpStatus: typeof item.httpStatus === 'number' ? item.httpStatus : null,
    errorCount: count(item.errorCount),
    warningCount: count(item.warningCount),
    failedRequestCount: count(item.failedRequestCount),
    screenshotPath: typeof item.screenshotPath === 'string' ? item.screenshotPath : null
  }
}

export interface PreviewBadge {
  tone: 'ok' | 'warn' | 'error'
  label: string
}

/** 卡片角标：没问题只给一个「正常」，有问题逐类列出。 */
export function previewBadges(details: PreviewToolDetails): PreviewBadge[] {
  const badges: PreviewBadge[] = []
  if (details.status === 'failed') badges.push({ tone: 'error', label: details.httpStatus && details.httpStatus >= 400 ? `加载失败 · HTTP ${details.httpStatus}` : '加载失败' })
  if (details.status === 'timeout') badges.push({ tone: 'warn', label: '加载超时' })
  if (details.errorCount) badges.push({ tone: 'error', label: `${details.errorCount} 个错误` })
  if (details.failedRequestCount) badges.push({ tone: 'error', label: `${details.failedRequestCount} 个请求失败` })
  if (details.warningCount) badges.push({ tone: 'warn', label: `${details.warningCount} 个警告` })
  if (!badges.length) badges.push({ tone: 'ok', label: '渲染正常' })
  return badges
}
