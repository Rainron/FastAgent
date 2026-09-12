import { useEffect } from 'react'
import { CircleAlert, ShieldAlert, X } from 'lucide-react'
import type { PermissionProfile } from '../../shared/permission-profiles'

export function FullAccessDialog({ profile, onRespond }: { profile: PermissionProfile; onRespond: (accepted: boolean) => void }) {
  const summary = profile
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onRespond(false) }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onRespond])

  return <div className="approval-overlay" role="dialog" aria-modal="true" aria-label={`启用${summary.label}`} onPointerDown={(event) => { if (event.target === event.currentTarget) onRespond(false) }}>
    <div className="approval-dialog">
      <div className="approval-header">
        <span className="approval-icon doom_loop"><ShieldAlert size={16} /></span>
        <div className="approval-heading">
          <strong>启用{summary.label}？</strong>
          <small>只在首次开启时确认一次</small>
        </div>
        <button className="icon-button" aria-label="取消" title="取消" onClick={() => onRespond(false)}><X size={14} /></button>
      </div>
      <div className="approval-body">
        <div className="approval-meta"><span className="approval-chip risk"><CircleAlert size={11} />高风险</span></div>
        <p className="approval-note">{summary.description}</p>
        <p className="approval-note">开启后，工作区内外的文件读写与命令执行都不再逐次询问。仍然保留的硬性限制：`rm -rf`、`git push --force`、`shutdown`、`format` 等破坏性命令被拒绝，私钥文件（.pem、.key、id_rsa）读取被拒绝。</p>
      </div>
      <div className="approval-actions">
        <button className="approval-secondary" onClick={() => onRespond(false)}>取消</button>
        <button className="approval-primary" autoFocus onClick={() => onRespond(true)}>启用{summary.label}</button>
      </div>
    </div>
  </div>
}
