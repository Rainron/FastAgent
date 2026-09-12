import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Check } from 'lucide-react'
import type { ApprovalDecision, ApprovalRequest, QuestionItem } from '../../shared/types'

/**
 * Agent 提问弹窗：问题类型（单选/多选/文本/长文本）按 schema 自动匹配，
 * 结构化选项解析后分别渲染，界面层不允许出现 JSON 序列化文本。
 */

interface NormalizedOption {
  /** 提交给模型的答案文本；内置选项取 title，其他项用哨兵值 */
  value: string
  title: string
  description?: string
  recommended?: boolean
}

/** 「其他」选项在 selected 里的哨兵值；真实答案是 textarea 里的自填文本 */
const OTHER_VALUE = '__other__'

interface QuestionDraft {
  selected: string[]
  custom: boolean
  text: string
}

const emptyDraft = (): QuestionDraft => ({ selected: [], custom: false, text: '' })

// 草稿按问题 id 存到模块级：Agent 重试会换一个 request 重新挂载组件，已填写内容不能跟着丢
const draftStore = new Map<string, QuestionDraft>()

function normalizeOptions(item: QuestionItem): NormalizedOption[] {
  return (item.options ?? []).map((option) =>
    typeof option === 'string'
      ? { value: option, title: option }
      : { value: option.title, title: option.title, description: option.description, recommended: option.recommended }
  )
}

function questionType(item: QuestionItem): 'single-select' | 'multi-select' | 'text' | 'textarea' {
  if (item.type) return item.type
  return item.options?.length ? 'single-select' : 'text'
}

function isRequired(item: QuestionItem): boolean {
  return item.required !== false
}

function draftHasContent(draft: QuestionDraft): boolean {
  return draft.selected.length > 0 || draft.text.trim().length > 0
}

function draftAnswered(item: QuestionItem, draft: QuestionDraft): boolean {
  const type = questionType(item)
  if (type === 'text' || type === 'textarea') return draft.text.trim().length > 0
  if (draft.selected.length === 0) return false
  // 选了「其他」但没填内容不算完成
  if (draft.selected.includes(OTHER_VALUE) && !draft.text.trim()) return false
  return true
}

function draftToAnswer(item: QuestionItem, draft: QuestionDraft): string {
  const type = questionType(item)
  if (type === 'text' || type === 'textarea') return draft.text.trim()
  const parts = draft.selected.filter((value) => value !== OTHER_VALUE)
  const custom = draft.selected.includes(OTHER_VALUE) ? draft.text.trim() : ''
  return [...parts, custom].filter(Boolean).join(', ')
}

function effectiveDraft(item: QuestionItem): QuestionDraft {
  // 升级前的旧会话只存过纯文本答案，能还原就还原，避免重试时丢已有输入
  const stored = draftStore.get(item.id)
  if (stored) return stored
  return emptyDraft()
}

