import { useEffect, useState, type MouseEvent } from 'react'
import { Copy } from 'lucide-react'
import type { Attachment } from '../../shared/types'
import { openLightbox } from './Lightbox'

/** dataUrl 按 localPath 缓存：同一张图在输入区缩略图和消息历史里反复出现，只读一次盘。 */
const cache = new Map<string, string | null>()

export function isImageAttachment(attachment: Attachment): boolean {
  return attachment.type.startsWith('image/')
}

export function attachmentImageSrc(attachment: Attachment): string | null {
  return attachment.localPath ? cache.get(attachment.localPath) ?? null : null
}

/** 附件图片缩略图；路径失效或超限时静默退场，布局由调用方兜底。onOpen 缺省时点击开灯箱。 */
export function AttachmentImage({ attachment, title, onOpen }: { attachment: Attachment; title?: string; onOpen?: (attachment: Attachment) => void }) {
  const [src, setSrc] = useState<string | null>(() => attachmentImageSrc(attachment))
  const path = attachment.localPath
  useEffect(() => {
    let cancelled = false
    if (!path) return
    if (cache.has(path)) { setSrc(cache.get(path) ?? null); return }
    void window.fastAgent.files.readImage(path).then((dataUrl) => {
      cache.set(path, dataUrl)
      if (!cancelled) setSrc(dataUrl)
    })
    return () => { cancelled = true }
  }, [path])
  if (!src) return null
  async function copyImage(event: MouseEvent) {
    event.stopPropagation()
    const blob = await fetch(src!).then((response) => response.blob())
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
  }
  return <button type="button" className="msg-img" onClick={() => onOpen ? onOpen(attachment) : openLightbox(src)} title={title ?? attachment.name} aria-label={`查看 ${attachment.name}`}><img src={src} alt={attachment.name} loading="lazy" draggable={false} /><span className="msg-img-copy" role="button" tabIndex={0} onClick={(event) => { void copyImage(event) }} aria-label="复制图片" title="复制图片"><Copy size={13} /></span></button>
}

/** 原型 fmtSize：M 级一位小数，K 级向上取整，1K 起步。 */
export function formatAttachmentSize(size: number): string {
  return size >= 1048576 ? `${(size / 1048576).toFixed(1)}M` : `${Math.max(1, Math.round(size / 1024))}K`
}
