import { useEffect, useRef, useState } from 'react'
import { CircleAlert, ExternalLink, LoaderCircle } from 'lucide-react'
import { IMAGE_PATH_RE } from '../resource-panel/FileViewer'
import { useResponseActions } from '../ai-response/response-context'
import { displayPath } from '../ai-response/path-display'
import { openLightbox } from './Lightbox'
import { excerptLines } from './tool-read-excerpt'
import { useTraceDisplay } from './trace-display-context'

/**
 * 工具卡展开区里的读取预览：图片直接出图，文本给前 N 行节选。
 * 内容一律经主进程按工作区边界校验后返回，渲染进程不碰文件系统；
 * 卡片没展开就不会挂载，不会在轨迹里批量读磁盘。
 */
export function ToolReadPreview({ path, workspaceRoot }: { path: string; workspaceRoot: string | null }) {
  const display = useTraceDisplay()
  const actions = useResponseActions()
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState('')
  const requestIdRef = useRef(0)
  const isImage = IMAGE_PATH_RE.test(path)
  const wanted = isImage ? display.inlineImagePreview : display.textExcerpt

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setImageUrl(null)
    setContent(null)
    setError('')
    if (!wanted) return
    const done = <T,>(run: (value: T) => void) => (value: T) => { if (requestId === requestIdRef.current) run(value) }
    const fail = done<unknown>(() => setError(isImage ? '图片加载失败' : '文件读取失败'))
    if (isImage) {
      window.fastAgent.workspace.readImage(path).then(done((result: { dataUrl: string }) => setImageUrl(result.dataUrl))).catch(fail)
      return
    }
    window.fastAgent.workspace.readFile(path).then(done((result: { content: string }) => setContent(result.content))).catch(fail)
  }, [path, wanted, isImage])

  if (!wanted) return null
  const label = displayPath(path, workspaceRoot)
  const openFile = display.openFileFromTrace
    ? <button type="button" className="tool-read-open" onClick={() => actions.openFile({ path, line: null, endLine: null })} title="在资源面板打开"><ExternalLink size={11} />打开</button>
    : null

  if (error) return <div className="tool-read-preview error"><CircleAlert size={13} />{error}</div>
  if (isImage) {
    if (!imageUrl) return <div className="tool-read-preview loading"><LoaderCircle size={13} className="spin" />正在加载图片…</div>
    return <div className="tool-read-preview image">
      <div className="tool-read-head"><span className="tool-read-path" title={path}>{label}</span>{openFile}</div>
      <button type="button" className="tool-read-image" onClick={() => openLightbox(imageUrl)} title="查看大图"><img src={imageUrl} alt={label} draggable={false} /></button>
    </div>
  }
  if (content === null) return <div className="tool-read-preview loading"><LoaderCircle size={13} className="spin" />正在读取…</div>
  const { body, remaining } = excerptLines(content, display.textExcerptLines)
  return <div className="tool-read-preview text">
    <div className="tool-read-head"><span className="tool-read-path" title={path}>{label}</span>{openFile}</div>
    <pre className="tool-read-excerpt">{body}</pre>
    {remaining > 0 && <div className="tool-read-more">还有 {remaining} 行未显示</div>}
  </div>
}
