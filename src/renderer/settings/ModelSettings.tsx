import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, LoaderCircle, Pencil, Plug, Search, Star, Trash2 } from 'lucide-react'
import type { LocalModelSummary, ModelOption } from '../../shared/types'
import { filterModelOptions, groupModelsByChannel, initialExpandedChannels, thinkingLevelsForModel, thinkingLevelLabel } from '../model-picker'
import { LocalModelDialog } from './LocalModelDialog'
import type { LocalModelInput } from '../../shared/types'
import { ModelConnections } from '../model-connections/ModelConnections'
import { visibleLegacyModels } from '../model-connections/form-state'
import type { ModelConnectionSummary } from '../../shared/types'

/**
 * 模型与 Provider 管理。云端模型来自登录后的服务端清单（只读展示 + 收藏 + 选择）；
 * 本地模型由用户自行添加，直连自建网关或第三方 API，可编辑 / 删除 / 测试连接。
 */
export function ModelSettings({ models, selectedModelId, defaultModelId, favoriteModelIds, localModels, onSelectModel, onToggleFavorite, onCreateLocal, onUpdateLocal, onDeleteLocal, onTestLocal, onNotice }: {
  models: ModelOption[]
  selectedModelId: number | null
  defaultModelId: number | null
  favoriteModelIds: number[]
  localModels: LocalModelSummary[]
  onSelectModel: (modelId: number) => void
  onToggleFavorite: (modelId: number) => void
  onCreateLocal: (input: LocalModelInput) => Promise<void>
  onUpdateLocal: (id: number, input: LocalModelInput) => Promise<void>
  onDeleteLocal: (id: number) => Promise<void>
  onTestLocal: (id: number) => Promise<{ ok: boolean; error?: string; latencyMs?: number }>
  onNotice: (notice: string) => void
}) {
  const [query, setQuery] = useState('')
  const [connections, setConnections] = useState<ModelConnectionSummary[]>([])
  const legacyModels = useMemo(() => visibleLegacyModels(localModels, connections), [localModels, connections])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<{ model: LocalModelSummary | null } | null>(null)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
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

  async function handleSaveLocal(input: LocalModelInput) {
    const editing = dialog?.model ?? null
    if (editing) {
      await onUpdateLocal(editing.id, input)
      onNotice(`已更新本地模型：${editing.name}`)
    } else {
      await onCreateLocal(input)
      onNotice(`已添加本地模型：${input.name}`)
    }
    setDialog(null)
  }

  async function handleDeleteLocal(model: LocalModelSummary) {
    setDeletingId(model.id)
    try {
      await onDeleteLocal(model.id)
      onNotice(`已删除本地模型：${model.name}`)
    } finally {
      setDeletingId(null)
    }
  }

  async function handleTestLocal(model: LocalModelSummary) {
    setTestingId(model.id)
    try {
      const result = await onTestLocal(model.id)
      onNotice(result.ok
        ? `连接成功（${result.latencyMs ?? '—'} ms）`
        : `连接失败：${result.error ?? '未知错误'}`)
    } finally {
      setTestingId(null)
    }
  }

  return <section className="settings-panel model-settings" aria-labelledby="settings-models">
    <div className="settings-section-heading">
      <div><h2 id="settings-models">模型服务</h2><p>管理厂商账号、API Key 和连接内模型。每个连接可以添加多个模型。</p></div>
    </div>
    <ModelConnections selectedModelId={selectedModelId} onSelectModel={onSelectModel} onChanged={setConnections} />
    <div className="settings-section-heading"><div><h3>FastAgent 云端模型</h3><p>由 FastAgent 账号同步，可收藏和选择使用。</p></div></div>
    <div className="model-settings-filters">
      <label className="model-settings-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型或 Provider" aria-label="搜索模型" /></label>
    </div>
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
                  <button className={`model-favorite ${favoriteModelIds.includes(model.id) ? 'active' : ''}`} onClick={() => onToggleFavorite(model.id)} aria-label={`${favoriteModelIds.includes(model.id) ? '取消收藏' : '收藏'} ${model.name}`} title={favoriteModelIds.includes(model.id) ? '取消收藏' : '收藏'}><Star size={14} fill={favoriteModelIds.includes(model.id) ? 'currentColor' : 'none'} /></button>
                  <button className="small-control" onClick={() => onSelectModel(model.id)} disabled={model.id === selectedModelId}>{model.id === selectedModelId ? <><Check size={13} />使用中</> : '设为当前模型'}</button>
                </div>
              </div>
            })}
          </div>}
        </div>
      }) : <div className="section-list-empty">没有匹配的模型</div>}
    </div>

    <div className="settings-section-heading local-model-heading">
      <div><h3>旧版本地模型</h3><p>继续管理已有的独立模型配置；新的配置请添加模型服务。</p></div>
    </div>
    <div className="model-settings-list">
      {legacyModels.map((model) => (
        <div className={`model-settings-row local-model-row ${model.id === selectedModelId ? 'active' : ''}`} key={model.id}>
          <div className="model-settings-copy">
            <strong>{model.name}<span className="model-settings-tag">本地</span></strong>
            <small>{model.provider} · {model.model_name} · {model.protocol ?? model.provider}</small>
            <div className="model-settings-caps">
              <span>{model.model_kind === 'multimodal' ? '多模态' : '文本对话'}</span>
              {model.supports_thinking ? <span>Reasoning</span> : <span className="muted">不支持 Reasoning</span>}
              {model.context_window && <span>{Math.round(model.context_window / 1000)}k 上下文</span>}
            </div>
            <p className="local-model-base-url" title={model.base_url}>{model.base_url}{model.hasApiKey ? ' · 已配置密钥' : ''}</p>
          </div>
          <div className="model-settings-actions">
            <button className="small-control" onClick={() => void handleTestLocal(model)} disabled={testingId === model.id}>{testingId === model.id ? <LoaderCircle size={13} className="spin" /> : <Plug size={13} />}测试</button>
            <button className="small-control" onClick={() => setDialog({ model })} aria-label={`编辑 ${model.name}`} title="编辑"><Pencil size={13} />编辑</button>
            <button className="small-control danger" onClick={() => void handleDeleteLocal(model)} disabled={deletingId === model.id} aria-label={`删除 ${model.name}`} title="删除">{deletingId === model.id ? <LoaderCircle size={13} className="spin" /> : <Trash2 size={13} />}删除</button>
            <button className="small-control" onClick={() => onSelectModel(model.id)} disabled={model.id === selectedModelId}>{model.id === selectedModelId ? <><Check size={13} />使用中</> : '设为当前模型'}</button>
          </div>
        </div>
      ))}
      {legacyModels.length === 0 && <div className="section-list-empty">没有旧版独立模型配置。</div>}
    </div>
    <p className="settings-hint">密钥经系统加密保存在本机，仅用于连接对应的模型服务。</p>

    {dialog && <LocalModelDialog
      initial={dialog.model}
      onClose={() => setDialog(null)}
      onSave={handleSaveLocal}
    />}
  </section>
}
