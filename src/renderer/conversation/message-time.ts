/**
 * 对话里消息时间的展示：今天只给时:分，昨天加「昨天」，今年内给 月-日，跨年补上年份。
 * 只写时:分时隔天回看分不清是哪天的消息；但今天的消息每条都挂日期又是纯噪音。
 */

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function formatMessageTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (sameDay(date, now)) return time
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (sameDay(date, yesterday)) return `昨天 ${time}`
  const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  if (date.getFullYear() === now.getFullYear()) return `${day} ${time}`
  return `${date.getFullYear()}-${day} ${time}`
}

/** 悬停提示给完整时间，精确到秒。 */
export function formatMessageTimeFull(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
