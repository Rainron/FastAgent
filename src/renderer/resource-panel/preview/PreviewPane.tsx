import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, CircleAlert, ExternalLink, FileCode2, Globe, LoaderCircle, Maximize2, Minimize2, Minus, Monitor, Plus, RotateCw, Scan, Smartphone, Tablet, X } from 'lucide-react'
import { CodeViewer } from '../CodeViewer'
import { parseIpcError } from '../../ipc-error'
import { computePreviewLayout, formatZoom, PREVIEW_DEVICE_ORDER, PREVIEW_DEVICES, stepZoom, ZOOM_STEPS, type PreviewDevice } from './preview-layout'
import { previewSubtitle } from './preview-target'
import { usePreviewSource } from './use-preview-source'
import { usePreviewView } from './use-preview-view'

const DEVICE_ICONS: Record<PreviewDevice, typeof Monitor> = { responsive: Scan, desktop: Monitor, tablet: Tablet, mobile: Smartphone }

/**
 * iframe 沙箱：放行脚本、表单、弹窗与同源（预览页的源与主界面不同，同源只让它能用自己的 localStorage），
 * 不放行 top-navigation——页面没法把整个应用导航走。window.open 由主进程统一转给系统浏览器。
 */
const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups'

export interface PreviewPaneSource {
  url: string | null
  path: string | null
  title: string
}

interface PreviewPaneProps {
  source: PreviewPaneSource
  maximized: boolean
  onToggleMaximize: () => void
  /** 返回资源列表；没有列表可回时不显示。 */
  onBack?: () => void
  onClose: () => void
  onNotice: (notice: string) => void
}

