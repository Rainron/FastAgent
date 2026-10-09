import { describe, expect, it } from 'vitest'
import { excerptLines, previewUnavailable } from './tool-read-excerpt'

describe('excerptLines', () => {
  it('行数不超上限时原样返回', () => {
    expect(excerptLines('a\nb\nc', 20)).toEqual({ body: 'a\nb\nc', remaining: 0 })
  })

  it('超出上限时截到前 N 行并报出剩余行数', () => {
    const text = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n')
    const result = excerptLines(text, 20)
    expect(result.body.split('\n')).toHaveLength(20)
    expect(result.body.endsWith('line 20')).toBe(true)
    expect(result.remaining).toBe(10)
  })

  it('空内容不产出假的剩余行数', () => {
    expect(excerptLines('', 20)).toEqual({ body: '', remaining: 0 })
  })

  it('上限为 0 时不显示正文，但仍报出总行数', () => {
    expect(excerptLines('a\nb', 0)).toEqual({ body: '', remaining: 2 })
  })
})

describe('previewUnavailable', () => {
  it('越界报错翻成说明，剥掉 IPC 前缀', () => {
    expect(previewUnavailable(new Error("Error invoking remote method 'workspace:read-file': Error: 只能打开工作区内的文件"))).toBe('文件不在当前工作区内，无法预览')
    expect(previewUnavailable(new Error('尚未打开工作区'))).toBe('没有打开工作区，无法预览')
  })

  it('其他错误保留原文，非 Error 给通用说明', () => {
    expect(previewUnavailable(new Error('文件过大'))).toBe('无法预览：文件过大')
    expect(previewUnavailable('x')).toBe('无法预览这个文件')
  })
})
