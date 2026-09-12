import { useEffect, useMemo, useState } from 'react'
import { LockKeyhole } from 'lucide-react'
import type { AppSettings, AppTheme, AuthSnapshot, ConversationMode, LocalModelInput, LocalModelSummary, LocalModelTestResult, ModelOption } from '../../shared/types'
import { mergeModelOptions } from '../model-picker'
import type { ModePrompts } from '../mode-prompts'
import { AppearanceSettings } from './AppearanceSettings'
import { ConnectionSettings } from './ConnectionSettings'
import { ContextSettings } from './ContextSettings'
import { DataStorageSettings } from './DataStorageSettings'
import { GeneralSettings } from './GeneralSettings'
import { KeybindingSettings } from './KeybindingSettings'
import { MemorySettings } from './MemorySettings'
import { ModelSettings } from './ModelSettings'
import { PermissionSettings } from './PermissionSettings'
import { PromptSettings } from './PromptSettings'
import { SandboxSettings } from './SandboxSettings'
import { DoctorSettings } from './DoctorSettings'
import { RuntimeSettings } from './RuntimeSettings'

export type SettingsCategory = 'general' | 'connection' | 'appearance' | 'models' | 'context' | 'permissions' | 'memory' | 'sandbox' | 'prompts' | 'storage' | 'keybindings' | 'runtime' | 'doctor'

const categories: Array<{ key: SettingsCategory; label: string }> = [
  { key: 'general', label: '常规' },
  { key: 'connection', label: 'FastAgent 服务器' },
  { key: 'appearance', label: '外观' },
  { key: 'models', label: '模型服务' },
  { key: 'context', label: '对话与上下文' },
  { key: 'permissions', label: 'Agent 与权限' },
  { key: 'memory', label: '记忆' },
  { key: 'sandbox', label: '安全与沙箱' },
  { key: 'prompts', label: '提示词' },
  { key: 'keybindings', label: '快捷键' },
  { key: 'storage', label: '数据与存储' },
  { key: 'runtime', label: '开发环境' },
  { key: 'doctor', label: '环境体检' }
]

const reserved = ['账户']

export function SettingsPage({ settings, theme, models, localModels, auth, modePrompts, onSettingsChange, onThemeChange, onModePromptChange, onNotice, onLock, requestedCategory, categoryRequest, selectedModelId, defaultModelId, favoriteModelIds, onSelectModel, onToggleFavoriteModel, onCreateLocal, onUpdateLocal, onDeleteLocal, onTestLocal }: {
  settings: AppSettings | null
  theme: AppTheme
  models: ModelOption[]
  localModels: LocalModelSummary[]
  auth: AuthSnapshot
  modePrompts: ModePrompts
  onSettingsChange: (patch: Partial<AppSettings>) => void
  onThemeChange: (theme: AppTheme) => void
  onModePromptChange: (mode: ConversationMode, value: string) => void
  onResetModePrompts?: () => void
  onNotice: (notice: string) => void
  onLock: () => Promise<void>
  requestedCategory: SettingsCategory
  /** 计数器变化即表示外部又发起了一次跳转，重复点同一分类也能生效。 */
  categoryRequest: number
  selectedModelId: number | null
  defaultModelId: number | null
  favoriteModelIds: number[]
  onSelectModel: (modelId: number) => void
  onToggleFavoriteModel: (modelId: number) => void
  onCreateLocal: (input: LocalModelInput) => Promise<void>
  onUpdateLocal: (id: number, input: LocalModelInput) => Promise<void>
  onDeleteLocal: (id: number) => Promise<void>
  onTestLocal: (id: number) => Promise<LocalModelTestResult>
}) {
  const [category, setCategory] = useState<SettingsCategory>(requestedCategory)
  // 记忆页的提取模型下拉要能选到本地模型，云端列表里没有它们。
  const selectableModels = useMemo(() => mergeModelOptions(models, localModels), [models, localModels])

  useEffect(() => { setCategory(requestedCategory) }, [categoryRequest])

  return <div className="settings-page">
    <div className="settings-header">
      <div><span className="eyebrow">PREFERENCES</span><h1>设置</h1><p>管理启动与后台、主题、上下文压缩策略、会话详情和模式提示词。</p></div>
    </div>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分类">
        {categories.map((item) => <button key={item.key} className={category === item.key ? 'active' : ''} onClick={() => setCategory(item.key)} aria-current={category === item.key}>{item.label}</button>)}
        <div className="settings-nav-label">即将推出</div>
        {reserved.map((label) => <button key={label} disabled title="后续版本提供">{label}</button>)}
      </nav>
      <div className="settings-content">
        {!settings && category !== 'prompts' && category !== 'models'
          ? <div className="section-list-empty">设置加载中</div>
          : <>
            {category === 'general' && settings && <GeneralSettings settings={settings} onChange={onSettingsChange} />}
            {category === 'connection' && <ConnectionSettings auth={auth} onNotice={onNotice} />}
            {category === 'appearance' && <AppearanceSettings theme={theme} onThemeChange={onThemeChange} />}
            {category === 'models' && <ModelSettings models={models} localModels={localModels} selectedModelId={selectedModelId} defaultModelId={defaultModelId} favoriteModelIds={favoriteModelIds} onSelectModel={onSelectModel} onToggleFavorite={onToggleFavoriteModel} onCreateLocal={onCreateLocal} onUpdateLocal={onUpdateLocal} onDeleteLocal={onDeleteLocal} onTestLocal={onTestLocal} onNotice={onNotice} />}
            {category === 'context' && settings && <ContextSettings settings={settings} onChange={onSettingsChange} />}
            {category === 'permissions' && settings && <PermissionSettings settings={settings} onChange={onSettingsChange} />}
            {category === 'memory' && settings && <MemorySettings settings={settings} models={selectableModels} onChange={onSettingsChange} onNotice={onNotice} />}
            {category === 'sandbox' && settings && <SandboxSettings settings={settings} onChange={onSettingsChange} />}
            {category === 'runtime' && <RuntimeSettings onNotice={onNotice} />}
            {category === 'doctor' && <DoctorSettings onNotice={onNotice} />}
            {category === 'prompts' && <PromptSettings prompts={modePrompts} onChange={onModePromptChange} />}
            {category === 'keybindings' && settings && <KeybindingSettings settings={settings} onChange={onSettingsChange} onNotice={onNotice} />}
            {category === 'storage' && <DataStorageSettings onNotice={onNotice} />}
          </>}
        <div className="settings-account">
          <div><strong>账户安全</strong><span>锁定后需要重新验证才能继续使用。</span></div>
          <button className="quick-secondary" onClick={() => void onLock()}><LockKeyhole size={14} />锁定账户</button>
        </div>
      </div>
    </div>
  </div>
}