/** 右栏的网页预览：标题栏（打开/最大化/关闭）+ 工具栏（预览源码/设备/缩放/刷新）+ 画布。 */
export function PreviewPane({ source, maximized, onToggleMaximize, onBack, onClose, onNotice }: PreviewPaneProps) {
  const { url, error, loading, reloadKey, reload, retry } = usePreviewSource(source)
  const { view, updateView } = usePreviewView()
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview')
  const [code, setCode] = useState<{ content: string | null; error: string }>({ content: null, error: '' })
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ width: 0, height: 0 })

  useEffect(() => { setViewMode('preview') }, [source.path, source.url])

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setStage((current) => (current.width === Math.round(width) && current.height === Math.round(height) ? current : { width: Math.round(width), height: Math.round(height) }))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [viewMode])

  // 源码只在切过去时读：多数时候用户只看效果。每次切换都重读，拿到的是刷新后的最新内容。
  useEffect(() => {
    if (viewMode !== 'source' || !source.path) return
    let alive = true
    setCode({ content: null, error: '' })
    window.fastAgent.workspace.readFile(source.path)
      .then((result) => { if (alive) setCode({ content: result.content, error: '' }) })
      .catch((cause: unknown) => { if (alive) setCode({ content: null, error: parseIpcError(cause, '源码读取失败').message }) })
    return () => { alive = false }
  }, [viewMode, source.path, reloadKey])

  const layout = computePreviewLayout(stage, view.device, view.zoom)
  const openExternal = async () => {
    if (!url) return
    const failure = await window.fastAgent.preview.openExternal(url).catch(() => '无法在浏览器中打开')
    if (failure) onNotice(failure)
  }

  return <>
    <header className="artifact-header resource-header preview-header">
      {onBack && <button className="icon-button" aria-label="返回列表" title="返回列表" onClick={onBack}><ChevronLeft size={16} /></button>}
      <div className="artifact-heading">
        <span className="artifact-heading-icon">{source.path ? <FileCode2 size={15} /> : <Globe size={15} />}</span>
        <span className="artifact-heading-text">
          <strong title={source.title}>{source.title}</strong>
          <small title={url ?? source.path ?? ''}>{previewSubtitle({ url, path: source.path })}</small>
        </span>
      </div>
      <div className="file-preview-actions">
        <button className="icon-button" disabled={!url} onClick={() => void openExternal()} aria-label="在浏览器中打开" title="在浏览器中打开"><ExternalLink size={14} /></button>
        <button className={`icon-button ${maximized ? 'active' : ''}`} onClick={onToggleMaximize} aria-pressed={maximized} aria-label={maximized ? '还原' : '最大化'} title={maximized ? '还原（Esc）' : '最大化'}>{maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        <button className="icon-button" aria-label="关闭资源面板" title="关闭资源面板" onClick={onClose}><X size={16} /></button>
      </div>
    </header>
    <div className="preview-toolbar" role="toolbar" aria-label="预览工具栏">
      {source.path && <div className="view-mode-toggle" role="group" aria-label="预览方式">
        <button type="button" className={viewMode === 'preview' ? 'active' : ''} onClick={() => setViewMode('preview')}>预览</button>
        <button type="button" className={viewMode === 'source' ? 'active' : ''} onClick={() => setViewMode('source')}>源码</button>
      </div>}
      {viewMode === 'preview' && <>
        <div className="preview-device-group" role="group" aria-label="设备尺寸">
          {PREVIEW_DEVICE_ORDER.map((device) => {
            const Icon = DEVICE_ICONS[device]
            return <button key={device} type="button" className={`icon-button ${view.device === device ? 'active' : ''}`} aria-pressed={view.device === device} aria-label={PREVIEW_DEVICES[device].label} title={PREVIEW_DEVICES[device].label} onClick={() => updateView({ device })}><Icon size={13} /></button>
          })}
        </div>
        <div className="preview-zoom-group" role="group" aria-label="缩放">
          <button type="button" className="icon-button" aria-label="缩小" title="缩小" disabled={layout.scale <= ZOOM_STEPS[0]} onClick={() => updateView({ zoom: stepZoom(layout.scale, -1) })}><Minus size={13} /></button>
          <select value={view.zoom === 'fit' ? 'fit' : String(view.zoom)} onChange={(event) => updateView({ zoom: event.target.value === 'fit' ? 'fit' : Number(event.target.value) })} aria-label="缩放比例">
            <option value="fit">适应 · {formatZoom(layout.scale)}</option>
            {ZOOM_STEPS.map((step) => <option key={step} value={String(step)}>{formatZoom(step)}</option>)}
          </select>
          <button type="button" className="icon-button" aria-label="放大" title="放大" disabled={layout.scale >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} onClick={() => updateView({ zoom: stepZoom(layout.scale, 1) })}><Plus size={13} /></button>
        </div>
      </>}
      <button type="button" className="icon-button preview-reload" aria-label="刷新" title="刷新" disabled={!url} onClick={() => (error ? retry() : reload())}><RotateCw size={13} /></button>
    </div>
    {viewMode === 'source'
      ? code.error
        ? <div className="artifact-empty"><CircleAlert size={20} /><strong>无法读取源码</strong><span>{code.error}</span></div>
        : code.content === null
          ? <div className="artifact-empty"><LoaderCircle size={20} className="spin" /><span>正在读取…</span></div>
          : <CodeViewer content={code.content} language="html" wrap={false} line={null} endLine={null} />
      : <div ref={stageRef} className={`preview-stage${layout.framed ? ' framed' : ''}`}>
        {error
          ? <div className="artifact-empty"><CircleAlert size={20} /><strong>预览无法加载</strong><span>{error}</span><button className="small-control" onClick={retry}><RotateCw size={13} />重试</button></div>
          : loading || !url
            ? <div className="artifact-empty"><LoaderCircle size={20} className="spin" /><span>正在加载预览…</span></div>
            : stage.width > 0 && <div className="preview-box" style={{ width: layout.boxWidth, height: layout.boxHeight }}>
              <iframe
                key={reloadKey}
                src={url}
                title={source.title}
                sandbox={FRAME_SANDBOX}
                allow="clipboard-write; fullscreen"
                style={{ width: layout.frameWidth, height: layout.frameHeight, transform: layout.scale === 1 ? undefined : `scale(${layout.scale})` }}
              />
            </div>}
      </div>}
  </>
}
