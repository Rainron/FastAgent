import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

/**
 * 口令加密的密钥信封。能力整包与模型服务归档共用同一套算法与字段名，
 * 换句话说两边的加密产物可以用同一份实现读写。
 */
export interface EncryptedBlob {
  algorithm: 'aes-256-gcm'
  kdf: 'scrypt'
  salt: string
  iv: string
  tag: string
  data: string
}

export function encryptSecret(plaintext: string, passphrase: string): EncryptedBlob {
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

export function decryptSecret(blob: EncryptedBlob, passphrase: string): string {
  const decipher = createDecipheriv('aes-256-gcm', scryptSync(passphrase, Buffer.from(blob.salt, 'base64'), 32), Buffer.from(blob.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'))
  try {
    return Buffer.concat([decipher.update(Buffer.from(blob.data, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    // GCM 校验失败只可能是口令错或包被改过，两者都不该继续解析。
    throw new Error('口令不正确，或整包已被篡改')
  }
}
