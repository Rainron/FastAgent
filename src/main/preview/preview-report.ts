/** preview_show 离屏检查的采集结果与给模型看的文本报告。纯函数，便于测试条数与截断上限。 */

export const MAX_REPORT_ENTRIES = 20
export const MAX_REPORT_MESSAGE = 300

export interface PreviewConsoleEntry {
  level: 'error' | 'warning'
  message: string
  source?: string
  line?: number
}

export interface PreviewFailedRequest {
  url: string
  /** HTTP 状态；网络层失败（DNS、拒绝连接、被拦）时为 null。 */
  status: number | null
  error?: string
}

export interface PreviewCaptureLog {
  status: 'ok' | 'timeout' | 'failed'
  httpStatus: number | null
  title: string
  /** 主文档加载失败的原因（did-fail-load 的描述）；正常为 null。 */
  loadError: string | null
  console: PreviewConsoleEntry[]
  failedRequests: PreviewFailedRequest[]
}

export function emptyCaptureLog(): PreviewCaptureLog {
  return { status: 'ok', httpStatus: null, title: '', loadError: null, console: [], failedRequests: [] }
}

function clip(text: string, max = MAX_REPORT_MESSAGE): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/**
 * 采集阶段就限量：一个在 rAF 里狂刷报错的页面能在几秒内打出上万条，全攒着既占内存也没有信息量。
 * 同一条消息只记一次，超过上限只计数。
 */
export function pushLimited<T>(list: T[], item: T, key: (value: T) => string, limit = MAX_REPORT_ENTRIES): boolean {
  const id = key(item)
  if (list.some((existing) => key(existing) === id)) return false
  if (list.length >= limit) return false
  list.push(item)
  return true
}

export function consoleCounts(log: PreviewCaptureLog): { errors: number; warnings: number } {
  return {
    errors: log.console.filter((entry) => entry.level === 'error').length,
    warnings: log.console.filter((entry) => entry.level === 'warning').length
  }
}

/** 给模型的报告：先给结论，再列错误、失败请求；截图单独作为图片块附在后面。 */
export function formatPreviewReport(log: PreviewCaptureLog, targetLabel: string, screenshotAttached: boolean): string {
  const lines: string[] = []
  const statusText = log.status === 'ok' ? '加载完成' : log.status === 'timeout' ? '加载超时（已按当前状态检查）' : '加载失败'
  lines.push(`预览：${targetLabel}`)
  lines.push(`状态：${statusText}${log.httpStatus !== null ? ` · HTTP ${log.httpStatus}` : ''}`)
  if (log.title) lines.push(`页面标题：${clip(log.title, 120)}`)
  if (log.loadError) lines.push(`加载错误：${clip(log.loadError)}`)
  const { errors, warnings } = consoleCounts(log)
  lines.push(`控制台：${errors} 个错误，${warnings} 个警告；失败请求 ${log.failedRequests.length} 个`)
  const consoleLines = log.console.map((entry) => {
    const where = entry.source ? ` (${clip(entry.source, 120)}${entry.line ? `:${entry.line}` : ''})` : ''
    return `- [${entry.level}] ${clip(entry.message)}${where}`
  })
  if (consoleLines.length) lines.push('控制台输出：', ...consoleLines)
  const requestLines = log.failedRequests.map((request) => `- ${request.status ?? '网络错误'} ${clip(request.url, 200)}${request.error ? `（${clip(request.error, 120)}）` : ''}`)
  if (requestLines.length) lines.push('失败请求：', ...requestLines)
  if (log.console.length >= MAX_REPORT_ENTRIES || log.failedRequests.length >= MAX_REPORT_ENTRIES) lines.push(`（每类最多列出 ${MAX_REPORT_ENTRIES} 条，重复消息已合并）`)
  lines.push(screenshotAttached ? '截图已附上，请据此核对布局与样式。' : '未能生成截图。')
  if (log.status === 'ok' && errors === 0 && log.failedRequests.length === 0) lines.push('没有发现错误。页面已在用户的预览面板中打开。')
  else lines.push('页面已在用户的预览面板中打开；如有错误请修复后再调用 preview_show 复查。')
  return lines.join('\n')
}
