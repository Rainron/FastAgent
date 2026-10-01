import { useEffect, useMemo, useState } from 'react'
import { Boxes, Brain, ChartColumn, CircleUserRound, Database, FileText, Keyboard, LibraryBig, LockKeyhole, MessagesSquare, Palette, Server, Settings, Shield, ShieldCheck, Stethoscope, Terminal } from 'lucide-react'
import type { ComponentType } from 'react'
import type { AppSettings, AppTheme, AuthSnapshot, ConversationMode,  LocalModelSummary, LocalModelTestResult, ModelOption } from '../../shared/types'
import { mergeModelOptions } from '../model-picker'
import type { ModePrompts } from '../mode-prompts'
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
import { UsageSettings } from './UsageSettings'
import { RunLimitSettings } from './RunLimitSettings'

export type SettingsCategory = 'general' | 'connection' | 'appearance' | 'models' | 'usage' | 'context' | 'permissions' | 'memory' | 'knowledge' | 'sandbox' | 'prompts' | 'storage' | 'keybindings' | 'runtime' | 'doctor'

const categories: Array<{ key: SettingsCategory; label: string; desc: string; icon: ComponentType<{ size?: number }>; group: string }> = [
  { key: 'general', label: '常规', desc: '启动、后台与基础行为偏好。', icon: Settings, group: '通用' },
  { key: 'appearance', label: '外观', desc: '主题、强调色与界面密度。', icon: Palette, group: '通用' },
  { key: 'keybindings', label: '快捷键', desc: '应用内与全局快捷键绑定。', icon: Keyboard, group: '通用' },
  { key: 'connection', label: 'FastAgent 服务器', desc: '登录状态与服务连接。', icon: Server, group: '运行时' },
  { key: 'models', label: '模型服务', desc: '模型选择、收藏与本地模型。', icon: Boxes, group: '运行时' },
  { key: 'usage', label: '用量统计', desc: '模型调用量与 token 消耗。', icon: ChartColumn, group: '运行时' },
  { key: 'context', label: '对话与上下文', desc: '压缩策略与上下文窗口占用。', icon: MessagesSquare, group: '运行时' },
  { key: 'permissions', label: 'Agent 与权限', desc: 'Agent 执行权限档位。', icon: ShieldCheck, group: '运行时' },
  { key: 'memory', label: '记忆', desc: '记忆提取与注入。', icon: Brain, group: '运行时' },
  { key: 'knowledge', label: '项目知识库', desc: '人工维护的项目背景与约定。', icon: LibraryBig, group: '运行时' },
  { key: 'sandbox', label: '安全与沙箱', desc: '沙箱与命令执行防护。', icon: Shield, group: '系统' },
  { key: 'prompts', label: '提示词', desc: '各模式提示词覆写。', icon: FileText, group: '系统' },
  { key: 'storage', label: '数据与存储', desc: '数据目录与存储占用。', icon: Database, group: '系统' },
  { key: 'runtime', label: '开发环境', desc: '本地命令与运行时路径。', icon: Terminal, group: '系统' },
  { key: 'doctor', label: '环境体检', desc: '环境自检与修复。', icon: Stethoscope, group: '系统' }
]

// 分组渲染顺序：导航按组分段，组内保持上面数组的相对顺序
const groupOrder = ['通用', '运行时', '系统']

export function SettingsPage({ settings, theme, models, localModels, auth, modePrompts, onSettingsChange, onThemeChange, onModePromptChange, onNotice, onLock, requestedCategory, categoryRequest, selectedModelId, defaultModelId, favoriteModelIds, onSelectModel, onToggleFavoriteModel, onTestDialogue }: {
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
  onTestDialogue: (id: number) => Promise<LocalModelTestResult>
}) {
  const [category, setCategory] = useState<SettingsCategory>(requestedCategory)
  // 记忆页的提取模型下拉要能选到本地模型，云端列表里没有它们。
  const selectableModels = useMemo(() => mergeModelOptions(models, localModels), [models, localModels])

  useEffect(() => { setCategory(requestedCategory) }, [categoryRequest])

  const active = categories.find((item) => item.key === category) ?? categories[0]

  return <div className="settings-page">
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分类">
        {groupOrder.map((group) => <div key={group}>
          <div className="settings-nav-label">{group}</div>
          {categories.filter((item) => item.group === group).map((item) => { const Icon = item.icon; return <button key={item.key} className={`snav${category === item.key ? ' on' : ''}`} onClick={() => setCategory(item.key)} aria-current={category === item.key}><Icon size={15} />{item.label}</button> })}
        </div>)}
        <div className="settings-nav-label">即将推出</div>
        <button className="snav" disabled title="后续版本提供"><CircleUserRound size={15} />账户</button>
      </nav>
      <div className="settings-content">
        <div className="set-head"><span className="eyebrow">PREFERENCES</span><h1>{active.label}</h1><p>{active.desc}</p></div>
        {!settings && category !== 'prompts' && category !== 'models'
          ? <div className="section-list-empty">设置加载中</div>
          : <>
            {category === 'general' && settings && <GeneralSettings settings={settings} onChange={onSettingsChange} />}
            {category === 'connection' && <ConnectionSettings auth={auth} onNotice={onNotice} />}
            {category === 'appearance' && settings && <AppearanceSettings settings={settings} theme={theme} onThemeChange={onThemeChange} onChange={onSettingsChange} />}
            {category === 'models' && <ModelSettings models={models} localModels={localModels} selectedModelId={selectedModelId} defaultModelId={defaultModelId} favoriteModelIds={favoriteModelIds} onSelectModel={onSelectModel} onToggleFavorite={onToggleFavoriteModel} onTestDialogue={onTestDialogue} onNotice={onNotice} />}
            {category === 'usage' && <><UsageSettings onNotice={onNotice} /><RunLimitSettings settings={settings} onSettingsChange={onSettingsChange} /></>}
            {category === 'context' && settings && <ContextSettings settings={settings} onChange={onSettingsChange} />}
            {category === 'permissions' && settings && <PermissionSettings settings={settings} onChange={onSettingsChange} />}
            {category === 'memory' && settings && <MemorySettings settings={settings} models={selectableModels} onChange={onSettingsChange} onNotice={onNotice} />}
            {category === 'knowledge' && <KnowledgeSettings onNotice={onNotice} />}
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
