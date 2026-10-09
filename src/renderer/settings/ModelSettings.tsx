import { filterSettingsModels } from './settings-model-filter'
import { useMemo, useState } from 'react'
import { Check, LoaderCircle, Plug, Star } from 'lucide-react'
import type { LocalModelSummary, ModelOption } from '../../shared/types'
import { CenterDialog } from '../components/CenterDialog'
import { mergeModelOptions } from '../model-picker'
import { useModelSettings } from './hooks/use-model-settings'
import { ModelConnections } from '../model-connections/ModelConnections'
import { ModelParameterFields } from './ModelParameterFields'
import { draftFromSource, overrideFromDraft, type ModelParameterDraft } from './model-parameter-draft'
import { overrideKey, type ModelParameterOverride } from '../../shared/model-parameters'

/**
 * 云端模型的本地参数覆盖面板。
 *
 * 云端下发值改不了，但它不一定对；覆盖存在本机、永远优先，清空即回落到下发值。
 * 与连接内模型共用同一个字段组件，两边只是提交去向不同。
 */
function CloudModelParameters({ model, override, onSave, onNotice }: {
  onNotice: (notice: string) => void
  model: ModelOption
  override?: ModelParameterOverride
  onSave: (model: ModelOption, override: ModelParameterOverride) => Promise<void>
}) {
  const [draft, setDraft] = useState<ModelParameterDraft>(() => draftFromSource(override ?? null))
  const [saving, setSaving] = useState(false)
  const next = overrideFromDraft(draft)

  async function submit(value: ModelParameterOverride) {
    setSaving(true)
    try { await onSave(model, value) } catch (error) { onNotice(error instanceof Error ? error.message : '参数保存失败') } finally { setSaving(false) }
  }

  return <div className="model-settings-parameters">
    <ModelParameterFields
      draft={draft}
      placeholders={{
        contextWindow: model.context_window ? { value: model.context_window, origin: '云端下发' } : undefined,
        maxTokens: model.max_tokens ? { value: model.max_tokens, origin: '云端下发' } : undefined,
        modelKind: model.model_kind === 'multimodal' ? '云端：多模态' : '云端：文本对话',
        supportsThinking: model.supports_thinking ? '云端：支持思考' : '云端：不支持'
      }}
      onChange={setDraft}
      onClear={() => { setDraft(draftFromSource(null)); void submit({}) }}
    />
    <div className="model-settings-actions">
      <button className="small-control" disabled={saving || !next} onClick={() => next && void submit(next)}>保存本地参数</button>
    </div>
  </div>
}

