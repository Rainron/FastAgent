import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, MoreHorizontal, Search, Settings2, Shield, ShieldAlert, ShieldCheck, Star } from 'lucide-react'
import type { ModelOption, PermissionPreset, ThinkingLevel } from '../../shared/types'
import { findProfile, type BuiltinPermissionPreset, type PermissionProfile } from '../../shared/permission-profiles'
import { expandedModels, groupModelsByChannel, initialExpandedChannels, modelMetaLabel, modelTabs, stepModelIndex, thinkingLevelDescription, thinkingLevelLabel, thinkingLevelShortLabel, triggerModelLabel, visibleModelOptions, type ModelTabKey } from '../model-picker'
import { useDismiss } from '../use-dismiss'
import type { ComposerDensity } from './composer-density'

/** 图标按档位继承的内置档取，自定义档跟随它的 base。 */
export function permissionIcon(base: BuiltinPermissionPreset, size: number) {
  if (base === 'full') return <ShieldAlert size={size} />
  return base === 'workspace' ? <ShieldCheck size={size} /> : <Shield size={size} />
}

function PermissionOptions({ value, profiles, onSelect }: { value: PermissionPreset; profiles: PermissionProfile[]; onSelect: (preset: PermissionPreset) => void }) {
  return <>{profiles.map((profile) => (
    <button key={profile.id} className={`permission-option ${value === profile.id ? 'selected' : ''} ${profile.risk ? 'warning' : ''}`} onClick={() => onSelect(profile.id)} role="menuitemradio" aria-checked={value === profile.id} title={profile.description}>
      {permissionIcon(profile.base, 15)}
      <span><strong>{profile.label}</strong><small>{profile.hint}</small>{profile.risk && <em>风险较高</em>}</span>
      {value === profile.id && <Check size={14} />}
    </button>
  ))}</>
}

export function PermissionSelector({ value, profiles, onChange, density, onOpenAdvanced }: { value: PermissionPreset; profiles: PermissionProfile[]; onChange: (preset: PermissionPreset) => void; density: ComposerDensity; onOpenAdvanced: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const summary = findProfile(profiles, value)
  useDismiss(open, () => setOpen(false), ref)
  return <div ref={ref} className="permission-selector">
    <button className={`composer-chip permission-trigger ${summary.risk ? 'risk' : ''}`} onClick={() => setOpen((current) => !current)} aria-haspopup="menu" aria-expanded={open} title={`执行权限：${summary.label} · ${summary.description}`}>
      {permissionIcon(summary.base, 14)}<span>{density === 'wide' ? summary.label : summary.shortLabel}</span><ChevronDown size={12} />
    </button>
    {open && <div className="permission-menu popover-card" role="menu" aria-label="执行权限">
      <div className="popover-heading">执行权限</div>
      <PermissionOptions value={value} profiles={profiles} onSelect={(preset) => { onChange(preset); setOpen(false) }} />
      <button className="popover-footer-action" onClick={() => { setOpen(false); onOpenAdvanced() }}>高级权限设置…</button>
    </div>}
  </div>
}

function ReasoningOptions({ levels, value, onSelect }: { levels: ThinkingLevel[]; value: ThinkingLevel; onSelect: (level: ThinkingLevel) => void }) {
  const active = levels.includes(value) ? value : levels[0]
  return <>
    <div className="reasoning-segmented" role="group" aria-label="思考强度" style={{ gridTemplateColumns: `repeat(${levels.length}, minmax(0, 1fr))` }}>
      {levels.map((level) => <button key={level} className={active === level ? 'active' : ''} onClick={() => onSelect(level)} aria-pressed={active === level}>{thinkingLevelLabel(level)}</button>)}
    </div>
    <div className="reasoning-current">{thinkingLevelLabel(active)}</div>
    <p className="reasoning-description">{thinkingLevelDescription(active)}</p>
  </>
}

export function ReasoningSelector({ levels, value, onChange, density }: { levels: ThinkingLevel[]; value: ThinkingLevel; onChange: (level: ThinkingLevel) => void; density: ComposerDensity }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, () => setOpen(false), ref)
  const active = levels.includes(value) ? value : levels[0]
  return <div ref={ref} className="reasoning-selector">
    <button className="composer-chip reasoning-trigger" onClick={() => setOpen((current) => !current)} aria-haspopup="dialog" aria-expanded={open} title={`思考强度：${thinkingLevelLabel(active)} · ${thinkingLevelDescription(active)}`}>
      <span>{density === 'wide' ? thinkingLevelLabel(active) : thinkingLevelShortLabel(active)}</span><ChevronDown size={12} />
    </button>
    {open && <div className="reasoning-menu popover-card" role="dialog" aria-label="思考强度">
      <div className="popover-heading">思考强度</div>
      <ReasoningOptions levels={levels} value={active} onSelect={(level) => onChange(level)} />
    </div>}
  </div>
}

