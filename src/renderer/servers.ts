const RECENT_SERVERS_KEY = 'fastagent.recent-servers'
const RECENT_SERVERS_LIMIT = 5

export type ServerStatus = 'idle' | 'checking' | 'online' | 'offline'

export const serverStatusLabel: Record<ServerStatus, string> = {
  idle: '等待输入地址',
  checking: '正在检测…',
  online: '已连接',
  offline: '无法连接'
}

export function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function upsertRecentServer(list: string[], value: string, limit = RECENT_SERVERS_LIMIT): string[] {
  const url = normalizeServerUrl(value)
  if (!url) return list
  return [url, ...list.filter((item) => item !== url)].slice(0, limit)
}

export function removeRecentServer(list: string[], value: string): string[] {
  const url = normalizeServerUrl(value)
  return list.filter((item) => item !== url)
}

export function readRecentServers(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_SERVERS_KEY) || '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
  } catch {
    return []
  }
}

export function writeRecentServers(list: string[]) {
  window.localStorage.setItem(RECENT_SERVERS_KEY, JSON.stringify(list.slice(0, RECENT_SERVERS_LIMIT)))
}
