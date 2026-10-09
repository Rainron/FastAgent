import type { AppSettings, AppTheme, AuthSnapshot, ConversationMode, LocalModelSummary, LocalModelTestResult, ModelOption } from '../../shared/types'
import type { ModePrompts } from '../mode-prompts'
import type { SettingsCategory } from './settings-navigation'

export interface SettingsPageProps {
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
  /** 侧栏当前选中的项目；知识库、召回测试、新增记忆默认落到这里。 */
  currentProjectId: string | null
  onOpenConversation: (id: string) => void
}
