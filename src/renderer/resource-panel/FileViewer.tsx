import { useEffect, useRef, useState } from 'react'
import { CircleAlert, LoaderCircle } from 'lucide-react'
import { languageFromPath, MAX_HIGHLIGHT_CODE_LENGTH } from '../ai-response/highlight'
import { parseIpcError } from '../ipc-error'
import type { FileReference } from '../ai-response/file-reference'
import { CodeViewer } from './CodeViewer'
import { MarkdownRenderer } from './MarkdownRenderer'

export const IMAGE_PATH_RE = /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i
export const MARKDOWN_PATH_RE = /\.(md|markdown|mdx)$/i

/** 预览文件类型（图片不报 meta，Header 只需图标）；决定 Header 的换行开关是否可用。 */
export type FilePreviewKind = 'markdown' | 'code'

export interface FilePreviewMeta {
  kind: FilePreviewKind
  language: string | null
  /** 超大文件不逐行拆分，行数未知（Header 显示「大文件」）。 */
  lines: number | null
  /** 复制按钮用的原始内容；图片无内容。 */
  content: string
}

interface FileViewerProps {
  file: FileReference
  onNotice: (notice: string) => void
  workspaceRoot: string | null
  onPickSuggestion?: (path: string) => void
  onMeta: (meta: FilePreviewMeta) => void
  wrap: boolean
  viewMode: 'preview' | 'source'
}

/**
 * 只读文件查看：内容由主进程校验过路径后返回，渲染进程不碰文件系统。
 * 图片直接展示，Markdown 走独立命名空间的 MarkdownRenderer（或源码视图），
 * 其余文本统一进 CodeViewer（行号固定 + 内容横向滚动）。
 * 顶部的元信息与操作（类型/行数/预览源码/换行/复制/关闭）由 ResourcePanel 的 Header 统一提供。
 */
export function FileViewer({ file, onNotice, workspaceRoot, onPickSuggestion, onMeta, wrap, viewMode }: FileViewerProps) {
  const [content, setContent] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [error, setError] = useState({ message: '', suggestions: [] as string[] })
  const language = languageFromPath(file.path)
  const isImage = IMAGE_PATH_RE.test(file.path)
  const isMarkdown = MARKDOWN_PATH_RE.test(file.path)

  // 请求代次：切换工作区或文件后以递增的 requestId 隔离旧的读请求，
  // 避免旧工作区的同名文件被写入新工作区预览。
  const requestIdRef = useRef(0)
  useEffect(() => {
    const requestId = ++requestIdRef.current
    setContent(null)
    setImageUrl(null)
    setError({ message: '', suggestions: [] })
    if (isImage) {
      window.fastAgent.workspace.readImage(file.path)
        .then((result) => {
          if (requestId !== requestIdRef.current) return
          setImageUrl(result.dataUrl)
          // 图片没有行数概念，不报 meta：Header 只展示文件图标即可。
        })
        .catch((cause: unknown) => { if (requestId !== requestIdRef.current) return; setError(parseIpcError(cause, '图片加载失败')) })
      return
    }
    window.fastAgent.workspace.readFile(file.path)
      .then((result) => {
        if (requestId !== requestIdRef.current) return
        setContent(result.content)
        onMeta({
          kind: isMarkdown ? 'markdown' : 'code',
          language,
          lines: result.content.length > MAX_HIGHLIGHT_CODE_LENGTH ? null : result.content.split('\n').length,
          content: result.content
        })
        // 引用路径和工作区实际路径不一致（如引用裸文件名但文件在子目录），提示真实位置。
        const requestedPath = file.path.replace(/\\/g, '/').replace(/^\.\//, '')
        if (result.path !== requestedPath) onNotice(`已在工作区中匹配到 ${result.path}`)
        else if (result.truncated) onNotice('文件过大，仅显示前 2MB')
      })
      .catch((cause: unknown) => {
        if (requestId !== requestIdRef.current) return
        setError(parseIpcError(cause, '文件打开失败'))
      })
  }, [file.path, workspaceRoot, isImage, isMarkdown, language, onMeta, onNotice])

  if (error.message) return <div className="artifact-empty"><CircleAlert size={20} /><strong>无法打开</strong><span>{error.message}</span>{error.suggestions.length > 0 && (onPickSuggestion
    ? <div className="artifact-empty-suggestions">{error.suggestions.map((suggestion) => <button type="button" key={suggestion} className="file-row" onClick={() => onPickSuggestion(suggestion)}>{suggestion}</button>)}</div>
    : <div className="artifact-empty-suggestions"><span>你是不是要找:{error.suggestions.join('、')}</span></div>)}</div>
  if (isImage && imageUrl === null) return <div className="artifact-empty"><LoaderCircle size={20} className="spin" /><span>正在加载图片…</span></div>
  if (isImage) return <div className="file-viewer-image"><img src={imageUrl as string} alt={file.path} /></div>
  if (content === null) return <div className="artifact-empty"><LoaderCircle size={20} className="spin" /><span>正在读取…</span></div>

  // Markdown 预览态走独立渲染器；源码态与代码文件统一走 CodeViewer（源码不参与高亮，保持原文）。
  if (isMarkdown && viewMode === 'preview') {
    return <div className="file-viewer-markdown"><MarkdownRenderer content={content} /></div>
  }
  return <CodeViewer content={content} language={isMarkdown ? null : language} wrap={wrap} line={file.line} endLine={file.endLine} />
}