export function QuestionDialog({ request, questions, onRespond }: {
  request: ApprovalRequest
  questions: QuestionItem[]
  onRespond: (decision: ApprovalDecision, answer?: string) => void
}) {
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>(() => Object.fromEntries(questions.map((item) => [item.id, effectiveDraft(item)])))
  const [submitting, setSubmitting] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const optionRefs = useRef<Record<string, HTMLElement | null>>({})

  useEffect(() => {
    // Agent 重试可能带着相同问题再来一次：合并模块级草稿，不清空已填写内容
    setDrafts(Object.fromEntries(questions.map((item) => [item.id, effectiveDraft(item)])))
  }, [questions])

  const updateDraft = useCallback((id: string, next: QuestionDraft) => {
    draftStore.set(id, next)
    setDrafts((current) => ({ ...current, [id]: next }))
  }, [])

  const requiredItems = useMemo(() => questions.filter(isRequired), [questions])
  const answeredRequired = requiredItems.filter((item) => draftAnswered(item, drafts[item.id] ?? emptyDraft())).length
  const missingRequired = requiredItems.length - answeredRequired
  const allAnswered = missingRequired === 0
  const hasAnyContent = questions.some((item) => draftHasContent(drafts[item.id] ?? emptyDraft()))

  const submit = useCallback(() => {
    if (!allAnswered || submitting) return
    setSubmitting(true)
    const payload = questions
      .filter((item) => draftAnswered(item, drafts[item.id] ?? emptyDraft()))
      .map((item) => ({ id: item.id, answer: draftToAnswer(item, drafts[item.id] ?? emptyDraft()) }))
    for (const item of questions) draftStore.delete(item.id)
    onRespond('once', JSON.stringify(payload))
  }, [allAnswered, drafts, onRespond, questions, submitting])

  const requestDiscard = useCallback(() => {
    if (hasAnyContent) setConfirmDiscard(true)
    else onRespond('reject')
  }, [hasAnyContent, onRespond])

  // 打开后自动聚焦第一个未回答的问题
  useEffect(() => {
    const firstUnanswered = questions.find((item) => !draftAnswered(item, drafts[item.id] ?? emptyDraft())) ?? questions[0]
    if (!firstUnanswered) return
    const type = questionType(firstUnanswered)
    const timer = window.setTimeout(() => {
      if (type === 'text') {
        optionRefs.current[`${firstUnanswered.id}:input`]?.focus()
      } else if (type === 'textarea') {
        optionRefs.current[`${firstUnanswered.id}:textarea`]?.focus()
      } else {
        optionRefs.current[`${firstUnanswered.id}:0`]?.focus()
      }
    }, 30)
    return () => window.clearTimeout(timer)
    // 只在挂载时定位一次，避免用户操作焦点后被抢回；依赖里故意见questions/drafts
  }, [])

  // 键盘交互：Enter 提交（textarea 内用 Ctrl/Cmd+Enter），Esc 触发放弃确认
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (confirmDiscard) onRespond('reject')
        else requestDiscard()
        return
      }
      if (event.key !== 'Enter' || event.isComposing) return
      const inTextarea = event.target instanceof HTMLTextAreaElement
      if (inTextarea) {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault()
          submit()
        }
        return
      }
      event.preventDefault()
      submit()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmDiscard, onRespond, requestDiscard, submit])

  // 选项列表 ↑ ↓ 在选项之间移动焦点；单选时方向键直接切换选中项（经典 radio 行为）
  const handleOptionKeyDown = (item: QuestionItem, type: 'single-select' | 'multi-select', index: number, event: ReactKeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const options = normalizeOptions(item)
    const total = options.length + 1
    const step = event.key === 'ArrowDown' ? 1 : -1
    const next = (index + step + total) % total
    if (type === 'single-select') {
      const option = options[next]
      updateDraft(item.id, { selected: option ? [option.value] : [OTHER_VALUE], custom: !option, text: '' })
    }
    optionRefs.current[`${item.id}:${next}`]?.focus()
  }

  const renderSelectQuestion = (item: QuestionItem, type: 'single-select' | 'multi-select') => {
    const draft = drafts[item.id] ?? emptyDraft()
    const options = normalizeOptions(item)
    const multi = type === 'multi-select'
    return <>
      <div className="question-options" role={multi ? 'group' : 'radiogroup'} aria-label={item.title}>
        {options.map((option, index) => {
          const checked = draft.selected.includes(option.value)
          return <button
            key={option.value}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={checked}
            className={`question-option${checked ? ' selected' : ''}`}
            ref={(node) => { optionRefs.current[`${item.id}:${index}`] = node }}
            onKeyDown={(event) => handleOptionKeyDown(item, type, index, event)}
            onClick={() => {
              if (multi) {
                const next = checked ? draft.selected.filter((value) => value !== option.value) : [...draft.selected, option.value]
                updateDraft(item.id, { ...draft, selected: next })
              } else {
                updateDraft(item.id, { ...draft, selected: [option.value] })
              }
            }}
          >
            <span className={`question-marker ${multi ? 'checkbox' : 'radio'}${checked ? ' checked' : ''}`} aria-hidden="true">
              {checked && (multi ? <Check size={11} strokeWidth={3} /> : <span className="question-marker-dot" />)}
            </span>
            <span className="question-option-body">
              <span className="question-option-title">
                {option.title}
                {option.recommended && <em className="question-option-recommended">推荐</em>}
              </span>
              {option.description && <span className="question-option-desc">{option.description}</span>}
            </span>
          </button>
        })}
        <button
          type="button"
          role={multi ? 'checkbox' : 'radio'}
          aria-checked={draft.custom}
          className={`question-option${draft.custom ? ' selected' : ''}`}
          ref={(node) => { optionRefs.current[`${item.id}:${options.length}`] = node }}
          onKeyDown={(event) => handleOptionKeyDown(item, type, options.length, event)}
          onClick={() => updateDraft(item.id, draft.custom ? { ...draft, selected: draft.selected.filter((value) => value !== OTHER_VALUE), custom: false } : { ...draft, selected: [...draft.selected.filter((value) => value !== OTHER_VALUE), OTHER_VALUE], custom: true })}
        >
          <span className={`question-marker ${multi ? 'checkbox' : 'radio'}${draft.custom ? ' checked' : ''}`} aria-hidden="true">
            {draft.custom && (multi ? <Check size={11} strokeWidth={3} /> : <span className="question-marker-dot" />)}
          </span>
          <span className="question-option-body">
            <span className="question-option-title">其他</span>
            <span className="question-option-desc">选项都不合适时自行说明</span>
          </span>
        </button>
      </div>
      {draft.custom && <textarea
        className="question-other-editor"
        placeholder="输入你的要求…"
        rows={2}
        value={draft.text}
        ref={(node) => { optionRefs.current[`${item.id}:textarea`] = node }}
        onChange={(event) => updateDraft(item.id, { ...draft, text: event.target.value })}
      />}
    </>
  }

  return <div className="approval-overlay" role="dialog" aria-modal="true" aria-label="Agent 需要你的确认">
    <div className="question-dialog">
      <header className="question-header">
        <div className="question-header-top">
          <strong>Agent 需要你的确认</strong>
          <span className="question-status"><span className="question-status-dot" />Agent 等待回答</span>
        </div>
        <p>回答以下问题后，Agent 将继续执行任务</p>
        {request.cwd && <code className="question-cwd">{request.cwd}</code>}
      </header>

      <div className="question-body">
        {questions.map((item, index) => {
          const type = questionType(item)
          const draft = drafts[item.id] ?? emptyDraft()
          return <section className="question-item" key={item.id}>
            <div className="question-item-heading">
              <span className="question-index">{String(index + 1).padStart(2, '0')}</span>
              <strong className="question-title">{item.title || `问题 ${item.id}`}</strong>
              <span className={`question-required${isRequired(item) ? '' : ' optional'}`}>{isRequired(item) ? '必选' : '可选'}</span>
            </div>
            {item.question && <p className="question-desc">{item.question}</p>}
            {(type === 'single-select' || type === 'multi-select') && renderSelectQuestion(item, type)}
            {type === 'text' && <input
              className="question-input"
              placeholder="输入回答…"
              value={draft.text}
              ref={(node) => { optionRefs.current[`${item.id}:input`] = node }}
              onChange={(event) => updateDraft(item.id, { ...draft, text: event.target.value })}
            />}
            {type === 'textarea' && <textarea
              className="question-textarea"
              placeholder="输入回答…"
              rows={3}
              value={draft.text}
              ref={(node) => { optionRefs.current[`${item.id}:textarea`] = node }}
              onChange={(event) => updateDraft(item.id, { ...draft, text: event.target.value })}
            />}
          </section>
        })}
      </div>

      {confirmDiscard && <div className="question-discard">
        <span>已填写的内容将被放弃，确定关闭吗？</span>
        <div>
          <button className="question-secondary" onClick={() => setConfirmDiscard(false)}>继续填写</button>
          <button className="question-danger" onClick={() => onRespond('reject')}>放弃并关闭</button>
        </div>
      </div>}

      <footer className="question-footer">
        <div className="question-progress">
          <span>已完成 {answeredRequired} / {requiredItems.length} 个必选项</span>
          {!allAnswered && <em className="question-progress-hint">还需回答 {missingRequired} 个必选问题</em>}
        </div>
        <div className="question-actions">
          <button className="question-secondary" onClick={() => (hasAnyContent ? setConfirmDiscard(true) : onRespond('reject'))}>取消</button>
          <button className="question-primary" disabled={!allAnswered || submitting} onClick={submit}>提交并继续</button>
        </div>
      </footer>
    </div>
  </div>
}
