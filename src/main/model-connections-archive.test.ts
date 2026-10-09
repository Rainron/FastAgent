import { describe, expect, it } from 'vitest'
import type { BuildArchiveInput } from './model-connections-archive'
import { archiveSecretAt, buildConnectionsArchive, connectionsArchiveNeedsPassphrase, readConnectionsArchive } from './model-connections-archive'

const SECRET = 'sk-archive-secret-value'

function input(overrides: Partial<BuildArchiveInput> = {}): BuildArchiveInput {
  return {
    secrets: 'omit',
    appVersion: '1.0.0',
    exportedAt: '2026-09-14T00:00:00.000Z',
    connections: [
      { providerId: 'deepseek', name: 'DeepSeek · 工作', authMode: 'api-key', baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai', models: [{ modelId: 'deepseek-chat', name: 'DeepSeek Chat', contextWindow: 128_000, vision: false }], hasSecrets: false },
      { providerId: 'openai', name: 'OpenAI 账号', authMode: 'oauth', baseUrl: 'https://api.openai.com/v1', protocol: 'openai', models: [{ modelId: 'gpt-5' }], hasSecrets: false }
    ],
    secretsByIndex: { 0: { apiKey: SECRET, headers: { 'x-tenant': 'team' } } },
    ...overrides
  }
}

describe('buildConnectionsArchive / readConnectionsArchive', () => {
  it('导出再导入结构一致', () => {
    const archive = readConnectionsArchive(buildConnectionsArchive(input()))
    expect(archive.exportedAt).toBe('2026-09-14T00:00:00.000Z')
    expect(archive.appVersion).toBe('1.0.0')
    expect(archive.connections).toHaveLength(2)
    expect(archive.connections[0]).toMatchObject({ providerId: 'deepseek', name: 'DeepSeek · 工作', protocol: 'openai' })
    expect(archive.connections[0].models[0]).toMatchObject({ modelId: 'deepseek-chat', contextWindow: 128_000 })
    expect(archive.connections[1].authMode).toBe('oauth')
  })

  it('默认档的产物里搜不到任何密钥值', () => {
    const text = buildConnectionsArchive(input())
    expect(text).not.toContain(SECRET)
    expect(readConnectionsArchive(text).connections[0].hasSecrets).toBe(false)
    expect(archiveSecretAt(readConnectionsArchive(text), 0)).toEqual({})
  })

  it('明文档带出密钥并标记 hasSecrets', () => {
    const text = buildConnectionsArchive(input({ secrets: 'plain' }))
    expect(text).toContain(SECRET)
    const archive = readConnectionsArchive(text)
    expect(archive.connections[0].hasSecrets).toBe(true)
    expect(archive.connections[1].hasSecrets).toBe(false)
    expect(archiveSecretAt(archive, 0)).toEqual({ apiKey: SECRET, headers: { 'x-tenant': 'team' } })
  })

  it('加密档的产物里搜不到明文密钥，凭口令能还原', () => {
    const text = buildConnectionsArchive(input({ secrets: 'encrypted', passphrase: 'correct horse' }))
    expect(text).not.toContain(SECRET)
    expect(connectionsArchiveNeedsPassphrase(text)).toBe(true)
    expect(archiveSecretAt(readConnectionsArchive(text, 'correct horse'), 0)).toEqual({ apiKey: SECRET, headers: { 'x-tenant': 'team' } })
  })

  it('口令错误时明确报错而不是给出空密钥', () => {
    const text = buildConnectionsArchive(input({ secrets: 'encrypted', passphrase: 'right' }))
    expect(() => readConnectionsArchive(text, 'wrong')).toThrow('口令不正确，或整包已被篡改')
  })

  it('加密档不给口令时连接清单仍可预览', () => {
    const text = buildConnectionsArchive(input({ secrets: 'encrypted', passphrase: 'right' }))
    const archive = readConnectionsArchive(text)
    expect(archive.connections[0].name).toBe('DeepSeek · 工作')
    expect(archiveSecretAt(archive, 0)).toEqual({})
  })

  it('加密导出缺口令时拒绝构建', () => {
    expect(() => buildConnectionsArchive(input({ secrets: 'encrypted' }))).toThrow('加密导出必须提供口令')
  })

  it('没有密钥可带时不写 credentials', () => {
    const text = buildConnectionsArchive(input({ secrets: 'plain', secretsByIndex: {} }))
    expect(JSON.parse(text).credentials).toBeUndefined()
    expect(connectionsArchiveNeedsPassphrase(text)).toBe(false)
  })

  it('拒绝非本格式与更高版本的归档', () => {
    expect(() => readConnectionsArchive('{}')).toThrow('这不是 FastAgent 模型服务归档')
    expect(() => readConnectionsArchive('not json')).toThrow('文件不是合法 JSON')
    const future = JSON.stringify({ ...JSON.parse(buildConnectionsArchive(input())), version: 2 })
    expect(() => readConnectionsArchive(future)).toThrow('归档版本 2 高于当前应用支持的 1')
  })
})