/** 窄窗口下承接权限与思考强度，避免压缩字号。 */
export function ComposerOverflow({ permission, permissionProfiles, onPermissionChange, levels, thinkingLevel, onThinkingLevelChange }: { permission: PermissionPreset | null; permissionProfiles: PermissionProfile[]; onPermissionChange: (preset: PermissionPreset) => void; levels: ThinkingLevel[]; thinkingLevel: ThinkingLevel; onThinkingLevelChange: (level: ThinkingLevel) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, () => setOpen(false), ref)
  return <div ref={ref} className="composer-overflow">
    <button className="composer-chip overflow-trigger" onClick={() => setOpen((current) => !current)} aria-haspopup="menu" aria-expanded={open} aria-label="更多运行配置" title="更多运行配置"><MoreHorizontal size={15} /></button>
    {open && <div className="composer-overflow-menu popover-card" role="menu" aria-label="更多运行配置">
      {permission && <><div className="popover-heading">执行权限</div><PermissionOptions value={permission} profiles={permissionProfiles} onSelect={(preset) => { onPermissionChange(preset); setOpen(false) }} /></>}
      {levels.length > 0 && <div className="overflow-reasoning"><div className="popover-heading">思考强度</div><ReasoningOptions levels={levels} value={thinkingLevel} onSelect={onThinkingLevelChange} /></div>}
    </div>}
  </div>
}

