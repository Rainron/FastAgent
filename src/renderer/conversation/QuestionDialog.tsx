import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AlertTriangle, Check, X } from 'lucide-react'
import type { ApprovalDecision, ApprovalRequest, QuestionItem } from '../../shared/types'
import { OTHER_VALUE, needsBuiltinOther, normalizeOptions } from './question-options'
import {
  draftAnswered, draftHasContent, draftToAnswer, emptyDraft, isRequired, isSelectType, navStatus,
  questionType, typeLabel, type QuestionDraft
} from './question-view'
import { BriefingPanel, DiscardConfirmModal, QuestionDescription } from './QuestionBriefing'

/**
 * Agent 提问弹窗：左侧问题导航 + 中间单问题填写 + 右侧任务说明（默认折叠）。
 * 中间一次只呈现一道题（点导航切换），草稿按问题 id 存在 state 与模块级 store 里，
 * 切换、重试都不丢已填内容。单选/多选以文字标签明示，不让用户靠控件形状猜。
 */

// 草稿按问题 id 存到模块级：Agent 重试会换一个 request 重新挂载组件，已填写内容不能跟着丢
const draftStore = new Map<string, QuestionDraft>()

// 升级前的旧会话只存过纯文本答案，能还原就还原，避免重试时丢已有输入
const effectiveDraft = (item: QuestionItem): QuestionDraft => draftStore.get(item.id) ?? emptyDraft()

