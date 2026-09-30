import { describe, expect, it } from 'vitest'
import { chunkContent, chunkMarkdown, chunkPlainText, chunkTitle, lineLocator, pageLocator } from './chunk-text'

describe('chunkMarkdown', () => {
  it('按标题切段并保留标题链与行号', () => {
    const content = ['# 架构', '总览一句话。', '', '## 主进程', 'Electron 主进程说明。'].join('\n')
    const chunks = chunkMarkdown(content, { minChars: 0 })
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatchObject({ title: '架构', startLine: 1, endLine: 3 })
    expect(chunks[1]).toMatchObject({ title: '架构 › 主进程', startLine: 4, endLine: 5 })
  })

  it('同级标题替换而非叠加标题链', () => {
    const content = ['## 甲', 'a', '## 乙', 'b'].join('\n')
    expect(chunkMarkdown(content, { minChars: 0 }).map((chunk) => chunk.title)).toEqual(['甲', '乙'])
  })

  it('围栏代码块里的 # 不当成标题', () => {
    const content = ['# 标题', '```sh', '# 这是注释', 'ls', '```', '正文'].join('\n')
    const chunks = chunkMarkdown(content, { minChars: 0 })
    expect(chunks).toHaveLength(1)
    expect(chunks[0].endLine).toBe(6)
  })

  it('超预算的段落继续切，优先断在空行', () => {
    const paragraph = 'x'.repeat(50)
    const content = ['# 长文', paragraph, '', paragraph, '', paragraph].join('\n')
    const chunks = chunkMarkdown(content, { maxChars: 80, minChars: 0 })
    expect(chunks.length).toBeGreaterThan(1)
    // 行号必须连续且不重叠，否则引用定位会指错位置。
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index].startLine).toBe(chunks[index - 1].endLine + 1)
    }
    expect(chunks.every((chunk) => chunk.title === '长文')).toBe(true)
  })

  it('过短的尾块并回上一块', () => {
    const content = ['# 标题', 'a'.repeat(200), '', '短'].join('\n')
    const chunks = chunkMarkdown(content, { maxChars: 210, minChars: 100 })
    expect(chunks).toHaveLength(1)
    expect(chunks[0].endLine).toBe(4)
  })

  it('空内容不产出块', () => {
    expect(chunkMarkdown('   \n\n  ')).toEqual([])
  })
})

describe('chunkPlainText', () => {
  it('无标题时块标题为空，行号从 1 起算', () => {
    const chunks = chunkPlainText('第一行\n第二行')
    expect(chunks).toEqual([{ title: '', text: '第一行\n第二行', startLine: 1, endLine: 2 }])
  })

  it('CRLF 与 CR 换行都按行切', () => {
    expect(chunkPlainText('a\r\nb\rc')[0].endLine).toBe(3)
  })
})

describe('定位串', () => {
  it('单行与多行格式不同', () => {
    expect(lineLocator({ startLine: 7, endLine: 7 })).toBe('L7')
    expect(lineLocator({ startLine: 7, endLine: 20 })).toBe('L7-20')
  })

  it('PDF 用页码', () => {
    expect(pageLocator(3)).toBe('p.3')
  })
})

describe('chunkTitle', () => {
  it('有标题链时用标题链，否则回退到文件名加行区间', () => {
    expect(chunkTitle('ARCHITECTURE.md', { title: '架构 › 主进程', text: 'x', startLine: 1, endLine: 2 })).toBe('ARCHITECTURE.md › 架构 › 主进程')
    expect(chunkTitle('notes.txt', { title: '', text: 'x', startLine: 1, endLine: 2 })).toBe('notes.txt · L1-2')
  })
})

describe('chunkContent', () => {
  it('按 kind 分派', () => {
    expect(chunkContent('# 标题\n正文', 'markdown', { minChars: 0 })[0].title).toBe('标题')
    expect(chunkContent('# 标题\n正文', 'text', { minChars: 0 })[0].title).toBe('')
  })
})
