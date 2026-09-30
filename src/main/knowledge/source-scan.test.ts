import { describe, expect, it } from 'vitest'
import { classifyFile, isExcluded, selectSourceFiles, summarizeSkipped } from './source-scan'

describe('classifyFile', () => {
  it('按扩展名区分 markdown / 文本 / PDF', () => {
    expect(classifyFile('docs/ARCHITECTURE.md')).toBe('markdown')
    expect(classifyFile('src/main/index.ts')).toBe('text')
    expect(classifyFile('spec/需求.pdf')).toBe('pdf')
  })

  it('无扩展名与未知扩展名不进知识库', () => {
    expect(classifyFile('LICENSE')).toBeNull()
    expect(classifyFile('assets/logo.png')).toBeNull()
    expect(classifyFile('build/app.exe')).toBeNull()
  })
})

describe('isExcluded', () => {
  it('按路径段匹配，不做子串匹配', () => {
    expect(isExcluded('node_modules/react/index.js', ['node_modules'])).toBe(true)
    expect(isExcluded('src/node_modules_helper.ts', ['node_modules'])).toBe(false)
  })

  it('支持通配模式与整条路径匹配', () => {
    expect(isExcluded('docs/draft.md', ['docs/*.md'])).toBe(true)
    expect(isExcluded('tmp-2026/a.md', ['tmp-*'])).toBe(true)
  })
})

describe('selectSourceFiles', () => {
  it('挑出支持的文件并记录跳过原因', () => {
    const result = selectSourceFiles([
      { path: 'docs/a.md', size: 100 },
      { path: 'node_modules/x/readme.md', size: 100 },
      { path: 'logo.png', size: 100 },
      { path: 'huge.md', size: 9_000_000 }
    ])
    expect(result.candidates.map((item) => item.path)).toEqual(['docs/a.md'])
    expect(result.skipped).toEqual([
      { path: 'node_modules/x/readme.md', reason: 'excluded' },
      { path: 'logo.png', reason: 'unsupported' },
      { path: 'huge.md', reason: 'too-large' }
    ])
    expect(result.truncated).toBe(false)
  })

  it('凭据文件一律不索引', () => {
    const result = selectSourceFiles([
      { path: '.env', size: 20 },
      { path: 'config/.env.production', size: 20 },
      { path: 'keys/server.pem', size: 20 },
      { path: '.env.example', size: 20 }
    ], { excludes: [] })
    // .env.example 不算凭据（不是 secret），但它没有可识别的正文扩展名，按不支持处理
    expect(result.skipped.map((item) => item.reason)).toEqual(['secret', 'secret', 'secret', 'unsupported'])
    expect(result.candidates).toEqual([])
  })

  it('反斜杠路径归一化后再判定', () => {
    const result = selectSourceFiles([{ path: 'node_modules\\pkg\\readme.md', size: 10 }])
    expect(result.skipped[0]).toEqual({ path: 'node_modules/pkg/readme.md', reason: 'excluded' })
  })

  it('超过文件数上限时截断并如实标记', () => {
    const entries = Array.from({ length: 5 }, (_, index) => ({ path: `doc-${index}.md`, size: 10 }))
    const result = selectSourceFiles(entries, { maxFiles: 3 })
    expect(result.candidates).toHaveLength(3)
    expect(result.truncated).toBe(true)
  })
})

describe('summarizeSkipped', () => {
  it('按原因分组计数，空组不出现', () => {
    expect(summarizeSkipped([
      { path: 'a.png', reason: 'unsupported' },
      { path: 'b.png', reason: 'unsupported' },
      { path: '.env', reason: 'secret' }
    ])).toEqual([
      { reason: 'unsupported', label: '格式暂不支持', count: 2 },
      { reason: 'secret', label: '疑似凭据文件，未索引', count: 1 }
    ])
  })
})
