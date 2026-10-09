import { describe, expect, it } from 'vitest'
import { thinkingHeadline, thinkingPreview } from './thinking-preview'

describe('thinkingHeadline', () => {
  it('取最后一个独占一行的加粗标题', () => {
    expect(thinkingHeadline('**梳理折叠逻辑**\n先看 trace\n\n**对比终态文案**\n再看 runbar')).toBe('对比终态文案')
  })

  it('认 Markdown 标题与末尾冒号', () => {
    expect(thinkingHeadline('## 定位来源\n内容')).toBe('定位来源')
    expect(thinkingHeadline('**Analyzing layout**:\nbody')).toBe('Analyzing layout')
  })

  it('半截标题与正文里的加粗不算', () => {
    expect(thinkingHeadline('正文里有 **强调** 的词\n**分析')).toBeNull()
  })

  it('超长标题截断', () => {
    expect(thinkingHeadline(`**${'长'.repeat(50)}**`)).toBe(`${'长'.repeat(40)}…`)
  })
})

describe('thinkingPreview', () => {
  it('取最新一句并跳过标题行', () => {
    expect(thinkingPreview('**定位来源**\n先读 ExecutionTrace.tsx\n再对比 runbar\n**下一步**')).toBe('再对比 runbar')
  })

  it('剥列表与加粗记号，保留下划线', () => {
    expect(thinkingPreview('- 检查 **trace_runbar** 的 `status`')).toBe('检查 trace_runbar 的 status')
  })

  it('跳过代码块内容', () => {
    expect(thinkingPreview('看一下实现\n```ts\nconst a = 1\n```')).toBe('看一下实现')
  })

  it('长句只留尾部，空内容返回 null', () => {
    expect(thinkingPreview('字'.repeat(130))).toBe(`…${'字'.repeat(120)}`)
    expect(thinkingPreview('\n  \n')).toBeNull()
  })
})
