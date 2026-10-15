import { useEffect, useRef, useState } from 'react'
import { CircleAlert, ExternalLink, LoaderCircle } from 'lucide-react'
import { IMAGE_PATH_RE } from '../resource-panel/FileViewer'
import { useResponseActions } from '../ai-response/response-context'
import { displayPath } from '../ai-response/path-display'
import { openLightbox } from './Lightbox'
import { excerptLines, previewUnavailable } from './tool-read-excerpt'
import { useTraceDisplay } from './trace-display-context'

/**
 * 工具卡展开区里的读取预览：图片直接出图，文本给前 N 行节选。
 * 文本优先用工具调用记下的结果——那才是 Agent 当时读到的内容，而且不受路径限制：
 * 技能文件、工作区外的文件都在记录里，重新读盘反而会被工作区边界拦下来。
 * 只有记录还没落库时才经主进程读盘（按工作区边界校验，渲染进程不碰文件系统）；
 * 卡片没展开就不会挂载，不会在轨迹里批量读磁盘。
 */
export function ToolReadPreview({ path, workspaceRoot, recorded }: { path: string; workspaceRoot: string | null; recorded: string | null }) {
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
    if (!isImage && recorded !== null) { setContent(recorded); return }
    const done = <T,>(run: (value: T) => void) => (value: T) => { if (requestId === requestIdRef.current) run(value) }
    // 读盘失败不等于工具失败：工具的成败看卡片标题上的状态，这里只说明预览为什么出不来
    const fail = done<unknown>((cause) => setError(previewUnavailable(cause)))
    if (isImage) {
      window.fastAgent.workspace.readImage(path).then(done((result: { dataUrl: string }) => setImageUrl(result.dataUrl))).catch(fail)
      return
    }
    window.fastAgent.workspace.readFile(path).then(done((result: { content: string }) => setContent(result.content))).catch(fail)
  }, [path, wanted, isImage, recorded])

  if (!wanted) return null
  const label = displayPath(path, workspaceRoot)
  const openFile = display.openFileFromTrace
    ? <button type="button" className="tool-read-open" onClick={() => actions.openFile({ path, line: null, endLine: null })} title="在资源面板打开"><ExternalLink size={11} />打开</button>
    : null

  if (error) return <div className="tool-read-preview unavailable"><CircleAlert size={13} />{error}</div>
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
