import type { ConversationRecord, ConversationTurn } from '../shared/types'

export type ConversationExportFormat = 'markdown' | 'html'

/** Windows 文件名非法字符统一替换，标题常常含这些字符。 */
export function sanitizeFilename(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim()
  return cleaned.length ? cleaned.slice(0, 60) : 'conversation'
}

/** 固定格式避免 toLocaleString 的平台差异，导出文件内容和测试都要求可复现。 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const STATUS_LABELS: Partial<Record<ConversationTurn['status'], string>> = {
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
  working: '进行中',
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** 附件与产物只登记名字：源文件留在本地数据目录，导出文件要能单独流通。 */
function attachmentNames(turn: ConversationTurn): string[] {
  return turn.attachments.map((item) => item.name).filter(Boolean)
}

function artifactNames(turn: ConversationTurn): string[] {
  return turn.artifacts.map((item) => item.name ?? item.path ?? item.id ?? '').filter(Boolean)
}

function citationLines(turn: ConversationTurn): Array<{ title: string; url: string }> {
  return turn.citations
    .map((item) => ({ title: String(item.title ?? item.url ?? '引用'), url: String(item.url ?? '') }))
    .filter((item) => item.title || item.url)
}

function turnParts(turn: ConversationTurn): Array<{ role: 'user' | 'assistant'; text: string; time: string }> {
  const parts: Array<{ role: 'user' | 'assistant'; text: string; time: string }> = []
  if (turn.userMessage.text || turn.attachments.length) {
    parts.push({ role: 'user', text: turn.userMessage.text, time: formatDateTime(turn.userMessage.createdAt) })
  }
  if (turn.assistantMessage?.text) {
    parts.push({ role: 'assistant', text: turn.assistantMessage.text, time: formatDateTime(turn.assistantMessage.createdAt) })
  }
  return parts
}

export function buildConversationMarkdown(
  conversation: ConversationRecord,
  turns: ConversationTurn[],
  exportedAt: string = new Date().toISOString(),
): string {
  const lines: string[] = [`# ${conversation.title}`, '']
  lines.push(`- 导出时间：${formatDateTime(exportedAt)}`)
  lines.push(`- 会话创建：${formatDateTime(conversation.createdAt)}`)
  lines.push(`- 对话轮数：${turns.length}`)
  lines.push('', '---', '')
  turns.forEach((turn, index) => {
    const number = index + 1
    for (const part of turnParts(turn)) {
      const time = part.time ? ` · ${part.time}` : ''
      lines.push(`## ${number} · ${part.role === 'user' ? '用户' : '助手'}${time}`, '', part.text, '')
      const attachments = attachmentNames(turn)
      if (part.role === 'user' && attachments.length) lines.push(`> 附件：${attachments.join('、')}`, '')
      if (part.role === 'assistant') {
        const artifacts = artifactNames(turn)
        if (artifacts.length) lines.push(`> 产物：${artifacts.join('、')}`, '')
        for (const citation of citationLines(turn)) {
          lines.push(citation.url ? `> - [${citation.title}](${citation.url})` : `> - ${citation.title}`)
        }
        if (citationLines(turn).length) lines.push('')
      }
    }
    // 状态属于整轮：中断轮常常没有助手回复，标记不能只挂在助手段下。
    const statusLabel = STATUS_LABELS[turn.status]
    if (statusLabel) lines.push(`（本轮${statusLabel}）`, '')
  })
  return `${lines.join('\n').trimEnd()}\n`
}

export function buildConversationHtml(
  conversation: ConversationRecord,
  turns: ConversationTurn[],
  exportedAt: string = new Date().toISOString(),
): string {
  const blocks: string[] = []
  turns.forEach((turn, index) => {
    const number = index + 1
    for (const part of turnParts(turn)) {
      const time = part.time ? `<span class="time">${escapeHtml(part.time)}</span>` : ''
      const extras: string[] = []
      if (part.role === 'user') {
        const attachments = attachmentNames(turn)
        if (attachments.length) extras.push(`<div class="meta">附件：${escapeHtml(attachments.join('、'))}</div>`)
      } else {
        const artifacts = artifactNames(turn)
        if (artifacts.length) extras.push(`<div class="meta">产物：${escapeHtml(artifacts.join('、'))}</div>`)
        const citations = citationLines(turn)
        if (citations.length) {
          const items = citations.map((item) => `<li>${item.url ? `<a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a>` : escapeHtml(item.title)}</li>`).join('')
          extras.push(`<ul class="citations">${items}</ul>`)
        }
      }
      blocks.push(`<section class="turn ${part.role}"><h2>${number} · ${part.role === 'user' ? '用户' : '助手'}${time}</h2><div class="content">${escapeHtml(part.text)}</div>${extras.join('')}</section>`)
    }
    // 状态与 Markdown 版一致挂在轮级，中断轮常常没有助手段。
    const statusLabel = STATUS_LABELS[turn.status]
    if (statusLabel) blocks.push(`<div class="status turn-status">（本轮${statusLabel}）</div>`)
  })
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(conversation.title)}</title>
<style>
:root { color-scheme: light dark; }
body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; line-height: 1.7; max-width: 48rem; margin: 2rem auto; padding: 0 1.25rem; }
h1 { font-size: 1.5rem; }
.summary { color: gray; font-size: 0.875rem; margin-bottom: 2rem; }
.turn { border-top: 1px solid color-mix(in srgb, currentColor 15%, transparent); padding: 1.25rem 0; }
.turn h2 { font-size: 0.9375rem; color: gray; font-weight: 600; margin: 0 0 0.75rem; }
.turn .time { margin-left: 0.5rem; font-weight: 400; }
.content { white-space: pre-wrap; word-break: break-word; }
.meta, .status { color: gray; font-size: 0.875rem; margin-top: 0.5rem; }
.citations { color: gray; font-size: 0.875rem; margin-top: 0.5rem; padding-left: 1.25rem; }
</style>
</head>
<body>
<h1>${escapeHtml(conversation.title)}</h1>
<p class="summary">导出时间：${escapeHtml(formatDateTime(exportedAt))} · 会话创建：${escapeHtml(formatDateTime(conversation.createdAt))} · 对话轮数：${turns.length}</p>
${blocks.join('\n')}
</body>
</html>
`
}

/** 从保存路径推断格式：对话框选了哪种过滤器，扩展名就是哪种。 */
export function exportFormatFromPath(path: string): ConversationExportFormat {
  return path.toLowerCase().endsWith('.html') ? 'html' : 'markdown'
}
