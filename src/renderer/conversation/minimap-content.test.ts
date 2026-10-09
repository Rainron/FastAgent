import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../shared/types'
import { activityBlocks, minimapPreviewText, parseMinimapBlocks } from './minimap-content'

describe('parseMinimapBlocks', () => {
  it('空行分段，连续行并进同一段', () => {
    expect(parseMinimapBlocks('第一段第一行\n第一段第二行\n\n第二段')).toEqual([
      { kind: 'paragraph', text: '第一段第一行\n第一段第二行' },
      { kind: 'paragraph', text: '第二段' }
    ])
  })

  it('标题独立成块并去掉井号', () => {
    expect(parseMinimapBlocks('## 小标题\n正文')).toEqual([
      { kind: 'heading', text: '小标题' },
      { kind: 'paragraph', text: '正文' }
    ])
  })

  it('连续列表项合成一块，有序无序都认', () => {
    expect(parseMinimapBlocks('- a\n* b\n1. c')).toEqual([{ kind: 'list', text: '- a\n* b\n1. c' }])
  })

  it('围栏代码块保留原始行，围栏本身不进内容', () => {
    expect(parseMinimapBlocks('说明\n```ts\nconst a = 1\n\nconst b = 2\n```\n收尾')).toEqual([
      { kind: 'paragraph', text: '说明' },
      { kind: 'code', text: 'const a = 1\n\nconst b = 2' },
      { kind: 'paragraph', text: '收尾' }
    ])
  })

  it('代码块内的空行不切段、井号不当标题', () => {
    expect(parseMinimapBlocks('```\n# 这是注释\n\nrun\n```')).toEqual([{ kind: 'code', text: '# 这是注释\n\nrun' }])
  })

  it('引用去掉前缀单独成块', () => {
    expect(parseMinimapBlocks('> 引用内容')).toEqual([{ kind: 'quote', text: '引用内容' }])
  })

  it('块数与单块字符都按上限截断', () => {
    const many = Array.from({ length: 50 }, (_, index) => `段${index}`).join('\n\n')
    expect(parseMinimapBlocks(many, { maxBlocks: 3, maxChars: 400 })).toHaveLength(3)
    expect(parseMinimapBlocks('x'.repeat(100), { maxBlocks: 24, maxChars: 10 })[0].text).toHaveLength(10)
  })

  it('空文本不产出块', () => {
    expect(parseMinimapBlocks('')).toEqual([])
    expect(parseMinimapBlocks('   \n\n  ')).toEqual([])
  })
})

describe('activityBlocks', () => {
  const event = (tool: string, detail?: string): AgentEvent => ({ runId: 'r', type: 'tool_started', tool, detail })

  it('只取工具调用，拼成一块代码样式的纹理', () => {
    const events = [event('bash', 'npm test'), { runId: 'r', type: 'token', text: 'x' } as AgentEvent, event('read')]
    expect(activityBlocks(events)).toEqual([{ kind: 'code', text: 'bash npm test\nread' }])
  })

  it('detail 只取首行，避免多行输出把缩影撑开', () => {
    expect(activityBlocks([event('bash', '第一行\n第二行')])).toEqual([{ kind: 'code', text: 'bash 第一行' }])
  })

  it('没有工具调用时不产出块', () => {
    expect(activityBlocks([])).toEqual([])
    expect(activityBlocks(undefined)).toEqual([])
    expect(activityBlocks([{ runId: 'r', type: 'token', text: 'x' } as AgentEvent])).toEqual([])
  })
})

describe('minimapPreviewText', () => {
  it('压平空白并用分隔符连接各块', () => {
    expect(minimapPreviewText([{ kind: 'heading', text: '标题' }, { kind: 'paragraph', text: '正文\n换行' }]))
      .toBe('标题 · 正文 换行')
  })

  it('超长时截断并加省略号', () => {
    expect(minimapPreviewText([{ kind: 'paragraph', text: 'x'.repeat(50) }], 10)).toBe(`${'x'.repeat(10)}…`)
  })

  it('无内容时返回空串，调用方据此不弹预览', () => {
    expect(minimapPreviewText([])).toBe('')
  })
})
