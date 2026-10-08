import { useHeightAnimation } from '../use-height-animation'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import { useState, type RefObject } from 'react'
import type { QuestionItem } from '../../shared/types'
import { MarkdownBlockRenderer } from '../ai-response/blocks/MarkdownBlock'
import { shouldClampDescription } from './question-options'
import { draftSummary, emptyDraft, isSelectType, questionType, typeLabel, type QuestionDraft } from './question-view'

/** QuestionDialog 的展示子组件集合：说明折叠、右侧任务说明面板、弃用确认弹窗。 */

/** 问题说明按 Markdown 渲染：模型写的是 Markdown，当纯文本贴出来就是满屏星号。长段落折起来。 */
export function QuestionDescription({ id, text }: { id: string; text: string }) {
  const clampable = shouldClampDescription(text)
  const [expanded, setExpanded] = useState(false)
  // 展开 / 收起是原地换内容，高度从旧值补间到新值，不再一下跳变
  const height = useHeightAnimation<HTMLDivElement>()
  const clamped = clampable && !expanded
  return <div className={`question-desc${clamped ? ' clamped' : ''}`} ref={height.ref}>
    <MarkdownBlockRenderer block={{ id, type: 'markdown', text, status: 'completed' }} />
    {clampable && <button type="button" className="question-desc-toggle" onClick={() => { height.capture(); setExpanded((value) => !value) }} aria-expanded={expanded}>
      {expanded ? '收起说明' : '展开完整说明'}
    </button>}
  </div>
}

/** 右侧任务说明面板：默认只给进度与每题当前选择的摘要，完整说明由用户展开。 */
export function BriefingPanel({ questions, drafts, answeredRequired, requiredCount, expanded, onToggle }: {
  questions: QuestionItem[]
  drafts: Record<string, QuestionDraft>
  answeredRequired: number
  requiredCount: number
  expanded: boolean
  onToggle: () => void
}) {
  const height = useHeightAnimation<HTMLDivElement>()
  const percent = requiredCount === 0 ? 100 : Math.round((answeredRequired / requiredCount) * 100)
  return <aside className="question-briefing">
    <div className="question-briefing-head">
      <strong>任务说明</strong>
      <button type="button" className="question-briefing-toggle" onClick={onToggle} aria-expanded={expanded}>
        {expanded ? '收起' : '展开详情'}
        <ChevronDown size={12} className={expanded ? 'flip' : undefined} />
      </button>
    </div>
    <div className="question-briefing-body" ref={height.ref}>
      <div className="question-briefing-progress">
        <div className="question-briefing-progress-text">
          <span>必选项进度</span>
          <span>{answeredRequired} / {requiredCount}</span>
        </div>
        <div className="question-briefing-bar"><i style={{ width: `${percent}%` }} /></div>
      </div>
      {expanded
        ? questions.map((item) => {
          const draft = drafts[item.id] ?? emptyDraft()
          const summary = draftSummary(item, draft)
          const type = questionType(item)
          return <div className="question-full" key={item.id}>
            <div className="question-full-head">
              <strong className="question-full-title">{item.title || `问题 ${item.id}`}</strong>
              {isSelectType(type) && <span className="question-mode-chip">{typeLabel(type)}</span>}
            </div>
            {item.question && <div className="question-full-desc">
              <MarkdownBlockRenderer block={{ id: `${item.id}-full`, type: 'markdown', text: item.question, status: 'completed' }} />
            </div>}
            <div className={`question-full-choice${summary ? '' : ' empty'}`}>
              <span>{isSelectType(type) ? '当前选择' : '你的回答'}</span>
              <em>{summary ?? '待选择'}</em>
            </div>
          </div>
        })
        : questions.map((item) => {
          const draft = drafts[item.id] ?? emptyDraft()
          const summary = draftSummary(item, draft)
          return <div className={`question-brief-item${summary ? ' done' : ''}`} key={item.id}>
            <span className="question-brief-item-title">{item.title || `问题 ${item.id}`}</span>
            <span className="question-brief-item-answer">{summary ?? '待选择'}</span>
          </div>
        })}
    </div>
  </aside>
}

/** 弃用确认：居中警示弹窗。默认焦点落在「取消」，危险按钮文案明说后果。 */
export function DiscardConfirmModal({ onCancel, onDiscard, cancelRef }: {
  onCancel: () => void
  onDiscard: () => void
  cancelRef: RefObject<HTMLButtonElement | null>
}) {
  return <div className="question-discard-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <div className="question-discard-modal" role="alertdialog" aria-modal="true" aria-label="放弃本次确认">
      <span className="question-discard-icon"><AlertTriangle size={16} /></span>
      <strong className="question-discard-title">放弃本次确认？</strong>
      <p className="question-discard-text">已填写的选择不会被保存。关闭后，Agent 将继续等待你的操作。</p>
      <div className="question-discard-actions">
        <button ref={cancelRef} className="question-secondary" onClick={onCancel}>取消</button>
        <button className="question-danger" onClick={onDiscard}>放弃并关闭</button>
      </div>
    </div>
  </div>
}
