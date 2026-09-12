import { describe, expect, it } from 'vitest'
import { findSkills, mcpPayloads, parseGitArchive, skillPayload, stripArchiveRoot } from './git-archive'

function skillFile(name: string, description: string, extra = '') {
  return `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n正文\n`
}

describe('stripArchiveRoot', () => {
  it('剥掉共享的顶层目录', () => {
    expect(stripArchiveRoot({ 'repo-main/a.md': 'a', 'repo-main/b/c.md': 'c' })).toEqual({ 'a.md': 'a', 'b/c.md': 'c' })
  })

  it('顶层目录不唯一时原样返回', () => {
    const files = { 'a/x.md': 'x', 'b/y.md': 'y' }
    expect(stripArchiveRoot(files)).toEqual(files)
  })

  it('空归档返回空对象', () => {
    expect(stripArchiveRoot({})).toEqual({})
  })
})

describe('findSkills', () => {
  it('识别合法 frontmatter 并按目录排序', () => {
    const files = {
      'skills/beta/SKILL.md': skillFile('beta', 'B 技能'),
      'skills/alpha/SKILL.md': skillFile('alpha', 'A 技能', 'version: 2.1.0\nauthor: Ann\n')
    }
    expect(findSkills(files)).toEqual([
      { dir: 'skills/alpha', name: 'alpha', description: 'A 技能', version: '2.1.0', author: 'Ann', license: undefined },
      { dir: 'skills/beta', name: 'beta', description: 'B 技能', version: undefined, author: undefined, license: undefined }
    ])
  })

  it('跳过缺 name/description 或名称非法的 SKILL.md', () => {
    const files = {
      'a/SKILL.md': '---\nname: a\n---\n',
      'b/SKILL.md': skillFile('Bad_Name', '大写与下划线不合法'),
      'c/SKILL.md': '没有 frontmatter'
    }
    expect(findSkills(files)).toEqual([])
  })

  it('解析带引号的 description', () => {
    expect(findSkills({ 'x/SKILL.md': skillFile('x', '"带引号"') })[0].description).toBe('带引号')
  })
})

describe('skillPayload', () => {
  it('路径改为相对 skill 目录', () => {
    const files = { 'skills/a/SKILL.md': 'M', 'skills/a/refs/x.md': 'X', 'skills/b/SKILL.md': 'B' }
    expect(skillPayload(files, 'skills/a')).toEqual({ kind: 'skill', files: { 'SKILL.md': 'M', 'refs/x.md': 'X' } })
  })

  it('不把嵌套的另一个 SKILL.md 打包进来', () => {
    const files = { 'a/SKILL.md': 'M', 'a/nested/SKILL.md': 'N', 'a/nested/ref.md': 'R' }
    expect(skillPayload(files, 'a')).toEqual({ kind: 'skill', files: { 'SKILL.md': 'M', 'nested/ref.md': 'R' } })
  })
})

