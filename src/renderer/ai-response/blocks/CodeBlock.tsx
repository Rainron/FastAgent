import { memo, useEffect, useState } from 'react'
import { Check, ChevronDown, Copy } from 'lucide-react'
import type { CodeBlock as CodeBlockData } from '../blocks'
import { highlightCode, isHighlightableLanguage } from '../highlight'
import { parseFileReference } from '../file-reference'
import { useResponseActions } from '../response-context'

const COLLAPSE_LINES = 24

function CodeBlockView({ block }: { block: CodeBlockData }) {
  const actions = useResponseActions()
  const [html, setHtml] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const streaming = block.status === 'streaming'
  const lineCount = block.code.split('\n').length
  const collapsible = lineCount > COLLAPSE_LINES && !streaming
  const reference = block.filename ? parseFileReference(block.filename) : null

  useEffect(() => {
    // 流式阶段按 token 高亮会把 CPU 烧光，收尾后再高亮一次。
    if (streaming || !isHighlightableLanguage(block.language)) { setHtml(null); return }
    let alive = true
    void highlightCode(block.code, block.language).then((result) => { if (alive) setHtml(result) })
    return () => { alive = false }
  }, [block.code, block.language, streaming])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1400)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <div className={`code-block ${collapsible && !expanded ? 'collapsed' : ''}`}>
      <div className="code-block-head">
        <span className="code-block-meta">
          {block.filename && (reference
            ? <button type="button" className="code-block-file" onClick={() => actions.openFile(reference)}>{block.filename}</button>
            : <span className="code-block-file">{block.filename}</span>)}
          {block.language && <span className="code-block-language">{block.language}</span>}
        </span>
        <button type="button" className="code-block-action" onClick={() => { actions.copyText(block.code); setCopied(true) }} aria-label="复制代码" title="复制代码">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      {html
        // shiki 输出的是它自己构造并转义过的 span 树，代码原文不会当作标签解析。
        ? <div className="code-block-body shiki-host" dangerouslySetInnerHTML={{ __html: html }} />
        : <pre className="code-block-body"><code>{block.code}</code></pre>}
      {collapsible && <button type="button" className="block-expand" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <ChevronDown size={13} />{expanded ? '收起' : `展开全部 ${lineCount} 行`}
      </button>}
    </div>
  )
}

export const CodeBlockRenderer = memo(CodeBlockView, (prev, next) =>
  prev.block.code === next.block.code && prev.block.language === next.block.language
  && prev.block.filename === next.block.filename && prev.block.status === next.block.status)
