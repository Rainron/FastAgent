import { describe, expect, it } from 'vitest'
import type { QuestionItem } from '../../shared/types'
import { isFallbackOption, needsBuiltinOther, normalizeOptions, shouldClampDescription } from './question-options'

const item = (options: QuestionItem['options']): QuestionItem => ({ id: 'q1', title: '标题', question: '说明', options })

describe('normalizeOptions', () => {
  it('字符串与对象两种写法都归一成同一形态', () => {
    expect(normalizeOptions(item(['A', { title: 'B', description: '说明', recommended: true }]))).toEqual([
      { value: 'A', title: 'A' },
      { value: 'B', title: 'B', description: '说明', recommended: true }
    ])
  })

  it('没有选项时返回空数组', () => {
    expect(normalizeOptions(item(undefined))).toEqual([])
  })
})

describe('isFallbackOption', () => {
  it('识别模型自写的兜底项，含编号前缀', () => {
    for (const title of ['其他', '其它', 'D. 其他', 'd) 其他', '- 其他', 'Other', 'none of the above', '以上都不是', '都不合适。']) {
      expect(isFallbackOption(title)).toBe(true)
    }
  })

  it('正经选项不会被误判成兜底项', () => {
    for (const title of ['其他方案：改用 Redis', 'A. 测试服务器当唯一环境', 'Otherwise keep polling', '其他人负责部署']) {
      expect(isFallbackOption(title)).toBe(false)
    }
  })
})

describe('needsBuiltinOther', () => {
  it('模型已给兜底项时不再补内置「其他」', () => {
    expect(needsBuiltinOther(normalizeOptions(item(['A 方案', 'B 方案', 'D. 其他'])))).toBe(false)
  })

  it('没有兜底项时仍要补，用户得有地方自己写', () => {
    expect(needsBuiltinOther(normalizeOptions(item(['A 方案', 'B 方案'])))).toBe(true)
    expect(needsBuiltinOther([])).toBe(true)
  })
})

describe('shouldClampDescription', () => {
  it('短说明不折叠', () => {
    expect(shouldClampDescription('选一个环境')).toBe(false)
    expect(shouldClampDescription(undefined)).toBe(false)
  })

  it('整段背景塞进 question 时折叠', () => {
    expect(shouldClampDescription('长'.repeat(400))).toBe(true)
  })
})
