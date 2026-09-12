const INVOKE_PREFIX = /^Error invoking remote method '[^']*':\s*/
const ERROR_CLASS_PREFIX = /^(?:[A-Za-z]+)?Error:\s*/
const SUGGESTION_LINE = /^(.+?)\n\n你是不是要找：(.+)$/

export interface IpcErrorPayload {
  message: string
  suggestions: string[]
}

/**
 * Electron 会把主进程抛出的错误包成
 * `Error invoking remote method 'workspace:read-file': Error: 文件不存在：main.py`，
 * 直接显示会把 IPC 通道名和一串英文糊到用户脸上，这里只留主进程写的那句话。
 */
export function cleanIpcError(cause: unknown, fallback: string): string {
  const raw = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''
  const message = raw.replace(INVOKE_PREFIX, '').replace(ERROR_CLASS_PREFIX, '').trim()
  return message || fallback
}

/**
 * 跟 cleanIpcError 一样剥掉 IPC 包装，但同时把「你是不是要找：a/b、c/d」形式的候选项拆出来。
 * 没匹配到候选时 suggestions 为空数组。
 */
export function parseIpcError(cause: unknown, fallback: string): IpcErrorPayload {
  const cleaned = cleanIpcError(cause, fallback)
  const match = SUGGESTION_LINE.exec(cleaned)
  if (!match) return { message: cleaned, suggestions: [] }
  return { message: match[1], suggestions: match[2].split('、').map((item) => item.trim()).filter(Boolean) }
}
