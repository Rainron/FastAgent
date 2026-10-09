import type { PreviewTarget } from '../../shared/types'
import { PreviewPane, type PreviewPaneSource } from './preview/PreviewPane'
import { isHtmlPath } from './preview/preview-target'
import { useMemo } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, Code2, Copy, FileCode2, FileImage, FileText, LayoutPanelLeft, Search, WrapText, X } from 'lucide-react'
import type { FileReference } from '../ai-response/file-reference'
import { useResourcePanelState } from './use-panel-state'
import { MIN_PANEL_WIDTH } from './panel-state'
import { useResponseActions } from '../ai-response/response-context'
import { WorkspaceTree } from './WorkspaceTree'
import { ArtifactsTree } from './ArtifactsTree'
import { FileViewer, IMAGE_PATH_RE, MARKDOWN_PATH_RE, type FilePreviewMeta } from './FileViewer'

interface ResourcePanelProps {
  workspaceRoot: string | null
  /** 当前会话：Artifacts 页据此把本次会话的产物置顶展开。 */
  conversationId: string | null
  file: FileReference | null
  onPickWorkspace: () => void
  onOpenFile: (reference: FileReference) => void
  onCloseFile: () => void
  onClose: () => void
  onNotice: (notice: string) => void
  onPickSuggestion?: (path: string) => void
  /** 成果「继续修改」：把提示写进输入框，交给用户补充后自己发。 */
  onContinueEdit?: (text: string) => void
  /** 资源树选中项「添加到对话」：把路径引用追加进输入框。 */
  onAddToChat?: (text: string) => void
  /** 对话里的预览卡片或 preview_show 自动打开的网页；优先于文件预览显示。 */
  preview: PreviewTarget | null
  onClosePreview: () => void
}

/**
 * 统一的资源侧栏：Workspace 管「项目中有什么」，Artifacts 管「Agent 做出了什么」。
 * Header / Search 固定，Content 独立滚动；宽度可拖拽，状态（Tab、宽度、展开、滚动、搜索、选中）持久化。
 * 文件预览态的 Header 直接承担类型/行数展示与预览源码、换行、复制、关闭操作，内部不再有第二行工具栏。
 */
