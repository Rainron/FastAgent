import { useEffect, useState } from 'react'

type Listener = (src: string) => void
const listeners = new Set<Listener>()

/** 轻量发布订阅：缩略图遍布消息列表，不值得为看大图引入全局状态。 */
export function openLightbox(src: string) {
  listeners.forEach((listener) => listener(src))
}

/** 挂在 WorkspaceShell 末尾的大图层；Esc 与点击遮罩都能关。 */
export function LightboxLayer() {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const listener: Listener = (next) => setSrc(next)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
  useEffect(() => {
    if (!src) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSrc(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [Boolean(src)])
  if (!src) return null
  return <div className="lightbox" role="dialog" aria-label="查看大图" onClick={() => setSrc(null)}><img src={src} alt="" draggable={false} /></div>
}
