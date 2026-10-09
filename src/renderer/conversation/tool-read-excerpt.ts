/**
 * 读取预览的节选：只取前 N 行，剩余行数交给界面说明。
 * 不做「中间省略」——读文件看的是开头的定义与导入，尾部截断更符合阅读顺序。
 */
export function excerptLines(text: string, limit: number): { body: string; remaining: number } {
  if (limit <= 0) return { body: '', remaining: text ? text.split('\n').length : 0 }
  const lines = text.split('\n')
  if (lines.length <= limit) return { body: text, remaining: 0 }
  return { body: lines.slice(0, limit).join('\n'), remaining: lines.length - limit }
}

/** 预览读不出来时给用户看的说明；主进程的越界报错翻成「为什么」，其余保留原文。 */
export function previewUnavailable(cause: unknown): string {
  const message = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : ''
  if (message.includes('只能打开工作区内的文件')) return '文件不在当前工作区内，无法预览'
  if (message.includes('尚未打开工作区')) return '没有打开工作区，无法预览'
  return message ? `无法预览：${message}` : '无法预览这个文件'
}
