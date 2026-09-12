import { createHash } from 'node:crypto'
import { join } from 'node:path'

/** 目录名要能直接落到 Windows/NTFS 上，非白名单字符一律折成连字符。 */
export function sanitizeSegment(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.\-]+|[.\-]+$/g, '')
  return cleaned || fallback
}

/** namespace 形如 `${backendUrl}::${userId}`，同一后端下 userId 唯一。 */
export function userIdFromNamespace(namespace: string): string {
  const index = namespace.lastIndexOf('::')
  return index < 0 ? namespace : namespace.slice(index + 2)
}

/** username 只有登录/续期成功后才落库，旧库与未登录场景回落 userId，保证路径始终能算出来。 */
export function sessionUserSegment(namespace: string, username: string | null | undefined): string {
  const raw = username?.trim() || userIdFromNamespace(namespace)
  return sanitizeSegment(raw, 'unknown-user')
}

/** 按本地时区分桶：用户在界面上看到的会话日期就是本地日期。 */
export function sessionDateSegment(createdAt: string | null | undefined): string {
  const date = createdAt ? new Date(createdAt) : null
  if (!date || Number.isNaN(date.getTime())) return 'unknown-date'
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function conversationSessionDir(sessionsDir: string, input: { userSegment: string; createdAt: string | null | undefined; conversationId: string }): string {
  return join(sessionsDir, input.userSegment, sessionDateSegment(input.createdAt), sanitizeSegment(input.conversationId, 'unknown-conversation'))
}

/** 旧布局：一层哈希目录。只留给迁移定位旧文件，新会话不再写入。 */
export function legacyConversationSessionDir(sessionsDir: string, namespace: string, conversationId: string): string {
  return join(sessionsDir, createHash('sha256').update(`${namespace}\t${conversationId}`).digest('hex'))
}
