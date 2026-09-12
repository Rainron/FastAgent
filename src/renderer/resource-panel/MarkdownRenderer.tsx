import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { openExternalLink, useResponseActions } from '../ai-response/response-context'
import { isExternalHttpUrl, sanitizeLinkHref } from '../ai-response/sanitize-url'

/**
 * 文件预览专用的 Markdown 渲染器。
 * 样式全部走独立的 .fmd-* 命名空间，与消息区 .markdown-block、代码高亮、全局样式互不污染：
 * 正文/标题/列表自动换行，图片不超容器宽，代码块与表格各自横向滚动，不撑宽预览窗口。
 */
export function MarkdownRenderer({ content }: { content: string }) {
  const actions = useResponseActions()

  const components: Components = {
    a({ href, children }) {
      const safe = sanitizeLinkHref(href)
      if (!safe) return <span className="fmd-link-blocked">{children}</span>
      return <a href={safe} onClick={(event) => { event.preventDefault(); void openExternalLink(safe, actions.notify) }}>{children}</a>
    },
    img({ src, alt, title }) {
      // 只放行 http/https/data 与无协议的相对路径；带协议的其它 scheme（javascript: 等）不渲染。
      if (!src || (src.includes(':') && !isExternalHttpUrl(src) && !src.startsWith('data:'))) return null
      return <img src={src} alt={alt ?? ''} title={title} loading="lazy" />
    },
    // 围栏代码块保持原始格式，块内横向滚动；行内代码走独立样式。
    pre({ children }) { return <pre className="fmd-pre">{children}</pre> },
    code({ className, children }) {
      if (className?.includes('language-')) return <code className="fmd-code-block">{children}</code>
      return <code className="fmd-inline-code">{children}</code>
    },
    // 表格包进独立横向滚动容器，列多时只让表格自身滚动。
    table({ children }) { return <div className="fmd-table-wrap"><table>{children}</table></div> },
    // 删除线、引用等元素显式收进命名空间，防止被其它全局文本样式带偏。
    del({ children }) { return <del className="fmd-del">{children}</del> }
  }

  return (
    <div className="fmd">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