describe('mcpPayloads', () => {
  it('解析 stdio 与 http 两种配置', () => {
    const text = JSON.stringify({
      mcpServers: {
        local: { command: 'npx', args: ['-y', 'pkg'], cwd: '/tmp' },
        remote: { url: 'https://mcp.example.com/x' }
      }
    })
    expect(mcpPayloads(text)).toEqual([
      { kind: 'mcp', name: 'local', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'], cwd: '/tmp', url: undefined, timeoutMs: 10_000 },
      { kind: 'mcp', name: 'remote', transport: 'streamable_http', command: undefined, args: undefined, cwd: undefined, url: 'https://mcp.example.com/x', timeoutMs: 10_000 }
    ])
  })

  it('缺 command 的 stdio 与缺 url 的 http 都跳过', () => {
    expect(mcpPayloads(JSON.stringify({ mcpServers: { bad: { args: ['x'] }, alsoBad: { type: 'http' } } }))).toEqual([])
  })

  it('非法 JSON 与缺 mcpServers 都返回空', () => {
    expect(mcpPayloads('{')).toEqual([])
    expect(mcpPayloads(JSON.stringify({ other: 1 }))).toEqual([])
    expect(mcpPayloads(undefined)).toEqual([])
  })
})

describe('parseGitArchive', () => {
  it('无 marketplace.json 时每个 skill 目录一条', () => {
    const packages = parseGitArchive({
      'repo-main/skills/alpha/SKILL.md': skillFile('alpha', 'A 技能', 'version: 1.2.0\n'),
      'repo-main/skills/beta/SKILL.md': skillFile('beta', 'B 技能')
    })
    expect(packages.map((item) => item.ref)).toEqual(['skills/alpha', 'skills/beta'])
    expect(packages[0].detail.version).toBe('1.2.0')
    expect(packages[0].detail.abilityType).toBe('skill')
    expect(packages[0].payloads).toEqual([{ kind: 'skill', files: { 'SKILL.md': skillFile('alpha', 'A 技能', 'version: 1.2.0\n') } }])
  })

  it('marketplace.json 的相对 source 解析成包，远端 source 跳过', () => {
    const packages = parseGitArchive({
      'repo-main/.claude-plugin/marketplace.json': JSON.stringify({
        name: 'team',
        owner: { name: 'Team' },
        plugins: [
          { name: 'review-kit', source: './plugins/review-kit', description: '评审套件', category: '开发' },
          { name: 'elsewhere', source: 'other/repo' }
        ]
      }),
      'repo-main/plugins/review-kit/.claude-plugin/plugin.json': JSON.stringify({ version: '3.0.0', author: { name: 'Team' }, keywords: ['review'] }),
      'repo-main/plugins/review-kit/skills/code-review/SKILL.md': skillFile('code-review', '评审技能'),
      'repo-main/plugins/review-kit/.mcp.json': JSON.stringify({ mcpServers: { linter: { command: 'linter-server' } } }),
      'repo-main/plugins/review-kit/README.md': '# 评审套件'
    })
    expect(packages).toHaveLength(1)
    const [pkg] = packages
    expect(pkg.ref).toBe('review-kit')
    expect(pkg.detail.displayName).toBe('review-kit')
    expect(pkg.detail.description).toBe('评审套件')
    expect(pkg.detail.version).toBe('3.0.0')
    expect(pkg.detail.categories).toEqual(['开发'])
    expect(pkg.detail.tags).toEqual(['review'])
    expect(pkg.detail.readme).toBe('# 评审套件')
    expect(pkg.detail.contents).toEqual([
      { kind: 'skill', name: 'code-review', description: '评审技能' },
      { kind: 'mcp', name: 'linter' }
    ])
    expect(pkg.payloads.map((item) => item.kind)).toEqual(['skill', 'mcp'])
  })

  it('带 stdio MCP 的包如实标出会跑本地代码并联网', () => {
    const [pkg] = parseGitArchive({
      'r/.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'p', source: './p' }] }),
      'r/p/skills/s/SKILL.md': skillFile('s', '技能'),
      'r/p/.mcp.json': JSON.stringify({ mcpServers: { srv: { command: 'node' } } })
    })
    expect(pkg.detail.permissions).toMatchObject({ runsLocalCode: true, networkAccess: true, fileAccess: true, commands: ['node'] })
  })

  it('纯文本 skill 不标记为会跑本地代码，带 scripts 才标', () => {
    const [plain] = parseGitArchive({ 'r/skills/a/SKILL.md': skillFile('a', '纯文本') })
    expect(plain.detail.permissions.runsLocalCode).toBe(false)
    const [scripted] = parseGitArchive({ 'r/skills/a/SKILL.md': skillFile('a', '带脚本'), 'r/skills/a/scripts/run.py': 'print(1)' })
    expect(scripted.detail.permissions.runsLocalCode).toBe(true)
  })

  it('装不出任何能力的包不进目录', () => {
    expect(parseGitArchive({
      'r/.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'empty', source: './empty' }] }),
      'r/empty/README.md': '空的'
    })).toEqual([])
  })

  // anthropics/skills 的真实形状：所有包共用 source "./"，靠 skills 数组区分。
  it('多个包共用 source "./" 时按 skills 数组切分，互不串味', () => {
    const packages = parseGitArchive({
      'skills-main/.claude-plugin/marketplace.json': JSON.stringify({
        name: 'anthropic-agent-skills',
        plugins: [
          { name: 'document-skills', description: '文档处理', source: './', skills: ['./skills/xlsx', './skills/docx'] },
          { name: 'claude-api', description: 'API 文档', source: './', skills: ['./skills/claude-api'] }
        ]
      }),
      'skills-main/skills/xlsx/SKILL.md': skillFile('xlsx', 'Excel'),
      'skills-main/skills/docx/SKILL.md': skillFile('docx', 'Word'),
      'skills-main/skills/claude-api/SKILL.md': skillFile('claude-api', 'API')
    })
    expect(packages.map((item) => item.ref)).toEqual(['document-skills', 'claude-api'])
    expect(packages[0].detail.contents.map((item) => item.name)).toEqual(['xlsx', 'docx'])
    expect(packages[1].detail.contents.map((item) => item.name)).toEqual(['claude-api'])
    expect(packages[1].payloads).toHaveLength(1)
  })

  it('skills 数组里指向不存在的目录时跳过，不整包失败', () => {
    const [pkg] = parseGitArchive({
      'r/.claude-plugin/marketplace.json': JSON.stringify({
        plugins: [{ name: 'p', source: './', skills: ['./skills/a', './skills/missing'] }]
      }),
      'r/skills/a/SKILL.md': skillFile('a', 'A')
    })
    expect(pkg.detail.contents.map((item) => item.name)).toEqual(['a'])
  })

  it('共用 source "./" 时权限只看本包选中的 skill', () => {
    const packages = parseGitArchive({
      'r/.claude-plugin/marketplace.json': JSON.stringify({
        plugins: [
          { name: 'plain', source: './', skills: ['./skills/a'] },
          { name: 'scripted', source: './', skills: ['./skills/b'] }
        ]
      }),
      'r/skills/a/SKILL.md': skillFile('a', 'A'),
      'r/skills/b/SKILL.md': skillFile('b', 'B'),
      'r/skills/b/scripts/run.py': 'print(1)'
    })
    expect(packages[0].detail.permissions.runsLocalCode).toBe(false)
    expect(packages[1].detail.permissions.runsLocalCode).toBe(true)
  })

  it('没有 skills 数组时仍按 source 目录整体收', () => {
    const [pkg] = parseGitArchive({
      'r/.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'kit', source: './plugins/kit' }] }),
      'r/plugins/kit/skills/a/SKILL.md': skillFile('a', 'A'),
      'r/plugins/kit/skills/b/SKILL.md': skillFile('b', 'B'),
      'r/skills/outside/SKILL.md': skillFile('outside', '不属于这个包')
    })
    expect(pkg.detail.contents.map((item) => item.name)).toEqual(['a', 'b'])
  })

  it('多能力包在没有描述时给出条目数概述', () => {
    const [pkg] = parseGitArchive({
      'r/.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'multi', source: './multi' }] }),
      'r/multi/skills/a/SKILL.md': skillFile('a', 'A'),
      'r/multi/skills/b/SKILL.md': skillFile('b', 'B')
    })
    expect(pkg.detail.description).toBe('包含 2 项能力')
  })
})
