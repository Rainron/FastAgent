import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, LoaderCircle, Plug, Search, SlidersHorizontal, Star } from 'lucide-react'
import type { LocalModelSummary, ModelOption } from '../../shared/types'
import { filterModelOptions, groupModelsByChannel, initialExpandedChannels, thinkingLevelsForModel, thinkingLevelLabel } from '../model-picker'
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
function CloudModelParameters({ model, override, onSave }: {
  model: ModelOption
  override?: ModelParameterOverride
  onSave: (model: ModelOption, override: ModelParameterOverride) => Promise<void>
}) {
  const [draft, setDraft] = useState<ModelParameterDraft>(() => draftFromSource(override ?? null))
  const [saving, setSaving] = useState(false)
  const next = overrideFromDraft(draft)

  async function submit(value: ModelParameterOverride) {
    setSaving(true)
    try { await onSave(model, value) } finally { setSaving(false) }
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

/**
 * 模型与 Provider 管理。模型连接负责厂商账号与连接内模型；
 * 云端模型来自登录后的服务端清单，可收藏、选择，并在本机覆盖参数。
 */
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
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandedModel, setExpandedModel] = useState<number | null>(null)
  const [overrides, setOverrides] = useState<Map<string, ModelParameterOverride>>(new Map())
  const [testingId, setTestingId] = useState<number | null>(null)
  // 先过滤再分组：搜索时组内只剩命中项，与模型弹层行为一致。
  const groups = useMemo(() => groupModelsByChannel(filterModelOptions(models.filter((model) => model.source !== 'local' && model.id >= 0), query)), [models, query])
  // 搜索时按分组折叠会把命中项藏起来，这种时候整体展开。
  const searching = query.trim().length > 0
  const effectiveExpanded = searching ? new Set(groups.map((group) => group.channel)) : expanded
  // 模型清单首次就绪时默认展开当前所选模型所在分组；无所选模型时保持折叠；
  // 切换当前模型后也保持其所在分组展开，避免选中项被折叠藏起来。
  useEffect(() => {
    setExpanded((current) => {
      if (current.size > 0) {
        const owner = groups.find((group) => group.models.some((model) => model.id === selectedModelId))
        return owner && !current.has(owner.channel) ? new Set([...current, owner.channel]) : current
      }
      return new Set(initialExpandedChannels(groups, selectedModelId))
    })
  }, [selectedModelId, groups])

  function toggleChannel(channel: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(channel)) next.delete(channel)
      else next.add(channel)
      return next
    })
  }

  // 覆盖表与云端清单分开取：清单来自 bootstrap（已套过覆盖），这份是给编辑器回填草稿用的原始值。
  async function loadOverrides() {
    const items = await window.fastAgent.models.listOverrides().catch(() => [] as Array<{ key: string; override: ModelParameterOverride }>)
    setOverrides(new Map(items.map((item) => [item.key, item.override])))
  }
  useEffect(() => { void loadOverrides() }, [])

  const saveOverride = useCallback(async (model: ModelOption, override: ModelParameterOverride) => {
    const saved = await window.fastAgent.models.setOverride(model.provider, model.model_name, override)
    setOverrides((current) => {
      const next = new Map(current)
      const key = overrideKey(model.provider, model.model_name)
      if (Object.keys(saved).length) next.set(key, saved)
      else next.delete(key)
      return next
    })
    onNotice(Object.keys(saved).length ? `已保存 ${model.model_name} 的本地参数` : `已清除 ${model.model_name} 的本地参数`)
  }, [onNotice])

  interface BulkResult { id: number; label: string; ok: boolean; latencyMs?: number; error?: string }
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkResults, setBulkResults] = useState<BulkResult[] | null>(null)

  async function handleTestOne(modelId: number, label: string) {
    setTestingId(modelId)
    try {
      const result = await onTestDialogue(modelId)
      onNotice(result.ok
        ? `${label}：对话测试通过（${result.latencyMs ?? '—'} ms）`
        : `${label}：对话测试失败（${result.error ?? '未知错误'}）`)
    } finally {
      setTestingId(null)
    }
  }

  // 批量覆盖全部已保存模型：账号云端 + 本地服务连接 + 旧版独立本地。
  const bulkTargets = useMemo(() => [
    ...models.filter((model) => model.source !== 'local' && model.id >= 0).map((model) => ({ id: model.id, label: `${model.provider} / ${model.model_name}` })),
    ...localModels.map((model) => ({ id: model.id, label: `${model.connectionName ?? model.name} / ${model.model_name}` }))
  ], [models, localModels])

  async function runBulkTest() {
    if (bulkRunning || bulkTargets.length === 0) return
    setBulkRunning(true)
    setBulkResults(null)
    const results: (BulkResult | undefined)[] = new Array(bulkTargets.length)
    let cursor = 0
    // 并发太多会同时打到各家服务触发限流，这里控制在 3 路。
    async function worker() {
      while (cursor < bulkTargets.length) {
        const target = bulkTargets[cursor]
        const index = cursor
        cursor += 1
        try {
          const result = await onTestDialogue(target.id)
          results[index] = result.ok
            ? { ...target, ok: true, latencyMs: result.latencyMs }
            : { ...target, ok: false, error: result.error }
        } catch (error) {
          results[index] = { ...target, ok: false, error: error instanceof Error ? error.message : '测试失败' }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, bulkTargets.length) }, () => worker()))
    setBulkRunning(false)
    setBulkResults(results.filter((item): item is BulkResult => Boolean(item)))
  }

  return <section className="settings-panel model-settings" aria-labelledby="settings-models">
    <div className="settings-section-heading">
      <div><h2 id="settings-models">模型服务</h2><p>管理厂商账号、API Key 和连接内模型。每个连接可以添加多个模型。</p></div>
    </div>
    <ModelConnections selectedModelId={selectedModelId} onSelectModel={onSelectModel} />
    <div className="settings-section-heading"><div><h3>FastAgent 云端模型</h3><p>由 FastAgent 账号同步，可收藏和选择使用。</p></div></div>
    <div className="model-settings-filters">
      <label className="model-settings-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型或 Provider" aria-label="搜索模型" /></label>
      <button className="small-control" onClick={() => void runBulkTest()} disabled={bulkRunning || bulkTargets.length === 0} title="对云端与本地全部已保存模型各发一句短对话，验证能否真实回答">
        {bulkRunning ? <LoaderCircle size={14} className="spin" /> : <Plug size={14} />}{bulkRunning ? '测试中…' : '测试全部模型'}
      </button>
    </div>
    {bulkResults && <div className="model-bulk-results" aria-live="polite">
      {bulkResults.map((item) => <div className={`model-bulk-result ${item.ok ? 'ok' : 'fail'}`} key={item.id}>
        <span className="model-bulk-name">{item.label}</span>
        <span className="model-bulk-status">{item.ok ? `通过 · ${item.latencyMs ?? '—'} ms` : `失败：${item.error ?? '未知错误'}`}</span>
      </div>)}
    </div>}
    <div className="model-settings-list">
      {groups.length ? groups.map((group) => {
        const open = effectiveExpanded.has(group.channel)
        const holdsSelected = group.models.some((model) => model.id === selectedModelId)
        return <div className="model-settings-group" key={group.channel}>
          <button className="model-settings-group-head" onClick={() => toggleChannel(group.channel)} aria-expanded={open} disabled={searching}>
            <ChevronRight size={13} className={open ? 'open' : ''} />
            <span>{group.channel}</span>
            {holdsSelected && !open && <em>当前</em>}
            <span className="model-settings-group-count">{group.models.length}</span>
          </button>
          {open && <div className="model-settings-group-body">
            {group.models.map((model) => {
              const levels = thinkingLevelsForModel(model)
              return <div className={`model-settings-row ${model.id === selectedModelId ? 'active' : ''}`} key={model.id}>
                <div className="model-settings-copy">
                  <strong>{model.model_name}{model.id === defaultModelId && <span className="model-settings-tag">默认</span>}</strong>
                  <small>{model.provider} · {model.protocol ?? '协议未配置'}</small>
                  <div className="model-settings-caps">
                    <span>{model.model_kind === 'multimodal' ? '多模态' : '文本对话'}</span>
                    {model.context_window ? <span>{Math.round(model.context_window / 1000)}k 上下文</span> : <span className="muted">上下文默认 128k</span>}
                    {model.max_tokens ? <span>单次输出 {Math.round(model.max_tokens / 1000)}k</span> : <span className="muted">输出默认 8k</span>}
                    {levels.length > 0 ? <span>Reasoning · {levels.map(thinkingLevelLabel).join(' / ')}</span> : <span className="muted">不支持 Reasoning</span>}
                  </div>
                  {model.description && <p>{model.description}</p>}
                </div>
                <div className="model-settings-actions">
                  <button className="small-control" onClick={() => void handleTestOne(model.id, model.model_name)} disabled={testingId === model.id || bulkRunning}>{testingId === model.id ? <LoaderCircle size={13} className="spin" /> : <Plug size={13} />}测试</button>
                  <button className="small-control" aria-expanded={expandedModel === model.id} onClick={() => setExpandedModel(expandedModel === model.id ? null : model.id)}><SlidersHorizontal size={13} />参数</button>
                  <button className={`model-favorite ${favoriteModelIds.includes(model.id) ? 'active' : ''}`} onClick={() => onToggleFavorite(model.id)} aria-label={`${favoriteModelIds.includes(model.id) ? '取消收藏' : '收藏'} ${model.name}`} title={favoriteModelIds.includes(model.id) ? '取消收藏' : '收藏'}><Star size={14} fill={favoriteModelIds.includes(model.id) ? 'currentColor' : 'none'} /></button>
                  <button className="small-control" onClick={() => onSelectModel(model.id)} disabled={model.id === selectedModelId}>{model.id === selectedModelId ? <><Check size={13} />使用中</> : '设为当前模型'}</button>
                </div>
                {expandedModel === model.id && <CloudModelParameters model={model} override={overrides.get(overrideKey(model.provider, model.model_name))} onSave={saveOverride} />}
              </div>
            })}
          </div>}
        </div>
      }) : <div className="section-list-empty">没有匹配的模型</div>}
    </div>

    <p className="settings-hint">密钥经系统加密保存在本机，仅用于连接对应的模型服务。</p>
  </section>
}
