import React from 'react'
import { Square, TerminalSquare, X } from 'lucide-react'
import { shellCommandStatusLabel } from '../../shared/shell-command'
import type { ShellCommandEntry } from './shell-entries'

/**
 * `!命令` 的执行卡片。刻意不做成消息气泡：它不是问答的一部分，
 * 默认落点下也不进模型上下文，样式上要一眼看出「这是本地命令」。
 */
export const ShellCommandCard = React.memo(function ShellCommandCard({ entry, onCancel, onDismiss }: {
  entry: ShellCommandEntry
  onCancel: (id: string) => void
  onDismiss: (id: string) => void
}) {
  const failed = entry.status === 'failed' || entry.status === 'timeout'
  const elapsed = Math.max(0, Math.round(((entry.finishedAt ?? Date.now()) - entry.startedAt) / 1000))
  const running = entry.status === 'running'
  const label = entry.status === 'running'
    ? '运行中…'
    : `${shellCommandStatusLabel({ status: entry.status, exitCode: entry.exitCode })} · ${elapsed}s`
  return <section className={`shell-command-card${running ? ' running' : ''}${failed ? ' failed' : ''}`}>
    <div className="shell-command-head">
      <TerminalSquare size={13} />
      <code className="shell-command-text" title={entry.cwd || undefined}>{entry.command}</code>
      <span className="shell-command-status">{label}</span>
      {running
        ? <button className="shell-command-action" onClick={() => onCancel(entry.id)} aria-label="终止命令" title="终止命令"><Square size={11} fill="currentColor" strokeWidth={0} /></button>
        : <button className="shell-command-action" onClick={() => onDismiss(entry.id)} aria-label="移除" title="移除"><X size={12} /></button>}
    </div>
    {(entry.output || entry.error) && <pre className="shell-command-output">{entry.output}{entry.error ? `\n${entry.error}` : ''}</pre>}
    {entry.truncated && <div className="shell-command-note">输出过长，只保留了末尾部分</div>}
  </section>
})
