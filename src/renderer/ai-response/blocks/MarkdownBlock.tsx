import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import type { MarkdownBlock as MarkdownBlockData } from '../blocks'
import { parseFileReference } from '../file-reference'
import { normalizeFlagEmoji } from '../flag-emoji'
import { sanitizeLinkHref } from '../sanitize-url'
import { openExternalLink, useResponseActions } from '../response-context'
import { FileReferenceChip } from './FileReferenceBlock'

/**
 * 正文只渲染 Markdown：围栏代码/diff 已在 block-parser 里拆走。
 * 不启用 rehype-raw，原始 HTML 不会被解析；再叠一层 rehype-sanitize 兜底。
 */
function MarkdownBlockView({ block }: { block: MarkdownBlockData }) {
  const actions = useResponseActions()

  const components: Components = {
    a({ href, children }) {
      const safe = sanitizeLinkHref(href)
      if (!safe) return <span className="markdown-link-blocked">{children}</span>
      if (safe.startsWith('#')) return <a href={safe}>{children}</a>
      return <a href={safe} onClick={(event) => { event.preventDefault(); void openExternalLink(safe, actions.notify) }}>{children}</a>
    },
    code({ className, children }) {
      // 有 language-* 说明是围栏残留（缩进代码块），按纯代码渲染，不做行内文件引用识别。
      if (className?.includes('language-')) return <code className={className}>{children}</code>
      const text = String(children)
      const reference = parseFileReference(text)
      if (reference) return <FileReferenceChip reference={reference} />
      return <code>{children}</code>
    },
    // 缩进代码块保持等宽容器，但不进 CodeBlock 的高亮流程。
    pre({ children }) { return <pre className="markdown-pre">{children}</pre> },
    // 表格包进横向滚动容器：超宽表格只让自身滚动，不撑破消息区与主布局。
    table({ children }) { return <div className="table-wrapper"><table>{children}</table></div> }
  }

  return (
    <div className="markdown-block">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
        {normalizeFlagEmoji(block.text)}
      </ReactMarkdown>
    </div>
  )
}

// 每次冲刷都会重新解析出新的 block 对象，按值比较才能让已完成的块真正跳过重渲染。
export const MarkdownBlockRenderer = memo(MarkdownBlockView, (prev, next) =>
  prev.block.text === next.block.text && prev.block.status === next.block.status)
