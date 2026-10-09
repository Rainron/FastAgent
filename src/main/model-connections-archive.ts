import type { ModelConnectionArchiveCipher, ModelConnectionArchiveEntry, ModelConnectionArchiveSecret, ModelConnectionsArchive } from '../shared/types'
import { decryptSecret, encryptSecret } from './bundle/secret-box'

/**
 * 模型服务归档（.json）。只做「结构 <-> 文本」的转换，读连接、解密钥、弹文件框都在外层。
 * 账号连接的 OAuth 凭据一律不进归档：刷新令牌泄露的代价远高于重新登录一次。
 */

export const MODEL_ARCHIVE_FORMAT = 'fastagent-model-connections'
export const MODEL_ARCHIVE_VERSION = 1

export interface BuildArchiveInput {
  connections: ModelConnectionArchiveEntry[]
  /** 下标与 connections 对齐；omit 档下调用方不该传。 */
  secretsByIndex?: Record<string, ModelConnectionArchiveSecret>
  secrets: ModelConnectionsArchive['secrets']
  exportedAt?: string
  appVersion?: string
  passphrase?: string
}

function isCipher(value: unknown): value is ModelConnectionArchiveCipher {
  return Boolean(value) && typeof value === 'object' && (value as ModelConnectionArchiveCipher).algorithm === 'aes-256-gcm'
}

export function buildConnectionsArchive(input: BuildArchiveInput): string {
  if (input.secrets === 'encrypted' && !input.passphrase?.trim()) throw new Error('加密导出必须提供口令')
  const carried = input.secrets === 'omit' ? {} : input.secretsByIndex ?? {}
  const hasSecrets = Object.keys(carried).length > 0
  const archive: ModelConnectionsArchive = {
    format: MODEL_ARCHIVE_FORMAT,
    version: MODEL_ARCHIVE_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    appVersion: input.appVersion,
    secrets: input.secrets,
    connections: input.connections.map((connection, index) => ({ ...connection, hasSecrets: Boolean(carried[String(index)]) })),
    ...(hasSecrets
      ? { credentials: input.secrets === 'encrypted' ? encryptSecret(JSON.stringify(carried), input.passphrase as string) : carried }
      : {})
  }
  return JSON.stringify(archive, null, 2)
}

/** 解析。口令只在 secrets 为 encrypted 时需要，缺口令时连接清单照样能预览。 */
export function readConnectionsArchive(text: string, passphrase?: string): ModelConnectionsArchive {
  let parsed: ModelConnectionsArchive
  try {
    parsed = JSON.parse(text) as ModelConnectionsArchive
  } catch {
    throw new Error('文件不是合法 JSON，无法作为模型服务归档读取')
  }
  if (!parsed || parsed.format !== MODEL_ARCHIVE_FORMAT) throw new Error('这不是 FastAgent 模型服务归档')
  if (parsed.version > MODEL_ARCHIVE_VERSION) throw new Error(`归档版本 ${parsed.version} 高于当前应用支持的 ${MODEL_ARCHIVE_VERSION}`)
  if (!Array.isArray(parsed.connections)) throw new Error('归档里缺少连接清单')

  const credentials: Record<string, ModelConnectionArchiveSecret> = (() => {
    const raw = parsed.credentials
    if (!raw || parsed.secrets === 'omit') return {}
    if (!isCipher(raw)) return raw
    if (!passphrase?.trim()) return {}
    return JSON.parse(decryptSecret(raw, passphrase)) as Record<string, ModelConnectionArchiveSecret>
  })()

  return { ...parsed, credentials }
}

/** 预览用：不解密也能看清要不要口令。 */
export function connectionsArchiveNeedsPassphrase(text: string): boolean {
  const parsed = JSON.parse(text) as ModelConnectionsArchive
  return parsed?.secrets === 'encrypted' && isCipher(parsed.credentials)
}

/** 取归档里某条连接的密钥；没带密钥时返回空对象。 */
export function archiveSecretAt(archive: ModelConnectionsArchive, index: number): ModelConnectionArchiveSecret {
  const credentials = archive.credentials
  if (!credentials || isCipher(credentials)) return {}
  return credentials[String(index)] ?? {}
}
