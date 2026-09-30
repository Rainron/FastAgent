import { describe, expect, it } from 'vitest'
import { renderKbPrompt } from './memory-prompt'

describe('renderKbPrompt', () => {
  it('empty list gives empty string', () => {
    expect(renderKbPrompt([])).toBe('')
  })
})

  it('flattens entry text', () => {
    const prompt = renderKbPrompt([{ title: '发布流程', content: '先跑测试\n再打包' }])
    expect(prompt).toContain('发布流程: 先跑测试 再打包')
  })

  it('budget drops later entries whole', () => {
    const prompt = renderKbPrompt([{ title: 'one', content: 'a'.repeat(500) }, { title: 'two', content: 'b'.repeat(5000) }], 600)
    expect(prompt).toContain('one')
    expect(prompt).not.toContain('two')
  })

  it('带来源的条目标出文件与定位，供模型引用原文', () => {
    const prompt = renderKbPrompt([{ title: 'guide.md › 部署', content: '先跑测试', sourcePath: 'docs/guide.md', locator: 'L4-9' }])
    expect(prompt).toContain('guide.md › 部署（docs/guide.md L4-9）: 先跑测试')
    expect(prompt).toContain('请一并给出括号里的文件与位置')
  })

  it('手工条目没有来源时不编造定位', () => {
    expect(renderKbPrompt([{ title: '发布流程', content: '先跑测试' }])).toContain('发布流程: 先跑测试')
  })

  it('只有文件没有定位时只标文件', () => {
    expect(renderKbPrompt([{ title: 'a', content: 'x', sourcePath: 'a.md', locator: null }])).toContain('a（a.md）: x')
  })
