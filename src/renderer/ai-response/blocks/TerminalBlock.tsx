import { memo, useMemo, useState } from 'react'
import { ChevronDown, Copy } from 'lucide-react'
import type { TerminalBlock as TerminalBlockData } from '../blocks'
import { useResponseActions } from '../response-context'

const COLLAPSE_LINES = 16

function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null) return null
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(2)}s` : `${durationMs}ms`
}

function TerminalBlockView({ block }: { block: TerminalBlockData }) {
  const actions = useResponseActions()
  const [expanded, setExpanded] = useState(false)
  const lines = useMemo(() => block.output.split('\n'), [block.output])
  const collapsible = lines.length > COLLAPSE_LINES
  const visible = collapsible && !expanded ? lines.slice(0, COLLAPSE_LINES) : lines
  const duration = formatDuration(block.durationMs)

  return (
    <div className="terminal-block">
      <div className="terminal-block-head">
        <span className="terminal-command"><i>$</i>{block.command}</span>
        <button type="button" className="code-block-action" onClick={() => actions.copyText(block.command)} aria-label="复制命令" title="复制命令"><Copy size={13} /></button>
      </div>
      {block.output && <pre className="terminal-output">{visible.join('\n')}</pre>}
      {collapsible && <button type="button" className="block-expand" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <ChevronDown size={13} />{expanded ? '收起输出' : `展开剩余 ${lines.length - COLLAPSE_LINES} 行`}
      </button>}
      <div className="terminal-footer">
        {block.exitCode !== null && <span className={block.exitCode === 0 ? 'ok' : 'fail'}>Exit {block.exitCode}</span>}
        {duration && <span>{duration}</span>}
        {block.cwd && <span className="terminal-cwd">{block.cwd}</span>}
      </div>
    </div>
  )
}

export const TerminalBlockRenderer = memo(TerminalBlockView)
