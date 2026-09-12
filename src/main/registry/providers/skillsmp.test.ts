import { describe, expect, it, vi } from 'vitest'

import type { HubSource } from '../../../shared/types'
import { parseSkillsMpRef, skillsMpRef, SkillsMpProvider } from './skillsmp'

// 取自 skillsmp.com/api/skills 的真实返回形状。
const record = {
  id: 'openclaw-openclaw-agents-skills-agent-transcript-skill-md',
  name: 'agent-transcript',
  author: 'openclaw',
  description: 'Add a redacted agent transcript section to GitHub PR bodies.',
  githubUrl: 'https://github.com/openclaw/openclaw/tree/main/.agents/skills/agent-transcript',
  stars: 388044,
  updatedAt: 1779808673,
  path: 'SKILL.md',
  branch: 'main',
  route: {
    ownerSlug: 'openclaw',
    repoSlug: 'openclaw',
    routeSlug: 'agents-skills-agent-transcript',
    sourceSkillPath: '.agents/skills/agent-transcript/SKILL.md'
  }
}

function source(): HubSource {
  return {
    id: 'skillsmp', kind: 'skillsmp', name: 'SkillsMP', enabled: true, builtin: false,
    sortOrder: 0, hasSecrets: false, status: 'ready', updatedAt: ''
  }
}

function jsonResponse(body: unknown) {
  return new Response(new TextEncoder().encode(JSON.stringify(body)) as unknown as BodyInit, { headers: { 'content-type': 'application/json' } })
}

describe('skillsMpRef / parseSkillsMpRef', () => {
  it('往返一致', () => {
    const ref = skillsMpRef('openclaw', 'openclaw', 'main', '.agents/skills/agent-transcript')
    expect(parseSkillsMpRef(ref)).toEqual({ owner: 'openclaw', repo: 'openclaw', branch: 'main', dir: '.agents/skills/agent-transcript' })
  })

  it('目录含斜杠也能正确切分', () => {
    expect(parseSkillsMpRef('a/b@v1.2:x/y/z')).toEqual({ owner: 'a', repo: 'b', branch: 'v1.2', dir: 'x/y/z' })
  })

  it('形状不对时返回 null', () => {
    expect(parseSkillsMpRef('garbage')).toBeNull()
  })
})

describe('SkillsMpProvider.search', () => {
  const signal = new AbortController().signal

  it('把索引记录映射成目录条目', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ skills: [record] })) as unknown as typeof fetch
    const [draft] = await new SkillsMpProvider(source(), { fetchImpl }).search({ keyword: 'transcript' }, signal)
    expect(draft).toMatchObject({
      name: 'agent-transcript',
      abilityType: 'skill',
      author: 'openclaw',
      repository: 'https://github.com/openclaw/openclaw/tree/main/.agents/skills/agent-transcript',
      trending: 388044
    })
    expect(draft.ref).toBe('openclaw/openclaw@main:.agents/skills/agent-transcript')
    expect(draft.publishedAt).toBe(new Date(1779808673 * 1000).toISOString())
  })

  it('关键词进 q 参数', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ skills: [] }))
    await new SkillsMpProvider(source(), { fetchImpl: fetchImpl as unknown as typeof fetch }).search({ keyword: 'pdf' }, signal)
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toContain('q=pdf')
  })

  it('按非 skill 类型筛选时不打网络', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ skills: [record] }))
    const result = await new SkillsMpProvider(source(), { fetchImpl: fetchImpl as unknown as typeof fetch }).search({ abilityType: 'mcp' }, signal)
    expect(result).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('缺 route 的记录被跳过而不是整页失败', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ skills: [{ name: 'broken' }, record] })) as unknown as typeof fetch
    const drafts = await new SkillsMpProvider(source(), { fetchImpl }).search({}, signal)
    expect(drafts.map((item) => item.name)).toEqual(['agent-transcript'])
  })

  it('返回体没有 skills 字段时给空数组', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'x' })) as unknown as typeof fetch
    expect(await new SkillsMpProvider(source(), { fetchImpl }).search({}, signal)).toEqual([])
  })

  it('配了 apiKey 时带上 Authorization', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ skills: [] }))
    await new SkillsMpProvider(source(), { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'k-1' }).search({}, signal)
    expect((fetchImpl.mock.calls[0] as unknown[])[1]).toMatchObject({ headers: expect.objectContaining({ authorization: 'Bearer k-1' }) })
  })
})

