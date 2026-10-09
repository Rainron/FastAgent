import React, { useEffect, useState } from 'react'
import { Collapse } from '../Collapse'
import { ChevronDown, Copy, ExternalLink, FileCode2, FileImage, FileText, FolderOpen, LoaderCircle, WrapText, X } from 'lucide-react'
import type { Attachment } from '../../shared/types'
import { languageFromPath } from '../ai-response/highlight'
import { useResponseActions } from '../ai-response/response-context'
import { CodeViewer } from '../resource-panel/CodeViewer'
import { MarkdownRenderer } from '../resource-panel/MarkdownRenderer'
import { attachmentDirectory, attachmentMetaRows, attachmentPreviewKind } from './attachment-preview'
import { attachmentImageSrc } from './AttachmentImage'
import { openLightbox } from './Lightbox'

const headingIcons = { image: FileImage, markdown: FileText, text: FileCode2, binary: FileText }

/**
 * 消息里的附件预览，与资源面板、计划面板共用右侧那一栏。
 * 图片与文本在应用内展示，读不出文本的（PDF、压缩包、音视频）只给元信息和系统打开入口。
 */
export const AttachmentPanel = React.memo(function AttachmentPanel({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const kind = attachmentPreviewKind(attachment)
  const path = attachment.localPath ?? ''
  const actions = useResponseActions()
  const [wrap, setWrap] = useState(false)
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview')
  const [content, setContent] = useState<string | null>(null)
  const [image, setImage] = useState<string | null>(() => attachmentImageSrc(attachment))
  // 像素尺寸只能等图解码完才知道，元数据区因此是渐进补全的
  const [pixels, setPixels] = useState<string | null>(null)
  const [metaOpen, setMetaOpen] = useState(false)
  // 读不出内容（二进制、超限、路径失效）就退回元信息卡，不弹错误。
  const [unreadable, setUnreadable] = useState(kind === 'binary' || !path)
  useEffect(() => {
    let cancelled = false
    setContent(null)
    setPixels(null)
    setImage(attachmentImageSrc(attachment))
    setUnreadable(kind === 'binary' || !path)
    if (!path || kind === 'binary') return
    if (kind === 'image') {
      // 读失败（通道缺失、路径失效）也要落到元信息卡，否则会永远停在「正在加载」
      void window.fastAgent.files.readImage(path).catch(() => null).then((dataUrl) => {
        if (cancelled) return
        if (dataUrl) setImage(dataUrl)
        else setUnreadable(true)
      })
      return () => { cancelled = true }
    }
    void window.fastAgent.files.readText(path).catch(() => null).then((text) => {
      if (cancelled) return
      if (text === null) setUnreadable(true)
      else setContent(text)
    })
    return () => { cancelled = true }
  }, [attachment, kind, path])

  const HeadingIcon = headingIcons[kind]
  const showWrap = !unreadable && kind !== 'image' && !(kind === 'markdown' && viewMode === 'preview')
  const metaRows = attachmentMetaRows(attachment, { lines: content === null ? undefined : content.split('\n').length, pixels: pixels ?? undefined })
  const metaList = <dl className="attachment-meta">{metaRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd title={row.value}>{row.value}</dd></div>)}</dl>
  // 能预览时元数据默认收起，别把正文往下挤；预览不出来时它就是正文，不给折叠
  const metaBlock = <div className={`attachment-meta-block${metaOpen ? ' open' : ''}`}>
    <button type="button" className="attachment-meta-toggle" aria-expanded={metaOpen} onClick={() => setMetaOpen((value) => !value)}><ChevronDown size={13} />文件信息</button>
    <Collapse open={metaOpen}>{metaList}</Collapse>
  </div>
  return <aside className="artifact-panel attachment-panel" aria-label="附件预览">
    <header className="artifact-header">
      <div className="artifact-heading">
        <span className="artifact-heading-icon"><HeadingIcon size={15} /></span>
        <span className="artifact-heading-text">
          <strong title={path || attachment.name}>{attachment.name}</strong>
        </span>
      </div>
      <div className="file-preview-actions">
        {kind === 'markdown' && !unreadable && <div className="view-mode-toggle" role="group" aria-label="预览方式">
          <button type="button" className={viewMode === 'preview' ? 'active' : ''} onClick={() => setViewMode('preview')}>预览</button>
          <button type="button" className={viewMode === 'source' ? 'active' : ''} onClick={() => setViewMode('source')}>源码</button>
        </div>}
        {showWrap && <button className={`icon-button ${wrap ? 'active' : ''}`} onClick={() => setWrap((value) => !value)} aria-pressed={wrap} aria-label="自动换行" title="自动换行"><WrapText size={14} /></button>}
        {content !== null && <button className="icon-button" onClick={() => actions.copyText(content)} aria-label="复制文件内容" title="复制文件内容"><Copy size={14} /></button>}
        {path && <button className="icon-button" onClick={() => void openWithSystem(path, actions.notify)} aria-label="用本地应用打开" title="用本地应用打开"><ExternalLink size={14} /></button>}
        {path && <button className="icon-button" onClick={() => void openWithSystem(attachmentDirectory(path), actions.notify)} aria-label="打开所在文件夹" title="打开所在文件夹"><FolderOpen size={14} /></button>}
        <button className="icon-button" aria-label="关闭附件预览" title="关闭附件预览" onClick={onClose}><X size={16} /></button>
      </div>
    </header>
    {unreadable
      // 预览不出来时元数据就是正文：完整信息 + 交给系统打开的两个出口
      ? <div className="attachment-unreadable">
        <div className="attachment-unreadable-head">
          <span className="artifact-heading-icon"><HeadingIcon size={18} /></span>
          <strong>{attachment.name}</strong>
          <span className="attachment-unreadable-hint">{path ? '这个类型不能在应用内预览' : '附件没有本地路径，可能来自已清理的会话'}</span>
        </div>
        {metaList}
        {path && <div className="attachment-unreadable-actions">
          <button type="button" className="text-button" onClick={() => void openWithSystem(path, actions.notify)}><ExternalLink size={13} />用系统程序打开</button>
          <button type="button" className="text-button" onClick={() => void openWithSystem(attachmentDirectory(path), actions.notify)}><FolderOpen size={13} />打开所在文件夹</button>
        </div>}
      </div>
      : <>
        {metaBlock}
        {kind === 'image'
          ? image === null
            ? <div className="artifact-empty"><LoaderCircle size={20} className="spin" /><span>正在加载图片…</span></div>
            // 面板里看的是受面板宽度限制的图，再点一次进灯箱看全屏原图
            : <div className="file-viewer-image"><button type="button" className="attachment-image-zoom" onClick={() => openLightbox(image)} aria-label={`全屏查看 ${attachment.name}`} title="点击查看大图"><img src={image} alt={attachment.name} onLoad={(event) => setPixels(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)} /></button></div>
          : content === null
            ? <div className="artifact-empty"><LoaderCircle size={20} className="spin" /><span>正在读取…</span></div>
            : kind === 'markdown' && viewMode === 'preview'
              ? <div className="file-viewer-markdown"><MarkdownRenderer content={content} /></div>
              : <CodeViewer content={content} language={kind === 'markdown' ? null : languageFromPath(attachment.name)} wrap={wrap} line={null} endLine={null} />}
      </>}
  </aside>
})

async function openWithSystem(path: string, notify: (message: string) => void) {
  const error = await window.fastAgent.shell.openPath(path).catch(() => '打开失败')
  if (error) notify(error)
}
