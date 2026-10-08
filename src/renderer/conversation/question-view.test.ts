import { describe, expect, it } from 'vitest'
import type { QuestionItem } from '../../shared/types'
import { OTHER_VALUE } from './question-options'
import {
  draftAnswered, draftHasContent, draftSummary, draftToAnswer, emptyDraft, isRequired, isSelectType,
  navStatus, questionType, typeLabel, type QuestionDraft
} from './question-view'

const selectItem = (options: QuestionItem['options'], type?: QuestionItem['type']): QuestionItem => ({
  id: 'q1', title: '实施范围', question: '说明', options, type
})

describe('questionType', () => {
  it('显式 type 优先，缺省时按有无 options 推断', () => {
    expect(questionType(selectItem(['A'], 'multi-select'))).toBe('multi-select')
    expect(questionType(selectItem(['A']))).toBe('single-select')
    expect(questionType(selectItem(undefined))).toBe('text')
  })
})

describe('typeLabel', () => {
  it('选择型必须明示单选/多选', () => {
    expect(typeLabel('single-select')).toBe('单选')
    expect(typeLabel('multi-select')).toBe('多选')
    expect(typeLabel('text')).toBe('文本')
    expect(typeLabel('textarea')).toBe('长文本')
  })
})

describe('draftAnswered', () => {
  it('文本型有内容即完成', () => {
    expect(draftAnswered(selectItem(undefined), { ...emptyDraft(), text: '  按 A 方案 ' })).toBe(true)
    expect(draftAnswered(selectItem(undefined), { ...emptyDraft(), text: '   ' })).toBe(false)
  })

  it('选择型选中即完成，但选「其他」没填文本不算', () => {
    expect(draftAnswered(selectItem(['A', 'B']), { ...emptyDraft(), selected: ['A'] })).toBe(true)
    expect(draftAnswered(selectItem(['A', 'B']), { ...emptyDraft(), selected: [OTHER_VALUE], custom: true })).toBe(false)
    expect(draftAnswered(selectItem(['A', 'B']), { ...emptyDraft(), selected: [OTHER_VALUE], custom: true, text: '自定义' })).toBe(true)
  })
})

describe('draftToAnswer', () => {
  it('内置选项按 title 提交，「其他」替换为自填文本', () => {
    const draft: QuestionDraft = { selected: ['A', 'B', OTHER_VALUE], custom: true, text: '先做 A 再评估' }
    expect(draftToAnswer(selectItem(['A', 'B']), draft)).toBe('A, B, 先做 A 再评估')
  })

  it('文本型直接给 trim 后的内容', () => {
    expect(draftToAnswer(selectItem(undefined), { ...emptyDraft(), text: ' 好 ' })).toBe('好')
  })
})

describe('draftSummary', () => {
  it('摘要用选项 title 顿号拼接，自填内容在末尾', () => {
    const draft: QuestionDraft = { selected: ['A 方案', 'B 方案'], custom: false, text: '' }
    expect(draftSummary(selectItem(['A 方案', 'B 方案', 'C 方案']), draft)).toBe('A 方案、B 方案')
  })

  it('选「其他」时摘要展示自填文本', () => {
    const draft: QuestionDraft = { selected: [OTHER_VALUE], custom: true, text: '只做 A 的子集' }
    expect(draftSummary(selectItem(['A', 'B']), draft)).toBe('只做 A 的子集')
  })

  it('未完成的题没有摘要，由视图层显示「待选择」', () => {
    expect(draftSummary(selectItem(['A']), emptyDraft())).toBeNull()
    // 选了「其他」但没填，同样不算完成
    expect(draftSummary(selectItem(['A']), { ...emptyDraft(), selected: [OTHER_VALUE], custom: true })).toBeNull()
  })
})

describe('navStatus', () => {
  const item = selectItem(['A', 'B'])

  it('已答为 done，未答为 pending，error 提示态优先', () => {
    expect(navStatus(item, { ...emptyDraft(), selected: ['A'] }, new Set())).toBe('done')
    expect(navStatus(item, emptyDraft(), new Set())).toBe('pending')
    expect(navStatus(item, emptyDraft(), new Set(['q1']))).toBe('error')
    // 补上答案后即使还在 error 集合里也按完成展示？——不：error 只在未完成时由外层写入，答案补上时外层会移除
    expect(navStatus(item, { ...emptyDraft(), selected: ['A'] }, new Set(['q1']))).toBe('error')
  })
})

describe('isRequired / isSelectType / draftHasContent', () => {
  it('required 默认 true，显式 false 才是可选', () => {
    expect(isRequired({ id: 'a', title: 't', question: '' })).toBe(true)
    expect(isRequired({ id: 'a', title: 't', question: '', required: false })).toBe(false)
  })

  it('isSelectType 只认两种选择型', () => {
    expect(isSelectType('single-select')).toBe(true)
    expect(isSelectType('multi-select')).toBe(true)
    expect(isSelectType('text')).toBe(false)
    expect(isSelectType('textarea')).toBe(false)
  })

  it('有选中或有文本都算「填过」，用于放弃确认的判断', () => {
    expect(draftHasContent({ ...emptyDraft(), selected: ['A'] })).toBe(true)
    expect(draftHasContent({ ...emptyDraft(), text: 'x' })).toBe(true)
    expect(draftHasContent(emptyDraft())).toBe(false)
  })
})
