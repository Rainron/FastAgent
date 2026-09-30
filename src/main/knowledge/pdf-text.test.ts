import { describe, expect, it } from 'vitest'
import { joinTextItems } from './pdf-text'

describe('joinTextItems', () => {
  it('同一行的文本项直接拼接，hasEOL 处换行', () => {
    const text = joinTextItems([
      { str: 'Fast', transform: [1, 0, 0, 1, 0, 700] },
      { str: 'Agent', transform: [1, 0, 0, 1, 40, 700], hasEOL: true },
      { str: '第二行', transform: [1, 0, 0, 1, 0, 680] }
    ])
    expect(text).toBe('FastAgent\n第二行')
  })

  it('纵坐标跳变时也断行：有的 PDF 不给 hasEOL', () => {
    const text = joinTextItems([
      { str: '标题', transform: [1, 0, 0, 1, 0, 700] },
      { str: '正文', transform: [1, 0, 0, 1, 0, 660] }
    ])
    expect(text).toBe('标题\n正文')
  })

  it('同一行内的微小纵坐标抖动不算换行', () => {
    const text = joinTextItems([
      { str: 'a', transform: [1, 0, 0, 1, 0, 700] },
      { str: 'b', transform: [1, 0, 0, 1, 10, 700.4] }
    ])
    expect(text).toBe('ab')
  })

  it('空文本层返回空串，调用方据此报「无可提取文本」', () => {
    expect(joinTextItems([])).toBe('')
  })
})
