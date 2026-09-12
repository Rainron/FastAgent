import { describe, expect, it, vi } from 'vitest'
import { zipSync } from 'fflate'
import type { HubSource } from '../../../shared/types'
import { archiveUrlFor, GitMarketplaceProvider } from './git'

describe('archiveUrlFor', () => {
  it('GitHub 仓库走 codeload', () => {
    expect(archiveUrlFor('https://github.com/acme/kit')).toBe('https://codeload.github.com/acme/kit/zip/HEAD')
    expect(archiveUrlFor('https://github.com/acme/kit.git', 'v1.2.0')).toBe('https://codeload.github.com/acme/kit/zip/v1.2.0')
  })

  it('GitLab 仓库走 archive 端点', () => {
    expect(archiveUrlFor('https://gitlab.com/acme/kit/', 'main')).toBe('https://gitlab.com/acme/kit/-/archive/main/kit-main.zip')
  })

  it('直接给 zip 地址时原样使用', () => {
    expect(archiveUrlFor('https://files.example.com/kit.zip')).toBe('https://files.example.com/kit.zip')
  })

  it('未知托管方给出可操作的错误', () => {
    expect(() => archiveUrlFor('https://example.com/acme/kit')).toThrow('请直接填 .zip 地址')
  })

  it('路径段不足时报错', () => {
    expect(() => archiveUrlFor('https://github.com/acme')).toThrow('无法从仓库地址推断归档地址')
  })
})

function makeArchive() {
  const encode = (value: string) => new TextEncoder().encode(value)
  return zipSync({
    'kit-main/skills/alpha/SKILL.md': encode('---\nname: alpha\ndescription: A 技能\nversion: 1.0.0\n---\n\n正文\n'),
    'kit-main/skills/beta/SKILL.md': encode('---\nname: beta\ndescription: B 技能\n---\n\n正文\n')
  })
}

function makeProvider(fetchImpl: typeof fetch, overrides: Partial<HubSource> = {}) {
  const source: HubSource = {
    id: 'team', kind: 'git', name: '团队源', url: 'https://github.com/acme/kit',
    enabled: true, builtin: false, sortOrder: 0, hasSecrets: false, status: 'ready', updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides
  }
  return new GitMarketplaceProvider(source, { fetchImpl })
}

describe('GitMarketplaceProvider', () => {
  const signal = new AbortController().signal

  it('下载归档并列出全部 skill', async () => {
    const fetchImpl = vi.fn(async () => new Response(makeArchive() as unknown as BodyInit)) as unknown as typeof fetch
    const provider = makeProvider(fetchImpl)
    const listings = await provider.search({}, signal)
    expect(listings.map((item) => item.name)).toEqual(['alpha', 'beta'])
    expect(listings[0].version).toBe('1.0.0')
  })

  it('关键词过滤生效', async () => {
    const fetchImpl = vi.fn(async () => new Response(makeArchive() as unknown as BodyInit)) as unknown as typeof fetch
    const listings = await makeProvider(fetchImpl).search({ keyword: 'B 技能' }, signal)
    expect(listings.map((item) => item.name)).toEqual(['beta'])
  })

  it('搜索与安装共用一次下载', async () => {
    const fetchImpl = vi.fn(async () => new Response(makeArchive() as unknown as BodyInit))
    const provider = makeProvider(fetchImpl as unknown as typeof fetch)
    await provider.search({}, signal)
    const payloads = await provider.fetchPayload('skills/alpha', signal)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(payloads).toEqual([{ kind: 'skill', files: { 'SKILL.md': '---\nname: alpha\ndescription: A 技能\nversion: 1.0.0\n---\n\n正文\n' } }])
  })

  it('缓存过期后重新下载', async () => {
    const fetchImpl = vi.fn(async () => new Response(makeArchive() as unknown as BodyInit))
    let clock = 0
    const provider = new GitMarketplaceProvider(
      { id: 'team', kind: 'git', name: '团队源', url: 'https://github.com/acme/kit', enabled: true, builtin: false, sortOrder: 0, hasSecrets: false, status: 'ready', updatedAt: '' },
      { fetchImpl: fetchImpl as unknown as typeof fetch, ttlMs: 1000, now: () => clock }
    )
    await provider.search({}, signal)
    clock = 2000
    await provider.search({}, signal)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('不存在的 ref 报错时带上源名', async () => {
    const fetchImpl = vi.fn(async () => new Response(makeArchive() as unknown as BodyInit)) as unknown as typeof fetch
    await expect(makeProvider(fetchImpl).fetchPayload('skills/missing', signal)).rejects.toThrow('源 团队源 上不存在条目：skills/missing')
  })

  it('未配置仓库地址时报错', async () => {
    const fetchImpl = vi.fn(async () => new Response(makeArchive() as unknown as BodyInit)) as unknown as typeof fetch
    await expect(makeProvider(fetchImpl, { url: undefined }).search({}, signal)).rejects.toThrow('未配置仓库地址')
  })
})