export function ModelSelector({ model, models, selectedModelId, favoriteModelIds, recentModelIds, open, onOpenChange, onSelectModel, onToggleFavorite, onManageModels }: { model: ModelOption | null; models: ModelOption[]; selectedModelId: number | null; favoriteModelIds: number[]; recentModelIds: number[]; open: boolean; onOpenChange: (open: boolean) => void; onSelectModel: (modelId: number) => void; onToggleFavorite: (modelId: number) => void; onManageModels: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  // 关闭判定挂在外层容器上，触发按钮才不会被「先关再开」抵消。
  useDismiss(open, () => onOpenChange(false), ref)
  return <div className="model-selector" ref={ref}>
    <button className="composer-chip model-trigger" onClick={() => onOpenChange(!open)} aria-haspopup="dialog" aria-expanded={open} title={`模型：${triggerModelLabel(model)}（Ctrl/Cmd + K）`}>
      <span className="model-trigger-label">{triggerModelLabel(model)}</span><ChevronDown size={13} />
    </button>
    {open && <ModelPicker models={models} selectedModelId={selectedModelId} favoriteModelIds={favoriteModelIds} recentModelIds={recentModelIds} onSelectModel={(id) => { onSelectModel(id); onOpenChange(false) }} onToggleFavorite={onToggleFavorite} onManageModels={() => { onOpenChange(false); onManageModels() }} />}
  </div>
}

function ModelPicker({ models, selectedModelId, favoriteModelIds, recentModelIds, onSelectModel, onToggleFavorite, onManageModels }: { models: ModelOption[]; selectedModelId: number | null; favoriteModelIds: number[]; recentModelIds: number[]; onSelectModel: (modelId: number) => void; onToggleFavorite: (modelId: number) => void; onManageModels: () => void }) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<ModelTabKey>('all')
  const [activeIndex, setActiveIndex] = useState(0)
  const pickerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const tabs = modelTabs(models, { favoriteIds: favoriteModelIds, recentIds: recentModelIds })
  const scopedModels = visibleModelOptions(models, { tab, query, favoriteIds: favoriteModelIds, recentIds: recentModelIds })
  const groups = useMemo(() => groupModelsByChannel(scopedModels), [scopedModels])
  // 弹层每次打开都是新挂载，初值在这里算一次就等于「每次打开展开当前所选模型的分组」。
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialExpandedChannels(groupModelsByChannel(scopedModels), selectedModelId)))
  // 搜索时按分组折叠会把命中项藏起来，这种时候整体展开。
  const searching = query.trim().length > 0
  const effectiveExpanded = useMemo(() => searching ? new Set(groups.map((group) => group.channel)) : expanded, [searching, groups, expanded])
  const visibleModels = useMemo(() => expandedModels(groups, effectiveExpanded), [groups, effectiveExpanded])

  // 过滤条件或展开态一变，高亮回到第一项，否则 Enter 会选到已经不在列表里的模型。
  useEffect(() => { setActiveIndex(0) }, [query, tab, effectiveExpanded])
  // 换分页签后分组集合会变，之前展开的组可能已经不在，重新按「展开所选模型所在组」归位。
  useEffect(() => { setExpanded(new Set(initialExpandedChannels(groups, selectedModelId))) }, [tab])
  useEffect(() => { listRef.current?.querySelector<HTMLElement>('.model-picker-item.active')?.scrollIntoView({ block: 'nearest' }) }, [activeIndex, visibleModels.length])

  function toggleChannel(channel: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(channel)) next.delete(channel)
      else next.add(channel)
      return next
    })
  }

  function onSearchKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => stepModelIndex(visibleModels.length, current, event.key === 'ArrowDown' ? 1 : -1))
      return
    }
    if (event.key === 'Enter') {
      const target = visibleModels[activeIndex]
      if (target) { event.preventDefault(); onSelectModel(target.id) }
    }
  }

  function renderItem(item: ModelOption) {
    const index = visibleModels.indexOf(item)
    return <div className={`model-picker-item ${item.id === selectedModelId ? 'selected' : ''} ${index === activeIndex ? 'active' : ''}`} key={item.id} onPointerEnter={() => setActiveIndex(index)}>
      <button className="model-picker-select" onClick={() => onSelectModel(item.id)} aria-pressed={item.id === selectedModelId}>
        <span className="model-picker-item-copy"><strong>{item.model_name}</strong><small>{modelMetaLabel(item)}</small></span>
        {item.id === selectedModelId && <Check size={15} />}
      </button>
      <button className={`model-favorite ${favoriteModelIds.includes(item.id) ? 'active' : ''}`} onClick={() => onToggleFavorite(item.id)} aria-label={`${favoriteModelIds.includes(item.id) ? '取消收藏' : '收藏'} ${item.model_name}`} title={favoriteModelIds.includes(item.id) ? '取消收藏' : '收藏'}><Star size={14} fill={favoriteModelIds.includes(item.id) ? 'currentColor' : 'none'} /></button>
    </div>
  }

  return <div ref={pickerRef} className="model-picker-popover" role="dialog" aria-label="模型选择器">
    <div className="model-picker-search">
      <Search size={15} />
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onSearchKeyDown} placeholder="搜索模型…" aria-label="搜索模型" />
      <kbd>Esc</kbd>
    </div>
    {tabs.length > 1 && <div className="model-picker-tabs" role="tablist" aria-label="模型范围">
      {tabs.map((item) => <button key={item.key} role="tab" aria-selected={tab === item.key} className={tab === item.key ? 'active' : ''} onClick={() => { setTab(item.key); setQuery('') }}>{item.label}<span>{item.count}</span></button>)}
    </div>}
    <div className="model-picker-results" ref={listRef}>
      {groups.length ? groups.map((group) => {
        const open = effectiveExpanded.has(group.channel)
        const holdsSelected = group.models.some((item) => item.id === selectedModelId)
        return <div className="model-picker-group" key={group.channel}>
          <button className="model-picker-group-head" onClick={() => toggleChannel(group.channel)} aria-expanded={open} disabled={searching}>
            <ChevronRight size={13} className={open ? 'open' : ''} />
            <span>{group.channel}</span>
            {holdsSelected && !open && <em>当前</em>}
            <span className="model-picker-group-count">{group.models.length}</span>
          </button>
          {open && <div className="model-picker-group-body">{group.models.map(renderItem)}</div>}
        </div>
      }) : <div className="model-picker-empty">{query ? '没有匹配的模型' : '此范围暂无模型'}</div>}
    </div>
    <button className="popover-footer-action" onClick={onManageModels}><Settings2 size={13} />管理模型与 Provider…</button>
  </div>
}
