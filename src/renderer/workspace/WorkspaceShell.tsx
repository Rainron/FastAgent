import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Map as MapIcon, PanelRight, TerminalSquare } from 'lucide-react'
import type { AgentEvent, AppSettings, AppTheme, ApprovalDecision, Attachment, AuthSnapshot, BootstrapData, CompactionHistory, ContextPolicy, ConversationMode, ConversationRunState, ConversationTurn, GitOperationResult,  LocalModelSummary, SearchResult, TodoItem, ToolCallRecord } from '../../shared/types'
import { resetFileExistsCache } from '../ai-response/file-exists-cache'
import { formatFileReference, type FileReference } from '../ai-response/file-reference'
import { ResponseActionsContext, type ResponseActions } from '../ai-response/response-context'
import { ResumeBar } from '../composer/ResumeBar'
import { Composer } from '../composer/Composer'
import { MIN_COMPOSER_HEIGHT } from '../composer/composer-height'
import type { ProjectTrustState } from '../composer/WorkspaceMenu'
import { ApprovalDialog } from '../conversation/ApprovalDialog'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { truncateTurnsForRerun } from './rerun-turns'
import { beginCompaction, cancelCompaction, clearCompaction, completeCompaction, failCompaction, type CompactionStates } from '../conversation/compaction-state'
import { CompactionFallbackDialog } from '../conversation/CompactionFallbackDialog'
import { conversationMetaNow, mergeStreamedText, normalizeRenameInput, readModelIds, titleFromPrompt, toWorkspaceConversation } from '../conversation/conversation-meta'
import { ConversationInspector, type ConversationInspectorData } from '../conversation/ConversationInspector'
import type { ContextHealthData } from '../conversation/ContextHealth'
import { ContextPressureBar } from '../conversation/ContextPressureBar'
import { contextPressure } from '../conversation/context-pressure'
import { resolveEffectivePolicy } from '../../shared/context-policy'
import { EmptyConversation, MessageList } from '../conversation/MessageList'
import { LightboxLayer } from '../conversation/Lightbox'
import { FindBar } from '../conversation/FindBar'
import { MessageContextMenu, selectionText, type ContextMenuItem } from '../conversation/message-context-menu'
import type { ScrollNavAction } from '../conversation/auto-scroll'
import { dropNextQueuedPrompt, enqueuePrompt, markSteerDelivered, removeQueuedPrompt, takeNextQueuedPrompt, type QueuedPrompt } from '../conversation/prompt-queue'
import { isRunConflictError } from '../../shared/active-runs'
import { cleanIpcError } from '../ipc-error'
import { conversationModelId, defaultThinkingLevel, initialSelectedModelId, mergeModelOptions, normalizeThinkingLevel, pendingBoundModelId } from '../model-picker'
import { subscribeLocalModels } from '../local-model-sync'
import { defaultModePrompts, modePromptFor, normalizeSavedModePrompt, withPlanModePrompt, type ModePrompts } from '../mode-prompts'
import { defaultPermissionForMode } from '../permissions'
import { DEFAULT_CONTEXT_WINDOW, resolveContextWindow } from '../../shared/model-context-windows'
import { findProfile, mergeProfiles, type PermissionProfile } from '../../shared/permission-profiles'
import { GitPanel } from '../git/GitPanel'
import { ResourcePanel } from '../resource-panel/ResourcePanel'
import type { SettingsCategory } from '../settings/SettingsPage'
import type { SkillDraft } from '../../shared/types'
import { SkillDistillDialog } from '../conversation/SkillDistillDialog'
import { toggleSidebarSection, type SidebarSectionState } from '../sidebar-sections'
import { buildContinuationPrompt, isContinuationInput, isNewConversationShortcut, pushNavigation, stepNavigation } from '../workspace-actions'
import { archiveWorkspaceItem, findActiveProjectConversation, removeWorkspaceItem, renameWorkspaceItem, toggleBatchPageSelection, toggleBatchSelection, upsertRecentWorkspaceItem, type ConversationScope } from '../workspace-data'
import { whenFirstScreenReady } from '../startup-ready'
import { usePagination } from '../use-pagination'
import { useEventCallback } from '../use-event-callback'
import { MOTION_DURATIONS } from '../motion'
import { abilitiesNeedingAttention } from '../features/abilities/ability-view'
import { useAbilities } from '../features/abilities/hooks/useAbilities'
import { SectionView } from './SectionView'
import { TerminalPanel } from '../terminal/TerminalPanel'
import { WorkspaceTitlebar } from './WorkspaceTitlebar'
import { Sidebar, ItemActions } from './Sidebar'
import { buildInspectorData } from '../conversation/inspector-data'
import { buildMessageMenuItems } from '../conversation/message-menu-items'
import { useAgentEvents } from './hooks/use-agent-events'
import { useConversationScroll } from './hooks/use-conversation-scroll'
import { useConversationMinimap } from './hooks/use-conversation-minimap'
import { ConversationMinimap } from '../conversation/ConversationMinimap'
import { useEffectiveDark } from './hooks/use-effective-dark'
import { useFindBar } from './hooks/use-find-bar'
import { useNotice } from './hooks/use-notice'
import { usePlanMode } from './hooks/use-plan-mode'
import { persistShellCommandTurn, useShellCommands } from './hooks/use-shell-commands'
import { useStreamBuffers } from './hooks/use-stream-buffers'
import { formatShellCommandOutput } from '../../shared/shell-command'
import { useTurnActivitySets } from './hooks/use-turn-activity-sets'
import { useAppShortcuts } from './hooks/use-app-shortcuts'
import { useGitWorkspace } from './hooks/use-git-workspace'
import type { PendingApproval, WorkspaceConversation, WorkspaceProject, WorkspaceSection } from './workspace-types'

const scrollNavLabel: Record<Exclude<ScrollNavAction, 'none'>, string> = {
  top: '回到顶部',
  bottom: '回到底部',
  latest: '回到最新消息'
}

/** 侧栏「最近对话」只取这么多条；再往前翻走会话中心。 */
const RECENT_CONVERSATION_LIMIT = 20

/** 点了停止之后最多等这么久终态事件；再不来就在界面上自行收尾。 */
const CANCEL_TERMINAL_TIMEOUT_MS = 8_000


/**
 * 「重载前停在哪个会话」存在 sessionStorage 而不是偏好库：它只该在同一次运行内的
 * 页面重载（崩溃自动重载、dev 热更、手动重载）之间存活。存进库里会连冷启动也一起恢复，
 * 那是另一回事。sessionStorage 随应用退出自然清空，正好是这个语义。
 */
const LAST_CONVERSATION_KEY = 'fastagent.last-conversation'

function readLastConversationId(): string | null {
  try { return window.sessionStorage.getItem(LAST_CONVERSATION_KEY) } catch { return null }
}

function writeLastConversationId(conversationId: string | null) {
  try {
    if (conversationId) window.sessionStorage.setItem(LAST_CONVERSATION_KEY, conversationId)
    else window.sessionStorage.removeItem(LAST_CONVERSATION_KEY)
  } catch { /* 存储不可用时只是失去恢复能力，不影响会话本身 */ }
}

/** 上下文健康度的初始值，/clear 与新建会话时重置用。 */
const EMPTY_CONTEXT_HEALTH: ContextHealthData = { estimatedTokens: 0, contextWindow: DEFAULT_CONTEXT_WINDOW, messageTokens: 0, toolTokens: 0, systemTokens: 0, compactionCount: 0, latestCompactionAt: null }

