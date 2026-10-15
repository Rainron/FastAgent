import type { NetworkProxySettings } from './types'

export const defaultNetworkProxySettings: NetworkProxySettings = { mode: 'auto', proxyUrl: '' }

export function validateNetworkProxySettings(value: unknown): NetworkProxySettings {
  const input = value as Partial<NetworkProxySettings> | null
  if (!input || !['auto', 'manual', 'direct'].includes(input.mode ?? '')) throw new Error('请选择有效的代理模式')
  if (input.mode !== 'manual') return { mode: input.mode!, proxyUrl: '' }
  let url: URL
  try { url = new URL(typeof input.proxyUrl === 'string' ? input.proxyUrl.trim() : '') } catch { throw new Error('请输入完整的 HTTP 或 HTTPS 代理地址') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP / HTTPS 代理，请使用代理软件的 HTTP 端口')
  if (url.username || url.password) throw new Error('暂不支持带认证信息的代理地址')
  if (!url.hostname || url.pathname !== '/' || url.search || url.hash) throw new Error('代理地址只应包含协议、主机和端口')
  return { mode: 'manual', proxyUrl: url.toString() }
}

export function normalizeNetworkProxySettings(value: unknown): NetworkProxySettings {
  try { return validateNetworkProxySettings(value) } catch { return { ...defaultNetworkProxySettings } }
}
