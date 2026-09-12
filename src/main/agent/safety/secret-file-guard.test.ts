import { describe, expect, it } from 'vitest'
import { classifySecretPath, mergeSecretClassification } from './secret-file-guard'

describe('secret file guard', () => {
  it('.env 与 .env.* 变体判为 ask，.env.example 除外', () => {
    expect(classifySecretPath('.env')).toBe('ask')
    expect(classifySecretPath('.env.local')).toBe('ask')
    expect(classifySecretPath('config/.env.production')).toBe('ask')
    expect(classifySecretPath('.env.example')).toBeNull()
    expect(classifySecretPath('docs/.env.example')).toBeNull()
  })

  it('私钥类直接 deny', () => {
    expect(classifySecretPath('certs/server.pem')).toBe('deny')
    expect(classifySecretPath('.ssh/id_rsa')).toBe('deny')
    expect(classifySecretPath('.ssh/id_rsa.pub')).toBe('deny')
    expect(classifySecretPath('.ssh/id_ed25519')).toBe('deny')
    expect(classifySecretPath('keys/private.key')).toBe('deny')
  })

  it('.ssh 与 .aws 目录判为 ask', () => {
    expect(classifySecretPath('.ssh/config')).toBe('ask')
    expect(classifySecretPath('.ssh/known_hosts')).toBe('ask')
    expect(classifySecretPath('.aws/credentials')).toBe('ask')
  })

  it('常见凭据文件名判为 ask', () => {
    expect(classifySecretPath('.npmrc')).toBe('ask')
    expect(classifySecretPath('.pypirc')).toBe('ask')
    expect(classifySecretPath('secrets/credentials.json')).toBe('ask')
  })

  it('普通文件不受影响', () => {
    expect(classifySecretPath('src/index.ts')).toBeNull()
    expect(classifySecretPath('package.json')).toBeNull()
    expect(classifySecretPath('')).toBeNull()
  })

  it('合并取更严者', () => {
    expect(mergeSecretClassification('ask', 'deny')).toBe('deny')
    expect(mergeSecretClassification('deny', null)).toBe('deny')
    expect(mergeSecretClassification('ask', null)).toBe('ask')
    expect(mergeSecretClassification(null, null)).toBeNull()
  })
})