export function QuestionDialog({ request, questions, onRespond }: {
  request: ApprovalRequest
  questions: QuestionItem[]
  onRespond: (decision: ApprovalDecision, answer?: string) => void
}) {
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>(() => Object.fromEntries(questions.map((item) => [item.id, effectiveDraft(item)])))
  const [activeId, setActiveId] = useState<string | undefined>(() =>
    (questions.find((item) => !draftAnswered(item, effectiveDraft(item))) ?? questions[0])?.id)
  const [submitting, setSubmitting] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [briefingExpanded, setBriefingExpanded] = useState(false)
  // 提交被必选项拦下时，给未完成的题一个短促的错误提示态（导航上的 !）
  const [errorIds, setErrorIds] = useState<ReadonlySet<string>>(() => new Set())
  const optionRefs = useRef<Record<string, HTMLElement | null>>({})
  const discardCancelRef = useRef<HTMLButtonElement | null>(null)
  const activeItem = questions.find((item) => item.id === activeId) ?? questions[0]

  useEffect(() => {
    // Agent 重试可能带着相同问题再来一次：合并模块级草稿，不清空已填写内容
    setDrafts(Object.fromEntries(questions.map((item) => [item.id, effectiveDraft(item)])))
    setActiveId((current) => (current && questions.some((item) => item.id === current))
      ? current
      : (questions.find((item) => !draftAnswered(item, effectiveDraft(item))) ?? questions[0])?.id)
  }, [questions])

  useEffect(() => {
    if (!errorIds.size) return
    const timer = window.setTimeout(() => setErrorIds(new Set()), 3200)
    return () => window.clearTimeout(timer)
  }, [errorIds])

  const updateDraft = useCallback((id: string, next: QuestionDraft) => {
    draftStore.set(id, next)
    setDrafts((current) => ({ ...current, [id]: next }))
    // 补上答案后即时摘掉该题的错误提示
    setErrorIds((current) => (current.has(id) ? new Set([...current].filter((value) => value !== id)) : current))
  }, [])

  const requiredItems = useMemo(() => questions.filter(isRequired), [questions])
  const answeredRequired = requiredItems.filter((item) => draftAnswered(item, drafts[item.id] ?? emptyDraft())).length
  const missingRequired = requiredItems.length - answeredRequired
  const allAnswered = missingRequired === 0
  const hasAnyContent = questions.some((item) => draftHasContent(drafts[item.id] ?? emptyDraft()))

  // 提交被拦时标出所有未完成必选题，并把用户直接带到第一题
  const flashMissing = useCallback(() => {
    const missing = questions.filter((item) => isRequired(item) && !draftAnswered(item, drafts[item.id] ?? emptyDraft()))
    if (!missing.length) return
    setErrorIds(new Set(missing.map((item) => item.id)))
    setActiveId(missing[0].id)
  }, [drafts, questions])

  const attemptSubmit = useCallback(() => {
    if (submitting) return
    if (!allAnswered) {
      flashMissing()
      return
    }
    setSubmitting(true)
    const payload = questions
      .filter((item) => draftAnswered(item, drafts[item.id] ?? emptyDraft()))
      .map((item) => ({ id: item.id, answer: draftToAnswer(item, drafts[item.id] ?? emptyDraft()) }))
    for (const item of questions) draftStore.delete(item.id)
    onRespond('once', JSON.stringify(payload))
  }, [allAnswered, drafts, flashMissing, onRespond, questions, submitting])

  const requestDiscard = useCallback(() => {
    if (hasAnyContent) setConfirmDiscard(true)
    else onRespond('reject')
  }, [hasAnyContent, onRespond])

  // 切换问题后把焦点放到该题第一个控件：键盘用户点完导航就能直接上下键选
  useEffect(() => {
    if (!activeItem) return
    const type = questionType(activeItem)
    const timer = window.setTimeout(() => {
      if (type === 'text') optionRefs.current[`${activeItem.id}:input`]?.focus()
      else if (type === 'textarea') optionRefs.current[`${activeItem.id}:textarea`]?.focus()
      else optionRefs.current[`${activeItem.id}:0`]?.focus()
    }, 30)
    return () => window.clearTimeout(timer)
    // 依赖故意只有 activeItem：drafts 变化不该抢走用户当前焦点
  }, [activeItem])

  // 弃用确认弹窗打开后聚焦「取消」：危险动作的默认落点必须是安全项
  useEffect(() => {
    if (!confirmDiscard) return
    const timer = window.setTimeout(() => discardCancelRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [confirmDiscard])

  // 键盘交互：Enter 提交（textarea 内用 Ctrl/Cmd+Enter），Esc 触发放弃确认；确认弹窗开着时 Enter 不提交
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        // 弹窗开着时 Esc 的语义是取消这次危险操作，而不是替用户放弃
        if (confirmDiscard) setConfirmDiscard(false)
        else requestDiscard()
        return
      }
      if (event.key !== 'Enter' || event.isComposing || confirmDiscard) return
      const inTextarea = event.target instanceof HTMLTextAreaElement
      if (inTextarea) {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault()
          attemptSubmit()
        }
        return
      }
      event.preventDefault()
      attemptSubmit()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [attemptSubmit, confirmDiscard, requestDiscard])

  // 选项列表 ↑ ↓ 在选项之间移动焦点；单选时方向键直接切换选中项（经典 radio 行为）
  const handleOptionKeyDown = (item: QuestionItem, type: 'single-select' | 'multi-select', index: number, event: ReactKeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const options = normalizeOptions(item)
    // 模型自带兜底项时没有内置「其他」这一格，方向键不能多绕一圈到空位上
    const total = options.length + (needsBuiltinOther(options) ? 1 : 0)
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
    // 模型经常自己写一个「D. 其他」，再补内置项就是并排两个同义选项
    const builtinOther = needsBuiltinOther(options)
    return <div className="question-options" role={multi ? 'group' : 'radiogroup'} aria-label={item.title}>
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
            // 已选中再点一次即取消（单选/多选一致）；未选中时单选替换、多选追加
            if (checked) {
              updateDraft(item.id, { ...draft, selected: draft.selected.filter((value) => value !== option.value) })
              return
            }
            updateDraft(item.id, multi ? { ...draft, selected: [...draft.selected, option.value] } : { ...draft, selected: [option.value] })
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
      {builtinOther && <button
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
      </button>}
      {/* 选了「其他」才出现输入框，不选不占空间 */}
      {draft.custom && <textarea
        className="question-other-editor"
        placeholder="输入你的要求…"
        rows={2}
        value={draft.text}
        ref={(node) => { optionRefs.current[`${item.id}:textarea`] = node }}
        onChange={(event) => updateDraft(item.id, { ...draft, text: event.target.value })}
      />}
    </div>
  }

  if (!activeItem) return null
  const activeType = questionType(activeItem)
  const activeDraft = drafts[activeItem.id] ?? emptyDraft()
  const activeIndex = questions.findIndex((item) => item.id === activeItem.id)
  // 只有一道题时导航没有切换对象，藏掉让填写区占满
  const showNav = questions.length > 1

  return <div className="approval-overlay" role="dialog" aria-modal="true" aria-label="Agent 需要你的确认">
    <div className="question-dialog">
      <header className="question-header">
        <div className="question-header-top">
          <div className="question-header-heading">
            <strong>Agent 需要你的确认</strong>
            <span className="question-status"><span className="question-status-dot" />Agent 等待回答</span>
          </div>
          <button className="icon-button" aria-label="关闭" title="关闭" onClick={requestDiscard}><X size={14} /></button>
        </div>
        <p>回答以下问题后，Agent 将继续执行任务</p>
        {request.cwd && <code className="question-cwd">{request.cwd}</code>}
      </header>

      <div className="question-layout">
        {showNav && <nav className="question-nav" aria-label="确认事项">
          <div className="question-nav-title">确认事项</div>
          {questions.map((item, index) => {
            const status = navStatus(item, drafts[item.id] ?? emptyDraft(), errorIds)
            const active = item.id === activeItem.id
            return <button
              key={item.id}
              type="button"
              className={`question-nav-item ${status}${active ? ' active' : ''}`}
              aria-current={active ? 'true' : undefined}
              onClick={() => setActiveId(item.id)}
            >
              <span className="question-nav-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="question-nav-label">{item.title || `问题 ${item.id}`}</span>
              <span className="question-nav-state" aria-hidden="true">
                {status === 'done' && <Check size={11} strokeWidth={3} />}
                {status === 'error' && <AlertTriangle size={11} />}
              </span>
            </button>
          })}
        </nav>}

        {/* key 换题重挂载，切换动画交给 CSS */}
        <div className="question-main" key={activeItem.id}>
          <section className="question-item">
            <div className="question-item-heading">
              <span className="question-index">{String(activeIndex + 1).padStart(2, '0')}</span>
              <strong className="question-title">{activeItem.title || `问题 ${activeItem.id}`}</strong>
              {isSelectType(activeType) && <span className="question-mode-chip">{typeLabel(activeType)}</span>}
              <span className={`question-required${isRequired(activeItem) ? '' : ' optional'}`}>{isRequired(activeItem) ? '必选' : '可选'}</span>
            </div>
            {activeItem.question && <QuestionDescription id={`${activeItem.id}-desc`} text={activeItem.question} />}
            {(activeType === 'single-select' || activeType === 'multi-select') && renderSelectQuestion(activeItem, activeType)}
            {activeType === 'text' && <input
              className="question-input"
              placeholder="输入回答…"
              value={activeDraft.text}
              ref={(node) => { optionRefs.current[`${activeItem.id}:input`] = node }}
              onChange={(event) => updateDraft(activeItem.id, { ...activeDraft, text: event.target.value })}
            />}
            {activeType === 'textarea' && <textarea
              className="question-textarea"
              placeholder="输入回答…"
              rows={3}
              value={activeDraft.text}
              ref={(node) => { optionRefs.current[`${activeItem.id}:textarea`] = node }}
              onChange={(event) => updateDraft(activeItem.id, { ...activeDraft, text: event.target.value })}
            />}
          </section>
        </div>

        <BriefingPanel
          questions={questions}
          drafts={drafts}
          answeredRequired={answeredRequired}
          requiredCount={requiredItems.length}
          expanded={briefingExpanded}
          onToggle={() => setBriefingExpanded((value) => !value)}
        />
      </div>

      <footer className="question-footer">
        <div className="question-progress">
          <span>已完成 {answeredRequired} / {requiredItems.length} 个必选项</span>
          {!allAnswered && <em className="question-progress-hint">还有 {missingRequired} 个必选项未完成</em>}
        </div>
        <div className="question-actions">
          <button className="question-secondary" onClick={requestDiscard}>取消</button>
          {/* 不用原生 disabled：点击要能触发「跳到未完成题」的引导，语义上用 aria-disabled 表达不可提交 */}
          <button className="question-primary" aria-disabled={!allAnswered || submitting} onClick={attemptSubmit}>提交并继续</button>
        </div>
      </footer>
    </div>

    {confirmDiscard && <DiscardConfirmModal
      onCancel={() => setConfirmDiscard(false)}
      onDiscard={() => onRespond('reject')}
      cancelRef={discardCancelRef}
    />}
  </div>
}
