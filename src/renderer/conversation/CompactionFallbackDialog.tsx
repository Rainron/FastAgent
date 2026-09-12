import { useState } from 'react'
import { AlertTriangle, Clock3, X } from 'lucide-react'
import type { ModelOption } from '../../shared/types'
import { modelMetaLabel } from '../model-picker'
import type { CompactionState } from './compaction-state'

export function CompactionFallbackDialog({ state, models, onRetry, onCancel, onClose }: { state: CompactionState; models: ModelOption[]; onRetry: (modelId: number) => void; onCancel: () => void; onClose: () => void }) {
  const candidates = models.filter((model) => model.id !== state.modelId)
  const [selected, setSelected] = useState<number | null>(candidates[0]?.id ?? null)
  return <div className="approval-overlay" role="dialog" aria-modal="true" aria-label="选择压缩模型">
    <div className="compaction-dialog">
      <div className="approval-header">
        <span className="approval-icon compaction-warning">{state.status === 'timed_out' ? <Clock3 size={16} /> : <AlertTriangle size={16} />}</span>
        <div className="approval-heading"><strong>{state.status === 'timed_out' ? '压缩响应超时' : '压缩未完成'}</strong><small>{state.error || '当前模型无法完成上下文压缩'}</small></div>
        <button className="icon-button" onClick={onClose} aria-label="关闭" title="关闭"><X size={14} /></button>
      </div>
      <div className="compaction-dialog-body">
        <p>请选择其它模型重试。重试模型只用于生成本次摘要，不会改变当前会话模型。</p>
        {candidates.length ? <div className="compaction-model-list" role="radiogroup" aria-label="压缩模型"><strong>可用模型</strong>{candidates.map((model) => <label className="compaction-model-option" key={model.id}><input type="radio" name="compaction-model" value={model.id} checked={selected === model.id} onChange={() => setSelected(model.id)} /><span><b>{model.model_name}</b><small>{model.provider} · {modelMetaLabel(model)}{model.context_window ? ` · 上下文 ${Math.round(model.context_window / 1000)}k` : ''}</small></span></label>)}</div> : <div className="compaction-empty">暂无其它可用模型，请检查模型配置。</div>}
      </div>
      <div className="approval-actions"><button className="approval-secondary" onClick={onCancel}>取消</button><button className="approval-primary" disabled={selected === null} onClick={() => { if (selected !== null) onRetry(selected) }}>使用此模型重试</button></div>
    </div>
  </div>
}
