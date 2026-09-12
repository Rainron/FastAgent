import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { unzipSync, zipSync } from 'fflate'
import type { BundleCli, BundleContents, BundleEntryMeta, BundleMcp, BundleSecretMode, BundleSkill, LocalMcpServerInput } from '../../shared/types'
import { assertSafeSkillPath } from '../skill-registry'

export type { BundleCli, BundleContents, BundleEntryMeta, BundleMcp, BundleSecretMode, BundleSkill }

/**
 * 能力整包（.fabundle）。就是一个 ZIP：manifest + skills 目录 + mcp/cli 配置。
 * 这里只做「结构 <-> 字节」的转换，读磁盘与弹文件框在 bundle-service 里。
 */

export const BUNDLE_FORMAT = 'fastagent-ability-bundle'
export const BUNDLE_VERSION = 1

interface BundleManifest {
  format: string
  version: number
  exportedAt: string
  appVersion?: string
  secrets: BundleSecretMode
  skills: Array<{ name: string; enabled: boolean; meta?: BundleEntryMeta }>
  mcpServers: Array<{ server: Omit<LocalMcpServerInput, 'env' | 'headers'>; disabledTools: string[]; meta?: BundleEntryMeta }>
  cliTools: BundleCli[]
}

interface EncryptedBlob {
  algorithm: 'aes-256-gcm'
  kdf: 'scrypt'
  salt: string
  iv: string
  tag: string
  data: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf8')

function encrypt(plaintext: string, passphrase: string): EncryptedBlob {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(passphrase, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  }
}

function decrypt(blob: EncryptedBlob, passphrase: string): string {
  const decipher = createDecipheriv('aes-256-gcm', scryptSync(passphrase, Buffer.from(blob.salt, 'base64'), 32), Buffer.from(blob.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'))
  try {
    return Buffer.concat([decipher.update(Buffer.from(blob.data, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    // GCM 校验失败只可能是口令错或包被改过，两者都不该继续解析。
    throw new Error('口令不正确，或整包已被篡改')
  }
}

type ServerSecrets = Record<string, { env?: Record<string, string>; headers?: Record<string, string> }>

function secretsOf(servers: BundleMcp[]): ServerSecrets {
  const secrets: ServerSecrets = {}
  for (const item of servers) {
    const env = item.server.env
    const headers = item.server.headers
    if (Object.keys(env ?? {}).length || Object.keys(headers ?? {}).length) secrets[item.server.id] = { env, headers }
  }
  return secrets
}

export interface BuildBundleInput extends Omit<BundleContents, 'exportedAt'> {
  exportedAt?: string
  passphrase?: string
}

/** 导出。secrets 为 omit 时，产物里不会出现任何密钥值——这是默认档。 */
export function buildBundle(input: BuildBundleInput): Uint8Array {
  if (input.secrets === 'encrypted' && !input.passphrase?.trim()) throw new Error('加密导出必须提供口令')
  const files: Record<string, Uint8Array> = {}

  for (const skill of input.skills) {
    for (const [path, text] of Object.entries(skill.files)) {
      files[`skills/${skill.name}/${assertSafeSkillPath(path)}`] = encoder.encode(text)
    }
  }

  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    appVersion: input.appVersion,
    secrets: input.secrets,
    skills: input.skills.map(({ name, enabled, meta }) => ({ name, enabled, meta })),
    mcpServers: input.mcpServers.map(({ server, disabledTools, meta }) => {
      const { env: _env, headers: _headers, ...rest } = server
      return { server: rest, disabledTools, meta }
    }),
    cliTools: input.cliTools
  }
  files['manifest.json'] = encoder.encode(JSON.stringify(manifest, null, 2))

  if (input.secrets !== 'omit') {
    const secrets = secretsOf(input.mcpServers)
    if (Object.keys(secrets).length) {
      const serialized = JSON.stringify(secrets)
      files['mcp/secrets.json'] = encoder.encode(
        input.secrets === 'encrypted' ? JSON.stringify(encrypt(serialized, input.passphrase as string)) : serialized
      )
    }
  }
  return zipSync(files)
}

function parseJson<T>(bytes: Uint8Array | undefined, what: string): T {
  if (!bytes) throw new Error(`整包缺少 ${what}`)
  try {
    return JSON.parse(decoder.decode(bytes)) as T
  } catch {
    throw new Error(`整包里的 ${what} 不是合法 JSON`)
  }
}

/** 导入解析。口令只在 secrets 为 encrypted 时需要，缺口令时其余内容照样能预览。 */
export function readBundle(archive: Uint8Array, passphrase?: string): BundleContents {
  const files = unzipSync(archive)
  const manifest = parseJson<BundleManifest>(files['manifest.json'], 'manifest.json')
  if (manifest.format !== BUNDLE_FORMAT) throw new Error('这不是 FastAgent 能力整包')
  if (manifest.version > BUNDLE_VERSION) throw new Error(`整包版本 ${manifest.version} 高于当前应用支持的 ${BUNDLE_VERSION}`)

  const secrets: ServerSecrets = (() => {
    const raw = files['mcp/secrets.json']
    if (!raw || manifest.secrets === 'omit') return {}
    if (manifest.secrets !== 'encrypted') return parseJson<ServerSecrets>(raw, 'mcp/secrets.json')
    if (!passphrase?.trim()) return {}
    return JSON.parse(decrypt(parseJson<EncryptedBlob>(raw, 'mcp/secrets.json'), passphrase)) as ServerSecrets
  })()

  const skills = manifest.skills.map((entry) => {
    const prefix = `skills/${entry.name}/`
    const contents: Record<string, string> = {}
    for (const [path, bytes] of Object.entries(files)) {
      if (!path.startsWith(prefix) || path.endsWith('/')) continue
      contents[assertSafeSkillPath(path.slice(prefix.length))] = decoder.decode(bytes)
    }
    if (!contents['SKILL.md']) throw new Error(`整包里的 Skill ${entry.name} 缺少 SKILL.md`)
    return { ...entry, files: contents }
  })

  return {
    exportedAt: manifest.exportedAt,
    appVersion: manifest.appVersion,
    secrets: manifest.secrets,
    skills,
    mcpServers: manifest.mcpServers.map((entry) => ({
      ...entry,
      server: { ...entry.server, ...secrets[entry.server.id] }
    })),
    cliTools: manifest.cliTools ?? []
  }
}

/** 预览用：不解密也能看清整包里有什么、要不要口令。 */
export function bundleNeedsPassphrase(archive: Uint8Array): boolean {
  const files = unzipSync(archive)
  const manifest = parseJson<BundleManifest>(files['manifest.json'], 'manifest.json')
  return manifest.secrets === 'encrypted' && Boolean(files['mcp/secrets.json'])
}