export function ModelSettings({ models, selectedModelId, defaultModelId, favoriteModelIds, localModels, onSelectModel, onToggleFavorite, onTestDialogue, onNotice }: {
  models: ModelOption[]
  selectedModelId: number | null
  defaultModelId: number | null
  favoriteModelIds: number[]
  localModels: LocalModelSummary[]
  onSelectModel: (modelId: number) => void
  onToggleFavorite: (modelId: number) => void
  onTestDialogue: (id: number) => Promise<{ ok: boolean; error?: string; latencyMs?: number }>
  onNotice: (notice: string) => void
}) {
  const { overrides, testingId, saveOverride, handleTestOne, bulkRunning, bulkResults, bulkTargets, runBulkTest } = useModelSettings(models, localModels, onTestDialogue, onNotice)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'cloud' | 'local' | 'favorite'>('all')
  const [connectionsOpen, setConnectionsOpen] = useState(false)
  const [editingModelId, setEditingModelId] = useState<number | null>(null)
  const allModels = useMemo(() => mergeModelOptions(models, localModels), [models, localModels])
  const visible = useMemo(() => filterSettingsModels(allModels, query, filter, favoriteModelIds), [allModels, query, filter, favoriteModelIds])
  const current = allModels.find((model) => model.id === (defaultModelId ?? selectedModelId))
  const editing = allModels.find((model) => model.id === editingModelId)

  return <section className="settings-panel model-settings" aria-labelledby="settings-models">
    <div className="settings-section-heading"><div><h2 id="settings-models">模型工作台</h2><p>管理默认模型、连接与本地参数，选择适合当前任务的能力。</p></div><button className="quick-secondary" onClick={() => setConnectionsOpen(true)}><Plug size={13} />模型连接</button></div>
    <div className="model-hero">
      <div className="settings-model-card"><span>DEFAULT MODEL</span><h3>{current?.name ?? '尚未选择默认模型'}</h3><p>{current ? `${current.provider} · ${current.model_name}` : '从下方清单选择模型，或先添加模型连接'}</p><div className="model-meta">{current && <><span className="settings-badge">{current.model_kind === 'multimodal' ? '多模态' : '文本对话'}</span>{current.context_window && <span className="settings-badge muted">{Math.round(current.context_window / 1000)}k context</span>}</>}</div></div>
      <div className="settings-provider-card"><h3>模型来源</h3><p>FastAgent 云端 · {models.filter((model) => model.source !== 'local').length} 个模型</p><p>本地服务连接 · {localModels.length} 个模型</p><button className="small-control" onClick={() => setConnectionsOpen(true)}>管理连接</button></div>
    </div>
    <div className="model-settings-filters">
      <div className="settings-segmented" role="group" aria-label="模型来源筛选">{(['all', 'cloud', 'local', 'favorite'] as const).map((value) => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{{ all: '全部模型', cloud: '云端', local: '本地', favorite: '已收藏' }[value]}</button>)}</div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型或 Provider" aria-label="搜索模型" />
      <button className="small-control" onClick={() => void runBulkTest()} disabled={bulkRunning || bulkTargets.length === 0}>{bulkRunning ? <LoaderCircle size={13} className="spin" /> : <Plug size={13} />}{bulkRunning ? '测试中…' : '测试全部模型'}</button>
    </div>
    {bulkResults && <div className="model-bulk-results" aria-live="polite">{bulkResults.map((item) => <div className={`model-bulk-result ${item.ok ? 'ok' : 'fail'}`} key={item.id}><span className="model-bulk-name">{item.label}</span><span className="model-bulk-status">{item.ok ? `通过 · ${item.latencyMs ?? '—'} ms` : `失败：${item.error ?? '未知错误'}`}</span></div>)}</div>}
    <div className="model-settings-list">{visible.length ? visible.map((model) => <div className="model-settings-row" key={model.id}>
      <span className="settings-provider-logo">{model.provider.slice(0, 2).toUpperCase()}</span>
      <div className="model-settings-copy"><strong>{model.name}{model.id === defaultModelId && <span className="model-settings-tag">默认</span>}</strong><small>{model.provider} · {model.model_kind === 'multimodal' ? '多模态' : '文本对话'}{model.context_window ? ` · ${Math.round(model.context_window / 1000)}k context` : ''}</small></div>
      <span className="settings-badge muted">{model.source === 'local' ? '本地' : '云端'}</span>
      <div className="model-settings-actions">
        <button className="small-control" onClick={() => void handleTestOne(model.id, model.name)} disabled={testingId !== null || bulkRunning}>{testingId === model.id ? '测试中' : '测试'}</button>
        <button className="small-control" onClick={() => model.source === 'local' ? setConnectionsOpen(true) : setEditingModelId(model.id)}>参数</button>
        <button className={`model-favorite ${favoriteModelIds.includes(model.id) ? 'active' : ''}`} onClick={() => onToggleFavorite(model.id)} aria-label={`${favoriteModelIds.includes(model.id) ? '取消收藏' : '收藏'} ${model.name}`}><Star size={14} fill={favoriteModelIds.includes(model.id) ? 'currentColor' : 'none'} /></button>
        <button className="small-control" onClick={() => onSelectModel(model.id)} disabled={model.id === defaultModelId}>{model.id === defaultModelId ? <Check size={13} /> : '设为默认'}</button>
      </div>
    </div>) : <div className="section-list-empty">{allModels.length ? '没有匹配的模型' : '还没有可用模型，请先添加模型连接'}</div>}</div>
    {connectionsOpen && <CenterDialog title="模型连接" subtitle="管理厂商账号、API Key 与连接内模型" icon={<Plug size={16} />} onClose={() => setConnectionsOpen(false)} footer={<button className="approval-primary" onClick={() => setConnectionsOpen(false)}>完成</button>}><ModelConnections selectedModelId={selectedModelId} onSelectModel={onSelectModel} /></CenterDialog>}
    {editing && <CenterDialog title={`${editing.name} · 参数`} subtitle="本地覆盖 · 清空后回落到 Provider 默认值" onClose={() => setEditingModelId(null)} footer={<button className="approval-primary" onClick={() => setEditingModelId(null)}>完成</button>}><CloudModelParameters key={editing.id} model={editing} override={overrides.get(overrideKey(editing.provider, editing.model_name))} onSave={saveOverride} onNotice={onNotice} /></CenterDialog>}
  </section>
}
