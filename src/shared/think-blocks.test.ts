import { describe, expect, it } from 'vitest'
import { stripThinkBlocks } from './think-blocks'

describe('stripThinkBlocks', () => {
  it('没有标签时原样返回', () => {
    expect(stripThinkBlocks('普通回答')).toBe('普通回答')
  })

  it('剥掉成对的 think 块', () => {
    expect(stripThinkBlocks('<think>推理过程</think>最终回答')).toBe('最终回答')
    expect(stripThinkBlocks('<thinking>推理</thinking>\n答案')).toBe('答案')
  })

  it('跨行与多块都能剥', () => {
    expect(stripThinkBlocks('<think>第一\n第二</think>甲<think>再想</think>乙')).toBe('甲乙')
  })

  it('没闭合的标签保留，不吞内容', () => {
    expect(stripThinkBlocks('答案<think>还没写完')).toBe('答案<think>还没写完')
  })

  it('整段都是思考时返回空串，供调用方判定无内容', () => {
    expect(stripThinkBlocks('<think>只想没答</think>')).toBe('')
  })
})
