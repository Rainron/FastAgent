import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { highlightCode, MAX_HIGHLIGHT_CODE_LENGTH, shouldHighlightCode } from '../ai-response/highlight'

/**
 * 剥掉 shiki 输出的 <pre ...><code> 前缀与 </code></pre> 后缀，保留它自带的 <span class="line"> 行结构。
 * 代码里的 < 等字符已被 shiki 转义，不会误匹配标签；拆成纯函数便于测试。
 */
export function stripShikiWrapper(html: string): string {
  return html.replace(/^<pre[^>]*><code>/, '').replace(/<\/code><\/pre>\s*$/, '')
}

/**
 * 统一代码查看器：YAML / JSON / JS / TS / Python / Java 等文本文件共用。
 * 布局：body 只纵向滚动；行号列固定（sticky），代码内容列独立横向滚动，
 * 超宽行只让内容区滚动，不会撑宽整个预览窗口。
 * 行号用 CSS counter 画在 .line 上，shiki 高亮与纯文本兜底两条路径外观一致。
 */
export function CodeViewer({ content, language, wrap, line, endLine }: {
  content: string
  language: string | null
  wrap: boolean
  line: number | null
  endLine: number | null
}) {
  const [html, setHtml] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // 高亮只在语言支持且内容不算超大时进行；shiki 输出剥壳后自带行结构，
  // 与纯文本路径一样有 .line 行节点，行号与命中行高亮才能统一生效。
  useEffect(() => {
    if (!shouldHighlightCode(content, language)) {
      setHtml(null)
      return
    }
    let alive = true
    void highlightCode(content, language).then((result) => { if (alive) setHtml(result) })
    return () => { alive = false }
  }, [content, language])

  // shiki 输出剥离 pre/code 包装后是它自己构造并转义过的 span 树，代码原文不会当作标签解析。
  const shikiHtml = useMemo(() => (html ? stripShikiWrapper(html) : null), [html])

  useLayoutEffect(() => {
    const host = bodyRef.current
    if (!host || line === null) return
    const lines = host.querySelectorAll<HTMLElement>('.line')
    const start = line - 1
    const end = (endLine ?? line) - 1
    lines.forEach((node, index) => node.classList.toggle('active', index >= start && index <= end))
    lines[start]?.scrollIntoView({ block: 'center' })
  }, [html, content, line, endLine])

  const largePlainText = content.length > MAX_HIGHLIGHT_CODE_LENGTH
  const lines = largePlainText ? null : content.split('\n')
  return (
    <div className={`file-viewer-body ${wrap ? 'wrap' : ''}`} ref={bodyRef}>
      {shikiHtml
        // shiki 剥壳后是它自己构造并转义过的 span 树；放进 pre 与纯文本路径同构，
        // pre 的 scrollWidth 会纳入超宽行，行号 sticky 与命中行高亮两条路径共用一套规则。
        ? <pre className="shiki-plain" dangerouslySetInnerHTML={{ __html: shikiHtml }} />
        : <pre className="shiki-plain"><code>{largePlainText ? content : lines?.map((text, index) => <span className="line" key={index}>{text}{'\n'}</span>)}</code></pre>}
    </div>
  )
}
