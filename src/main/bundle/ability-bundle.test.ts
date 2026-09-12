import { describe, expect, it } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import type { BuildBundleInput } from './ability-bundle'
import { buildBundle, bundleNeedsPassphrase, readBundle } from './ability-bundle'

const decoder = new TextDecoder('utf8')

function input(overrides: Partial<BuildBundleInput> = {}): BuildBundleInput {
  return {
    secrets: 'omit',
    appVersion: '1.0.0',
    exportedAt: '2026-09-03T00:00:00.000Z',
    skills: [{
      name: 'alpha',
      enabled: true,
      files: { 'SKILL.md': '---\nname: alpha\ndescription: A\n---\n\n正文\n', 'refs/x.md': '参考' },
      meta: { source: 'marketplace', sourceId: 'team', version: '1.0.0' }
    }],
    mcpServers: [{
      server: { id: 'srv', name: 'Srv', transport: 'stdio', command: 'node', enabled: true, timeoutMs: 10_000, env: { TOKEN: 'sk-secret-value' } },
      disabledTools: ['danger'],
      meta: { source: 'imported' }
    }],
    cliTools: [],
    ...overrides
  }
}

function contains(archive: Uint8Array, needle: string) {
  return Object.values(unzipSync(archive)).some((bytes) => decoder.decode(bytes).includes(needle))
}

describe('buildBundle / readBundle', () => {
  it('导出再导入结构一致', () => {
    const contents = readBundle(buildBundle(input()))
    expect(contents.exportedAt).toBe('2026-09-03T00:00:00.000Z')
    expect(contents.appVersion).toBe('1.0.0')
    expect(contents.skills).toHaveLength(1)
    expect(contents.skills[0]).toMatchObject({ name: 'alpha', enabled: true })
    expect(contents.skills[0].files['refs/x.md']).toBe('参考')
    expect(contents.mcpServers[0].server).toMatchObject({ id: 'srv', command: 'node', enabled: true })
    expect(contents.mcpServers[0].disabledTools).toEqual(['danger'])
  })

  it('默认档的产物里搜不到任何密钥值', () => {
    const archive = buildBundle(input())
    expect(contains(archive, 'sk-secret-value')).toBe(false)
    expect(readBundle(archive).mcpServers[0].server.env).toBeUndefined()
  })

  it('明文档带出密钥', () => {
    const archive = buildBundle(input({ secrets: 'plain' }))
    expect(contains(archive, 'sk-secret-value')).toBe(true)
    expect(readBundle(archive).mcpServers[0].server.env).toEqual({ TOKEN: 'sk-secret-value' })
  })

  it('加密档的产物里搜不到明文密钥，凭口令能还原', () => {
    const archive = buildBundle(input({ secrets: 'encrypted', passphrase: 'correct horse' }))
    expect(contains(archive, 'sk-secret-value')).toBe(false)
    expect(readBundle(archive, 'correct horse').mcpServers[0].server.env).toEqual({ TOKEN: 'sk-secret-value' })
  })

  it('口令错误时明确报错而不是给出空密钥', () => {
    const archive = buildBundle(input({ secrets: 'encrypted', passphrase: 'right' }))
    expect(() => readBundle(archive, 'wrong')).toThrow('口令不正确，或整包已被篡改')
  })

  it('加密档不给口令时其余内容仍可预览', () => {
    const archive = buildBundle(input({ secrets: 'encrypted', passphrase: 'right' }))
    const contents = readBundle(archive)
    expect(contents.skills[0].name).toBe('alpha')
    expect(contents.mcpServers[0].server.env).toBeUndefined()
  })

  it('加密导出缺口令时拒绝构建', () => {
    expect(() => buildBundle(input({ secrets: 'encrypted' }))).toThrow('加密导出必须提供口令')
  })

  it('没有密钥可带时不产出 secrets 文件', () => {
    const archive = buildBundle(input({
      secrets: 'plain',
      mcpServers: [{ server: { id: 'srv', name: 'Srv', transport: 'stdio', command: 'node', enabled: true, timeoutMs: 10_000 }, disabledTools: [] }]
    }))
    expect(Object.keys(unzipSync(archive))).not.toContain('mcp/secrets.json')
  })

  it('bundleNeedsPassphrase 只对加密档为真', () => {
    expect(bundleNeedsPassphrase(buildBundle(input()))).toBe(false)
    expect(bundleNeedsPassphrase(buildBundle(input({ secrets: 'plain' })))).toBe(false)
    expect(bundleNeedsPassphrase(buildBundle(input({ secrets: 'encrypted', passphrase: 'x' })))).toBe(true)
  })

  it('拒绝越界的 Skill 文件路径', () => {
    expect(() => buildBundle(input({
      skills: [{ name: 'bad', enabled: false, files: { '../escape.md': 'x' } }]
    }))).toThrow('Skill 文件路径含非法片段')
  })
})

describe('readBundle 校验', () => {
  it('拒绝非本格式的压缩包', () => {
    const archive = zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify({ format: 'other', version: 1 })) })
    expect(() => readBundle(archive)).toThrow('这不是 FastAgent 能力整包')
  })

  it('拒绝更高版本的整包', () => {
    const archive = zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify({ format: 'fastagent-ability-bundle', version: 99, secrets: 'omit', skills: [], mcpServers: [], cliTools: [] }))
    })
    expect(() => readBundle(archive)).toThrow('整包版本 99 高于当前应用支持的 1')
  })

  it('缺 manifest 时给出可定位的错误', () => {
    expect(() => readBundle(zipSync({ 'a.txt': new Uint8Array([1]) }))).toThrow('整包缺少 manifest.json')
  })

  it('Skill 缺 SKILL.md 时拒绝导入', () => {
    const archive = zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify({
        format: 'fastagent-ability-bundle', version: 1, exportedAt: '', secrets: 'omit',
        skills: [{ name: 'alpha', enabled: false }], mcpServers: [], cliTools: []
      })),
      'skills/alpha/other.md': new TextEncoder().encode('x')
    })
    expect(() => readBundle(archive)).toThrow('缺少 SKILL.md')
  })
})
