import { useEffect, useState } from 'react'
import { ExternalLink, Globe, LoaderCircle, PanelRight } from 'lucide-react'
import type { PreviewToolDetails } from '../../shared/types'
import { useResponseActions } from '../ai-response/response-context'
import { previewSubtitle } from '../resource-panel/preview/preview-target'
import { previewBadges, readPreviewDetails } from './preview-card'

type CardStatus = 'pending' | 'streaming' | 'completed' | 'error'

/**
 * preview_show 的结果卡片：常显在工具行下方，像图片一样一眼能看到。
 * 缩略图来自主进程离屏检查时的截图；点缩略图或「预览」在右栏打开实时页面。
 */
export function PreviewToolCard({ turnId, toolCallId, status }: { turnId: string; toolCallId: string; status: CardStatus }) {
  const actions = useResponseActions()
  const [details, setDetails] = useState<PreviewToolDetails | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [shot, setShot] = useState<string | null>(null)
  const finished = status === 'completed' || status === 'error'

  // 工具结果在发出 tool_result 事件之前已经落库，状态一变成完成就能读到。
  useEffect(() => {
    if (!finished) return
    let alive = true
    window.fastAgent.conversations.listToolCalls(turnId)
      .then((calls) => {
        if (!alive) return
        const record = calls.find((call) => call.id === toolCallId)
        setConversationId(record?.conversationId ?? null)
        setDetails(record ? readPreviewDetails(record.result) : null)
      })
      .catch(() => { if (alive) setDetails(null) })
    return () => { alive = false }
  }, [finished, turnId, toolCallId])

  useEffect(() => {
    if (!details?.screenshotPath || !conversationId) return
    let alive = true
    window.fastAgent.preview.screenshot(conversationId, toolCallId)
      .then((dataUrl) => { if (alive) setShot(dataUrl) })
      .catch(() => { if (alive) setShot(null) })
    return () => { alive = false }
  }, [details?.screenshotPath, conversationId, toolCallId])

  if (!finished) return <div className="preview-card loading"><LoaderCircle size={13} className="spin" />正在渲染预览…</div>
  if (!details) return null

  const title = details.target.title || details.target.path || details.target.url
  const open = () => actions.openPreview(details.target)
  const openExternal = async () => {
    const failure = await window.fastAgent.preview.openExternal(details.target.url).catch(() => '无法在浏览器中打开')
    if (failure) actions.notify(failure)
  }

  return <div className={`preview-card ${details.status}`}>
    <button type="button" className="preview-card-thumb" onClick={open} title="在右侧预览">
      {shot ? <img src={shot} alt={title} draggable={false} /> : <span className="preview-card-placeholder"><Globe size={20} /></span>}
    </button>
    <div className="preview-card-body">
      <strong title={title}>{title}</strong>
      <small title={details.target.url}>{previewSubtitle(details.target)}</small>
      <div className="preview-card-badges">
        {previewBadges(details).map((badge) => <span key={badge.label} className={`preview-badge ${badge.tone}`}>{badge.label}</span>)}
      </div>
      <div className="preview-card-actions">
        <button type="button" className="small-control" onClick={open}><PanelRight size={13} />预览</button>
        <button type="button" className="small-control" onClick={() => void openExternal()}><ExternalLink size={13} />浏览器打开</button>
      </div>
    </div>
  </div>
}
