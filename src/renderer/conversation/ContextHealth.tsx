import { memo, useCallback, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, History, Minimize2 } from 'lucide-react'
import { useDismiss } from '../use-dismiss'
import type { CompactionState } from './compaction-state'
import type { ContextPolicy, ModelUsageSummary } from '../../shared/types'
import { compactionSummaryLabel, contextHealthView } from './context-health-view'
import './context-usage.css'

export interface ContextHealthData {
  estimatedTokens: number
  contextWindow: number
  messageTokens: number
  toolTokens: number
  systemTokens: number
  summaryTokens?: number
  attachmentTokens?: number
  countingMethod?: 'provider-usage' | 'fallback-estimate'
  modelId?: number | null
  provider?: string | null
  compactionCount: number
  latestCompactionAt?: string | null
  usage?: ModelUsageSummary
  usagePending?: boolean
}

function formatTokens(value: number) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(value)))
}

/**
 * 原型触发器上的环形表：外径 20、半径 8，弧长 50.3，用 dashoffset 表达占用比。
 * 阈值刻度画在同一个圆上：不标出来的话，用户没法把这个百分比和「什么时候会压」对上。
 */
function MeterRing({ ratio, mark }: { ratio: number; mark: number | null }) {
  const circumference = 50.3
  return <span className="meter" aria-hidden="true"><svg viewBox="0 0 20 20" width="18" height="18">
    <circle className="meter-track" cx="10" cy="10" r="8" fill="none" strokeWidth="2.5" />
    <circle className="meter-fill" cx="10" cy="10" r="8" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} />
    {mark !== null && <circle
      className="meter-mark"
      cx="10" cy="10" r="8" fill="none" strokeWidth="2.5"
      strokeDasharray={`1.4 ${circumference - 1.4}`}
      strokeDashoffset={-circumference * mark}
    />}
  </svg></span>
}

export const ContextHealth = memo(function ContextHealth({ data, policy, onCompact, onCancelCompaction, onOpenHistory, compaction }: {
  data: ContextHealthData
  /** 这条会话实际生效的压缩策略；决定刻度位置与配色。未就绪时按「未启用」保守展示。 */
  policy?: Pick<ContextPolicy, 'strategy' | 'autoSummary' | 'triggerRatio'> | null
  onCompact?: () => void
  onCancelCompaction?: () => void
  /** 打开会话详情的压缩历史；没压过时不给入口。 */
  onOpenHistory?: () => void
  compaction?: CompactionState | null
}) {
  const [open, setOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  // 与其他浮层一致：点外部或 Esc 关闭，不必回到触发按钮再点一次
  useDismiss(open, close, ref)
  const view = contextHealthView({ estimatedTokens: data.estimatedTokens, contextWindow: data.contextWindow, policy: policy ?? null })
  const running = compaction?.status === 'running'
  return <div className={`context-health ${view.level}`} ref={ref}>
    <button className="context-health-trigger" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog" title={`${view.headline}${data.usagePending ? '；本次用量待返回' : ''}`}>
      <MeterRing ratio={view.ratio} mark={view.triggerMark} /><span>{view.percent}%</span><ChevronDown size={12} />
    </button>
    {open && <div className="context-health-popover" role="dialog" aria-label="上下文使用情况">
      <div className="context-health-heading"><strong>上下文使用情况</strong><span>{formatTokens(data.estimatedTokens)} / {formatTokens(data.contextWindow)}</span></div>
      <div className="context-health-bar">
        <span style={{ width: `${view.percent}%` }} />
        {view.triggerMark !== null && <i className="context-health-threshold" style={{ left: `${Math.round(view.triggerMark * 100)}%` }} aria-hidden="true" />}
      </div>
      <p className="context-health-headline">{view.headline}</p>

      {running
        ? <div className="context-health-compaction" aria-live="polite">
          <div className="context-health-compaction-label"><span>{compaction.phase}</span><span>{compaction.progress}%</span></div>
          <div className="context-health-compaction-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={compaction.progress}><span style={{ width: `${compaction.progress}%` }} /></div>
          <small>{compaction.auto ? '本轮上下文正在自动压缩' : '当前会话正在压缩，暂时无法发送；可切换到其它会话继续问答'}</small>
          {onCancelCompaction && <button className="context-health-action" onClick={onCancelCompaction}>取消压缩</button>}
        </div>
        : onCompact && <button className="context-health-action primary" onClick={() => { onCompact(); setOpen(false) }}><Minimize2 size={12} />立即压缩</button>}

      <button
        className="context-health-compactions"
        onClick={() => { if (data.compactionCount) { onOpenHistory?.(); setOpen(false) } }}
        disabled={!data.compactionCount || !onOpenHistory}
        title={data.compactionCount ? '查看压缩历史' : '这个会话还没有压缩记录'}
      >
        <History size={12} />{compactionSummaryLabel(data.compactionCount, data.latestCompactionAt)}
        {Boolean(data.compactionCount) && onOpenHistory && <ChevronRight size={12} />}
      </button>

      <button className={`context-health-detail-toggle${detailOpen ? ' open' : ''}`} onClick={() => setDetailOpen((value) => !value)} aria-expanded={detailOpen}>
        <ChevronRight size={12} />占用明细
      </button>
      {detailOpen && <>
        <dl className="context-health-breakdown">
          <div><dt>消息</dt><dd>{formatTokens(data.messageTokens)}</dd></div>
          <div><dt>工具</dt><dd>{formatTokens(data.toolTokens)}</dd></div>
          <div><dt>系统</dt><dd>{formatTokens(data.systemTokens)}</dd></div>
          {Boolean(data.summaryTokens) && <div><dt>摘要</dt><dd>{formatTokens(data.summaryTokens || 0)}</dd></div>}
          {Boolean(data.attachmentTokens) && <div><dt>附件</dt><dd>{formatTokens(data.attachmentTokens || 0)}</dd></div>}
        </dl>
        <div className="context-health-meta"><span>计量</span><span>{data.countingMethod === 'provider-usage' ? '总量：模型 usage · 分类：比例估算' : '统一估算'}</span></div>
        {data.usagePending && <p className="context-health-pending" role="status">正在生成，本次用量待返回。</p>}
        <p className="context-health-note">模型缓存与 token 成本在「会话详情 › Context」里。</p>
      </>}
    </div>}
  </div>
})
