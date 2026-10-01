import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { CompactionHistory, type CompactionHistoryItem } from './CompactionHistory'
import { ContextHealth, type ContextHealthData } from './ContextHealth'
import { ModelCacheUsage } from './ModelCacheUsage'
import { AgentRunLedger } from './AgentRunLedger'
import type { CompactionState } from './compaction-state'
import { ConversationPolicyEditor } from './ConversationPolicyEditor'
import type { ContextPolicy, ContextStrategy, ToolCallRecord } from '../../shared/types'

export interface ConversationInspectorData {
  conversation: { id: string; title: string; createdAt: string; updatedAt: string }
  runtime: { mode: string; model: string; provider?: string; reasoning?: string; permission?: string; status: string; agentSessionId?: string | null; maxTokens?: number | null }
  context: ContextHealthData
  summary?: { text: string; version: number; createdAt: string } | null
  history: CompactionHistoryItem[]
  agent?: { toolCalls: number; latestStep?: string | null; failureReason?: string | null; startedAt?: string | null; finishedAt?: string | null; toolCallsDetailed?: ToolCallRecord[] }
  policy?: { strategy: ContextStrategy; triggerRatio: number | null; autoSummary: boolean; forceCompaction: boolean; inheritGlobal: boolean }
}

export function ConversationInspector({ data, onClose, onRefresh, onCompact, onCancelCompaction, onUpdatePolicy, initialSection = 'summary', compaction }: { data: ConversationInspectorData; onClose: () => void; onRefresh?: () => void; onCompact?: () => void; onCancelCompaction?: () => void; onUpdatePolicy?: (conversationId: string, patch: Partial<Omit<ContextPolicy, 'conversationId'>>) => void; /** 从上下文环的「已压缩 N 次」进来时直接停在压缩历史。 */ initialSection?: 'summary' | 'history' | 'agent'; compaction?: CompactionState | null }) {
  const [section, setSection] = useState<'summary' | 'history' | 'agent'>(initialSection)
  // 面板常驻，换会话或换入口时要跟着重新定位，否则第二次点「压缩历史」还停在摘要页。
  useEffect(() => { setSection(initialSection) }, [initialSection, data.conversation.id])
  useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }; window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown) }, [onClose])
  return <aside className="artifact-panel inspector-panel"><div className="artifact-header"><div className="artifact-title"><span>会话详情</span></div><div className="artifact-actions">{onRefresh && <button className="icon-button" onClick={onRefresh} aria-label="刷新会话详情" title="刷新"><RefreshCw size={14} /></button>}<button className="icon-button" onClick={onClose} aria-label="关闭会话详情" title="关闭"><X size={16} /></button></div></div><div className="inspector-scroll"><div className="inspector-title"><strong>{data.conversation.title}</strong><small>{data.conversation.id}</small></div><section className="inspector-section"><h3>Runtime</h3><dl className="inspector-grid"><div><dt>模式</dt><dd>{data.runtime.mode}</dd></div><div><dt>模型</dt><dd>{data.runtime.model}</dd></div><div><dt>Provider</dt><dd>{data.runtime.provider || '—'}</dd></div><div><dt>Reasoning</dt><dd>{data.runtime.reasoning || '—'}</dd></div><div><dt>状态</dt><dd>{data.runtime.status}</dd></div><div><dt>权限</dt><dd>{data.runtime.permission || '—'}</dd></div></dl></section><section className="inspector-section"><h3>Context</h3><ContextHealth data={data.context} policy={data.policy} onCompact={onCompact} onCancelCompaction={onCancelCompaction} onOpenHistory={() => setSection('history')} compaction={compaction} /><ModelCacheUsage usage={data.context.usage} pending={data.context.usagePending} /></section><section className="inspector-section"><div className="inspector-section-heading"><h3>详情</h3><div className="inspector-tabs" role="tablist"><button className={section === 'summary' ? 'active' : ''} onClick={() => setSection('summary')}>摘要</button><button className={section === 'history' ? 'active' : ''} onClick={() => setSection('history')}>压缩历史</button><button className={section === 'agent' ? 'active' : ''} onClick={() => setSection('agent')}>Agent</button></div></div>{section === 'summary' && <div className="inspector-summary">{data.summary?.text || '暂无结构化摘要'}</div>}{section === 'history' && <CompactionHistory items={data.history} />}{section === 'agent' && <dl className="inspector-grid">{data.agent ? <><div><dt>工具调用</dt><dd>{data.agent.toolCalls}</dd></div><div><dt>最近步骤</dt><dd>{data.agent.latestStep || '—'}</dd></div><div><dt>失败原因</dt><dd>{data.agent.failureReason || '—'}</dd></div></> : <div className="inspector-empty">暂无运行数据</div>}</dl>}{section === 'agent' && <AgentRunLedger conversationId={data.conversation.id} />}{section === 'agent' && (data.agent?.toolCallsDetailed?.length ?? 0) > 0 && <div className="inspector-toolcalls">{data.agent?.toolCallsDetailed?.map((call) => <div className={`inspector-toolcall ${call.status}`} key={call.id}><span className="inspector-toolcall-name">{call.toolName}</span><span className="inspector-toolcall-status">{call.status === 'denied' ? '拒绝' : call.status === 'failed' ? '失败' : call.status === 'success' ? '完成' : call.status}</span>{typeof call.durationMs === 'number' && call.durationMs !== null && <span>{call.durationMs}ms</span>}{(call.result as { additions?: number } | null)?.additions ? <span>+{(call.result as { additions?: number } | null)?.additions} -{(call.result as { deletions?: number } | null)?.deletions ?? 0}</span> : null}</div>)}</div>}</section><section className="inspector-section"><h3>上下文策略</h3>{data.policy && onUpdatePolicy
      ? <ConversationPolicyEditor
        policy={data.policy}
        contextWindow={data.context.contextWindow}
        maxTokens={data.runtime.maxTokens}
        disabled={compaction?.status === 'running'}
        onChange={(patch) => onUpdatePolicy(data.conversation.id, patch)}
      />
      : <dl className="inspector-grid"><div><dt>策略</dt><dd>{data.policy?.strategy || 'auto'}</dd></div><div><dt>自动压缩</dt><dd>{data.policy?.autoSummary === false ? '关闭' : '开启'}</dd></div><div><dt>作用范围</dt><dd>{data.policy?.inheritGlobal === false ? '单会话覆盖' : '跟随全局设置'}</dd></div></dl>}</section></div></aside>
}

