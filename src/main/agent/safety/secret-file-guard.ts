import { matchPattern } from '../../../shared/pattern-matcher'

export type SecretClassification = 'deny' | 'ask' | null

const PRIVATE_KEY_PATTERNS = ['*.pem', '*.key', 'id_rsa*', 'id_ed25519*']
const SECRET_BASENAMES = ['.npmrc', '.pypirc', 'credentials.json']

/** .env.example 是文档模板，不算密钥；其余 .env.* 变体按密钥处理。 */
function isDotEnvVariant(basename: string): boolean {
  return basename === '.env' || basename.startsWith('.env.')
}

export function classifySecretPath(rawPath: string): SecretClassification {
  const normalized = String(rawPath ?? '').replace(/\\/g, '/').trim()
  if (!normalized) return null
  const segments = normalized.split('/')
  const basename = segments.at(-1) ?? ''
  if (basename === '.env.example') return null
  if (PRIVATE_KEY_PATTERNS.some((pattern) => matchPattern(pattern, basename))) return 'deny'
  if (isDotEnvVariant(basename)) return 'ask'
  if (normalized.includes('.ssh/')) return 'ask'
  if (normalized.includes('.aws/credentials')) return 'ask'
  if (SECRET_BASENAMES.includes(basename)) return 'ask'
  return null
}

/** 合并多个路径的分类结果，取更严者（deny > ask > null）。 */
export function mergeSecretClassification(left: SecretClassification, right: SecretClassification): SecretClassification {
  if (left === 'deny' || right === 'deny') return 'deny'
  if (left === 'ask' || right === 'ask') return 'ask'
  return null
}