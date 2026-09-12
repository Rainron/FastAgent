import { useEffect } from 'react'
import { AlertTriangle, Clock3, Repeat2, Shield, X } from 'lucide-react'
import type { ApprovalDecision, ApprovalRequest, QuestionItem } from '../../shared/types'
import { QuestionDialog } from './QuestionDialog'

export function ApprovalDialog({ request, onRespond }: { request: ApprovalRequest; onRespond: (decision: ApprovalDecision, answer?: string) => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onRespond('reject')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onRespond])

  // question 类型整体交给 QuestionDialog，这里只保留批准/循环检测两种弹窗
  if (request.kind === 'question') {
    const questions = (request.options as { questions?: QuestionItem[] } | undefined)?.questions ?? []
    return <QuestionDialog request={request} questions={questions} onRespond={onRespond} />
  }

  // 泛化后的模式排在后面（`mvn` + `mvn *`），取最后一条展示才是用户真正授出的范围。
  const scopeLabel = request.scopePatterns?.at(-1) ?? request.subject
  const title = request.kind === 'doom_loop' ? '检测到重复操作' : '等待批准'
  const icon = request.kind === 'doom_loop' ? <Repeat2 size={16} /> : <Shield size={16} />

  return (
    <div className="approval-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="approval-dialog">
        <div className="approval-header">
          <span className={`approval-icon ${request.kind}`}>{icon}</span>
          <div className="approval-heading">
            <strong>{title}</strong>
            {request.kind === 'doom_loop' && <small>Agent 连续 3 次重复同一操作，可能陷入了循环。</small>}
            {request.kind === 'permission' && <small>Agent 请求执行以下操作</small>}
          </div>
          <button className="icon-button" aria-label="拒绝并关闭" title="拒绝" onClick={() => onRespond('reject')}><X size={14} /></button>
        </div>

        <div className="approval-body">
          <div className="approval-meta">
            <span className="approval-chip">{request.tool}</span>
            {request.risk && <span className="approval-chip risk"><AlertTriangle size={11} />高风险</span>}
          </div>
          {request.subject && <pre className="approval-subject">{request.subject}</pre>}
          {request.cwd && <div className="approval-cwd"><Clock3 size={11} />{request.cwd}</div>}
          {scopeLabel && (
            <div className="approval-scope">「本次会话允许」与「始终允许」的生效范围：<code>{scopeLabel}</code></div>
          )}
        </div>

        <div className="approval-actions">
          <button className="approval-reject" onClick={() => onRespond('reject')}>拒绝</button>
          <button className="approval-secondary" onClick={() => onRespond('once')}>仅本次</button>
          <button className="approval-secondary" onClick={() => onRespond('session')}>本次会话允许</button>
          <button className="approval-primary" onClick={() => onRespond('always')}>始终允许</button>
        </div>
      </div>
    </div>
  )
}