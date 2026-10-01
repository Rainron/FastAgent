import { AlertTriangle, Info, Minimize2, Settings2 } from 'lucide-react'
import type { ContextPressure } from './context-pressure'

/**
 * 输入框上方的上下文余量提示。
 * 只在越过预警线时出现：常驻的百分比已经在工具栏的上下文环上，这里是「需要你做点什么」的那一档。
 *
 * 布局与 AgentRunBar / ResumeBar 同一套包装（run-bar-wrap + conversation-content），
 * 否则这条提示会横贯整个主区，而输入框是 900px 居中的，两者左右对不齐。
 */
export function ContextPressureBar({ pressure, onCompact, onOpenSettings }: {
  pressure: ContextPressure
  onCompact?: () => void
  onOpenSettings?: () => void
}) {
  const Icon = pressure.tone === 'notice' ? Info : AlertTriangle
  // 触发刻度落在水位条上，用户一眼能看出「还差多少到自动压缩」，不必去读文案里的数字。
  const markPercent = pressure.triggerRatio === null ? null : Math.min(100, Math.max(0, pressure.triggerRatio * 100))
  return <div className="run-bar-wrap context-pressure-wrap">
    <div className={`conversation-content context-pressure ${pressure.tone}`} role={pressure.tone === 'danger' ? 'alert' : 'status'}>
      <span className="context-pressure-icon" aria-hidden="true"><Icon size={14} /></span>
      <div className="context-pressure-body">
        <strong className="context-pressure-title">{pressure.title}</strong>
        <span className="context-pressure-detail">{pressure.detail}</span>
      </div>
      <div className="context-pressure-actions">
        {pressure.showSettings && onOpenSettings && <button type="button" className="context-pressure-action" onClick={onOpenSettings} title="打开压缩设置">
          <Settings2 size={12} />压缩设置
        </button>}
        {pressure.showCompact && onCompact && <button type="button" className="context-pressure-action primary" onClick={onCompact} title="立即压缩这条会话的上下文">
          <Minimize2 size={12} />立即压缩
        </button>}
      </div>
      {/* 水位条脱离栅格贴在卡片下沿，所以放在最后而不是正文里 */}
      <div className="context-pressure-meter" aria-hidden="true">
        <span className="context-pressure-fill" style={{ width: `${Math.min(100, Math.max(2, pressure.ratio * 100))}%` }} />
        {markPercent !== null && <span className="context-pressure-mark" style={{ left: `${markPercent}%` }} />}
      </div>
    </div>
  </div>
}
