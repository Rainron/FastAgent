import type { QuestionItem } from '../../shared/types'

/** 「其他」选项在 selected 里的哨兵值；真实答案是 textarea 里的自填文本。 */
export const OTHER_VALUE = '__other__'

export interface NormalizedOption {
  /** 提交给模型的答案文本；内置选项取 title，其他项用哨兵值 */
  value: string
  title: string
  description?: string
  recommended?: boolean
}

export function normalizeOptions(item: QuestionItem): NormalizedOption[] {
  return (item.options ?? []).map((option) =>
    typeof option === 'string'
      ? { value: option, title: option }
      : { value: option.title, title: option.title, description: option.description, recommended: option.recommended }
  )
}

/**
 * 模型自己给的「其他 / Other / 都不是」这类兜底项。
 * 识别出来后就不再追加内置的「其他」，否则弹窗里会并排出现两个语义相同的选项（见模型常写的 `D. 其他`）。
 * 只认整项就是兜底的写法，避免把「其他方案：改用 Redis」这种正经选项误判掉。
 */
export function isFallbackOption(title: string): boolean {
  const text = title.trim()
    // 模型习惯给选项编号：A. / 1) / - 都先剥掉再判断
    .replace(/^[-*]\s*/, '')
    .replace(/^[A-Za-z0-9]{1,2}\s*[.、)）:：]\s*/, '')
    .replace(/[。.！!]+$/, '')
    .trim()
  return /^(其他|其它|都不是|都不合适|以上都不是|以上都不合适|other|others|none|none of the above|something else)$/i.test(text)
}

/** 模型已经给了兜底项时不再补内置项。 */
export function needsBuiltinOther(options: NormalizedOption[]): boolean {
  return !options.some((option) => isFallbackOption(option.title))
}

/** 描述超过这个长度就先折起来：模型经常把整段背景塞进 question，撑开后选项会被挤出屏幕。 */
export const QUESTION_DESC_CLAMP = 220

export function shouldClampDescription(text: string | undefined): boolean {
  return (text?.length ?? 0) > QUESTION_DESC_CLAMP
}