export function WorkspaceShell({ auth, theme, onThemeChange, settings, onSettingsChange }: { auth: AuthSnapshot; theme: AppTheme; onThemeChange: (theme: AppTheme) => void; settings: AppSettings | null; onSettingsChange: (patch: Partial<AppSettings>) => void }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarSections, setSidebarSections] = useState<SidebarSectionState>({ workspace: true, recent: true })
  const [artifactOpen, setArtifactOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  // xterm 吃具体色值、不认 CSS 变量，这里同步一份深浅判定
  const darkTheme = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [gitPanelOpen, setGitPanelOpen] = useState(false)
  const [mode, setMode] = useState<ConversationMode>('chat')
  const { planMode, setPlanMode } = usePlanMode()

  const [permission, setPermission] = useState<import('../../shared/types').PermissionPreset>('ask')
  // 档位可在设置页增删改，切换分区时重新拉一次即可，不必为它做实时推送。
  const [permissionProfiles, setPermissionProfiles] = useState<PermissionProfile[]>(() => mergeProfiles([]))
  // 用户在底栏手动选过权限后，模式切换、打开工作区、新对话都不再改它。
  // 只有进入另一个已有会话才交还给该会话自己存档的配置。
  const [permissionPinned, setPermissionPinned] = useState(false)

  /** 各种「顺手带出来」的权限默认值统一走这里，用户选过就不覆盖。 */
  function applyDefaultPermission(preset: import('../../shared/types').PermissionPreset) {
    if (!permissionPinned) setPermission(preset)
  }
  const [section, setSection] = useState<WorkspaceSection>('chats')
  useEffect(() => {
    void window.fastAgent.conversations.listPermissionProfiles().then(setPermissionProfiles).catch(() => undefined)
  }, [section])
  // 侧栏徽标：安装、启停、检查更新都发生在能力页里，换 section 时对一次账就够，不做轮询。
  const { abilities, refresh: refreshAbilities } = useAbilities()
  const abilityAlerts = useMemo(() => abilitiesNeedingAttention(abilities ?? []).length, [abilities])
  useEffect(() => { void refreshAbilities() }, [section, refreshAbilities])
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('permissions')
  const [skillDraft, setSkillDraft] = useState<SkillDraft | null>(null)
  const [settingsRequest, setSettingsRequest] = useState(0)
  // 从回合来源清单深链到「能力」页；nonce 保证连点同一个 Skill 也能重新展开详情。
  const [abilityRequest, setAbilityRequest] = useState<{ abilityId: string; nonce: number } | null>(null)
  const [navigation, setNavigation] = useState<{ entries: WorkspaceSection[]; index: number }>({ entries: ['chats'], index: 0 })
  const [conversationItems, setConversationItems] = useState<WorkspaceConversation[]>([])
  const [batchConversationItems, setBatchConversationItems] = useState<WorkspaceConversation[]>([])
  const [batchConversationTotal, setBatchConversationTotal] = useState(0)
  const [recentConversationRefresh, setRecentConversationRefresh] = useState(0)
  const [batchConversationRefresh, setBatchConversationRefresh] = useState(0)
  const { page: batchConversationPage, pageSize: batchConversationPageSize, setPage: setBatchConversationPage, setPageSize: setBatchConversationPageSize } = usePagination()
  const [batchConversationQuery, setBatchConversationQuery] = useState('')
  const [batchConversationScope, setBatchConversationScope] = useState<ConversationScope>('all')
  const [projectItems, setProjectItems] = useState<WorkspaceProject[]>([])
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const selectedConversationIdRef = useRef<string | null>(null)
  useEffect(() => { selectedConversationIdRef.current = selectedConversationId }, [selectedConversationId])
  const pendingShellContextRef = useRef<{ conversationId: string; promise: Promise<unknown> } | null>(null)
  // 重载前停留的会话，等首屏几路数据落定后由下方效应恢复一次。
  const [restoreConversationId] = useState<string | null>(() => readLastConversationId())
  const restoredRef = useRef(false)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [batchKind, setBatchKind] = useState<'conversations' | 'projects' | null>(null)
  const [batchSelectedIds, setBatchSelectedIds] = useState<Set<string>>(new Set())
  const [conversationTitle, setConversationTitle] = useState('新对话')
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  // 同一个相对路径在另一个项目里可能不存在：切工作区后文件引用的存在性结论必须作废。
  useEffect(() => { resetFileExistsCache() }, [workspaceRoot])
  const { gitState, refreshGitState } = useGitWorkspace(workspaceRoot)
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null)
  const [bootstrapLoaded, setBootstrapLoaded] = useState(false)
  const [localModels, setLocalModels] = useState<LocalModelSummary[]>([])
  const [localModelsLoaded, setLocalModelsLoaded] = useState(false)
  // 云端 + 本地合并成一份模型列表，选择器 / 会话记录 / 设置页共用
  const allModels = useMemo(() => mergeModelOptions(bootstrap?.models ?? [], localModels), [bootstrap, localModels])
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  // 会话绑定的模型还没出现在目录里时先挂在这里，等目录补齐再落位（见 pendingBoundModelId）。
  const [boundModelIdPending, setBoundModelIdPending] = useState<number | null>(null)
  // 账户级默认模型：新会话用它开场，只有手动切换模型才会更新，打开历史会话不影响。
  const [defaultModelId, setDefaultModelId] = useState<number | null>(null)
  const [thinkingLevel, setThinkingLevel] = useState<import('../../shared/types').ThinkingLevel>('low')
  const [modePrompts, setModePrompts] = useState<ModePrompts>({ ...defaultModePrompts })
  const [favoriteModelIds, setFavoriteModelIds] = useState<number[]>([])
  const [recentModelIds, setRecentModelIds] = useState<number[]>([])
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)
  const [turns, setTurns] = useState<ConversationTurn[]>([])
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null)
  const [runIdsByConversation, setRunIdsByConversation] = useState<Record<string, string>>({})
  const [runStates, setRunStates] = useState<Record<string, ConversationRunState>>({})
  const conversationItemsRef = useRef<WorkspaceConversation[]>([])
  const runId = selectedConversationId ? runIdsByConversation[selectedConversationId] ?? null : null
  // runIdsByConversation 的 ref 镜像：停止任务后轮询等待终态清除时要用最新值。
  const runIdsRef = useRef<Record<string, string>>({})
  useEffect(() => { runIdsRef.current = runIdsByConversation }, [runIdsByConversation])
  // git checkout 影响整个工作区，任何会话运行中都应拦截切换（不只当前会话）。
  const anyRunActive = Object.values(runIdsByConversation).some(Boolean)
  const [attachmentRequest, setAttachmentRequest] = useState(0)
  // 输入框高度提到这里，切到设置等分区再切回来时不会丢失用户拖出来的高度。
  const [composerHeight, setComposerHeight] = useState(MIN_COMPOSER_HEIGHT)
  const [composerHeightPinned, setComposerHeightPinned] = useState(false)
  // 引用稳定，否则输入框里的高度副作用会随每次流式渲染重复挂载。
  const changeComposerHeight = useCallback((next: number, pinned: boolean) => {
    setComposerHeight(next)
    if (pinned) setComposerHeightPinned(true)
  }, [])
  // 提示条的内容与退场状态在下面渲染：所有「已复制 / 删除失败 / 运行失败」这类反馈都靠它，
  // 不渲染的话这些提示全部静默丢失。
  const { notice, noticeAction, noticeClosing, setNotice, setNoticeAction } = useNotice()
  const [artifactFile, setArtifactFile] = useState<FileReference | null>(null)
  const effectiveDark = useEffectiveDark(theme)
  // 审批按发起它的 run / 会话归属存放：后台会话的审批不能弹到当前会话，也不能被别的 run 结束时清掉。
  const [approvals, setApprovals] = useState<PendingApproval[]>([])
  const [todosByTurn, setTodosByTurn] = useState<Record<string, TodoItem[]>>({})
  // 不可撤销的操作（/clear、删除会话或项目）统一先过这一个确认弹层，一次手滑不该丢掉整段工作。
  const [pendingConfirm, setPendingConfirm] = useState<{ title: string; lines: string[]; confirmLabel: string; onConfirm: () => void } | null>(null)
  const [inspector, setInspector] = useState<ConversationInspectorData | null>(null)
  const [inspectorId, setInspectorId] = useState<string | null>(null)
  /** 会话详情打开时停在哪个分页；从上下文环的「已压缩 N 次」进来要直接落到压缩历史。 */
  const [inspectorSection, setInspectorSection] = useState<'summary' | 'history' | 'agent'>('summary')
  // 队列按会话隔离，切换页面只改变展示目标，不丢弃后台任务。
  const [queuedPromptsByConversation, setQueuedPromptsByConversation] = useState<Record<string, QueuedPrompt[]>>({})
  const queuedPrompts = selectedConversationId ? queuedPromptsByConversation[selectedConversationId] ?? [] : []
  // 消息右键菜单状态；quoteRequest 把「引用到输入框」转交给 Composer。
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)
  const [conversationEntering, setConversationEntering] = useState(false)
  const [quoteRequest, setQuoteRequest] = useState<{ text: string; nonce: number } | null>(null)
  const [prefillRequest, setPrefillRequest] = useState<{ text: string; nonce: number } | null>(null)
  // 已请求暂停的 run；按会话记不住——同一会话下一轮是新的 runId，暂停不该被继承。
  const [pausedRunId, setPausedRunId] = useState<string | null>(null)
  const [contextHealth, setContextHealth] = useState<ContextHealthData>(EMPTY_CONTEXT_HEALTH)
  // 会话流里的压缩分隔卡与「这条会话实际按哪套策略压」都要在壳层持有：
  // 前者跟着消息列表渲染，后者决定输入框上方的余量提示按哪个阈值说话。
  const [compactionHistory, setCompactionHistory] = useState<CompactionHistory[]>([])
  const [conversationPolicy, setConversationPolicy] = useState<ContextPolicy | null>(null)
  /** 换会话与 /clear 都必须整份丢掉上一条会话的压缩记录与策略覆盖，否则会画出不属于它的分隔卡。 */
  const resetConversationContext = useCallback(() => { setCompactionHistory([]); setConversationPolicy(null) }, [])
  const [compactionStates, setCompactionStates] = useState<CompactionStates>({})
  // /clear 的确认弹层：清空不可撤销，还会删掉 session 文件、附件与这个会话产生的记忆。
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const conversationLoadRef = useRef(0)
  const permissionChangeRef = useRef(0)
  const runTurnRef = useRef(new Map<string, string>())
  const activeTurnRef = useRef<string | null>(null)
  // 事件回调里查 turn → conversationId 用，避免订阅随 turns 变化反复重建。
  const turnsStateRef = useRef<ConversationTurn[]>([])
  const eventSequenceRef = useRef(new Map<string, number>())
  useEffect(() => { turnsStateRef.current = turns }, [turns])
  useEffect(() => { conversationItemsRef.current = conversationItems }, [conversationItems])

  // 运行结束后暂停态自动失效；切到别的会话时 runId 不同，paused 自然算成 false，不必清。
  useEffect(() => { if (!runId) setPausedRunId(null) }, [runId])

  useEffect(() => { activeTurnRef.current = activeTurnId }, [activeTurnId])
  useEffect(() => {
    if (!selectedConversationId) return
    setConversationEntering(true)
    const timer = window.setTimeout(() => setConversationEntering(false), MOTION_DURATIONS.conversationEnter)
    return () => window.clearTimeout(timer)
  }, [selectedConversationId])

  useEffect(() => window.fastAgent.onTrayNewConversation(() => startNewChat()), [])
  useEffect(() => window.fastAgent.onTrayHidden(() => setNotice('FastAgent 仍在后台运行，可从系统托盘重新打开')), [])

  useEffect(() => {
    const bootstrapReady = window.fastAgent.resources.bootstrap()
      .then(setBootstrap)
      .catch((error) => {
        setBootstrap(null)
        setNotice(`模型列表加载失败：${cleanIpcError(error, '无法加载可用模型')}`)
      })
      .finally(() => setBootstrapLoaded(true))
    // 本地模型不依赖登录态，独立通道加载
    const modelSync = subscribeLocalModels(window.fastAgent.models, setLocalModels, () => setNotice('本地模型加载失败'))
    const localModelsReady = modelSync.ready
      .finally(() => setLocalModelsLoaded(true))
    const runStatesReady = window.fastAgent.chat.listStates().then((states) => setRunStates(Object.fromEntries(states.map((state) => [state.conversationId, state])))).catch(() => undefined)
    const activeRunsReady = syncActiveRuns().catch(() => undefined)
    // 侧栏搜索是本地过滤，走不分页的 list 才能搜到滚动区之外的项目（listPage 的页长被夹在 100 以内）
    const projectsReady = window.fastAgent.projects.list().then((items) => setProjectItems(items)).catch(() => setNotice('项目列表加载失败'))
    const preferencesReady = window.fastAgent.preferences.get().then((stored) => {
      const legacyFavorite = readModelIds('fastagent.favorite-models')
      const legacyRecent = readModelIds('fastagent.recent-models')
      let legacyPrompts: Partial<ModePrompts> = {}
      try { legacyPrompts = JSON.parse(window.localStorage.getItem('fastagent.mode-prompts') || '{}') as Partial<ModePrompts> } catch { /* 损坏的旧偏好直接丢弃 */ }
      const nextFavorite = stored.favoriteModelIds.length ? stored.favoriteModelIds : legacyFavorite
      const nextRecent = stored.recentModelIds.length ? stored.recentModelIds : legacyRecent
      const nextPrompts = {
        chat: normalizeSavedModePrompt(stored.modePrompts.chat ?? legacyPrompts.chat, 'chat'),
        agent: normalizeSavedModePrompt(stored.modePrompts.agent ?? legacyPrompts.agent, 'agent')
      }
      setFavoriteModelIds(nextFavorite)
      setRecentModelIds(nextRecent)
      setSelectedModelId(stored.selectedModelId)
      setDefaultModelId(stored.selectedModelId)
      setModePrompts(nextPrompts)
      setSidebarSections({ workspace: stored.sidebarSections?.workspace ?? true, recent: stored.sidebarSections?.recent ?? true })
      setPreferencesLoaded(true)
      if ((!stored.favoriteModelIds.length && legacyFavorite.length) || (!stored.recentModelIds.length && legacyRecent.length) || Object.keys(legacyPrompts).length) {
        void window.fastAgent.preferences.update({ favoriteModelIds: nextFavorite, recentModelIds: nextRecent, modePrompts: nextPrompts })
      }
      window.localStorage.removeItem('fastagent.favorite-models')
      window.localStorage.removeItem('fastagent.recent-models')
      window.localStorage.removeItem('fastagent.mode-prompts')
    }).catch(() => setPreferencesLoaded(true))
    // 主窗口在这之前一直隐藏着，由启动页顶着。等这几路落定再报就绪，
    // 侧栏分组折叠态、模型选择这些才不会当着用户的面回跳一次。
    void whenFirstScreenReady([bootstrapReady, localModelsReady, runStatesReady, activeRunsReady, projectsReady, preferencesReady], 2500)
      .then(() => requestAnimationFrame(() => requestAnimationFrame(() => { void window.fastAgent.startup.ready() })))
    // 启动期的非致命失败只进了日志，这里取回来给用户一条能看见的交代。
    void window.fastAgent.startup.warnings().then(({ warnings, logPath }) => {
      if (!warnings.length) return
      setNoticeAction({ label: '查看日志', run: () => { void window.fastAgent.shell.openPath(logPath) } })
      setNotice(warnings.length === 1 ? `启动异常：${warnings[0].scope}` : `启动异常：${warnings[0].scope} 等 ${warnings.length} 项`)
    }).catch(() => undefined)
    return () => modelSync.dispose()
  }, [])

  // 侧栏只展示最近这些，翻页与筛选交给会话中心（「查看全部」入口）。
  useEffect(() => {
    let cancelled = false
    void window.fastAgent.conversations.listPage({
      pageSize: RECENT_CONVERSATION_LIMIT,
      projectScope: selectedProjectId ?? 'all'
    }).then((result) => {
      if (cancelled) return
      setConversationItems(result.items.map(toWorkspaceConversation))
    }).catch(() => { if (!cancelled) setNotice('最近会话加载失败') })
    return () => { cancelled = true }
  }, [recentConversationRefresh, selectedProjectId])

  useEffect(() => {
    if (batchKind !== 'conversations') return
    let cancelled = false
    void window.fastAgent.conversations.listPage({
      page: batchConversationPage,
      pageSize: batchConversationPageSize,
      projectScope: batchConversationScope,
      keyword: batchConversationQuery.trim() || undefined
    }).then((result) => {
      if (cancelled) return
      setBatchConversationItems(result.items.map(toWorkspaceConversation))
      setBatchConversationTotal(result.total)
      if (result.page !== batchConversationPage) setBatchConversationPage(result.page)
    }).catch(() => { if (!cancelled) setNotice('批量管理列表加载失败') })
    return () => { cancelled = true }
  }, [batchConversationQuery, batchConversationScope, batchConversationRefresh, batchKind, batchConversationPage, batchConversationPageSize, setBatchConversationPage])

  useEffect(() => {
    // 本地模型异步加载完成前不能判定负数 ID 失效，否则会把已保存的本地模型提前覆盖为云端默认模型。
    if (bootstrapLoaded && localModelsLoaded && preferencesLoaded && !allModels.some((model) => model.id === selectedModelId)) {
      const next = initialSelectedModelId(allModels, bootstrap?.default_model_id, selectedModelId)
      setSelectedModelId(next)
      const selected = allModels.find((item) => item.id === next)
      setThinkingLevel(defaultThinkingLevel(bootstrap?.default_thinking_level || selected?.thinking_default, selected))
    }
  }, [allModels, bootstrap, bootstrapLoaded, localModelsLoaded, preferencesLoaded, selectedModelId])

  // 目录补齐后把挂起的会话绑定落位：重载恢复会话时账号连接的模型清单常常还没到，
  // 不补这一步，底栏会一直停在默认模型，直到用户手动再点一次该会话。
  useEffect(() => {
    if (boundModelIdPending === null) return
    const model = allModels.find((item) => item.id === boundModelIdPending)
    if (!model) return
    setBoundModelIdPending(null)
    setSelectedModelId(model.id)
    setThinkingLevel((current) => normalizeThinkingLevel(current, model))
  }, [allModels, boundModelIdPending])

  useEffect(() => {
    if (!bootstrapLoaded || !localModelsLoaded) return
    const model = allModels.find((item) => item.id === selectedModelId)
    // 模型尚未就绪时不归一：空能力会把刚落位的默认档冲回 auto。
    if (model) setThinkingLevel((current) => normalizeThinkingLevel(current, model))
  }, [allModels, bootstrapLoaded, localModelsLoaded, selectedModelId])

  useEffect(() => {
    // 模型目录未完整加载时禁止保存临时 null，避免覆盖数据库中的已保存模型。
    // selectedModelId 不在这里保存：打开历史会话会把它改成该会话绑定的模型，
    // 顺手写进账户偏好就等于「看一眼旧会话，新会话的默认模型也跟着变了」。只有手动切换才更新默认值。
    if (!preferencesLoaded || !bootstrapLoaded || !localModelsLoaded) return
    void window.fastAgent.preferences.update({ favoriteModelIds, recentModelIds, modePrompts, sidebarSections })
  }, [favoriteModelIds, modePrompts, preferencesLoaded, recentModelIds, sidebarSections])

  const { streamBuffer, thinkingBuffer, streamedTextRef } = useStreamBuffers(setTurns)
  const { memoryTurnIds, contextSourceTurnIds } = useTurnActivitySets(selectedConversationId, turns.length, runId)
  const { findOpen, findRequest, setFindOpen } = useFindBar(section, batchKind)
  // `!命令`：默认只在对话区展示；设置成 context 时补一轮落库问答让模型也读得到，composer 时回填输入框。
  // `!命令`：默认只在对话区展示；设置成 context 时补一轮落库问答让模型也读得到，composer 时回填输入框。
  const shellCommands = useShellCommands(selectedConversationId, {
    onNotice: setNotice,
    onFinished: (result, shellSettings) => {
      if (shellSettings.output === 'composer') {
        setPrefillRequest({ text: formatShellCommandOutput(result), nonce: Date.now() })
        return
      }
      if (shellSettings.output !== 'context') return
      const targetConversationId = selectedConversationIdRef.current
      if (!targetConversationId) { setNotice('还没有会话，命令输出这次只在本地显示'); return }
      const persistPromise = persistShellCommandTurn(targetConversationId, result, selectedModelId)
      pendingShellContextRef.current = { conversationId: targetConversationId, promise: persistPromise }
      void persistPromise
        // 会话可能在命令跑完前被切走，落库成功也不能把这一轮塞进别的会话。
        .then((turn) => setTurns((current) => turn.conversationId === selectedConversationIdRef.current ? [...current, turn] : current))
        .catch(() => setNotice('命令输出写入会话失败'))
        .finally(() => { if (pendingShellContextRef.current?.promise === persistPromise) pendingShellContextRef.current = null })
    }
  }, settings?.shellCommand)

  const { scrollRef, followRef, scrollNav, headerStuck, onConversationScroll, jumpConversation } = useConversationScroll(turns, runId, selectedConversationId)
  const minimap = useConversationMinimap(scrollRef, turns, followRef)

  useAgentEvents({
    selectedConversationId, visibleConversationId: section === 'chats' && batchKind !== 'conversations' ? selectedConversationId : null, streamBuffer, thinkingBuffer, refreshGitState,
    conversationItemsRef, runTurnRef, activeTurnRef, streamedTextRef, eventSequenceRef,
    setRunStates, setCompactionStates, setContextHealth, setCompactionHistory, setApprovals, setTodosByTurn, setTurns, setRunIdsByConversation, setQueuedPromptsByConversation, setNotice
  })

  async function respondApproval(id: string, decision: ApprovalDecision, answer?: string) {
    const pending = approvals.find((item) => item.request.id === id)
    if (!pending) return
    try {
      await window.fastAgent.chat.respondApproval(id, decision, answer, pending.runId)
      setApprovals((current) => current.filter((item) => item.request.id !== id))
    } catch {
      setApprovals((current) => current.filter((item) => item.request.id !== id))
      setNotice('审批响应失败')
    }
  }

  async function switchGitBranch(branch: string): Promise<GitOperationResult> {
    const result = await window.fastAgent.git.checkout(branch)
    if (result.ok) {
      refreshGitState()
      setNotice(`已切换到分支 ${branch}`)
    } else {
      setNotice(`切换分支失败：${result.error ?? '未知错误'}`)
    }
    return result
  }

  async function createGitBranch(name: string): Promise<GitOperationResult> {
    const result = await window.fastAgent.git.create(name)
    if (result.ok) {
      refreshGitState()
      setNotice(`已创建并切换到分支 ${name}`)
    } else {
      setNotice(`新建分支失败：${result.error ?? '未知错误'}`)
    }
    return result
  }

  /** 「停止任务并切换」：先取消当前会话的 run，等终态事件清掉 runId 后再切分支。 */
  async function stopRunThenSwitch(branch: string): Promise<GitOperationResult> {
    const currentRun = selectedConversationId ? runIdsRef.current[selectedConversationId] ?? null : null
    if (currentRun) {
      await window.fastAgent.chat.cancel(currentRun).catch(() => undefined)
      // 轮询等 run 终态（渲染层收到 cancelled 等事件后清除 runId），避免文件操作与 checkout 交错；超时兑底直接继续。
      const deadline = Date.now() + 5000
      while (Date.now() < deadline && runIdsRef.current[selectedConversationId ?? ''] !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    return switchGitBranch(branch)
  }

  async function pickWorkspace() {
    const root = await window.fastAgent.workspace.pickRoot()
    if (!root) return
    setWorkspaceRoot(root)
    let saved = true
    try {
      const record = await window.fastAgent.projects.add({ path: root })
      setProjectItems((current) => upsertRecentWorkspaceItem(current, record))
      setSelectedProjectId(record.id)
    } catch {
      saved = false
    }
    setMode('agent'); applyDefaultPermission('workspace'); setSection('chats')
    setNotice(saved ? `已打开项目：${root.split('\\').pop() || root}` : '项目已打开，但未能存入项目列表')
  }

  async function openProjectFolder(path: string) {
    const error = await window.fastAgent.shell.openPath(path)
    setNotice(error ? `无法打开目录：${error}` : '已在文件管理器中打开')
  }

  async function openConversationFolder(conversationId: string) {
    try {
      const error = await window.fastAgent.conversations.openSessionDirectory(conversationId)
      setNotice(error ? `无法打开目录：${error}` : '已在文件管理器中打开')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法打开会话目录')
    }
  }

  function navigate(next: WorkspaceSection) {
    setSection(next)
    setNavigation((current) => pushNavigation(current.entries, current.index, next))
  }

  function openSkill(abilityId: string) {
    setAbilityRequest((current) => ({ abilityId, nonce: (current?.nonce ?? 0) + 1 }))
    navigate('capabilities')
  }

  /** 计数器保证重复点同一个入口也能把设置页切回目标分类。 */
  function openSettings(category: SettingsCategory) {
    setSettingsCategory(category)
    setSettingsRequest((value) => value + 1)
    navigate('settings')
  }

  function openConversations() {
    setBatchKind(null)
    navigate('conversations')
  }

  /** 新建会话后把光标交回输入框。等一帧是因为从设置页等分区切回来时 Composer 还没挂载。 */
  function focusComposerSoon() {
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('fastagent:shortcut', { detail: 'focusComposer' })))
  }

  /** 新会话回到账户默认模型，不继承上一个打开的历史会话的绑定。 */
  function resetModelToDefault() {
    setBoundModelIdPending(null)
    setSelectedModelId((current) => conversationModelId(allModels, defaultModelId, current))
  }

  function startNewChat() {
    streamBuffer.flush()
    followRef.current = true
    conversationLoadRef.current += 1
    // 「新对话」建的是不归属任何项目的快速对话，所以要先解除项目选中，
    // 否则发送时会按当前选中的项目落库（见下方 conversations.create 的 projectId）。
    setSelectedProjectId(null)
    // 工作区根目录是主进程状态，不一并清空的话 @ 补全仍会搜到上一个项目的文件。
    void window.fastAgent.workspace.setRoot(null).catch(() => undefined)
    setWorkspaceRoot(null)
    setArtifactFile(null)
    setSection('chats'); setNavigation((current) => pushNavigation(current.entries, current.index, 'chats')); setSelectedConversationId(null); setConversationTitle('新对话'); setTurns([]); setActiveTurnId(null); setContextHealth(emptyContextHealth()); resetConversationContext(); setMode('chat'); applyDefaultPermission('ask'); resetModelToDefault()
    writeLastConversationId(null)
    focusComposerSoon()
  }

  /**
   * /new 的语境版本：项目里新建当前项目下的空会话（保持项目绑定），快速对话等同普通新对话。
   * projectId 显式传入是给「在某个项目上直接新建」用的：那条路径刚调过 selectProject，
   * 这一帧里 selectedProjectId 还是旧值，读 state 会把会话建到上一个项目下。
   */
  function startNewChatInContext(projectId: string | null = selectedProjectId) {
    if (!projectId) {
      startNewChat()
      return
    }
    streamBuffer.flush()
    followRef.current = true
    conversationLoadRef.current += 1
    // 只重置主区视图，保留 selectedProjectId 与工作区根；发送第一条消息时
    // 会以当前项目落库（sendPrompt 的 conversations.create projectId）。
    setArtifactFile(null)
    setSection('chats'); setNavigation((current) => pushNavigation(current.entries, current.index, 'chats')); setSelectedConversationId(null); setConversationTitle('新对话'); setTurns([]); setActiveTurnId(null); setContextHealth(emptyContextHealth()); resetConversationContext(); setMode('agent'); applyDefaultPermission('workspace'); resetModelToDefault()
    writeLastConversationId(null)
    focusComposerSoon()
  }

  /**
   * 删除 / 归档掉正在打开的会话之后的收尾。
   * 选中的项目要留住：用户是在这个项目的最近对话里删掉一条，不是要退出这个项目。
   */
  function leaveRemovedConversation() {
    if (selectedProjectId) startNewChatInContext()
    else startNewChat()
  }

  function stepHistory(direction: -1 | 1) {
    const next = stepNavigation(navigation.entries, navigation.index, direction)
    if (!next) return
    setNavigation((current) => ({ ...current, index: next.index }))
    setSection(next.target)
    setBatchKind(null)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isNewConversationShortcut(event)) return
      event.preventDefault()
      startNewChat()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useAppShortcuts(settings?.shortcuts, {
    newConversation: () => startNewChat(),
    openSettings: () => openSettings('general'),
    toggleTheme: () => {
      const next: AppTheme = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark'
      onThemeChange(next)
      setNotice(next === 'dark' ? '已切换到深色主题' : next === 'light' ? '已切换到浅色主题' : '已跟随系统主题')
    },
    notify: setNotice,
    stepHistory
  })

  // 会话跨项目时要把主进程工作区一起切过去，否则接着聊会在上一个项目的目录里跑工具。
  async function syncWorkspaceForConversation(projectId: string | null) {
    if (projectId === selectedProjectId) return
    const project = projectId ? projectItems.find((item) => item.id === projectId) : null
    // 切换工作区时清空旧的文件预览，避免旧请求在新工作区里读到同名同路径文件。
    setArtifactFile(null)
    // 无归属会话（或项目已被删除）要把工作区一起清掉，否则 @ 补全和产物面板还停在上一个项目里。
    if (!project) {
      setSelectedProjectId(null)
      try { await window.fastAgent.workspace.setRoot(null) } catch { /* 清空失败不影响会话切换 */ }
      setWorkspaceRoot(null)
      return
    }
    try { await window.fastAgent.workspace.setRoot(project.path) } catch { setNotice('切换工作区失败'); return }
    setSelectedProjectId(project.id)
    setWorkspaceRoot(project.path)
  }

  /**
   * 从主进程取回仍在跑的 run，重建 runId 与回合的对应关系。
   * 界面重载不会重启主进程，这些 run 还活着；不接回来界面就当它已结束，
   * 既不显示运行中，用户再发一条还会对同一会话起第二个 run。
   */
  async function syncActiveRuns() {
    const runs = await window.fastAgent.chat.listActive()
    for (const run of runs) runTurnRef.current.set(run.runId, run.turnId)
    setRunIdsByConversation((current) => ({ ...current, ...Object.fromEntries(runs.map((run) => [run.conversationId, run.runId])) }))
    // 挂起的审批/提问只在发起时推过一次事件，重载后弹层就没了，而主进程仍在 await。
    // 不接回来这一轮既不推进也不结束，界面只剩「准备中」，连停止都得靠用户自己想到。
    const pending = await window.fastAgent.chat.listPendingApprovals().catch(() => [])
    if (pending.length) {
      setApprovals((current) => {
        const known = new Set(current.map((item) => item.request.id))
        const restored = pending.filter((item) => !known.has(item.request.id))
        return restored.length ? [...current, ...restored] : current
      })
    }
  }

  async function selectConversation(item: WorkspaceConversation) {
    // 先把积压的 token 冲进缓存再切走，否则最后一段文本没进 streamedTextRef 就丢了。
    streamBuffer.flush()
    followRef.current = true
    const loadId = ++conversationLoadRef.current
    setBatchKind(null)
    setSelectedConversationId(item.id)
    writeLastConversationId(item.id)
    void window.fastAgent.chat.markRead(item.id)
    setRunStates((current) => current[item.id] ? { ...current, [item.id]: { ...current[item.id], hasUnreadResult: false } } : current)
    setSection('chats')
    setNavigation((current) => pushNavigation(current.entries, current.index, 'chats'))
    setConversationTitle(item.title)
    setTurns([])
    // 模型是会话级绑定，进会话立刻切过去；等历史加载完再切，底栏会当着用户的面跳一次。
    setSelectedModelId(conversationModelId(allModels, item.modelId, selectedModelId))
    setBoundModelIdPending(pendingBoundModelId(allModels, item.modelId))
    await syncWorkspaceForConversation(item.projectId)
    try {
      const history = await window.fastAgent.conversations.history(item.id)
      if (loadId === conversationLoadRef.current) {
        setTurns(mergeStreamedText(history, streamedTextRef.current))
        // 活动回合跟着会话走：不重置的话事件回调的兜底分支会把新事件写进上一个会话的 turn。
        setActiveTurnId(history.find((turn) => turn.status === 'working' && turn.activity?.execution?.status === 'running')?.id ?? null)
        const latest = history.at(-1)
        if (latest) {
          setMode(latest.runtimeConfig.mode)
          // 进入另一个已有会话是新上下文：交还给该会话存档的配置，并解除锁定。
          setPermission(latest.runtimeConfig.permission || 'ask')
          setPermissionPinned(false)
          // 会话级绑定为空（旧会话）时按最近一轮实际用的模型还原并写回绑定，
          // 否则刷新后底栏会回落成默认模型，看起来像会话没绑模型。
          const boundModelId = item.modelId ?? latest.runtimeConfig.modelId
          const modelId = conversationModelId(allModels, boundModelId, selectedModelId)
          // 绑定的模型还没进目录时挂起，等目录补齐再落位；直接回退到默认模型会把绑定丢掉。
          setBoundModelIdPending(pendingBoundModelId(allModels, boundModelId))
          if (item.modelId == null && latest.runtimeConfig.modelId != null && modelId !== null) {
            setSelectedModelId(modelId)
            void window.fastAgent.conversations.setModel(item.id, modelId).catch(() => undefined)
          }
          setThinkingLevel(normalizeThinkingLevel(latest.runtimeConfig.thinkingLevel, allModels.find((model) => model.id === modelId)))
        }
      }
      void window.fastAgent.conversations.listTodos(item.id).then((todos) => {
        // 历史会话只有末尾一份 todo 快照，归属到最近一个回合，跟随该回合的完成态展示。
        const latestTurnId = history.at(-1)?.id
        if (loadId === conversationLoadRef.current && todos.length && latestTurnId) setTodosByTurn((current) => ({ ...current, [latestTurnId]: todos }))
      }).catch(() => undefined)
      const detail = await window.fastAgent.conversations.getInspector(item.id)
      if (loadId === conversationLoadRef.current) {
        const usage = await window.fastAgent.conversations.modelUsage(item.id).catch(() => undefined)
        // 换会话必须整份换掉上下文数据：detail 或 context 缺失时回落到空值，
        // 沿用 current 会把上一个会话的 token 统计留在面板上。
        const boundModel = allModels.find((model) => model.id === conversationModelId(allModels, item.modelId, selectedModelId))
        const blank = emptyContextHealth(boundModel)
        // 落库的窗口是「最后一次运行时那个模型」的，不一定是这条会话现在绑定的模型。
        // 认得出绑定模型就按它的窗口算百分比：下一次发送用的就是这个窗口，
        // 照旧值显示会让换过模型的会话一直按上一个模型的分母算余量与阈值。
        setContextHealth(detail?.context
          ? { ...detail.context, contextWindow: boundModel ? blank.contextWindow : detail.context.contextWindow, latestCompactionAt: detail.compactionHistory[0]?.createdAt || null, usage: usage ?? blank.usage, usagePending: false }
          : { ...blank, usage: usage ?? blank.usage, usagePending: false })
        // 与上下文数据同批换掉：沿用上一个会话的压缩记录会在新会话里画出不存在的分隔卡。
        setCompactionHistory(detail?.compactionHistory ?? [])
        setConversationPolicy(detail?.contextPolicy ?? null)
      }
    } catch {
      if (loadId === conversationLoadRef.current) setNotice('会话历史加载失败')
    }
  }

  /**
   * 重载后回到上次打开的会话。等模型目录与偏好都就绪再恢复：
   * 早于目录加载就调 selectConversation，会话绑定的模型会被空目录顶成默认模型。
   */
  useEffect(() => {
    if (restoredRef.current || !restoreConversationId) return
    if (!preferencesLoaded || !bootstrapLoaded || !localModelsLoaded) return
    restoredRef.current = true
    // 用户在这期间已经自己选了会话，就别再跳走。
    if (selectedConversationId) return
    void window.fastAgent.conversations.get(restoreConversationId)
      .then((record) => { if (record && !record.archived) void selectConversation(toWorkspaceConversation(record)) })
      .catch(() => undefined)
    // selectConversation 每次渲染都是新引用，列进依赖会让恢复随渲染重跑；这里只由就绪条件驱动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreConversationId, preferencesLoaded, bootstrapLoaded, localModelsLoaded, selectedConversationId])

  async function openInspector(conversationId: string) {
    let detail
    try { detail = await window.fastAgent.conversations.getInspector(conversationId) }
    catch { setNotice('会话详情加载失败'); return }
    if (!detail) { setNotice('会话详情不存在'); return }
    setInspectorId(conversationId)
    setArtifactOpen(false)
    const model = allModels.find((item) => item.id === detail.runtime.modelId)
    const history = await window.fastAgent.conversations.history(conversationId).catch(() => [] as ConversationTurn[])
    const latestTurn = history.at(-1)
    const latestToolCalls = latestTurn ? await window.fastAgent.conversations.listToolCalls(latestTurn.id).catch(() => [] as ToolCallRecord[]) : []
    // 模型缓存面板搬进了会话详情：detail.context 只有上下文口径，用量得单独取一次。
    // 取失败不该挡住整个面板，回落到当前会话面板上那份。
    const usage = await window.fastAgent.conversations.modelUsage(conversationId).catch(() => undefined)
    setInspector(buildInspectorData({
      detail,
      history,
      latestToolCalls,
      model,
      permissionLabel: detail.runtime.permission ? findProfile(permissionProfiles, detail.runtime.permission).label : undefined,
      fallbackContext: contextHealth,
      usage: usage ?? (conversationId === selectedConversationId ? contextHealth.usage : undefined),
      settings
    }))
  }

  async function compactConversationNow(conversationId: string | null, compressionModelId = selectedModelId) {
    if (!conversationId) { setNotice('请先选择一个会话'); return }
    const currentCompaction = compactionStates[conversationId]
    if (currentCompaction?.status === 'running') return
    setCompactionStates((current) => beginCompaction(current, conversationId, compressionModelId))
    try {
      const result = await window.fastAgent.conversations.compactNow(conversationId, compressionModelId)
      if (!result) { setCompactionStates((current) => clearCompaction(current, conversationId)); setNotice('当前上下文没有可压缩的内容'); return }
      setCompactionStates((current) => completeCompaction(current, conversationId))
      const before = Math.round(result.compaction.beforeTokens / result.context.contextWindow * 100)
      const after = Math.round(result.compaction.afterTokens / result.context.contextWindow * 100)
      if (conversationId === selectedConversationId) setContextHealth((current) => ({ ...result.context, latestCompactionAt: result.compaction.createdAt, usage: current.usage, usagePending: false }))
      if (conversationId === inspectorId) await openInspector(conversationId)
      setNotice(`已压缩旧上下文 · ${before}% → ${after}%`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '压缩失败'
      setCompactionStates((current) => failCompaction(current, conversationId, message))
      if (/取消|cancel/i.test(message)) setNotice('已取消压缩')
      else setNotice(message)
    }
  }

  /**
   * /clear：彻底清空当前会话（不可撤销），主进程连 session 文件、附件与本会话产生的记忆一起删。
   * 本地把所有按会话挂着的视图状态一并重置，否则待办、审批、成果面板会指向已经不存在的回合。
   */
  async function clearConversationAction() {
    const conversationId = selectedConversationId
    if (!conversationId) { setNotice('/clear：请先选择一个会话'); return }
    try {
      await window.fastAgent.conversations.clear(conversationId)
      conversationLoadRef.current += 1
      setTurns([])
      setActiveTurnId(null)
      setContextHealth(emptyContextHealth()); resetConversationContext()
      setConversationTitle('新对话')
      setTodosByTurn({})
      setApprovals((current) => current.filter((item) => item.conversationId !== conversationId))
      setQueuedPromptsByConversation((current) => ({ ...current, [conversationId]: [] }))
      setCompactionStates((current) => clearCompaction(current, conversationId))
      setRunStates((current) => {
        if (!current[conversationId]) return current
        const next = { ...current }
        delete next[conversationId]
        return next
      })
      setArtifactFile(null)
      setConversationItems((current) => current.map((item) => item.id === conversationId ? { ...item, title: '新对话', meta: conversationMetaNow() } : item))
      setRecentConversationRefresh((current) => current + 1)
      setBatchConversationRefresh((current) => current + 1)
      setNotice('已清空这个会话的全部内容，包括上下文、运行记录与由它产生的记忆')
    } catch (error) {
      setNotice(cleanIpcError(error, '清空会话失败'))
    }
  }

  /** /init：在当前项目根目录生成 AGENTS.md，结果经 notice 反馈。 */
  async function initProjectAction() {
    try {
      const result = await window.fastAgent.workspace.initProject()
      if (result.status === 'error') setNotice(result.message || '/init 无法执行')
      else if (result.status === 'exists') setNotice('项目已有 ' + (result.path.split(/[\\/]/).pop() || '记忆文件') + '，未覆盖')
      else setNotice(`已生成 AGENTS.md：${result.path}`)
    } catch (error) {
      setNotice(cleanIpcError(error, '/init 执行失败'))
    }
  }

  /** 侧栏工作区按操作时间排序：命中一次操作就刷新 updated_at 并把本地列表重排，失败不影响主流程。 */
  async function touchProject(id: string) {
    try {
      const record = await window.fastAgent.projects.touch(id)
      if (record) setProjectItems((current) => upsertRecentWorkspaceItem(current, record))
    } catch { /* 排序刷新失败不值得打断用户 */ }
  }

  async function selectProject(item: WorkspaceProject) {
    setBatchKind(null)
    setSelectedProjectId(item.id)
    // 工作区根目录是主进程状态，运行时靠它定位文件，只改渲染层 state 不生效。
    try { await window.fastAgent.workspace.setRoot(item.path) } catch { setNotice('切换工作区失败'); return }
    void touchProject(item.id)
    setWorkspaceRoot(item.path)
    // 上一个项目里打开的文件在新项目多半不存在，留着只会让产物面板报错。
    setArtifactFile(null)
    // 项目里还有没跑完的会话时直接回到它：用户点项目是为了看那次运行，再让他手动翻会话列表是多余一步。
    const active = findActiveProjectConversation(conversationItems, runStates, item.id)
    if (active) {
      setNotice(`已切换项目：${item.name}，回到进行中的会话`)
      await selectConversation(active)
      return
    }
    setMode('agent')
    applyDefaultPermission('workspace')
    setSection('chats')
    setNavigation((current) => pushNavigation(current.entries, current.index, 'chats'))
    // 切换项目后主区重置为空白新对话，避免残留上一个对话的标题与历史；模式与权限保持 agent/workspace。
    conversationLoadRef.current += 1
    setSelectedConversationId(null)
    writeLastConversationId(null)
    setConversationTitle('新对话')
    setTurns([])
    setActiveTurnId(null)
    setContextHealth(emptyContextHealth()); resetConversationContext()
    setNotice(`已切换项目：${item.name}`)
  }

  async function deleteConversation(id: string) {
    try { await window.fastAgent.conversations.remove(id) } catch { setNotice('删除会话失败'); return }
    setConversationItems((current) => removeWorkspaceItem(current, id))
    setRecentConversationRefresh((current) => current + 1)
    setBatchConversationRefresh((current) => current + 1)
    if (selectedConversationId === id) {
      leaveRemovedConversation()
    }
    setNotice('对话已删除')
  }

  function deleteTurn(turnId: string) {
    setPendingConfirm({
      title: '删除这一轮问答？',
      lines: ['这一轮的提问、回答与执行记录会被永久删除，模型之后也不会再看到这一轮。', '工作区里已经改过的文件不会被还原。删除后无法恢复。'],
      confirmLabel: '删除',
      onConfirm: () => void performDeleteTurn(turnId)
    })
  }

  async function performDeleteTurn(turnId: string) {
    try {
      const removed = await window.fastAgent.conversations.deleteTurn(turnId)
      if (!removed) return
      setTurns((current) => current.filter((turn) => turn.id !== turnId))
      setNotice('已删除本轮问答')
    } catch (error) { setNotice(cleanIpcError(error, '删除本轮问答失败')) }
  }

  async function copyText(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice('已复制') } catch { setNotice('复制失败') }
  }

  /**
   * 重试 / 重新生成 / 编辑重发第 N 轮。主进程会把第 N 轮之后的回合删掉并把模型上下文退回到第 N 轮之前，
   * 界面同步截断；后面还有回合时先确认，别让一次「重新发送」悄悄带走后面的对话。
   */
  async function rerunTurn(turn: ConversationTurn, prompt = turn.userMessage.text, attachments = turn.attachments) {
    if (runId) return
    const index = turns.findIndex((item) => item.id === turn.id)
    const later = index < 0 ? 0 : turns.length - index - 1
    if (later > 0) {
      setPendingConfirm({
        title: '重新发送这一轮？',
        lines: [`这一轮之后的 ${later} 轮问答会被删除，模型上下文也会退回到这一轮之前。`, '工作区里已经改过的文件不会被还原。删除的问答无法恢复。'],
        confirmLabel: '重新发送',
        onConfirm: () => void performRerun(turn, prompt, attachments)
      })
      return
    }
    await performRerun(turn, prompt, attachments)
  }

  async function performRerun(turn: ConversationTurn, prompt: string, attachments: Attachment[]) {
    if (runId) return
    const before = turns
    const reset: ConversationTurn = { ...turn, userMessage: { ...turn.userMessage, text: prompt }, attachments, assistantMessage: null, activity: { status: 'working', startedAt: new Date().toISOString(), finishedAt: null, events: [] }, status: 'working', updatedAt: new Date().toISOString() }
    setTurns((current) => truncateTurnsForRerun(current, reset))
    setActiveTurnId(turn.id)
    try {
      await window.fastAgent.conversations.updateTurn(turn.id, { userMessage: reset.userMessage, attachments, assistantMessage: null, activity: reset.activity, status: 'working' })
      // 重试 / 重新生成 / 编辑重发都以底部对话框当前选择的模型与思考级别为准，不复用被重跑那一轮的存档。
      const result = await window.fastAgent.chat.send({ conversationId: turn.conversationId, turnId: turn.id, mode: turn.runtimeConfig.mode, modelId: selectedModelId, thinkingLevel, permission: turn.runtimeConfig.permission, modePrompt: withPlanModePrompt(modePromptFor(modePrompts, turn.runtimeConfig.mode), planMode), planMode, prompt, attachments })
      runTurnRef.current.set(result.runId, turn.id)
      setRunIdsByConversation((current) => ({ ...current, [turn.conversationId]: result.runId }))
    } catch (error) {
      // 主进程的拒绝（任务仍在跑、超预算等）都发生在删后续回合之前，库里的后续回合还在：
      // 把这一轮改回原样、界面整段恢复成重跑前的列表，别留一条空的 working 回合。
      setTurns(before)
      void window.fastAgent.conversations.updateTurn(turn.id, { userMessage: turn.userMessage, attachments: turn.attachments, assistantMessage: turn.assistantMessage, activity: turn.activity, status: turn.status }).catch(() => undefined)
      if (isRunConflictError(error)) {
        void syncActiveRuns().catch(() => undefined)
        setNotice('当前任务仍在运行，无法重新运行')
        return
      }
      setNotice(cleanIpcError(error, '重新运行失败'))
    }
  }

  /**
   * 发送一轮问答：新建会话或向当前会话追加 turn。
   * 运行中提交走 queuedPrompts 队列，由下方 flush 效应在回合结束后逐条发出。
   */
  async function sendPrompt(text: string, attachments: Attachment[]) {
    const pendingShellContext = pendingShellContextRef.current
    if (pendingShellContext && pendingShellContext.conversationId === selectedConversationIdRef.current) await pendingShellContext.promise.catch(() => undefined)
    // 新消息无论用户之前浏览到哪里，都从最新内容开始跟随。
    followRef.current = true
    // 中断恢复必须创建新回合：旧回合保留截断正文与执行证据，Pi 在新 prompt 前负责压缩内部上下文。
    const lastTurn = turns.at(-1)
    const prompt = attachments.length === 0 && lastTurn?.status === 'interrupted' && isContinuationInput(text)
      ? buildContinuationPrompt(text)
      : text
    let pendingTurnId: string | null = null
    try {
      const isNewConversation = selectedConversationId === null
      let conversationId: string
      if (isNewConversation) {
        const created = await window.fastAgent.conversations.create({ title: titleFromPrompt(prompt), projectId: selectedProjectId })
        conversationId = created.id
        setSelectedConversationId(conversationId)
        writeLastConversationId(conversationId)
        setConversationTitle(created.title)
        setConversationItems((current) => upsertRecentWorkspaceItem(current, toWorkspaceConversation(created)))
      } else {
        conversationId = selectedConversationId
        // /clear 会把标题重置成「新对话」；清空后的第一句话照新建会话的规则重新起标题，否则它会一直叫「新对话」。
        const retitle = turns.length === 0 && conversationTitle === '新对话' ? titleFromPrompt(prompt) : null
        if (retitle) {
          setConversationTitle(retitle)
          void window.fastAgent.conversations.rename(conversationId, retitle).catch(() => undefined)
        }
        setConversationItems((current) => current.map((item) => item.id === conversationId ? { ...item, ...(retitle ? { title: retitle } : {}), meta: conversationMetaNow(), archived: false } : item))
      }
      // turn 由主进程在 chat.send 内部原子创建；ACK 返回的 turn 是唯一来源，避免双 IPC。
      const result = await window.fastAgent.chat.send({ conversationId, mode, modelId: selectedModelId, thinkingLevel, permission, modePrompt: withPlanModePrompt(modePromptFor(modePrompts, mode), planMode), planMode, prompt, attachments })
      pendingTurnId = result.turnId
      setTurns((current) => [...current, result.turn])
      setActiveTurnId(result.turnId)
      runTurnRef.current.set(result.runId, result.turnId)
      setRunIdsByConversation((current) => ({ ...current, [conversationId]: result.runId }))
      setRecentConversationRefresh((current) => current + 1)
      setBatchConversationRefresh((current) => current + 1)
      if (selectedProjectId) void touchProject(selectedProjectId)
    } catch (error) {
      // 主进程说这个会话已经有 run 在跑：本地 runId 丢了（多半刚重载过）。
      // 转成排队而不是报失败；runId 与队列在同一个 then 里落地，
      // 否则中间那次渲染会看到「队列非空 + 无 runId」，flush 效应立刻重发又撞一次。
      if (isRunConflictError(error) && selectedConversationId) {
        const target = selectedConversationId
        void syncActiveRuns()
          .then(() => setQueuedPromptsByConversation((current) => ({ ...current, [target]: enqueuePrompt(current[target] ?? [], text, attachments) })))
          .catch(() => setNotice(cleanIpcError(error, '运行失败')))
        setNotice('当前任务仍在运行，已加入排队')
        return
      }
      if (pendingTurnId) void window.fastAgent.conversations.updateTurn(pendingTurnId, { status: 'failed', activity: { status: 'failed', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), events: [] } })
      setNotice(cleanIpcError(error, '运行失败'))
    }
  }

  // 回合结束后自动发出队首排队问题；发送失败时 runId 仍为空，队列随依赖变化继续往下走。
  useEffect(() => {
    if (runId) return
    const next = takeNextQueuedPrompt(queuedPrompts)
    if (!next) return
    if (selectedConversationId) setQueuedPromptsByConversation((current) => ({ ...current, [selectedConversationId]: dropNextQueuedPrompt(current[selectedConversationId] ?? []) }))
    void sendPrompt(next.text, next.attachments)
    // eslint 在这里关不掉：sendPrompt 每次渲染都是新引用，依赖它会让效应随每次流式渲染重跑。
    // 行为靠 runId 与队列内容驱动，遗漏 sendPrompt 依赖是故意的。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, queuedPrompts, selectedConversationId])

  /** 从对话保存知识：正文原样存，不做自动提炼——提炼错了用户看不出来。 */
  async function saveAsKnowledge(projectId: string, text: string) {
    const body = text.trim()
    // 标题压平成一行取前 40 字：知识条目列表按标题辨认，换行会把列表撑乱。
    const title = body.replace(/\s+/g, ' ').trim().slice(0, 40) || '未命名知识'
    try {
      await window.fastAgent.knowledgeBase.save(projectId, { title, content: body })
      setNotice(`已存为项目知识：${title}`)
    } catch (error) { setNotice(error instanceof Error ? error.message : '保存知识失败') }
  }

  // 消息右键菜单：按划选内容与所在消息侧（用户/助手）组装上下文操作。
  // 成果「继续修改」：只把提示写进输入框，不代替用户发送——要改什么必须由人补充。
  const handleContinueEditArtifact = useEventCallback((text: string) => setPrefillRequest({ text, nonce: Date.now() }))
  const handleInsertMcpPrompt = useEventCallback((text: string) => { setPrefillRequest({ text, nonce: Date.now() }); setNotice('Prompt 已插入 Composer，请确认内容后再发送') })

  /** 终端开在界面右侧的面板里，不再弹系统终端窗口；系统终端作为面板里的一个按钮保留。 */
  const handleToggleTerminal = useEventCallback(() => {
    if (!workspaceRoot) { setNotice('先打开一个项目再开终端'); return }
    setTerminalOpen((value) => !value)
  })
  const handleCloseTerminal = useEventCallback(() => setTerminalOpen(false))
  const showMessageContextMenu = useEventCallback((event: React.MouseEvent, turn: ConversationTurn) => {
    const target = event.target as HTMLElement
    const inUser = Boolean(target.closest('.message.user'))
    const inAssistant = Boolean(target.closest('.message.assistant'))
    if (!inUser && !inAssistant) return
    event.preventDefault()
    const items = buildMessageMenuItems(
      { turn, side: inUser ? 'user' : 'assistant', selected: selectionText(), projectId: selectedProjectId },
      {
        copyText: (text) => void copyText(text),
        quote: (text) => setQuoteRequest({ text, nonce: Date.now() }),
        rerun: (target) => void rerunTurn(target),
        saveKnowledge: (projectId, text) => void saveAsKnowledge(projectId, text),
        deleteTurn: (turnId) => void deleteTurn(turnId)
      }
    )
    setContextMenu({ x: event.clientX, y: event.clientY, items })
  })

  async function renameConversation(id: string, input: string) {
    const current = conversationItems.find((item) => item.id === id)
    const title = normalizeRenameInput(input, current?.title ?? '')
    // 空白或没改动就当没发生，不必打一次 IPC，也不弹提示
    if (!title) return
    try { await window.fastAgent.conversations.rename(id, title) } catch { setNotice('重命名失败'); return }
    setConversationItems((items) => renameWorkspaceItem(items, id, title))
    setRecentConversationRefresh((current) => current + 1)
    setBatchConversationRefresh((current) => current + 1)
    if (selectedConversationId === id) setConversationTitle(title)
  }

  async function archiveConversation(id: string) {
    try { await window.fastAgent.conversations.archive(id) } catch { setNotice('归档会话失败'); return }
    setConversationItems((current) => archiveWorkspaceItem(current, id))
    setRecentConversationRefresh((current) => current + 1)
    setBatchConversationRefresh((current) => current + 1)
    if (selectedConversationId === id) {
      leaveRemovedConversation()
    }
    setNotice('对话已归档')
  }

  async function exportConversation(id: string) {
    try {
      const path = await window.fastAgent.conversations.export(id)
      setNotice(path ? `已导出到：${path}` : '已取消导出')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '导出会话失败')
    }
  }

  async function distillSkill(id: string) {
    setNotice('正在提炼技能…')
    try {
      const draft = await window.fastAgent.skills.distill(id, selectedModelId)
      setSkillDraft(draft)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '提炼技能失败')
    }
  }

  async function deleteProject(id: string) {
    try { await window.fastAgent.projects.remove(id) } catch { setNotice('删除项目失败'); return }
    setProjectItems((current) => removeWorkspaceItem(current, id))
    if (selectedProjectId === id) setSelectedProjectId(null)
    setNotice('项目已删除')
  }

  async function archiveProject(id: string) {
    try { await window.fastAgent.projects.archive(id) } catch { setNotice('归档项目失败'); return }
    setProjectItems((current) => archiveWorkspaceItem(current, id))
    if (selectedProjectId === id) setSelectedProjectId(null)
    setNotice('项目已归档')
  }

  function startBatch(kind: 'projects' | 'conversations') {
    setBatchKind(kind)
    setBatchSelectedIds(new Set())
    if (kind === 'conversations') {
      setBatchConversationQuery('')
      setBatchConversationScope(selectedProjectId ?? 'all')
      setBatchConversationPage(1)
    }
    setSection(kind === 'projects' ? 'projects' : 'chats')
    setNotice(`已进入${kind === 'projects' ? '项目' : '对话'}批量管理`)
  }

  // 选中项目时只留该项目的会话；未选项目时保持全量，历史上没有归属的会话才不会消失。
  // 侧栏、搜索页、批量全选共用同一份，否则"全选"会勾到界面上看不见的会话。
  // 记忆化：引用一变，memo 过的侧栏与分区视图会跟着流式输出每帧重绘。
  const scopedConversations = useMemo(
    () => selectedProjectId ? conversationItems.filter((item) => item.projectId === selectedProjectId) : conversationItems,
    [conversationItems, selectedProjectId]
  )
  // Agent 模式只在项目会话里可用：新建会话随当前选中项目落库，已有会话选中时会同步它的归属项目。
  const agentAvailable = selectedProjectId !== null
  // 从项目会话切到快速对话（或历史记录里存了 agent）时，把模式拉回 chat。
  useEffect(() => { if (!agentAvailable && mode === 'agent') setMode('chat') }, [agentAvailable, mode])

  function toggleBatch(id: string) {
    setBatchSelectedIds((current) => toggleBatchSelection(current, id))
  }

  // 由列表把当前可见的 id 传进来，「全选」才不会勾到界面上看不见的条目。
  function toggleAllBatch(ids: string[]) {
    setBatchSelectedIds((current) => toggleBatchPageSelection(current, ids))
  }

  function changeBatchConversationQuery(query: string) {
    setBatchConversationQuery(query)
    setBatchConversationPage(1)
  }

  function changeBatchConversationScope(scope: ConversationScope) {
    setBatchConversationScope(scope)
    setBatchConversationPage(1)
  }

  async function finishBatch(action: 'delete' | 'archive') {
    if (!batchKind || batchSelectedIds.size === 0) return
    if (batchKind === 'projects') {
      const ids = [...batchSelectedIds]
      try {
        await Promise.all(ids.map((id) => action === 'delete' ? window.fastAgent.projects.remove(id) : window.fastAgent.projects.archive(id)))
      } catch {
        setNotice(`${action === 'delete' ? '删除' : '归档'}项目失败`)
        return
      }
      setProjectItems((current) => action === 'delete' ? current.filter((item) => !batchSelectedIds.has(item.id)) : current.map((item) => batchSelectedIds.has(item.id) ? { ...item, archived: true } : item))
      if (selectedProjectId && batchSelectedIds.has(selectedProjectId)) setSelectedProjectId(null)
    } else {
      const ids = [...batchSelectedIds]
      try {
        await Promise.all(ids.map((id) => action === 'delete' ? window.fastAgent.conversations.remove(id) : window.fastAgent.conversations.archive(id)))
      } catch {
        setNotice(`${action === 'delete' ? '删除' : '归档'}会话失败`)
        return
      }
      setConversationItems((current) => action === 'delete' ? current.filter((item) => !batchSelectedIds.has(item.id)) : current.map((item) => batchSelectedIds.has(item.id) ? { ...item, archived: true } : item))
      if (selectedConversationId && batchSelectedIds.has(selectedConversationId)) leaveRemovedConversation()
    }
    setBatchSelectedIds(new Set())
    setRecentConversationRefresh((current) => current + 1)
    setBatchConversationRefresh((current) => current + 1)
    setNotice(action === 'delete' ? '已删除选中项' : '已归档选中项')
  }

  function exitBatch() {
    setBatchKind(null)
    setBatchSelectedIds(new Set())
    setBatchConversationPage(1)
  }

  function closeInspector() {
    setInspector(null)
    setInspectorId(null)
  }

  // responseActions 用空依赖记忆化（换引用会让整棵回答子树重渲染），读不到最新 state，用 ref 兜住当前预览目标。
  const artifactViewRef = useRef({ open: false, key: '' })
  artifactViewRef.current = { open: artifactOpen, key: artifactFile ? formatFileReference(artifactFile) : '' }

  const responseActions = useMemo<ResponseActions>(() => ({
    openFile: (reference) => {
      setInspector(null)
      setInspectorId(null)
      const key = formatFileReference(reference)
      // 再点一次同一个引用就收回预览，和展开/收起工具卡片的手感保持一致。
      if (artifactViewRef.current.open && artifactViewRef.current.key === key) {
        setArtifactOpen(false)
        setArtifactFile(null)
        return
      }
      setArtifactFile(reference)
      setArtifactOpen(true)
    },
    copyText: (text) => void copyText(text),
    notify: setNotice,
    // 只用到 setState 系列，空依赖捕获首帧闭包也读不到过期值。
    openSkill: (abilityId) => openSkill(abilityId)
  }), [])

  const selectedModel = allModels.find((item) => item.id === selectedModelId) ?? allModels[0] ?? null
  const selectedProject = selectedProjectId ? projectItems.find((item) => item.id === selectedProjectId) ?? null : null
  // 输入框是 memo 组件，项目对象按名称与路径缓存，列表刷新不该让它重渲染
  const composerWorkspace = useMemo(() => (selectedProject ? { name: selectedProject.name, path: selectedProject.path } : null), [selectedProject?.name, selectedProject?.path])
  const selectedConversationCompaction = selectedConversationId ? compactionStates[selectedConversationId] ?? null : null
  /**
   * 这条会话实际生效的压缩策略，判定规则与主进程 resolvePolicy 同源。
   * 提示条必须按引擎真正用的阈值说话，否则界面说「82% 会压」而引擎按别的数跑。
   */
  const effectiveContextPolicy = useMemo(
    () => settings ? resolveEffectivePolicy(settings, conversationPolicy, selectedConversationId ?? '') : null,
    [settings, conversationPolicy, selectedConversationId]
  )
  const pressure = useMemo(() => effectiveContextPolicy && selectedConversationId
    ? contextPressure({
      estimatedTokens: contextHealth.estimatedTokens,
      contextWindow: contextHealth.contextWindow,
      policy: effectiveContextPolicy,
      compacting: selectedConversationCompaction?.status === 'running'
    })
    : null, [effectiveContextPolicy, selectedConversationId, contextHealth.estimatedTokens, contextHealth.contextWindow, selectedConversationCompaction?.status])

  /** 空会话没有落库上下文，窗口跟随当前模型，避免固定 128k 与模型设置不一致。 */
  function emptyContextHealth(model = selectedModel): ContextHealthData {
    return { ...EMPTY_CONTEXT_HEALTH, contextWindow: resolveContextWindow(model?.context_window, model?.model_name) }
  }

  function selectModel(nextId: number) {
    // 用户已经自己选了，挂起的旧绑定不能在目录补齐后反过来盖掉这次选择。
    setBoundModelIdPending(null)
    setSelectedModelId(nextId)
    setRecentModelIds((current) => [nextId, ...current.filter((id) => id !== nextId)].slice(0, 8))
    // 手动切换才更新账户默认值（新会话跟着走），并立刻绑定到当前会话，不必等下一次发送。
    setDefaultModelId(nextId)
    void window.fastAgent.preferences.update({ selectedModelId: nextId })
    if (selectedConversationId) {
      void window.fastAgent.conversations.setModel(selectedConversationId, nextId)
      setConversationItems((current) => current.map((item) => item.id === selectedConversationId ? { ...item, modelId: nextId } : item))
    }
    const nextModel = allModels.find((item) => item.id === nextId)
    setThinkingLevel((current) => normalizeThinkingLevel(current, nextModel))
    // 上下文窗口与 token 统计都是模型级的，切换后立即按新模型重算，否则面板停留在上一个模型的数值。
    if (!selectedConversationId) {
      setContextHealth(emptyContextHealth(nextModel))
      return
    }
    const loadId = conversationLoadRef.current
    void window.fastAgent.conversations.refreshContext(selectedConversationId, nextId)
      .then((context) => {
        if (loadId !== conversationLoadRef.current) return
        setContextHealth((current) => ({ ...context, latestCompactionAt: current.latestCompactionAt ?? null, usage: current.usage, usagePending: current.usagePending }))
      })
      // 静默 catch 曾把「主进程通道名对不上」这种彻底失效掩盖了很久：失败必须留痕。
      .catch((error) => console.warn('[context] 换模型后重算上下文失败:', error))
  }

  function handleTestDialogue(id: number) {
    return window.fastAgent.models.testDialogue(id)
  }

  // 下面这批回调全部传给 memo 过的子组件（Sidebar / Composer / SectionView / MessageList）。
  // 用 useEventCallback 定住引用，流式输出每帧的重渲染才不会穿透 memo。
  const handleCloseFind = useEventCallback(() => setFindOpen(false))
  /** 查找跳转会主动离开底部，必须停掉贴底跟随，否则流式输出立刻把视口拽回去。 */
  const handleFindBeforeJump = useEventCallback(() => { followRef.current = false })
  const handleNotice = useEventCallback((next: string) => setNotice(next))
  const handleRunShellCommand = useEventCallback((command: string) => { void shellCommands.run(command, turns.at(-1)?.id ?? null) })
  const handleCancelShellCommand = useEventCallback((id: string) => shellCommands.cancel(id))
  const handleDismissShellCommand = useEventCallback((id: string) => shellCommands.dismiss(id))
  const handleNavigate = useEventCallback(navigate)
  const handleNewChat = useEventCallback(() => startNewChat())
  const handleNewChatInContext = useEventCallback(() => startNewChatInContext())
  const handleNewChatInProject = useEventCallback(async (item: WorkspaceProject) => {
    if (selectedProjectId !== item.id) await selectProject(item)
    startNewChatInContext(item.id)
  })
  const handlePickWorkspace = useEventCallback(() => { void pickWorkspace() })
  const handleSelectConversation = useEventCallback((item: WorkspaceConversation) => { void selectConversation(item) })
  const handleSelectProject = useEventCallback((item: WorkspaceProject) => { void selectProject(item) })
  const handleDeleteConversation = useEventCallback((id: string) => {
    const title = conversationItems.find((item) => item.id === id)?.title ?? (id === selectedConversationId ? conversationTitle : '这个会话')
    setPendingConfirm({ title: '删除这个会话？', lines: [`「${title}」的全部消息与执行记录会被永久删除。`, '工作区里已经改过的文件不会被还原。删除后无法恢复，只想收起可以用「归档」。'], confirmLabel: '删除', onConfirm: () => void deleteConversation(id) })
  })
  const handleArchiveConversation = useEventCallback((id: string) => { void archiveConversation(id) })
  const handleRenameConversation = useEventCallback((id: string, title: string) => { void renameConversation(id, title) })
  const handleExportConversation = useEventCallback((id: string) => { void exportConversation(id) })
  const handleDistillSkill = useEventCallback((id: string) => { void distillSkill(id) })
  const handleDeleteProject = useEventCallback((id: string) => {
    const name = projectItems.find((item) => item.id === id)?.name ?? '这个项目'
    setPendingConfirm({ title: '删除这个项目？', lines: [`将从列表中移除「${name}」并删除它的项目知识库。`, '项目里的会话会保留在「最近对话」里，磁盘上的项目文件不受影响。删除后无法恢复，只想收起可以用「归档」。'], confirmLabel: '删除', onConfirm: () => void deleteProject(id) })
  })
  const handleArchiveProject = useEventCallback((id: string) => { void archiveProject(id) })
  const handleOpenProjectFolder = useEventCallback((path: string) => { void openProjectFolder(path) })
  const handleOpenConversationFolder = useEventCallback((id: string) => { void openConversationFolder(id) })
  // 常规入口一律回到摘要页；只有「已压缩 N 次」那条会显式改成压缩历史。
  const handleOpenInspector = useEventCallback((id: string) => { setInspectorSection('summary'); void openInspector(id) })
  const handleStartBatch = useEventCallback(startBatch)
  const handleBatchConversationPageChange = useEventCallback((page: number) => setBatchConversationPage(page))
  const handleBatchConversationPageSizeChange = useEventCallback((pageSize: number) => setBatchConversationPageSize(pageSize))
  const handleBatchConversationQueryChange = useEventCallback(changeBatchConversationQuery)
  const handleBatchConversationScopeChange = useEventCallback(changeBatchConversationScope)
  const handleToggleBatch = useEventCallback(toggleBatch)
  const handleToggleAllBatch = useEventCallback(toggleAllBatch)
  const handleExitBatch = useEventCallback(exitBatch)
  const handleFinishBatch = useEventCallback((action: 'delete' | 'archive') => {
    if (action === 'archive' || batchSelectedIds.size === 0) { void finishBatch(action); return }
    const what = batchKind === 'projects' ? '项目' : '会话'
    const lines = batchKind === 'projects'
      ? [`将删除选中的 ${batchSelectedIds.size} 个项目及其项目知识库。`, '项目里的会话会保留在「最近对话」里，磁盘上的项目文件不受影响。删除后无法恢复。']
      : [`将永久删除选中的 ${batchSelectedIds.size} 个会话的全部消息与执行记录。`, '删除后无法恢复，只想收起可以用「归档」。']
    setPendingConfirm({ title: `删除选中的${what}？`, lines, confirmLabel: '删除', onConfirm: () => void finishBatch('delete') })
  })
  const handleOpenConversations = useEventCallback(openConversations)
  const handleAccountAction = useEventCallback(() => navigate('settings'))
  const handleReadRun = useEventCallback((id: string) => setRunStates((current) => current[id] ? { ...current, [id]: { ...current[id], hasUnreadResult: false } } : current))
  const handleToggleSection = useEventCallback((key: keyof SidebarSectionState) => setSidebarSections((current) => toggleSidebarSection(current, key)))
  const handleToggleSidebar = useEventCallback(() => setSidebarCollapsed((value) => !value))
  const handleLock = useEventCallback(async () => { await window.fastAgent.auth.lock() })
  const handleModePromptChange = useEventCallback((nextMode: ConversationMode, value: string) => setModePrompts((current) => ({ ...current, [nextMode]: value })))
  const handleResetModePrompts = useEventCallback(() => setModePrompts({ ...defaultModePrompts }))
  const handleSelectModel = useEventCallback(selectModel)
  const handleToggleFavoriteModel = useEventCallback((modelId: number) => setFavoriteModelIds((current) => current.includes(modelId) ? current.filter((id) => id !== modelId) : [...current, modelId]))
  const handleTestDialogueModel = useEventCallback(handleTestDialogue)
  const handleCopyText = useEventCallback((text: string) => { void copyText(text) })
  const handleDeleteTurn = useEventCallback((turnId: string) => { void deleteTurn(turnId) })
  const handleRerunTurn = useEventCallback((turn: ConversationTurn) => { void rerunTurn(turn) })
  const handleEditTurn = useEventCallback((turn: ConversationTurn, text: string, attachments: Attachment[]) => { void rerunTurn(turn, text, attachments) })
  const handleContinueTurn = useEventCallback(() => { void sendPrompt('继续执行', []) })
  const handleSend = useEventCallback((text: string, attachments: Attachment[]) => sendPrompt(text, attachments))
  /** 续跑就是把主进程拼好的说明当作一条普通消息发出去：历史都在 pi 的 session 文件里，不需要另建恢复通道。 */
  const handleResumeRun = useEventCallback((resumeRunId: string) => {
    void window.fastAgent.agentRuns.resumePrompt(resumeRunId).then((prompt) => {
      if (prompt) sendPrompt(prompt, [])
      else setNotice('上一轮的续跑信息已失效')
    }).catch(() => setNotice('续跑失败，请手动重新发起'))
  })
  const handleCompact = useEventCallback(() => { void compactConversationNow(selectedConversationId) })
  const handleCancelCompaction = useEventCallback(() => {
    if (!selectedConversationId) return
    void window.fastAgent.conversations.cancelCompaction(selectedConversationId)
    setCompactionStates((current) => cancelCompaction(current, selectedConversationId))
  })
  const handleClearConversation = useEventCallback(async () => {
    if (!selectedConversationId) { setNotice('/clear：请先选择一个会话'); return }
    setPendingConfirm({
      title: '清空这个会话？',
      lines: [
        '会删除：全部消息与执行记录、上下文与压缩摘要、运行台账与成果登记、这个会话的附件副本与 Agent 会话文件，以及由这个会话抽出的记忆。',
        '工作区里已经改过的文件不会被还原，其它会话不受影响。清空后无法恢复。'
      ],
      confirmLabel: '清空',
      onConfirm: () => void clearConversationAction()
    })
  })
  const handleInitProject = useEventCallback(() => initProjectAction())
  const handleSetMode = useEventCallback((next: ConversationMode) => {
    setMode(next)
    const nextPermission = defaultPermissionForMode(next)
    if (nextPermission) applyDefaultPermission(nextPermission)
  })
  const handleTogglePlanMode = useEventCallback(() => setPlanMode((current) => !current))
  const handleOpenWorkspaceTerminal = useEventCallback(() => {
    if (!workspaceRoot) { setNotice('先打开一个项目再开终端'); return }
    setTerminalOpen(true)
  })
  const handleRevealWorkspace = useEventCallback(() => { if (composerWorkspace) void openProjectFolder(composerWorkspace.path) })
  const handleCopyWorkspacePath = useEventCallback(() => { if (composerWorkspace) void copyText(composerWorkspace.path) })
  // Project Trust：跟随当前项目加载信任状态；切换项目或手动 toggle 后重查。查询失败静默，入口不展示。
  const [workspaceTrust, setWorkspaceTrust] = useState<ProjectTrustState | null>(null)
  useEffect(() => {
    if (!composerWorkspace) { setWorkspaceTrust(null); return }
    let cancelled = false
    void window.fastAgent.projects.trustStatus(composerWorkspace.path)
      .then((status) => { if (!cancelled) setWorkspaceTrust(status) })
      .catch(() => { if (!cancelled) setWorkspaceTrust(null) })
    return () => { cancelled = true }
  }, [composerWorkspace?.path])
  const handleToggleWorkspaceTrust = useEventCallback((trusted: boolean) => {
    if (!composerWorkspace) return
    void window.fastAgent.projects.setTrust(composerWorkspace.path, trusted)
      .then(() => setWorkspaceTrust((current) => current ? { ...current, trusted } : current))
      .then(() => setNotice(trusted ? '已信任该项目，下一轮起 AGENTS/CLAUDE 注入系统提示' : '已撤销信任，下一轮起 AGENTS/CLAUDE 不再注入'))
      .catch(() => setNotice('信任状态更新失败'))
  })
  const handleThinkingLevelChange = useEventCallback((level: import('../../shared/types').ThinkingLevel) => setThinkingLevel(level))
  const handleManageModels = useEventCallback(() => openSettings('models'))
  /** 统一搜索结果的跳转：四类各自落到已有入口，不新造展示页。 */
  const handleOpenSearchResult = useEventCallback((result: SearchResult) => {
    if (result.kind === 'conversation') {
      const item = conversationItemsRef.current.find((conversation) => conversation.id === result.id)
      if (item) handleSelectConversation(item)
      else setNotice('这个会话已不在列表里')
      return
    }
    if (result.kind === 'knowledge') { openSettings('knowledge'); return }
    if (result.kind === 'skill') { navigate('capabilities'); return }
    // 成果只有在它所属的工作区已经打开时才能预览：路径是相对工作区根的。
    if (!result.locator) { setNotice('这条成果没有对应的文件'); return }
    if (result.workspaceId && result.workspaceId !== workspaceRoot) {
      setNotice('该成果属于其他工作区，请先切换到对应项目')
      return
    }
    responseActions.openFile({ path: result.locator, line: null, endLine: null })
  })

  /** 暂停只挡下一次工具调用，提示文案必须与这个边界一致，不能宣称已经停住。 */
  const handlePauseRun = useEventCallback(() => {
    if (!runId) return
    void window.fastAgent.chat.pause(runId).then((ok) => {
      if (!ok) { setNotice('这一轮已经结束，无需暂停'); return }
      setPausedRunId(runId)
      setNotice('已请求暂停：当前这一步跑完后会停在下一次工具调用前')
    }).catch(() => setNotice('暂停失败'))
  })

  const handleResumeRunPause = useEventCallback(() => {
    if (!runId) return
    void window.fastAgent.chat.resume(runId).then(() => {
      setPausedRunId(null)
      setNotice('已继续执行')
    }).catch(() => setNotice('继续执行失败'))
  })

  const handleOpenPermissionSettings = useEventCallback(() => openSettings('permissions'))
  const handleOpenContextSettings = useEventCallback(() => openSettings('context'))
  const handleOpenCompactionHistory = useEventCallback(() => {
    if (!selectedConversationId) return
    setInspectorSection('history')
    void openInspector(selectedConversationId)
  })
  /** 会话详情里的策略覆盖：写库后就地更新，界面不必等下一次打开会话才看到新值。 */
  const handleUpdateContextPolicy = useEventCallback(async (conversationId: string, patch: Partial<Omit<ContextPolicy, 'conversationId'>>) => {
    try {
      const next = await window.fastAgent.conversations.updateContextPolicy(conversationId, patch)
      if (conversationId === selectedConversationId) setConversationPolicy(next)
      if (conversationId === inspectorId) await openInspector(conversationId)
      setNotice(next.inheritGlobal ? '这条会话已改为跟随全局压缩设置' : '已保存这条会话的压缩策略')
    } catch (error) {
      setNotice(cleanIpcError(error, '压缩策略保存失败'))
    }
  })
  const handleStepHistory = useEventCallback((direction: -1 | 1) => stepHistory(direction))
  const handleOpenSettings = useEventCallback(() => openSettings('permissions'))
  const handleToggleTheme = useEventCallback((next: AppTheme) => {
    onThemeChange(next)
    setNotice(next === 'dark' ? '已切换到深色主题' : '已切换到浅色主题')
  })
  const handleEnqueue = useEventCallback((text: string, attachments: Attachment[]) => {
    if (!selectedConversationId) return
    setQueuedPromptsByConversation((current) => ({ ...current, [selectedConversationId]: enqueuePrompt(current[selectedConversationId] ?? [], text, attachments) }))
  })
  /**
   * 插进当前这一轮。先乐观入队再发 IPC：主进程可能在 await 返回前就报回「已送达」，
   * 反过来写会让那条消息在界面上永远挂着「等待送达」。没送达时按同一条路径回滚。
   */
  const handleSteer = useEventCallback(async (text: string, attachments: Attachment[]) => {
    const conversationId = selectedConversationId
    const activeRunId = runId
    if (!conversationId || !activeRunId) return false
    setQueuedPromptsByConversation((current) => ({ ...current, [conversationId]: enqueuePrompt(current[conversationId] ?? [], text, attachments, 'steer') }))
    const delivered = await window.fastAgent.chat.steer({ runId: activeRunId, conversationId, text, attachments })
      .then((result) => result.delivered)
      .catch(() => false)
    if (!delivered) {
      setQueuedPromptsByConversation((current) => ({ ...current, [conversationId]: markSteerDelivered(current[conversationId] ?? [], text) }))
    }
    return delivered
  })
  const handleRemoveQueued = useEventCallback((id: string) => {
    // 按 id 清全部会话的队列：撤销排队有退场动画窗口，期间切换会话也不至于漏删
    setQueuedPromptsByConversation((current) => {
      const next: Record<string, QueuedPrompt[]> = {}
      for (const [key, list] of Object.entries(current)) next[key] = removeQueuedPrompt(list, id)
      return next
    })
  })
  const handleCancelRun = useEventCallback(() => {
    if (!runId) return
    const stoppedRunId = runId
    const conversationId = selectedConversationId
    // 停止会连带清空引擎里还没投递的插队消息，主进程把它们退回来，原样放回输入框。
    void window.fastAgent.chat.cancel(stoppedRunId).then((result) => {
      const pending = result?.pending ?? []
      if (!pending.length || !conversationId) return
      setQueuedPromptsByConversation((current) => ({ ...current, [conversationId]: (current[conversationId] ?? []).filter((item) => item.kind !== 'steer') }))
      setPrefillRequest({ text: pending.join('\n'), nonce: Date.now() })
      setNotice('已停止生成，未发出的插队消息已放回输入框')
    }).catch(() => undefined)
    setNotice('已停止生成')
    if (!conversationId) return
    // 取消只是发出 abort：正在执行的工具、已发出的模型请求都可能还要一会儿才回来，
    // 而界面要等终态事件才摘 runId。卡在某个不响应 abort 的等待上时终态永远不来，
    // 用户看到的就是「按了没反应」。超时后在界面上自行收尾，主进程那边照常走它的清理。
    window.setTimeout(() => {
      if (runIdsRef.current[conversationId] !== stoppedRunId) return
      setRunIdsByConversation((current) => {
        if (current[conversationId] !== stoppedRunId) return current
        const next = { ...current }
        delete next[conversationId]
        return next
      })
      setApprovals((current) => current.filter((item) => item.runId !== stoppedRunId))
      const turnId = runTurnRef.current.get(stoppedRunId)
      if (turnId) {
        setTurns((current) => current.map((turn) => turn.id === turnId && turn.status === 'working'
          ? { ...turn, status: 'cancelled', activity: turn.activity ? { ...turn.activity, status: 'cancelled', finishedAt: new Date().toISOString() } : turn.activity, updatedAt: new Date().toISOString() }
          : turn))
      }
      setNotice('这一轮没有在停止后如期收尾，已在界面上结束；如果它还在做收尾清理，结果会在完成后补上')
    }, CANCEL_TERMINAL_TIMEOUT_MS)
  })
  const handleCloseArtifactFile = useEventCallback(() => setArtifactFile(null))
  const handleCloseArtifactPanel = useEventCallback(() => { setArtifactOpen(false); setArtifactFile(null) })
  const handlePickArtifactSuggestion = useEventCallback((path: string) => setArtifactFile({ path, line: null, endLine: null }))
  const handleGitCheckout = useEventCallback((branch: string) => switchGitBranch(branch))
  const handleGitCreate = useEventCallback((name: string) => createGitBranch(name))
  const handleGitStopAndCheckout = useEventCallback((branch: string) => stopRunThenSwitch(branch))
  const handleOpenGitPanel = useEventCallback(() => setGitPanelOpen(true))
  const handleCloseGitPanel = useEventCallback(() => setGitPanelOpen(false))
  const handleGitPrefill = useEventCallback((text: string) => setPrefillRequest({ text, nonce: Date.now() }))
  const handlePermissionChange = useEventCallback(async (next: import('../../shared/types').PermissionPreset) => {
    const requestId = ++permissionChangeRef.current
    const conversationLoad = conversationLoadRef.current
    const turnId = activeTurnRef.current
    let appliedToRun = false
    if (runId) {
      try {
        appliedToRun = await window.fastAgent.chat.setPermission(runId, next)
      } catch (error) {
        if (requestId === permissionChangeRef.current && conversationLoad === conversationLoadRef.current) setNotice(`权限切换失败：${error instanceof Error ? error.message : String(error)}`)
        return
      }
    }
    if (requestId !== permissionChangeRef.current || conversationLoad !== conversationLoadRef.current) return
    setPermission(next)
    setPermissionPinned(true)
    const detail = `权限已切换为${findProfile(permissionProfiles, next).label}${appliedToRun ? '，本轮立即生效' : '，下次发送生效'}`
    setNotice(detail)
    if (!appliedToRun) return
    const event: AgentEvent = { runId: runId!, type: 'permission_changed', permission: next, detail }
    setTurns((current) => current.map((turn) => turn.id === turnId ? { ...turn, runtimeConfig: { ...turn.runtimeConfig, permission: next }, activity: { ...(turn.activity || { status: 'working', startedAt: turn.createdAt, finishedAt: null, events: [] }), events: [...(turn.activity?.events || []), event] } } : turn))
  })

  return (
    <ResponseActionsContext.Provider value={responseActions}>
    <div className="app-shell">
      <WorkspaceTitlebar section={section} canGoBack={navigation.index > 0} canGoForward={navigation.index < navigation.entries.length - 1}
        workspaceRoot={workspaceRoot} effectiveDark={effectiveDark} onToggleSidebar={handleToggleSidebar}
        onStepHistory={handleStepHistory} onNavigate={handleNavigate} onOpenSettings={handleOpenSettings} onToggleTheme={handleToggleTheme} />
      <div className="shell-body">
        <Sidebar collapsed={sidebarCollapsed} sectionStates={sidebarSections} onToggleSection={handleToggleSection} section={section} projects={projectItems} conversations={scopedConversations} runStates={runStates} compactionStates={compactionStates} onReadRun={handleReadRun} selectedProjectId={selectedProjectId} selectedConversationId={selectedConversationId} onInspectConversation={handleOpenInspector} onStartBatch={handleStartBatch} onDeleteProject={handleDeleteProject} onArchiveProject={handleArchiveProject} onOpenProjectFolder={handleOpenProjectFolder} onOpenConversationFolder={handleOpenConversationFolder} onDeleteConversation={handleDeleteConversation} onArchiveConversation={handleArchiveConversation} onRenameConversation={handleRenameConversation} onExportConversation={handleExportConversation} onDistillSkill={handleDistillSkill} onNavigate={handleNavigate} onOpenConversations={handleOpenConversations} onNewChat={handleNewChat} onNewChatInSection={handleNewChatInContext} onNewChatInProject={handleNewChatInProject} onToggle={handleToggleSidebar} onPickWorkspace={handlePickWorkspace} onSelectConversation={handleSelectConversation} onSelectProject={handleSelectProject} onAccountAction={handleAccountAction} auth={auth} abilityAlerts={abilityAlerts} />
        <main className={`conversation ${artifactOpen ? 'with-artifact' : ''}`}>
          {section === 'chats' && batchKind !== 'conversations' ? <>
            <div className={`conversation-header${headerStuck ? ' stuck' : ''}`}>
              <div><span className="status-dot" /> <span>{conversationTitle}</span></div>
              <div className="header-actions">{selectedConversationId && <ItemActions onDelete={() => handleDeleteConversation(selectedConversationId)} onArchive={() => archiveConversation(selectedConversationId)} onBatch={() => startBatch('conversations')} onInspect={() => void openInspector(selectedConversationId)} onExport={() => void exportConversation(selectedConversationId)} />}<button className={`icon-button${terminalOpen ? ' active' : ''}`} disabled={!workspaceRoot} aria-pressed={terminalOpen} aria-label="终端" title={workspaceRoot ? `在 ${workspaceRoot} 打开终端面板` : '先打开一个项目'} onClick={handleToggleTerminal}><TerminalSquare size={16} /></button><button className={`icon-button${minimap.enabled ? ' active' : ''}`} aria-pressed={minimap.enabled} aria-label="对话缩略图" title="对话缩略图：点击缩略条直接跳到对应位置" onClick={minimap.toggle}><MapIcon size={16} /></button><button className="icon-button" aria-label="打开资源面板" title="打开资源面板" onClick={() => { closeInspector(); setArtifactOpen((value) => !value) }}><PanelRight size={16} /></button></div>
            </div>
            {/* 页内查找条：挂在对话头下沿，搜索范围就是上面的滚动容器 */}
            <FindBar open={findOpen} request={findRequest} containerRef={scrollRef} contentVersion={turns} scopeKey={selectedConversationId} onClose={handleCloseFind} onBeforeJump={handleFindBeforeJump} />
            {/* 包一层定位容器：缩略图要贴着滚动视口的上下缘，而输入区高度是用户可拖的，写死偏移会错位 */}
            <div className="conversation-body">
            <div className={`conversation-scroll ${conversationEntering ? 'conversation-entering' : ''}`} ref={scrollRef} onScroll={onConversationScroll}>
              {turns.length === 0 && shellCommands.entries.length === 0 ? <EmptyConversation onPickWorkspace={handlePickWorkspace} onAddAttachment={() => setAttachmentRequest((value) => value + 1)} onRunAgent={agentAvailable ? () => { setMode('agent'); applyDefaultPermission('ask'); setNotice('已切换到智能体模式') } : undefined} /> : <MessageList turns={turns} models={allModels} onCopy={handleCopyText} onDelete={handleDeleteTurn} onRetry={handleRerunTurn} onRegenerate={handleRerunTurn} onEdit={handleEditTurn} onContinue={handleContinueTurn} onShowContextMenu={showMessageContextMenu} todosByTurn={todosByTurn} memoryTurnIds={memoryTurnIds} contextSourceTurnIds={contextSourceTurnIds} shellEntries={shellCommands.entries} onCancelShellCommand={handleCancelShellCommand} onDismissShellCommand={handleDismissShellCommand} compactionHistory={compactionHistory} contextWindow={contextHealth.contextWindow} onNotice={setNotice} />}
            </div>
            {minimap.enabled && <ConversationMinimap segments={minimap.segments} metrics={minimap.metrics} onSeek={minimap.seek} />}
            </div>
            <div className="scroll-nav-anchor">{scrollNav !== 'none' && <button className="scroll-nav" onClick={() => jumpConversation(scrollNav === 'top' ? 'top' : 'bottom')} aria-label={scrollNavLabel[scrollNav]} title={scrollNavLabel[scrollNav]}>
              {scrollNav === 'top' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
            </button>}</div>
            <ResumeBar conversationId={selectedConversationId} running={Boolean(runId)} onResume={handleResumeRun} />
            {pressure && <ContextPressureBar pressure={pressure} onCompact={handleCompact} onOpenSettings={handleOpenContextSettings} />}
            <Composer workspace={composerWorkspace} onRunShellCommand={handleRunShellCommand} onSteer={handleSteer} onOpenGitPanel={handleOpenGitPanel} onRevealWorkspace={handleRevealWorkspace} onCopyWorkspacePath={handleCopyWorkspacePath} onChangeWorkspace={handlePickWorkspace} onOpenWorkspaceTerminal={handleOpenWorkspaceTerminal} workspaceTrust={workspaceTrust} onToggleWorkspaceTrust={handleToggleWorkspaceTrust} shortcuts={settings?.shortcuts} height={composerHeight} heightPinned={composerHeightPinned} onHeightChange={changeComposerHeight} contextHealth={contextHealth} contextPolicy={effectiveContextPolicy} compaction={selectedConversationCompaction} onCompact={handleCompact} onCancelCompaction={handleCancelCompaction} onOpenCompactionHistory={handleOpenCompactionHistory} onNewChat={handleNewChatInContext} onSelectConversation={handleSelectConversation} onClearConversation={handleClearConversation} onInitProject={handleInitProject} currentProjectId={selectedProjectId} onManageModels={handleManageModels} onNotice={handleNotice} mode={mode} planMode={planMode} onTogglePlanMode={handleTogglePlanMode} agentAvailable={agentAvailable} setMode={handleSetMode} model={selectedModel} selectedModelId={selectedModelId} models={allModels} favoriteModelIds={favoriteModelIds} recentModelIds={recentModelIds} onSelectModel={handleSelectModel} thinkingLevel={thinkingLevel} onThinkingLevelChange={handleThinkingLevelChange} onToggleFavorite={handleToggleFavoriteModel} attachmentRequest={attachmentRequest} runId={runId} queue={queuedPrompts} onEnqueue={handleEnqueue} onRemoveQueued={handleRemoveQueued} quoteRequest={quoteRequest} prefillRequest={prefillRequest} paused={Boolean(runId) && pausedRunId === runId} onPause={handlePauseRun} onResume={handleResumeRunPause} onSend={handleSend} gitState={gitState} gitAnyRunActive={anyRunActive} onGitCheckout={handleGitCheckout} onGitCreate={handleGitCreate} onGitStopAndCheckout={handleGitStopAndCheckout} permission={permission} permissionProfiles={permissionProfiles} onPermissionChange={handlePermissionChange} onOpenPermissionSettings={handleOpenPermissionSettings} onCancel={handleCancelRun} />
          </> : <SectionView key={section} onInsertComposer={handleInsertMcpPrompt} section={section} auth={auth} bootstrap={bootstrap} projects={projectItems} conversations={batchKind === 'conversations' ? batchConversationItems : scopedConversations} allConversations={conversationItems} conversationPage={batchConversationPage} conversationPageSize={batchConversationPageSize} conversationTotal={batchConversationTotal} onConversationPageChange={handleBatchConversationPageChange} onConversationPageSizeChange={handleBatchConversationPageSizeChange} batchConversationQuery={batchConversationQuery} batchConversationScope={batchConversationScope} onBatchConversationQueryChange={handleBatchConversationQueryChange} onBatchConversationScopeChange={handleBatchConversationScopeChange} selectedProjectId={selectedProjectId} selectedConversationId={selectedConversationId} batchKind={batchKind} batchSelectedIds={batchSelectedIds} onToggleBatch={handleToggleBatch} onToggleAllBatch={handleToggleAllBatch} onStartBatch={handleStartBatch} onDeleteProject={handleDeleteProject} onArchiveProject={handleArchiveProject} onOpenProjectFolder={handleOpenProjectFolder} onDeleteConversation={handleDeleteConversation} onArchiveConversation={handleArchiveConversation} onExportConversation={handleExportConversation} onDistillSkill={handleDistillSkill} onExitBatch={handleExitBatch} onFinishBatch={handleFinishBatch} onNavigate={handleNavigate} onPickWorkspace={handlePickWorkspace} onNewChat={handleNewChat} onSelectProject={handleSelectProject} onSelectConversation={handleSelectConversation} onNotice={handleNotice} onLock={handleLock} modePrompts={modePrompts} onModePromptChange={handleModePromptChange} onResetModePrompts={handleResetModePrompts} settings={settings} theme={theme} onSettingsChange={onSettingsChange} onThemeChange={onThemeChange} onOpenInspector={handleOpenInspector} onOpenSearchResult={handleOpenSearchResult} settingsCategory={settingsCategory} settingsRequest={settingsRequest} abilityRequest={abilityRequest} selectedModelId={selectedModelId} defaultModelId={bootstrap?.default_model_id ?? null} favoriteModelIds={favoriteModelIds} localModels={localModels} onSelectModel={handleSelectModel} onTestDialogue={handleTestDialogueModel} onToggleFavoriteModel={handleToggleFavoriteModel} />}
        </main>
        {terminalOpen && <TerminalPanel dark={darkTheme} onClose={handleCloseTerminal} onNotice={handleNotice} />}
        {artifactOpen && !inspector && <ResourcePanel workspaceRoot={workspaceRoot} conversationId={selectedConversationId} file={artifactFile} onPickWorkspace={handlePickWorkspace} onOpenFile={setArtifactFile} onCloseFile={handleCloseArtifactFile} onClose={handleCloseArtifactPanel} onNotice={handleNotice} onPickSuggestion={handlePickArtifactSuggestion} onContinueEdit={handleContinueEditArtifact} />}
        {inspector && <ConversationInspector data={inspector} initialSection={inspectorSection} onUpdatePolicy={(conversationId, patch) => void handleUpdateContextPolicy(conversationId, patch)} compaction={inspectorId ? compactionStates[inspectorId] ?? null : null} onCancelCompaction={() => { if (inspectorId) { void window.fastAgent.conversations.cancelCompaction(inspectorId); setCompactionStates((current) => cancelCompaction(current, inspectorId)) } }} onClose={closeInspector} onRefresh={() => { if (inspectorId) void openInspector(inspectorId) }} onCompact={() => void compactConversationNow(inspectorId)} />}
        {Object.entries(compactionStates).filter(([, state]) => state.status === 'failed' || state.status === 'timed_out').map(([conversationId, state]) => <CompactionFallbackDialog key={`${conversationId}:${state.taskId}`} state={state} models={allModels} onRetry={(modelId) => void compactConversationNow(conversationId, modelId)} onCancel={() => { void window.fastAgent.conversations.cancelCompaction(conversationId); setCompactionStates((current) => cancelCompaction(current, conversationId)) }} onClose={() => setCompactionStates((current) => clearCompaction(current, conversationId))} />)}
      </div>
      <GitPanel open={gitPanelOpen && Boolean(gitState)} onClose={handleCloseGitPanel} state={gitState} anyRunActive={anyRunActive}
        modelId={selectedModelId} onNotice={handleNotice} onCheckout={handleGitCheckout} onStopAndCheckout={handleGitStopAndCheckout}
        onPrefillComposer={handleGitPrefill} onRefreshState={refreshGitState} />
      <LightboxLayer />
      {contextMenu && <MessageContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />}
      {notice && <div className={`toast${noticeClosing ? ' closing' : ''}`} role="status" aria-live="polite">
        <span className="toast-message">{notice}</span>
        {noticeAction && <button className="toast-action" onClick={noticeAction.run}>{noticeAction.label}</button>}
      </div>}
      {pendingConfirm && <ConfirmDialog title={pendingConfirm.title} lines={pendingConfirm.lines} confirmLabel={pendingConfirm.confirmLabel} danger onConfirm={() => { const action = pendingConfirm.onConfirm; setPendingConfirm(null); action() }} onCancel={() => setPendingConfirm(null)} />}
      {approvals.filter((item) => item.conversationId === selectedConversationId).map((item) => <ApprovalDialog key={item.request.id} request={item.request} onRespond={(decision, answer) => void respondApproval(item.request.id, decision, answer)} />)}
      {skillDraft && <SkillDistillDialog draft={skillDraft} onClose={() => setSkillDraft(null)} onSaved={(name) => { setSkillDraft(null); setNotice(`技能 ${name} 已保存，默认停用`) }} />}
      {clearConfirmOpen && <ConfirmDialog
        title="清空这个会话？"
        lines={[
          '会删除：全部消息与执行记录、上下文与压缩摘要、运行台账与成果登记、这个会话的附件副本与 Agent 会话文件，以及由这个会话抽出的记忆。',
          '工作区里已经改过的文件不会被还原，其它会话不受影响。',
          '清空后无法恢复。'
        ]}
        confirmLabel="清空"
        danger
        onConfirm={() => { setClearConfirmOpen(false); void clearConversationAction() }}
        onCancel={() => setClearConfirmOpen(false)}
      />}
    </div>
    </ResponseActionsContext.Provider>
  )
}
