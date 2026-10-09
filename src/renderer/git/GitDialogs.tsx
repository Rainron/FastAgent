import { useEffect, useState } from 'react'
import { CircleAlert, GitBranch, X } from 'lucide-react'

/** Esc 关闭；busy 期间不允许关，避免写操作进行到一半界面就没了。 */
function useEscape(onCancel: () => void, busy: boolean) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel, busy])
}

export interface GitConfirmRequest {
  title: string
  description: string
  /** 展示在正文上方的风险角标，如「3 个未提交改动」。 */
  chip?: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
}

/** 破坏性 Git 操作的统一确认层，样式沿用审批弹层。 */
export function GitConfirmDialog({ request, busy, onCancel }: { request: GitConfirmRequest; busy: boolean; onCancel: () => void }) {
  useEscape(onCancel, busy)
  return <div className="approval-overlay" role="dialog" aria-modal="true" aria-label={request.title}
    onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <div className="approval-dialog">
      <div className="approval-header">
        <span className="approval-icon doom_loop"><GitBranch size={16} /></span>
        <div className="approval-heading"><strong>{request.title}</strong><small>{request.danger ? '此操作不可撤销' : 'Git 操作确认'}</small></div>
        <button className="icon-button" aria-label="取消" title="取消" onClick={onCancel} disabled={busy}><X size={14} /></button>
      </div>
      <div className="approval-body">
        {request.chip && <div className="approval-meta"><span className="approval-chip risk"><CircleAlert size={11} />{request.chip}</span></div>}
        <p className="approval-note">{request.description}</p>
      </div>
      <div className="approval-actions">
        <button className="approval-secondary" onClick={onCancel} disabled={busy}>取消</button>
        <button className="approval-primary" onClick={request.onConfirm} disabled={busy}>{busy ? '执行中…' : request.confirmLabel}</button>
      </div>
    </div>
  </div>
}

export interface GitPromptRequest {
  title: string
  description?: string
  label: string
  placeholder?: string
  initialValue?: string
  confirmLabel: string
  /** 可选的第二个输入框；添加远程要同时收名字和地址，不值得为它再做一个弹层。 */
  secondary?: { label: string; placeholder?: string; initialValue?: string }
  /** 返回错误信息表示校验不通过，返回 null 才提交。 */
  validate?: (value: string, secondary: string) => string | null
  onSubmit: (value: string, secondary: string) => void
}

/** 新建 / 重命名分支、stash 备注这类需要输入一行文本的操作。 */
export function GitPromptDialog({ request, busy, onCancel }: { request: GitPromptRequest; busy: boolean; onCancel: () => void }) {
  const [value, setValue] = useState(request.initialValue ?? '')
  const [second, setSecond] = useState(request.secondary?.initialValue ?? '')
  const [error, setError] = useState('')
  useEscape(onCancel, busy)
  const submit = () => {
    const text = value.trim()
    const secondText = second.trim()
    const required = text && (!request.secondary || secondText)
    const message = request.validate?.(text, secondText) ?? (required ? null : '不能为空')
    if (message) { setError(message); return }
    request.onSubmit(text, secondText)
  }
  return <div className="approval-overlay" role="dialog" aria-modal="true" aria-label={request.title}
    onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <div className="approval-dialog">
      <div className="approval-header">
        <span className="approval-icon"><GitBranch size={16} /></span>
        <div className="approval-heading"><strong>{request.title}</strong>{request.description && <small>{request.description}</small>}</div>
        <button className="icon-button" aria-label="取消" title="取消" onClick={onCancel} disabled={busy}><X size={14} /></button>
      </div>
      <div className="approval-body">
        <label className="git-prompt-field">
          <span>{request.label}</span>
          <input autoFocus value={value} placeholder={request.placeholder} disabled={busy}
            onChange={(event) => { setValue(event.target.value); setError('') }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit() } }} />
        </label>
        {request.secondary && <label className="git-prompt-field">
          <span>{request.secondary.label}</span>
          <input value={second} placeholder={request.secondary.placeholder} disabled={busy}
            onChange={(event) => { setSecond(event.target.value); setError('') }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit() } }} />
        </label>}
        {error && <span className="git-prompt-error"><CircleAlert size={11} />{error}</span>}
      </div>
      <div className="approval-actions">
        <button className="approval-secondary" onClick={onCancel} disabled={busy}>取消</button>
        <button className="approval-primary" onClick={submit}
          disabled={busy || !value.trim() || Boolean(request.secondary && !second.trim())}>{busy ? '执行中…' : request.confirmLabel}</button>
      </div>
    </div>
  </div>
}

export interface GitPickRequest {
  title: string
  description?: string
  options: string[]
  emptyText: string
  /** 选项少或不是分支名（如 reset 模式）时关掉过滤框，免得多一个没用的输入。 */
  searchable?: boolean
  onPick: (value: string) => void
}

/** 从一组已有 ref 里挑一个（merge / rebase 目标、upstream 跟踪分支）。 */
export function GitPickDialog({ request, busy, onCancel }: { request: GitPickRequest; busy: boolean; onCancel: () => void }) {
  const [query, setQuery] = useState('')
  useEscape(onCancel, busy)
  const searchable = request.searchable ?? true
  const hits = searchable ? request.options.filter((option) => option.toLowerCase().includes(query.trim().toLowerCase())) : request.options
  return <div className="approval-overlay" role="dialog" aria-modal="true" aria-label={request.title}
    onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <div className="approval-dialog">
      <div className="approval-header">
        <span className="approval-icon"><GitBranch size={16} /></span>
        <div className="approval-heading"><strong>{request.title}</strong>{request.description && <small>{request.description}</small>}</div>
        <button className="icon-button" aria-label="取消" title="取消" onClick={onCancel} disabled={busy}><X size={14} /></button>
      </div>
      <div className="approval-body">
        {searchable && <label className="git-prompt-field">
          <span>过滤</span>
          <input autoFocus value={query} placeholder="输入分支名过滤" onChange={(event) => setQuery(event.target.value)} disabled={busy} />
        </label>}
        <div className="git-pick-list">
          {hits.length === 0
            ? <div className="git-panel-empty">{request.emptyText}</div>
            : hits.map((option) => <button key={option} type="button" className="git-pick-item" disabled={busy} onClick={() => request.onPick(option)}>
              <GitBranch size={13} /><span className="git-ellipsis">{option}</span>
            </button>)}
        </div>
      </div>
      <div className="approval-actions">
        <button className="approval-secondary" onClick={onCancel} disabled={busy}>取消</button>
      </div>
    </div>
  </div>
}
