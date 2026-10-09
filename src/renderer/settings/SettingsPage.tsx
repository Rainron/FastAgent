import { useMemo } from 'react'
import { Boxes, Brain, FileText, LibraryBig, Settings, Shield, ShieldCheck } from 'lucide-react'
import './settings-redesign.css'
import { settingsNavigation } from './settings-navigation'
import { useSettingsNavigation } from './hooks/use-settings-navigation'
export type { SettingsCategory } from './settings-navigation'
import type { SettingsPageProps } from './settings-page-types'
import { mergeModelOptions } from '../model-picker'
import { AppearanceSettings } from './AppearanceSettings'
import { ConnectionSettings } from './ConnectionSettings'
import { ContextSettings } from './ContextSettings'
import { DataStorageSettings } from './DataStorageSettings'
import { GeneralSettings } from './GeneralSettings'
import { KeybindingSettings } from './KeybindingSettings'
import { KnowledgeSettings } from './KnowledgeSettings'
import { MemorySettings } from './MemorySettings'
import { ModelSettings } from './ModelSettings'
import { PermissionSettings } from './PermissionSettings'
import { PromptSettings } from './PromptSettings'
import { SandboxSettings } from './SandboxSettings'
import { DoctorSettings } from './DoctorSettings'
import { RuntimeSettings } from './RuntimeSettings'
import { ShellCommandSettings } from './ShellCommandSettings'
import { UsageSettings } from './UsageSettings'
import { RunLimitSettings } from './RunLimitSettings'

export function SettingsPage({ settings, theme, models, localModels, auth, modePrompts, onSettingsChange, onThemeChange, onModePromptChange, onResetModePrompts, onNotice, requestedCategory, categoryRequest, selectedModelId, defaultModelId, favoriteModelIds, onSelectModel, onToggleFavoriteModel, onTestDialogue }: SettingsPageProps) {
  const { category, setCategory, contentRef } = useSettingsNavigation(requestedCategory, categoryRequest)
  const selectableModels = useMemo(() => mergeModelOptions(models, localModels), [models, localModels])
  const { active, primary, tabs } = settingsNavigation(category)
  const icons = { permissions: ShieldCheck, models: Boxes, memory: Brain, knowledge: LibraryBig, prompts: FileText }

  return <div className="settings-page settings-redesign">
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分类">
        <div className="settings-nav-title">设置</div>
        <div className="settings-nav-group">
          <div className="settings-nav-label">智能体</div>
          {primary.map((item) => { const Icon = icons[item.key as keyof typeof icons]; return <button key={item.key} className={`snav${category === item.key ? ' on' : ''}`} onClick={() => setCategory(item.key)} aria-current={category === item.key ? 'page' : undefined}><Icon size={16} />{item.label}{item.key === 'models' && <span className="settings-nav-count">{selectableModels.length}</span>}</button> })}
        </div>
        <div className="settings-nav-group">
          <div className="settings-nav-label">应用</div>
          <button className={`snav${active.group === 'workspace' ? ' on' : ''}`} onClick={() => setCategory('general')} aria-current={active.group === 'workspace' ? 'page' : undefined}><Settings size={16} />工作区偏好</button>
          <button className={`snav${active.group === 'security' ? ' on' : ''}`} onClick={() => setCategory('sandbox')} aria-current={active.group === 'security' ? 'page' : undefined}><Shield size={16} />安全与诊断</button>
        </div>
      </nav>
      <div className="settings-content" ref={contentRef}><div className="settings-content-inner">
        <div className="set-head"><h1>{active.label}</h1><p>{active.desc}</p></div>
        {tabs.length > 0 && <div className="settings-category-tabs" role="navigation" aria-label={active.group === 'workspace' ? '工作区偏好分类' : '安全与诊断分类'}>{tabs.map((item) => <button key={item.key} className={category === item.key ? 'active' : ''} aria-current={category === item.key ? 'page' : undefined} onClick={() => setCategory(item.key)}>{item.label}</button>)}</div>}
        {!settings && category !== 'prompts' && category !== 'models'
          ? <div className="section-list-empty">设置加载中</div>
          : <>
            {category === 'general' && settings && <GeneralSettings settings={settings} onChange={onSettingsChange} />}
            {category === 'connection' && <ConnectionSettings auth={auth} onNotice={onNotice} />}
            {category === 'appearance' && settings && <AppearanceSettings settings={settings} theme={theme} onThemeChange={onThemeChange} onChange={onSettingsChange} />}
            {category === 'models' && <ModelSettings models={models} localModels={localModels} selectedModelId={selectedModelId} defaultModelId={defaultModelId} favoriteModelIds={favoriteModelIds} onSelectModel={onSelectModel} onToggleFavorite={onToggleFavoriteModel} onTestDialogue={onTestDialogue} onNotice={onNotice} />}
            {category === 'usage' && <><UsageSettings onNotice={onNotice} /><RunLimitSettings settings={settings} onSettingsChange={onSettingsChange} /></>}
            {category === 'context' && settings && <ContextSettings settings={settings} model={selectableModels.find((item) => item.id === selectedModelId) ?? null} onChange={onSettingsChange} />}
            {category === 'permissions' && settings && <PermissionSettings settings={settings} onChange={onSettingsChange} />}
            {category === 'memory' && settings && <MemorySettings settings={settings} models={selectableModels} onChange={onSettingsChange} onNotice={onNotice} />}
            {category === 'knowledge' && <KnowledgeSettings onNotice={onNotice} />}
            {category === 'sandbox' && settings && <SandboxSettings settings={settings} onChange={onSettingsChange} />}
            {category === 'runtime' && settings && <><RuntimeSettings onNotice={onNotice} /><ShellCommandSettings settings={settings} onChange={onSettingsChange} /></>}
            {category === 'doctor' && <DoctorSettings onNotice={onNotice} />}
            {category === 'prompts' && <PromptSettings prompts={modePrompts} onChange={onModePromptChange} onReset={onResetModePrompts} />}
            {category === 'keybindings' && settings && <KeybindingSettings settings={settings} onChange={onSettingsChange} onNotice={onNotice} />}
            {category === 'storage' && <DataStorageSettings onNotice={onNotice} />}
          </>}
      </div></div>
    </div>
  </div>
}