describe('SkillsMpProvider.fetchPayload', () => {
  const signal = new AbortController().signal
  const encode = (value: string) => new TextEncoder().encode(value)

  /** 按 URL 路由的假 GitHub：contents API 返回目录项，raw 地址返回文件内容。 */
  function githubFake(tree: Record<string, Array<{ name: string; type: 'file' | 'dir'; size?: number }>>, blobs: Record<string, string>) {
    return vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.startsWith('https://api.github.com/')) {
        const dir = decodeURIComponent(url.split('/contents/')[1].split('?')[0])
        const entries = tree[dir]
        if (!entries) return new Response('[]', { status: 404 })
        return jsonResponse(entries.map((entry) => ({
          ...entry,
          download_url: entry.type === 'file' ? `https://raw.githubusercontent.com/o/r/main/${dir}/${entry.name}` : null
        })))
      }
      const path = url.replace('https://raw.githubusercontent.com/o/r/main/', '')
      return new Response(encode(blobs[path] ?? '') as unknown as BodyInit)
    })
  }

  const manifest = '---\nname: agent-transcript\ndescription: X\n---\n'

  it('只取该 skill 目录，不下载整个仓库归档', async () => {
    const fetchImpl = githubFake(
      { '.agents/skills/agent-transcript': [{ name: 'SKILL.md', type: 'file', size: 40 }] },
      { '.agents/skills/agent-transcript/SKILL.md': manifest }
    )
    const payloads = await new SkillsMpProvider(source(), { fetchImpl: fetchImpl as unknown as typeof fetch })
      .fetchPayload('openclaw/openclaw@main:.agents/skills/agent-transcript', signal)
    expect(payloads).toEqual([{ kind: 'skill', files: { 'SKILL.md': manifest } }])
    const urls = fetchImpl.mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes('codeload'))).toBe(false)
    expect(urls[0]).toContain('api.github.com/repos/openclaw/openclaw/contents/.agents/skills/agent-transcript?ref=main')
  })

  it('递归取子目录并保留相对路径', async () => {
    const fetchImpl = githubFake(
      {
        'skills/a': [{ name: 'SKILL.md', type: 'file', size: 10 }, { name: 'refs', type: 'dir' }],
        'skills/a/refs': [{ name: 'x.md', type: 'file', size: 5 }]
      },
      { 'skills/a/SKILL.md': 'M', 'skills/a/refs/x.md': '参考' }
    )
    const payloads = await new SkillsMpProvider(source(), { fetchImpl: fetchImpl as unknown as typeof fetch })
      .fetchPayload('o/r@main:skills/a', signal)
    expect(payloads[0]).toEqual({ kind: 'skill', files: { 'SKILL.md': 'M', 'refs/x.md': '参考' } })
  })

  it('目录里没有 SKILL.md 时报错而不是装个空壳', async () => {
    const fetchImpl = githubFake({ 'skills/a': [{ name: 'README.md', type: 'file', size: 3 }] }, { 'skills/a/README.md': 'x' })
    await expect(new SkillsMpProvider(source(), { fetchImpl: fetchImpl as unknown as typeof fetch })
      .fetchPayload('o/r@main:skills/a', signal)).rejects.toThrow('没有 SKILL.md')
  })

  it('超大单文件被拦下', async () => {
    const fetchImpl = githubFake({ 'skills/a': [{ name: 'big.bin', type: 'file', size: 99_000_000 }] }, {})
    await expect(new SkillsMpProvider(source(), { fetchImpl: fetchImpl as unknown as typeof fetch })
      .fetchPayload('o/r@main:skills/a', signal)).rejects.toThrow('超过单文件')
  })

  it('GitHub 限流的 403 换成看得懂的提示', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 403 })) as unknown as typeof fetch
    await expect(new SkillsMpProvider(source(), { fetchImpl })
      .fetchPayload('o/r@main:skills/a', signal)).rejects.toThrow('调用频率已达上限')
  })

  it('ref 形状不对时明确报错', async () => {
    await expect(new SkillsMpProvider(source(), {}).fetchPayload('garbage', signal)).rejects.toThrow('无法解析条目定位串')
  })
})

describe('SkillsMpProvider.detail 的权限告示', () => {
  const signal = new AbortController().signal

  function dirFake(entries: Array<{ name: string; type: 'file' | 'dir' }>) {
    return vi.fn(async () => jsonResponse(entries)) as unknown as typeof fetch
  }

  it('带 scripts/ 时如实标出会跑本地代码', async () => {
    const fetchImpl = dirFake([{ name: 'SKILL.md', type: 'file' }, { name: 'scripts', type: 'dir' }])
    const detail = await new SkillsMpProvider(source(), { fetchImpl }).detail('o/r@main:skills/a', signal)
    expect(detail.permissions).toMatchObject({ runsLocalCode: true, fileAccess: true })
  })

  it('纯文本 skill 不误报会跑代码', async () => {
    const fetchImpl = dirFake([{ name: 'SKILL.md', type: 'file' }])
    const detail = await new SkillsMpProvider(source(), { fetchImpl }).detail('o/r@main:skills/a', signal)
    expect(detail.permissions).toMatchObject({ runsLocalCode: false, fileAccess: false })
  })

  it('列不到目录时按会跑处理，不给出「只提供文本指令」的假保证', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 403 })) as unknown as typeof fetch
    const detail = await new SkillsMpProvider(source(), { fetchImpl }).detail('o/r@main:skills/a', signal)
    expect(detail.permissions.runsLocalCode).toBe(true)
  })

  it('搜索结果在拿到详情前也不宣称无害', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ skills: [record] })) as unknown as typeof fetch
    const [draft] = await new SkillsMpProvider(source(), { fetchImpl }).search({}, signal)
    expect(draft.permissions.runsLocalCode).toBe(true)
  })
})
