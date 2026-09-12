import { describe, expect, it } from 'vitest'
import { diffFilename, diffStats, parseBlocks, parseFenceInfo } from './block-parser'
import type { CodeBlock, DiffBlock, MarkdownBlock } from './blocks'

describe('parseFenceInfo', () => {
  it('只有语言时不猜文件名', () => {
    expect(parseFenceInfo('ts')).toEqual({ language: 'ts', filename: null })
  })

  it('解析 lang:path 写法', () => {
    expect(parseFenceInfo('ts:src/main.ts')).toEqual({ language: 'ts', filename: 'src/main.ts' })
  })

  it('解析 lang path 写法', () => {
    expect(parseFenceInfo('tsx src/App.tsx')).toEqual({ language: 'tsx', filename: 'src/App.tsx' })
  })

  it('解析 title="x" 属性', () => {
    expect(parseFenceInfo('js title="build.js"')).toEqual({ language: 'js', filename: 'build.js' })
  })

  it('只给文件名时从扩展名兜底语言', () => {
    expect(parseFenceInfo('src/main.ts')).toEqual({ language: 'ts', filename: 'src/main.ts' })
  })

  it('twoslash 这类修饰词不当文件名', () => {
    expect(parseFenceInfo('ts twoslash')).toEqual({ language: 'ts', filename: null })
  })
})

describe('parseBlocks', () => {
  it('纯文本产出单个 markdown block', () => {
    const blocks = parseBlocks('# 标题\n\n正文', 'turn-1')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ id: 'turn-1-0', type: 'markdown', status: 'completed' })
  })

  it('围栏代码切成独立 code block，前后文本各自成块', () => {
    const blocks = parseBlocks('前面\n\n```ts\nconst a = 1\n```\n\n后面', 'turn-1')
    expect(blocks.map((block) => block.type)).toEqual(['markdown', 'code', 'markdown'])
    expect((blocks[1] as CodeBlock).code).toBe('const a = 1')
    expect((blocks[1] as CodeBlock).language).toBe('ts')
    expect((blocks[2] as MarkdownBlock).text).toBe('后面')
  })

  it('diff 语言走 DiffBlock 并统计增删', () => {
    const patch = '--- a/src/main.ts\n+++ b/src/main.ts\n-const a = 1\n+const a = 2\n+const b = 3'
    const blocks = parseBlocks('```diff\n' + patch + '\n```', 'turn-1')
    const block = blocks[0] as DiffBlock
    expect(block.type).toBe('diff')
    expect(block.filename).toBe('src/main.ts')
    expect(block.additions).toBe(2)
    expect(block.deletions).toBe(1)
  })

  it('未闭合围栏标记为 streaming，不吞掉已收到的内容', () => {
    const blocks = parseBlocks('说明\n\n```ts\nconst a = ', 'turn-1')
    expect(blocks[1]).toMatchObject({ type: 'code', status: 'streaming' })
    expect((blocks[1] as CodeBlock).code).toBe('const a = ')
  })

  it('流式追加时已完成块的 ID 不变', () => {
    const first = parseBlocks('前面\n\n```ts\nconst a = 1\n```\n\n后', 'turn-1')
    const later = parseBlocks('前面\n\n```ts\nconst a = 1\n```\n\n后面更多内容', 'turn-1')
    expect(later[0].id).toBe(first[0].id)
    expect(later[1].id).toBe(first[1].id)
  })

  it('代码块内的三反引号行只有不短于开启围栏才收尾', () => {
    const blocks = parseBlocks('````md\n```ts\nx\n```\n````', 'turn-1')
    expect(blocks).toHaveLength(1)
    expect((blocks[0] as CodeBlock).code).toBe('```ts\nx\n```')
  })

  it('空文本不产出任何块', () => {
    expect(parseBlocks('', 'turn-1')).toEqual([])
    expect(parseBlocks('   \n\n', 'turn-1')).toEqual([])
  })
})

describe('diff 辅助', () => {
  it('+++/--- 头部不计入增删', () => {
    expect(diffStats('--- a/x\n+++ b/x\n+a\n-b')).toEqual({ additions: 1, deletions: 1 })
  })

  it('从 diff --git 头取文件名', () => {
    expect(diffFilename('diff --git a/src/a.ts b/src/a.ts\n@@')).toBe('src/a.ts')
  })

  it('新建文件时忽略 /dev/null', () => {
    expect(diffFilename('--- /dev/null\n+++ b/src/new.ts')).toBe('src/new.ts')
  })
})
