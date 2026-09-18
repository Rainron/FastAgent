import { useCallback, useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Copy, MoreHorizontal, RotateCw, Share2, Trash2 } from 'lucide-react'
import { useResponseActions } from './response-context'
import { useDismiss } from '../use-dismiss'

/** 常驻只留复制与重新生成，其余进「···」，避免底部堆一排按钮。 */
export function MessageActions({ markdown, plainText, onRegenerate, onDelete, onCopyPair }: {
  /** 完整正文（Markdown 原文） */
  markdown: string
  /** 完整正文的纯文本形态；执行轨迹把前段归档后，正文区渲染的不是全文，复制不能跟着丢。 */
  plainText: string
  onRegenerate: () => void
  onDelete: () => void
  onCopyPair: () => void
}) {
  const actions = useResponseActions()
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1400)
    return () => window.clearTimeout(timer)
  }, [copied])

  // 原来是手写的 pointerdown 监听，漏了 Esc；换成公共 hook 与其他浮层保持一致
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  useDismiss(menuOpen, closeMenu, ref)

  return (
    <div className="message-actions assistant">
      <button className="message-action" onClick={() => { actions.copyText(markdown); setCopied(true) }} aria-label="复制" title={copied ? '已复制' : '复制'}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
      <button className="message-action" onClick={onRegenerate} aria-label="重新生成" title="重新生成"><RotateCw size={14} /></button>
      <span className="message-more" ref={ref}>
        <button className="message-action" onClick={() => setMenuOpen((value) => !value)} aria-label="更多" title="更多" aria-expanded={menuOpen}><MoreHorizontal size={14} /></button>
        {menuOpen && <div className="message-menu" role="menu">
          <button role="menuitem" onClick={() => { actions.copyText(markdown); setCopied(true); setMenuOpen(false) }}><Copy size={14} />复制为 Markdown</button>
          <button role="menuitem" onClick={() => { actions.copyText(plainText); setMenuOpen(false) }}><Copy size={14} />复制为纯文本</button>
          <button role="menuitem" onClick={() => { onCopyPair(); setMenuOpen(false) }}><Share2 size={14} />复制本轮问答</button>
          <button role="menuitem" className="danger-menu-item" onClick={() => { onDelete(); setMenuOpen(false) }}><Trash2 size={14} />删除本轮问答</button>
        </div>}
      </span>
    </div>
  )
}