/** 打开时父组件会随流式输出每帧重渲染，面板内容与之无关，memo 挡住。 */
export const ResourcePanel = React.memo(function ResourcePanel({ workspaceRoot, conversationId, file, onPickWorkspace, onOpenFile, onCloseFile, onClose, onNotice, onPickSuggestion, onContinueEdit, onAddToChat, preview, onClosePreview }: ResourcePanelProps) {
  const { panelState, updatePanel, updateTab } = useResourcePanelState()
  const actions = useResponseActions()
  const activeTab = panelState.activeTab
  const tabState = activeTab === 'workspace' ? panelState.workspace : panelState.artifacts

  // 预览视图状态：换行开关（代码）与预览/源码（Markdown）由 Header 统一控制，切文件时重置。
  const [wrap, setWrap] = useState(false)
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview')
  const [previewMeta, setPreviewMeta] = useState<FilePreviewMeta | null>(null)

  useEffect(() => {
    setWrap(false)
    setViewMode('preview')
    setPreviewMeta(null)
  }, [file?.path])

  const handlePreviewMeta = useCallback((meta: FilePreviewMeta) => setPreviewMeta(meta), [])

  // 面板在窗口右侧：向左拖变宽、向右拖变窄；限制在 MIN 与窗口 70% 之间。
  const startResize = useCallback((event: React.PointerEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = panelState.width
    // 指针划过预览 iframe 时事件会被它吞掉，拖动就卡住；拖动期间让 iframe 不接收指针。
    document.body.classList.add('resource-resizing')
    const move = (moveEvent: PointerEvent) => {
      updatePanel({ width: Math.min(Math.max(startWidth - (moveEvent.clientX - startX), MIN_PANEL_WIDTH), Math.round(window.innerWidth * 0.7)) })
    }
    const up = () => {
      document.body.classList.remove('resource-resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [panelState.width, updatePanel])

  const rootName = workspaceRoot ? workspaceRoot.split(/[\\/]/).filter(Boolean).pop() || '工作区' : ''

  // 删除的文件（或所在目录）恰好是正在预览的目标时，由外层关闭预览，避免展示已不存在的文件。
  const handleFileDeleted = useCallback((path: string) => {
    if (file && (file.path === path || file.path.startsWith(`${path}/`))) onCloseFile()
  }, [file, onCloseFile])

  // 正在预览的文件（或它所在的目录）被拖走：预览跟到新位置，而不是关掉或指向已不存在的路径。
  const handleFileMoved = useCallback((from: string, to: string) => {
    if (file && (file.path === from || file.path.startsWith(`${from}/`))) onOpenFile({ ...file, path: `${to}${file.path.slice(from.length)}` })
  }, [file, onOpenFile])

  const isImage = file ? IMAGE_PATH_RE.test(file.path) : false
  const isMarkdown = file ? MARKDOWN_PATH_RE.test(file.path) : false
  const fileName = file ? file.path.split(/[\\/]/).filter(Boolean).pop() || file.path : ''
  // 换行开关对纯预览态的 Markdown 无意义；源码态与代码文件才需要。
  const showWrap = !isImage && !(isMarkdown && viewMode === 'preview')

  // 网页预览：显式打开的预览优先；工作区里点开的 .html 默认也渲染（工具栏里可切源码）。
  const previewTitle = preview?.title
  const previewUrl = preview?.url
  const previewPath = preview ? preview.path : file && isHtmlPath(file.path) ? file.path : null
  const previewSource = useMemo<PreviewPaneSource | null>(() => {
    if (previewUrl) return { url: previewUrl, path: previewPath, title: previewTitle || previewUrl }
    if (previewPath) return { url: null, path: previewPath, title: previewPath.split('/').pop() || previewPath }
    return null
  }, [previewUrl, previewPath, previewTitle])

  // 最大化：面板盖住整个主区（CSS 用 :has 让外层成为定位容器）。离开预览就还原，Esc 同样还原。
  const [maximized, setMaximized] = useState(false)
  const previewOpen = previewSource !== null
  useEffect(() => { if (!previewOpen) setMaximized(false) }, [previewOpen])
  useEffect(() => {
    if (!maximized) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      setMaximized(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [maximized])
  const toggleMaximize = useCallback(() => setMaximized((value) => !value), [])

  if (previewSource) {
    return <aside className={`artifact-panel resource-panel preview-panel${maximized ? ' maximized' : ''}`} style={maximized ? undefined : { width: panelState.width, flexBasis: panelState.width }}>
      <PreviewPane source={previewSource} maximized={maximized} onToggleMaximize={toggleMaximize} onBack={preview ? onClosePreview : onCloseFile} onClose={onClose} onNotice={onNotice} />
      {!maximized && <div className="resource-resizer" onPointerDown={startResize} aria-hidden="true" />}
    </aside>
  }

  return <aside className="artifact-panel resource-panel" style={{ width: panelState.width, flexBasis: panelState.width }}>
    <header className="artifact-header resource-header">
      {file
        // 文件预览态：返回列表 + 文件信息/类型/行数 + 预览源码/换行/复制/关闭
        ? <>
          <button className="icon-button" aria-label="返回列表" title="返回列表" onClick={onCloseFile}><ChevronLeft size={16} /></button>
          <div className="artifact-heading">
            <span className="artifact-heading-icon">{isImage ? <FileImage size={15} /> : isMarkdown ? <FileText size={15} /> : <FileCode2 size={15} />}</span>
            <span className="artifact-heading-text">
              <strong title={file.path}>{fileName}</strong>
              <small title={file.path}>{file.path}</small>
            </span>
          </div>
          <div className="file-preview-meta">
            {previewMeta && <>
              <span className="file-viewer-language">{previewMeta.language ?? previewMeta.kind}</span>
              <span className="file-preview-lines">{previewMeta.lines === null ? '大文件' : `${previewMeta.lines} 行`}</span>
            </>}
            {file.line !== null && <span className="file-viewer-jump">L{file.line}{file.endLine ? `-${file.endLine}` : ''}</span>}
          </div>
          <div className="file-preview-actions">
            {isMarkdown && <div className="view-mode-toggle" role="group" aria-label="预览方式">
              <button type="button" className={viewMode === 'preview' ? 'active' : ''} onClick={() => setViewMode('preview')}>预览</button>
              <button type="button" className={viewMode === 'source' ? 'active' : ''} onClick={() => setViewMode('source')}>源码</button>
            </div>}
            {showWrap && <button className={`icon-button ${wrap ? 'active' : ''}`} onClick={() => setWrap((value) => !value)} aria-pressed={wrap} aria-label="自动换行" title="自动换行"><WrapText size={14} /></button>}
            {!isImage && <button className="icon-button" disabled={!previewMeta} onClick={() => actions.copyText(previewMeta?.content ?? '')} aria-label="复制文件内容" title="复制文件内容"><Copy size={14} /></button>}
            <button className="icon-button" aria-label="关闭资源面板" title="关闭资源面板" onClick={onClose}><X size={16} /></button>
          </div>
        </>
        : <>
          <div className="resource-tabs" role="tablist" aria-label="资源面板">
            <button type="button" role="tab" aria-selected={activeTab === 'workspace'} className={activeTab === 'workspace' ? 'active' : ''} onClick={() => updatePanel({ activeTab: 'workspace' })}>Workspace</button>
            <button type="button" role="tab" aria-selected={activeTab === 'artifacts'} className={activeTab === 'artifacts' ? 'active' : ''} onClick={() => updatePanel({ activeTab: 'artifacts' })}>Artifacts</button>
          </div>
          <div className="artifact-heading resource-heading">
            <span className="artifact-heading-icon">{activeTab === 'workspace' ? <Code2 size={15} /> : <LayoutPanelLeft size={15} />}</span>
            <span className="artifact-heading-text">
              <strong title={workspaceRoot ?? ''}>{rootName || (activeTab === 'workspace' ? '工作区' : '产物')}</strong>
              <small>{activeTab === 'workspace' ? (workspaceRoot || '未打开项目') : 'Agent 执行产生的结果'}</small>
            </span>
          </div>
        </>}
      {!file && <div className="artifact-actions">
        <button className="icon-button" aria-label="关闭资源面板" title="关闭资源面板" onClick={onClose}><X size={16} /></button>
      </div>}
    </header>
    {file
      ? <FileViewer file={file} workspaceRoot={workspaceRoot} onNotice={onNotice} onPickSuggestion={onPickSuggestion} onMeta={handlePreviewMeta} wrap={wrap} viewMode={viewMode} />
      : <>
        <div className="resource-search">
          <Search size={14} />
          <input
            value={tabState.search}
            onChange={(event) => updateTab(activeTab, { search: event.target.value })}
            placeholder={activeTab === 'workspace' ? 'Search workspace files...' : 'Search artifacts...'}
            aria-label={activeTab === 'workspace' ? '搜索工作区文件' : '搜索产物'}
            spellCheck={false}
          />
        </div>
        <div className="resource-content">
          {!workspaceRoot
            ? <div className="resource-empty"><Code2 size={23} /><strong>未打开项目</strong><span>打开工作区后在这里管理文件与产物。</span><button className="small-control" onClick={onPickWorkspace}><Code2 size={14} />打开项目</button></div>
            : activeTab === 'workspace'
              ? <WorkspaceTree workspaceRoot={workspaceRoot} conversationId={conversationId} tabState={tabState} onTabStateChange={(patch) => updateTab('workspace', patch)} onOpenFile={onOpenFile} onNotice={onNotice} onFileDeleted={handleFileDeleted} onFileMoved={handleFileMoved} onAddToChat={onAddToChat} />
              : <ArtifactsTree workspaceRoot={workspaceRoot} conversationId={conversationId} tabState={tabState} onTabStateChange={(patch) => updateTab('artifacts', patch)} onOpenFile={onOpenFile} onNotice={onNotice} onFileDeleted={handleFileDeleted} onContinueEdit={onContinueEdit} onAddToChat={onAddToChat} />}
        </div>
      </>}
    <div className="resource-resizer" onPointerDown={startResize} aria-hidden="true" />
  </aside>
})
