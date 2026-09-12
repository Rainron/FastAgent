import { describe, expect, it } from 'vitest'
import { createInlineThinkStream, createThinkTagSplitter } from './think-tags'

describe('createThinkTagSplitter', () => {
  it('无标签时原样当正文', () => {
    const splitter = createThinkTagSplitter()
    expect(splitter.push('普通回答')).toEqual([{ kind: 'text', text: '普通回答' }])
    expect(splitter.inThinking).toBe(false)
  })

  it('按出现顺序切开正文与思考', () => {
    const splitter = createThinkTagSplitter()
    expect(splitter.push('前言<think>推理</think>结论')).toEqual([
      { kind: 'text', text: '前言' },
      { kind: 'thinking', text: '推理' },
      { kind: 'text', text: '结论' }
    ])
    expect(splitter.inThinking).toBe(false)
  })

  it('标签被切在块边界上时不放出半截标签', () => {
    const splitter = createThinkTagSplitter()
    expect(splitter.push('答案<thin')).toEqual([{ kind: 'text', text: '答案' }])
    expect(splitter.push('k>推理')).toEqual([{ kind: 'thinking', text: '推理' }])
    expect(splitter.inThinking).toBe(true)
    expect(splitter.push('还在推理</think>收尾')).toEqual([
      { kind: 'thinking', text: '还在推理' },
      { kind: 'text', text: '收尾' }
    ])
  })

  it('<thinking> 长标签同样识别', () => {
    const splitter = createThinkTagSplitter()
    expect(splitter.push('<thinking>推理</thinking>答案')).toEqual([
      { kind: 'thinking', text: '推理' },
      { kind: 'text', text: '答案' }
    ])
  })

  it('思考跨多块时保持在思考通道里', () => {
    const splitter = createThinkTagSplitter()
    splitter.push('<think>第一段')
    expect(splitter.push('第二段')).toEqual([{ kind: 'thinking', text: '第二段' }])
    expect(splitter.inThinking).toBe(true)
  })

  it('没等到闭合标签时 flush 把残留吐出来', () => {
    const splitter = createThinkTagSplitter()
    splitter.push('回答<thin')
    expect(splitter.flush()).toEqual([{ kind: 'text', text: '<thin' }])
  })

  it('普通尖括号不当标签', () => {
    const splitter = createThinkTagSplitter()
    expect(splitter.push('a < b 且 <div>x</div>')).toEqual([{ kind: 'text', text: 'a < b 且 <div>x</div>' }])
  })

  it('思考里出现的嵌套开标签按普通文本处理', () => {
    const splitter = createThinkTagSplitter()
    expect(splitter.push('<think>先<think>后</think>尾')).toEqual([
      { kind: 'thinking', text: '先<think>后' },
      { kind: 'text', text: '尾' }
    ])
  })
})

describe('createInlineThinkStream', () => {
  it('一段思考只开一次：起止跟标签走，不跟调用方的 thinkingActive 走', () => {
    const stream = createInlineThinkStream()
    // 每块 text_delta 之后调用方的 thinkingActive 都被原生映射复位成 false，
    // 这里必须仍然只有开头那一个 thinking_started。
    expect(stream.push('<think>第一块', false)).toEqual([
      { type: 'thinking_started' },
      { type: 'thinking', text: '第一块' }
    ])
    expect(stream.push('第二块', false)).toEqual([{ type: 'thinking', text: '第二块' }])
    expect(stream.push('第三块', false)).toEqual([{ type: 'thinking', text: '第三块' }])
    expect(stream.inThinking).toBe(true)
    expect(stream.push('</think>答案', false)).toEqual([
      { type: 'thinking_ended' },
      { type: 'token', text: '答案' }
    ])
    expect(stream.inThinking).toBe(false)
  })

  it('原生思考通道已开着时不重复发 thinking_started', () => {
    const stream = createInlineThinkStream()
    expect(stream.push('<think>推理', true)).toEqual([{ type: 'thinking', text: '推理' }])
  })

  it('无标签的正文原样当 token', () => {
    const stream = createInlineThinkStream()
    expect(stream.push('普通回答', false)).toEqual([{ type: 'token', text: '普通回答' }])
    expect(stream.flush(false)).toEqual([])
  })

  it('流结束时把没闭合的思考收掉', () => {
    const stream = createInlineThinkStream()
    stream.push('<think>没写完', false)
    expect(stream.flush(true)).toEqual([{ type: 'thinking_ended' }])
    expect(stream.inThinking).toBe(false)
  })

  it('标签被切在块边界上时不发多余事件', () => {
    const stream = createInlineThinkStream()
    expect(stream.push('答案<thin', false)).toEqual([{ type: 'token', text: '答案' }])
    expect(stream.push('k>推理', false)).toEqual([
      { type: 'thinking_started' },
      { type: 'thinking', text: '推理' }
    ])
  })
})
