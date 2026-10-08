import type { QuestionItem, QuestionType } from '../../shared/types'
import { OTHER_VALUE, normalizeOptions } from './question-options'

/**
 * 问题弹窗的草稿状态机与视图派生逻辑。
 * 组件里只留交互编排，能纯函数判定的部分全部放这里（node 环境可测）。
 */

/** 一道题的填写草稿：选择型记录选中值（内置「其他」用哨兵），文本型记 text */
export interface QuestionDraft {
  selected: string[]
  custom: boolean
  text: string
}

export const emptyDraft = (): QuestionDraft => ({ selected: [], custom: false, text: '' })

export function questionType(item: QuestionItem): QuestionType {
  if (item.type) return item.type
  return item.options?.length ? 'single-select' : 'text'
}

export function isSelectType(type: QuestionType): boolean {
  return type === 'single-select' || type === 'multi-select'
}

export function isRequired(item: QuestionItem): boolean {
  return item.required !== false
}

/** 交互类型标签：单选/多选必须明示，不能让用户靠控件形状猜 */
export function typeLabel(type: QuestionType): string {
  switch (type) {
    case 'single-select': return '单选'
    case 'multi-select': return '多选'
    case 'textarea': return '长文本'
    default: return '文本'
  }
}

export function draftHasContent(draft: QuestionDraft): boolean {
  return draft.selected.length > 0 || draft.text.trim().length > 0
}

export function draftAnswered(item: QuestionItem, draft: QuestionDraft): boolean {
  const type = questionType(item)
  if (!isSelectType(type)) return draft.text.trim().length > 0
  if (draft.selected.length === 0) return false
  // 选了「其他」但没填内容不算完成
  if (draft.selected.includes(OTHER_VALUE) && !draft.text.trim()) return false
  return true
}

export function draftToAnswer(item: QuestionItem, draft: QuestionDraft): string {
  const type = questionType(item)
  if (!isSelectType(type)) return draft.text.trim()
  const parts = draft.selected.filter((value) => value !== OTHER_VALUE)
  const custom = draft.selected.includes(OTHER_VALUE) ? draft.text.trim() : ''
  return [...parts, custom].filter(Boolean).join(', ')
}

/**
 * 摘要面板里每题展示的「当前选择」。用选项 title 而不是 value 拼接，
 * 内置「其他」换成自填文本。未完成的题返回 null，由视图层显示「待选择」。
 */
export function draftSummary(item: QuestionItem, draft: QuestionDraft): string | null {
  if (!draftAnswered(item, draft)) return null
  const type = questionType(item)
  if (!isSelectType(type)) return draft.text.trim()
  const titles = normalizeOptions(item)
    .filter((option) => draft.selected.includes(option.value))
    .map((option) => option.title)
  const custom = draft.selected.includes(OTHER_VALUE) ? draft.text.trim() : ''
  return [...titles, custom].filter(Boolean).join('、')
}

/** 左侧导航节点状态：error 是提交被拦下时对未完成必选题的提示态 */
export type QuestionNavStatus = 'pending' | 'done' | 'error'

export function navStatus(item: QuestionItem, draft: QuestionDraft, errorIds: ReadonlySet<string>): QuestionNavStatus {
  if (errorIds.has(item.id)) return 'error'
  return draftAnswered(item, draft) ? 'done' : 'pending'
}
