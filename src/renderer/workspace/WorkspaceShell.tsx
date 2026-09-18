import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, CircleDot, Command, Menu, MoreHorizontal, PanelRight } from 'lucide-react'
import type { AgentEvent, AppSettings, AppTheme, ApprovalDecision, Attachment, AuthSnapshot, BootstrapData, ConversationMode, ConversationRunState, ConversationTurn, GitOperationResult, LocalModelInput, LocalModelSummary, TodoItem, ToolCallRecord } from '../../shared/types'
import { createStreamBuffer } from '../ai-response/stream-buffer'
import { formatFileReference, type FileReference } from '../ai-response/file-reference'
import { ResponseActionsContext, type ResponseActions } from '../ai-response/response-context'
import { AgentRunBar } from '../composer/AgentRunBar'
import { ResumeBar } from '../composer/ResumeBar'
import { Composer } from '../composer/Composer'
import { MIN_COMPOSER_HEIGHT } from '../composer/composer-height'
import { ApprovalDialog } from '../conversation/ApprovalDialog'
import { beginCompaction, cancelCompaction, clearCompaction, completeCompaction, failCompaction, type CompactionStates } from '../conversation/compaction-state'
import { CompactionFallbackDialog } from '../conversation/CompactionFallbackDialog'
import { conversationMetaNow, mergeStreamedText, normalizeRenameInput, readModelIds, titleFromPrompt, toWorkspaceConversation } from '../conversation/conversation-meta'
import { ConversationInspector, type ConversationInspectorData } from '../conversation/ConversationInspector'
import type { ContextHealthData } from '../conversation/ContextHealth'
import { EmptyConversation, MessageList } from '../conversation/MessageList'
import { MessageContextMenu, selectionText, type ContextMenuItem } from '../conversation/message-context-menu'
import { nextFollowState, scrollNavAction, type ScrollNavAction } from '../conversation/auto-scroll'
import { dropNextQueuedPrompt, enqueuePrompt, removeQueuedPrompt, takeNextQueuedPrompt, type QueuedPrompt } from '../conversation/prompt-queue'
import { isRunConflictError } from '../../shared/active-runs'
import { cleanIpcError } from '../ipc-error'
import { conversationModelId, initialSelectedModelId, mergeModelOptions, normalizeThinkingLevel } from '../model-picker'
import { subscribeLocalModels } from '../local-model-sync'
import { defaultModePrompts, modePromptFor, normalizeSavedModePrompt, withPlanModePrompt, type ModePrompts } from '../mode-prompts'
import { defaultPermissionForMode } from '../permissions'
import { findProfile, mergeProfiles, type PermissionProfile } from '../../shared/permission-profiles'
import { ResourcePanel } from '../resource-panel/ResourcePanel'
import type { SettingsCategory } from '../settings/SettingsPage'
import { toggleSidebarSection, type SidebarSectionState } from '../sidebar-sections'
import { buildContinuationPrompt, isContinuationInput, isNewConversationShortcut, pushNavigation, stepNavigation } from '../workspace-actions'
import { archiveWorkspaceItem, removeWorkspaceItem, renameWorkspaceItem, toggleBatchPageSelection, toggleBatchSelection, upsertRecentWorkspaceItem, type ConversationScope } from '../workspace-data'
import { whenFirstScreenReady } from '../startup-ready'
import { usePagination } from '../use-pagination'
import { useEventCallback } from '../use-event-callback'
import { MOTION_DURATIONS } from '../motion'
import { abilitiesNeedingAttention } from '../features/abilities/ability-view'
import { useAbilities } from '../features/abilities/hooks/useAbilities'
import { SectionView } from './SectionView'
import { Sidebar, ItemActions } from './Sidebar'
import { useAgentEvents } from './use-agent-events'
import { useAppShortcuts } from './use-app-shortcuts'
import { useGitWorkspace } from './use-git-workspace'
import type { PendingApproval, WorkspaceConversation, WorkspaceProject, WorkspaceSection } from './workspace-types'

const scrollNavLabel: Record<Exclude<ScrollNavAction, 'none'>, string> = {
  top: '回到顶部',
  bottom: '回到底部',
  latest: '回到最新消息'
}

/** 侧栏「最近对话」只取这么多条；再往前翻走会话中心。 */
const RECENT_CONVERSATION_LIMIT = 20

/** 模型未配置上下文窗口时运行时使用的默认值，与主进程 pi-runtime 保持一致。 */
const DEFAULT_CONTEXT_WINDOW = 128000

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
  const [mode, setMode] = useState<ConversationMode>('chat')
  // 计划模式：开启后本回合只产出实施计划；Shift+Tab 随时切换。
  const [planMode, setPlanMode] = useState(false)
  // Shift+Tab 切换计划模式：全局监听让焦点在输入框外也能切，同时阻止默认的焦点反向移动。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
      event.preventDefault()
      setPlanMode((current) => !current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('general')
  const [settingsRequest, setSettingsRequest] = useState(0)
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
  // 重载前停留的会话，等首屏几路数据落定后由下方效应恢复一次。
  const [restoreConversationId] = useState<string | null>(() => readLastConversationId())
  const restoredRef = useRef(false)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [batchKind, setBatchKind] = useState<'conversations' | 'projects' | null>(null)
  const [batchSelectedIds, setBatchSelectedIds] = useState<Set<string>>(new Set())
  const [conversationTitle, setConversationTitle] = useState('新对话')
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const { gitState, refreshGitState } = useGitWorkspace(workspaceRoot)
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null)
  const [bootstrapLoaded, setBootstrapLoaded] = useState(false)
  const [localModels, setLocalModels] = useState<LocalModelSummary[]>([])
  const [localModelsLoaded, setLocalModelsLoaded] = useState(false)
  // 云端 + 本地合并成一份模型列表，选择器 / 会话记录 / 设置页共用
  const allModels = useMemo(() => mergeModelOptions(bootstrap?.models ?? [], localModels), [bootstrap, localModels])
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  // 账户级默认模型：新会话用它开场，只有手动切换模型才会更新，打开历史会话不影响。
  const [defaultModelId, setDefaultModelId] = useState<number | null>(null)
  const [thinkingLevel, setThinkingLevel] = useState<import('../../shared/types').ThinkingLevel>('auto')
  const [modePrompts, setModePrompts] = useState<ModePrompts>({ ...defaultModePrompts })
  const [favoriteModelIds, setFavoriteModelIds] = useState<number[]>([])
  const [recentModelIds, setRecentModelIds] = useState<number[]>([])
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)
  const [turns, setTurns] = useState<ConversationTurn[]>([])
  const [undoTurn, setUndoTurn] = useState<ConversationTurn | null>(null)
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null)
  const [runIdsByConversation, setRunIdsByConversation] = useState<Record<string, string>>({})
  const [runStates, setRunStates] = useState<Record<string, ConversationRunState>>({})
  const conversationItemsRef = useRef<WorkspaceConversation[]>([])
  const runId = selectedConversationId ? runIdsByConversation[selectedConversationId] ?? null : null
  // Run Bar 跟着最后一轮走：跑完仍留在那一轮的结果上，发下一条消息才切过去
  const latestTurnId = turns.length ? turns[turns.length - 1].id : null
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
  const [notice, setNotice] = useState('')
  /** 提示条上的附加动作；启动告警用它挂「查看日志」，撤销仍走 undoTurn 自己的分支。 */
  const [noticeAction, setNoticeAction] = useState<{ label: string; run: () => void } | null>(null)
  const [artifactFile, setArtifactFile] = useState<FileReference | null>(null)
  const [scrollNav, setScrollNav] = useState<ScrollNavAction>('none')
  const scrollRef = useRef<HTMLDivElement>(null)
  // 是否跟随底部；用 ref 保存，滚动回调里不需要重新绑定。
  const followRef = useRef(true)
  // 审批按发起它的 run / 会话归属存放：后台会话的审批不能弹到当前会话，也不能被别的 run 结束时清掉。
  const [approvals, setApprovals] = useState<PendingApproval[]>([])
  const [todosByTurn, setTodosByTurn] = useState<Record<string, TodoItem[]>>({})
  const [inspector, setInspector] = useState<ConversationInspectorData | null>(null)
  const [inspectorId, setInspectorId] = useState<string | null>(null)
  // 队列按会话隔离，切换页面只改变展示目标，不丢弃后台任务。
  const [queuedPromptsByConversation, setQueuedPromptsByConversation] = useState<Record<string, QueuedPrompt[]>>({})
  const queuedPrompts = selectedConversationId ? queuedPromptsByConversation[selectedConversationId] ?? [] : []
  // 消息右键菜单状态；quoteRequest 把「引用到输入框」转交给 Composer。
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)
  const [conversationEntering, setConversationEntering] = useState(false)
  const [quoteRequest, setQuoteRequest] = useState<{ text: string; nonce: number } | null>(null)
  const [contextHealth, setContextHealth] = useState<ContextHealthData>(EMPTY_CONTEXT_HEALTH)
  const [compactionStates, setCompactionStates] = useState<CompactionStates>({})
  const conversationLoadRef = useRef(0)
  const permissionChangeRef = useRef(0)
  const runTurnRef = useRef(new Map<string, string>())
  const activeTurnRef = useRef<string | null>(null)
  // turnId → 已收到的助手文本。turns state 只装当前打开的会话，切走就没了；
  // 这份缓存跨会话存活，切回来时由 mergeStreamedText 贴回历史。
  const streamedTextRef = useRef(new Map<string, string>())
  // 事件回调里查 turn → conversationId 用，避免订阅随 turns 变化反复重建。
  const turnsStateRef = useRef<ConversationTurn[]>([])
  const eventSequenceRef = useRef(new Map<string, number>())
  useEffect(() => { turnsStateRef.current = turns }, [turns])
  useEffect(() => { conversationItemsRef.current = conversationItems }, [conversationItems])

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
    const projectsReady = window.fastAgent.projects.listPage({ pageSize: 20 }).then((page) => setProjectItems(page.items)).catch(() => setNotice('项目列表加载失败'))
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
      setThinkingLevel(normalizeThinkingLevel(bootstrap?.default_thinking_level || selected?.thinking_default, selected))
    }
  }, [allModels, bootstrap, bootstrapLoaded, localModelsLoaded, preferencesLoaded, selectedModelId])

  useEffect(() => {
    if (!bootstrapLoaded || !localModelsLoaded) return
    const model = allModels.find((item) => item.id === selectedModelId)
    setThinkingLevel((current) => normalizeThinkingLevel(current, model))
  }, [allModels, bootstrapLoaded, localModelsLoaded, selectedModelId])

  useEffect(() => {
    // 模型目录未完整加载时禁止保存临时 null，避免覆盖数据库中的已保存模型。
    // selectedModelId 不在这里保存：打开历史会话会把它改成该会话绑定的模型，
    // 顺手写进账户偏好就等于「看一眼旧会话，新会话的默认模型也跟着变了」。只有手动切换才更新默认值。
    if (!preferencesLoaded || !bootstrapLoaded || !localModelsLoaded) return
    void window.fastAgent.preferences.update({ favoriteModelIds, recentModelIds, modePrompts, sidebarSections })
  }, [favoriteModelIds, modePrompts, preferencesLoaded, recentModelIds, sidebarSections])

  useEffect(() => {
    if (!notice) return
    // 带动作的提示要留够点击时间，2.4 秒不足以让人看完再点。
    const timer = window.setTimeout(() => { setNotice(''); setNoticeAction(null) }, undoTurn || noticeAction ? 5000 : 2400)
    return () => window.clearTimeout(timer)
  }, [notice, noticeAction, undoTurn])

  useEffect(() => {
    if (!undoTurn) return
    const timer = window.setTimeout(() => setUndoTurn(null), 5000)
    return () => window.clearTimeout(timer)
  }, [undoTurn])

  // 流式 token 不逐个进 state：按 turn 累积，定时冲刷成一次渲染。
  const streamBuffer = useMemo(() => createStreamBuffer((chunks) => {
    // 用 Map 索引：turns 与 chunks 都可能不止一条，逐个 find 会退化成 O(turns × chunks)。
    const byTurn = new Map(chunks.map((chunk) => [chunk.turnId, chunk.text]))
    for (const [turnId, text] of byTurn) {
      streamedTextRef.current.set(turnId, `${streamedTextRef.current.get(turnId) ?? ''}${text}`)
    }
    setTurns((current) => {
      // 冲刷目标不在当前会话时直接保留原数组，省掉一次无意义的整表重建与重渲染。
      if (!current.some((turn) => byTurn.has(turn.id))) return current
      return current.map((turn) => {
        const text = byTurn.get(turn.id)
        if (text === undefined) return turn
        const createdAt = turn.assistantMessage?.createdAt || new Date().toISOString()
        return { ...turn, assistantMessage: { text: `${turn.assistantMessage?.text || ''}${text}`, createdAt }, updatedAt: new Date().toISOString() }
      })
    })
  }), [])
  useEffect(() => () => streamBuffer.dispose(), [streamBuffer])

  // 思考正文单独一条缓冲：它只在折叠层里显示，没必要跟正文一样每帧冲刷，
  // 200ms 一次已经够「展开着也能看到在长」，又不会把整棵树按思考 token 重绘。
  const thinkingBuffer = useMemo(() => createStreamBuffer((chunks) => {
    const byTurn = new Map(chunks.map((chunk) => [chunk.turnId, chunk.text]))
    setTurns((current) => {
      if (!current.some((turn) => byTurn.has(turn.id) && turn.activity)) return current
      return current.map((turn) => {
        const text = byTurn.get(turn.id)
        if (text === undefined || !turn.activity) return turn
        // 分段与全文同步推进：段由 thinking_started 开出来，没开过就补一段，免得实时文本无处可放。
        const segments = turn.activity.thinkingSegments?.length ? [...turn.activity.thinkingSegments] : ['']
        segments[segments.length - 1] += text
        return { ...turn, activity: { ...turn.activity, thinking: `${turn.activity.thinking || ''}${text}`, thinkingSegments: segments } }
      })
    })
  }, 200), [])
  useEffect(() => () => thinkingBuffer.dispose(), [thinkingBuffer])

  useAgentEvents({
    selectedConversationId, streamBuffer, thinkingBuffer, refreshGitState,
    conversationItemsRef, runTurnRef, activeTurnRef, streamedTextRef, eventSequenceRef,
    setRunStates, setCompactionStates, setContextHealth, setApprovals, setTodosByTurn, setTurns, setRunIdsByConversation, setNotice
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
    setSection('chats'); setNavigation((current) => pushNavigation(current.entries, current.index, 'chats')); setSelectedConversationId(null); setConversationTitle('新对话'); setTurns([]); setUndoTurn(null); setActiveTurnId(null); setMode('chat'); applyDefaultPermission('ask'); resetModelToDefault()
    writeLastConversationId(null)
    focusComposerSoon()
  }

  /** /new 的语境版本：项目里新建当前项目下的空会话（保持项目绑定），快速对话等同普通新对话。 */
  function startNewChatInContext() {
    if (!selectedProjectId) {
      startNewChat()
      return
    }
    streamBuffer.flush()
    followRef.current = true
    conversationLoadRef.current += 1
    // 只重置主区视图，保留 selectedProjectId 与工作区根；发送第一条消息时
    // 会以当前项目落库（sendPrompt 的 conversations.create projectId）。
    setArtifactFile(null)
    setSection('chats'); setNavigation((current) => pushNavigation(current.entries, current.index, 'chats')); setSelectedConversationId(null); setConversationTitle('新对话'); setTurns([]); setUndoTurn(null); setActiveTurnId(null); setContextHealth(emptyContextHealth()); setMode('agent'); applyDefaultPermission('workspace'); resetModelToDefault()
    writeLastConversationId(null)
    setNotice('已新建当前项目的对话')
    focusComposerSoon()
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
          const modelId = conversationModelId(allModels, item.modelId, selectedModelId)
          setThinkingLevel(normalizeThinkingLevel(latest.runtimeConfig.thinkingLevel, allModels.find((model) => model.id === modelId)))
        }
      }
      void window.fastAgent.conversations.listTodos(item.id).then((todos) => {
        // 历史会话只有末尾一份 todo 快照，归属到最近一个回合，跟随该回合的完成态展示。
        const latestTurnId = history.at(-1)?.id
        if (loadId === conversationLoadRef.current && todos.length && latestTurnId) setTodosByTurn((current) => ({ ...current, [latestTurnId]: todos }))
      }).catch(() => undefined)
      const detail = await window.fastAgent.conversations.getInspector(item.id)
      if (detail && loadId === conversationLoadRef.current) {
        const usage = await window.fastAgent.conversations.modelUsage(item.id).catch(() => undefined)
        setContextHealth((current) => detail.context
          ? { ...detail.context, latestCompactionAt: detail.compactionHistory[0]?.createdAt || null, usage: usage ?? current.usage, usagePending: false }
          : { ...current, usage: usage ?? current.usage, usagePending: false })
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
    // 压缩记录存的是回合 ID，转成 1 基序号才能显示「覆盖回合范围」。
    const turnIndex = new Map(history.map((turn, index) => [turn.id, index + 1]))
    const agentEvents = history.flatMap((turn) => turn.activity?.events || [])
    const latestTurn = history.at(-1)
    const latestToolCalls = latestTurn ? await window.fastAgent.conversations.listToolCalls(latestTurn.id).catch(() => [] as ToolCallRecord[]) : []
    const mapped: ConversationInspectorData = {
      conversation: { id: detail.id, title: detail.title, createdAt: detail.createdAt, updatedAt: detail.updatedAt },
      runtime: { mode: detail.runtime.mode || 'chat', model: model?.name || (detail.runtime.modelId ? String(detail.runtime.modelId) : '未选择'), provider: detail.runtime.provider || model?.provider, reasoning: detail.runtime.thinkingLevel || undefined, permission: detail.runtime.permission ? findProfile(permissionProfiles, detail.runtime.permission).label : undefined, status: detail.runtime.status || 'idle', agentSessionId: detail.runtime.sessionId },
      context: detail.context ? { ...detail.context, latestCompactionAt: detail.compactionHistory[0]?.createdAt || null } : contextHealth,
      summary: detail.summary ? { text: detail.summary.summaryText, version: detail.summary.version, createdAt: detail.summary.createdAt } : null,
      history: detail.compactionHistory.map((item) => ({ id: item.id, beforeTokens: item.beforeTokens, afterTokens: item.afterTokens, triggerReason: item.triggerReason, coveredTurnStart: turnIndex.get(item.coveredTurnStart || '') ?? null, coveredTurnEnd: turnIndex.get(item.coveredTurnEnd || '') ?? null, strategy: item.strategy, createdAt: item.createdAt })),
      agent: {
        toolCalls: agentEvents.filter((event) => event.type === 'tool_started').length,
        latestStep: agentEvents.at(-1)?.detail || agentEvents.at(-1)?.tool || null,
        failureReason: agentEvents.filter((event) => event.type === 'failed').at(-1)?.detail || null,
        startedAt: latestTurn?.activity?.startedAt ?? null,
        finishedAt: latestTurn?.activity?.finishedAt ?? null,
        toolCallsDetailed: latestToolCalls
      },
      policy: detail.contextPolicy ? { strategy: detail.contextPolicy.strategy, triggerRatio: detail.contextPolicy.triggerRatio, keepRecentTurns: detail.contextPolicy.keepRecentTurns, autoSummary: detail.contextPolicy.autoSummary, inheritGlobal: detail.contextPolicy.inheritGlobal } : undefined
    }
    setInspector(mapped)
  }

  async function compactConversationNow(conversationId: string | null, compressionModelId = selectedModelId) {
    if (!conversationId) { setNotice('请先选择一个会话'); return }
    const currentCompaction = compactionStates[conversationId]
    if (currentCompaction?.status === 'running') return
    setCompactionStates((current) => beginCompaction(current, conversationId, compressionModelId))
    try {
      const result = await window.fastAgent.conversations.compactNow(conversationId, compressionModelId)
      if (!result) { setCompactionStates((current) => clearCompaction(current, conversationId)); setNotice('可压缩的历史回合不足'); return }
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

  /** /clear：清空当前会话，主进程已落库，本地同步重置视图状态。 */
  async function clearConversationAction() {
    if (!selectedConversationId) { setNotice('/clear：请先选择一个会话'); return }
    try {
      await window.fastAgent.conversations.clear(selectedConversationId)
      conversationLoadRef.current += 1
      setTurns([])
      setUndoTurn(null)
      setActiveTurnId(null)
      setContextHealth(emptyContextHealth())
      setConversationTitle('新对话')
      setNotice('已清空当前会话的全部消息与上下文')
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

  async function selectProject(item: WorkspaceProject) {
    setBatchKind(null)
    setSelectedProjectId(item.id)
    // 工作区根目录是主进程状态，运行时靠它定位文件，只改渲染层 state 不生效。
    try { await window.fastAgent.workspace.setRoot(item.path) } catch { setNotice('切换工作区失败'); return }
    setWorkspaceRoot(item.path)
    // 上一个项目里打开的文件在新项目多半不存在，留着只会让产物面板报错。
    setArtifactFile(null)
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
    setUndoTurn(null)
    setActiveTurnId(null)
    setContextHealth(emptyContextHealth())
    setNotice(`已切换项目：${item.name}`)
  }

  async function deleteConversation(id: string) {
    try { await window.fastAgent.conversations.remove(id) } catch { setNotice('删除会话失败'); return }
    setConversationItems((current) => removeWorkspaceItem(current, id))
    setRecentConversationRefresh((current) => current + 1)
    setBatchConversationRefresh((current) => current + 1)
    if (selectedConversationId === id) {
      startNewChat()
    }
    setNotice('对话已删除')
  }

  async function deleteTurn(turnId: string) {
    try {
      const removed = await window.fastAgent.conversations.deleteTurn(turnId)
      if (!removed) return
      setTurns((current) => current.filter((turn) => turn.id !== turnId))
      setUndoTurn(removed)
      setNotice('已删除本轮问答 · 可撤销')
    } catch { setNotice('删除本轮问答失败') }
  }

  async function restoreTurn() {
    if (!undoTurn) return
    try {
      const restored = await window.fastAgent.conversations.restoreTurn(undoTurn)
      setTurns((current) => [...current, restored].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
      setUndoTurn(null)
      setNotice('已撤销删除')
    } catch { setNotice('撤销失败') }
  }

  async function copyText(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice('已复制') } catch { setNotice('复制失败') }
  }

  async function rerunTurn(turn: ConversationTurn, prompt = turn.userMessage.text, attachments = turn.attachments) {
    if (runId) return
    const reset: ConversationTurn = { ...turn, userMessage: { ...turn.userMessage, text: prompt }, attachments, assistantMessage: null, activity: { status: 'working', startedAt: new Date().toISOString(), finishedAt: null, events: [] }, status: 'working', updatedAt: new Date().toISOString() }
    setTurns((current) => current.map((item) => item.id === turn.id ? reset : item))
    setActiveTurnId(turn.id)
    try {
      await window.fastAgent.conversations.updateTurn(turn.id, { userMessage: reset.userMessage, attachments, assistantMessage: null, activity: reset.activity, status: 'working' })
      const result = await window.fastAgent.chat.send({ conversationId: turn.conversationId, turnId: turn.id, mode: turn.runtimeConfig.mode, modelId: turn.runtimeConfig.modelId, thinkingLevel: turn.runtimeConfig.thinkingLevel, permission: turn.runtimeConfig.permission, modePrompt: withPlanModePrompt(modePromptFor(modePrompts, turn.runtimeConfig.mode), planMode), planMode, prompt, attachments })
      runTurnRef.current.set(result.runId, turn.id)
      setRunIdsByConversation((current) => ({ ...current, [turn.conversationId]: result.runId }))
    } catch (error) {
      // 会话已有任务在跑（本地 runId 丢了）：把这一轮改回原样，别留一条空的 working 回合。
      if (isRunConflictError(error)) {
        setTurns((current) => current.map((item) => item.id === turn.id ? turn : item))
        void window.fastAgent.conversations.updateTurn(turn.id, { userMessage: turn.userMessage, attachments: turn.attachments, assistantMessage: turn.assistantMessage, activity: turn.activity, status: turn.status }).catch(() => undefined)
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
        setConversationItems((current) => current.map((item) => item.id === conversationId ? { ...item, meta: conversationMetaNow(), archived: false } : item))
      }
      // turn 由主进程在 chat.send 内部原子创建；ACK 返回的 turn 是唯一来源，避免双 IPC。
      const result = await window.fastAgent.chat.send({ conversationId, mode, modelId: selectedModelId, thinkingLevel, permission: mode === 'chat' ? null : permission, modePrompt: withPlanModePrompt(modePromptFor(modePrompts, mode), planMode), planMode, prompt, attachments })
      pendingTurnId = result.turnId
      setTurns((current) => [...current, result.turn])
      setActiveTurnId(result.turnId)
      runTurnRef.current.set(result.runId, result.turnId)
      setRunIdsByConversation((current) => ({ ...current, [conversationId]: result.runId }))
      setRecentConversationRefresh((current) => current + 1)
      setBatchConversationRefresh((current) => current + 1)
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

  // 消息右键菜单：按划选内容与所在消息侧（用户/助手）组装上下文操作。
  const showMessageContextMenu = useEventCallback((event: React.MouseEvent, turn: ConversationTurn) => {
    const target = event.target as HTMLElement
    const inUser = Boolean(target.closest('.message.user'))
    const inAssistant = Boolean(target.closest('.message.assistant'))
    if (!inUser && !inAssistant) return
    event.preventDefault()
    const selected = selectionText()
    const items: ContextMenuItem[] = []
    if (selected) items.push({ id: 'copy-selection', label: '复制选中', onSelect: () => void copyText(selected) })
    if (inUser) {
      items.push({ id: 'copy-message', label: '复制原文', onSelect: () => void copyText(turn.userMessage.text) })
      items.push({ id: 'quote', label: '引用到输入框', onSelect: () => setQuoteRequest({ text: turn.userMessage.text, nonce: Date.now() }) })
      items.push({ id: 'retry', label: '重新发送', onSelect: () => void rerunTurn(turn) })
    } else {
      items.push({ id: 'copy-message', label: '复制回答', onSelect: () => void copyText(turn.assistantMessage?.text ?? '') })
      items.push({ id: 'quote', label: '引用到输入框', onSelect: () => setQuoteRequest({ text: turn.assistantMessage?.text ?? '', nonce: Date.now() }) })
      items.push({ id: 'regenerate', label: '重新生成', onSelect: () => void rerunTurn(turn) })
    }
    items.push({ id: 'delete', label: '删除本轮问答', danger: true, onSelect: () => void deleteTurn(turn.id) })
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
      startNewChat()
    }
    setNotice('对话已归档')
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
      if (selectedConversationId && batchSelectedIds.has(selectedConversationId)) startNewChat()
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

  function readScrollMetrics(node: HTMLDivElement) {
    return { scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }
  }

  // 只在用户本来就贴着底部时才跟随，且用直接赋值而不是平滑滚动，否则流式输出会抖。
  // 内容长高也要重算按钮：不重算的话流式输出把用户挤离底部后按钮不会出现。
  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node) return
    if (followRef.current) node.scrollTop = node.scrollHeight
    setScrollNav(scrollNavAction(readScrollMetrics(node), runId !== null))
  }, [turns, runId, selectedConversationId])

  function onConversationScroll() {
    const node = scrollRef.current
    if (!node) return
    const metrics = readScrollMetrics(node)
    followRef.current = nextFollowState(followRef.current, metrics)
    setScrollNav(scrollNavAction(metrics, runId !== null))
  }

  function jumpConversation(target: 'top' | 'bottom') {
    const node = scrollRef.current
    if (!node) return
    if (target === 'top') {
      // 回顶是用户主动跳走，顺手停掉跟随，免得流式输出立刻又把他拽回底部。
      followRef.current = false
      node.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      followRef.current = true
      node.scrollTop = node.scrollHeight
    }
    setScrollNav(scrollNavAction(readScrollMetrics(node), runId !== null))
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
    notify: setNotice
  }), [])

  const selectedModel = allModels.find((item) => item.id === selectedModelId) ?? allModels[0] ?? null
  const selectedConversationCompaction = selectedConversationId ? compactionStates[selectedConversationId] ?? null : null

  /** 空会话没有落库上下文，窗口跟随当前模型，避免固定 128k 与模型设置不一致。 */
  function emptyContextHealth(model = selectedModel): ContextHealthData {
    return { ...EMPTY_CONTEXT_HEALTH, contextWindow: model?.context_window || DEFAULT_CONTEXT_WINDOW }
  }

  function selectModel(nextId: number) {
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
      .catch(() => undefined)
  }

  async function handleCreateLocal(input: LocalModelInput) {
    await window.fastAgent.models.localCreate(input)
  }

  async function handleUpdateLocal(id: number, input: LocalModelInput) {
    await window.fastAgent.models.localUpdate(id, input)
  }

  async function handleDeleteLocal(id: number) {
    await window.fastAgent.models.localDelete(id)
  }

  function handleTestLocal(id: number) {
    return window.fastAgent.models.localTest(id)
  }

  // 下面这批回调全部传给 memo 过的子组件（Sidebar / Composer / SectionView / MessageList）。
  // 用 useEventCallback 定住引用，流式输出每帧的重渲染才不会穿透 memo。
  const handleNotice = useEventCallback((next: string) => setNotice(next))
  const handleNavigate = useEventCallback(navigate)
  const handleNewChat = useEventCallback(() => startNewChat())
  const handleNewChatInContext = useEventCallback(() => startNewChatInContext())
  const handlePickWorkspace = useEventCallback(() => { void pickWorkspace() })
  const handleSelectConversation = useEventCallback((item: WorkspaceConversation) => { void selectConversation(item) })
  const handleSelectProject = useEventCallback((item: WorkspaceProject) => { void selectProject(item) })
  const handleDeleteConversation = useEventCallback((id: string) => { void deleteConversation(id) })
  const handleArchiveConversation = useEventCallback((id: string) => { void archiveConversation(id) })
  const handleRenameConversation = useEventCallback((id: string, title: string) => { void renameConversation(id, title) })
  const handleDeleteProject = useEventCallback((id: string) => { void deleteProject(id) })
  const handleArchiveProject = useEventCallback((id: string) => { void archiveProject(id) })
  const handleOpenProjectFolder = useEventCallback((path: string) => { void openProjectFolder(path) })
  const handleOpenConversationFolder = useEventCallback((id: string) => { void openConversationFolder(id) })
  const handleOpenInspector = useEventCallback((id: string) => { void openInspector(id) })
  const handleStartBatch = useEventCallback(startBatch)
  const handleBatchConversationPageChange = useEventCallback((page: number) => setBatchConversationPage(page))
  const handleBatchConversationPageSizeChange = useEventCallback((pageSize: number) => setBatchConversationPageSize(pageSize))
  const handleBatchConversationQueryChange = useEventCallback(changeBatchConversationQuery)
  const handleBatchConversationScopeChange = useEventCallback(changeBatchConversationScope)
  const handleToggleBatch = useEventCallback(toggleBatch)
  const handleToggleAllBatch = useEventCallback(toggleAllBatch)
  const handleExitBatch = useEventCallback(exitBatch)
  const handleFinishBatch = useEventCallback((action: 'delete' | 'archive') => { void finishBatch(action) })
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
  const handleCreateLocalModel = useEventCallback(handleCreateLocal)
  const handleUpdateLocalModel = useEventCallback(handleUpdateLocal)
  const handleDeleteLocalModel = useEventCallback(handleDeleteLocal)
  const handleTestLocalModel = useEventCallback(handleTestLocal)
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
  const handleClearConversation = useEventCallback(() => clearConversationAction())
  const handleInitProject = useEventCallback(() => initProjectAction())
  const handleSetMode = useEventCallback((next: ConversationMode) => {
    setMode(next)
    const nextPermission = defaultPermissionForMode(next)
    if (nextPermission) applyDefaultPermission(nextPermission)
  })
  const handleTogglePlanMode = useEventCallback(() => setPlanMode((current) => !current))
  const handleThinkingLevelChange = useEventCallback((level: import('../../shared/types').ThinkingLevel) => setThinkingLevel(level))
  const handleManageModels = useEventCallback(() => openSettings('models'))
  const handleOpenPermissionSettings = useEventCallback(() => openSettings('permissions'))
  const handleEnqueue = useEventCallback((text: string, attachments: Attachment[]) => {
    if (!selectedConversationId) return
    setQueuedPromptsByConversation((current) => ({ ...current, [selectedConversationId]: enqueuePrompt(current[selectedConversationId] ?? [], text, attachments) }))
  })
  const handleRemoveQueued = useEventCallback((id: string) => {
    if (!selectedConversationId) return
    setQueuedPromptsByConversation((current) => ({ ...current, [selectedConversationId]: removeQueuedPrompt(current[selectedConversationId] ?? [], id) }))
  })
  const handleCancelRun = useEventCallback(() => {
    if (!runId) return
    void window.fastAgent.chat.cancel(runId)
    setNotice('已停止生成')
  })
  const handleCloseArtifactFile = useEventCallback(() => setArtifactFile(null))
  const handleCloseArtifactPanel = useEventCallback(() => { setArtifactOpen(false); setArtifactFile(null) })
  const handlePickArtifactSuggestion = useEventCallback((path: string) => setArtifactFile({ path, line: null, endLine: null }))
  const handleGitCheckout = useEventCallback((branch: string) => switchGitBranch(branch))
  const handleGitCreate = useEventCallback((name: string) => createGitBranch(name))
  const handleGitStopAndCheckout = useEventCallback((branch: string) => stopRunThenSwitch(branch))
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
      <header className="titlebar">
        <div className="titlebar-drag">
          <button className="icon-button no-drag" onClick={handleToggleSidebar} aria-label="切换侧栏" title="切换侧栏"><Menu size={17} /></button>
          <div className="window-nav no-drag"><button className="icon-button" onClick={() => stepHistory(-1)} disabled={navigation.index === 0} aria-label="后退" title="后退"><ChevronLeft size={16} /></button><button className="icon-button" onClick={() => stepHistory(1)} disabled={navigation.index >= navigation.entries.length - 1} aria-label="前进" title="前进"><ChevronRight size={16} /></button></div>
          <span className="window-title">{workspaceRoot ? workspaceRoot.split('\\').pop() : 'FastAgent'}</span>
        </div>
        <div className="titlebar-actions no-drag">
          <button className="icon-button" onClick={() => navigate('search')} aria-label="搜索与命令" title="搜索与命令"><Command size={16} /></button>
          <button className="icon-button" aria-label="切换主题" title="切换主题" onClick={() => { const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark'; onThemeChange(next); setNotice(next === 'dark' ? '已切换到深色主题' : next === 'light' ? '已切换到浅色主题' : '已跟随系统主题') }}><CircleDot size={16} /></button>
          <button className="icon-button" onClick={() => setNotice('更多窗口操作将在后续版本提供')} aria-label="更多操作" title="更多操作"><MoreHorizontal size={17} /></button>
        </div>
      </header>
      <div className="shell-body">
        <Sidebar collapsed={sidebarCollapsed} sectionStates={sidebarSections} onToggleSection={handleToggleSection} section={section} projects={projectItems} conversations={scopedConversations} runStates={runStates} compactionStates={compactionStates} onReadRun={handleReadRun} selectedProjectId={selectedProjectId} selectedConversationId={selectedConversationId} onInspectConversation={handleOpenInspector} onStartBatch={handleStartBatch} onDeleteProject={handleDeleteProject} onArchiveProject={handleArchiveProject} onOpenProjectFolder={handleOpenProjectFolder} onOpenConversationFolder={handleOpenConversationFolder} onDeleteConversation={handleDeleteConversation} onArchiveConversation={handleArchiveConversation} onRenameConversation={handleRenameConversation} onNavigate={handleNavigate} onOpenConversations={handleOpenConversations} onNewChat={handleNewChat} onToggle={handleToggleSidebar} onPickWorkspace={handlePickWorkspace} onSelectConversation={handleSelectConversation} onSelectProject={handleSelectProject} onAccountAction={handleAccountAction} auth={auth} abilityAlerts={abilityAlerts} />
        <main className={`conversation ${artifactOpen ? 'with-artifact' : ''}`}>
          {section === 'chats' && batchKind !== 'conversations' ? <>
            <div className="conversation-header">
              <div><span className="status-dot" /> <span>{conversationTitle}</span></div>
              <div className="header-actions">{selectedConversationId && <ItemActions onDelete={() => deleteConversation(selectedConversationId)} onArchive={() => archiveConversation(selectedConversationId)} onBatch={() => startBatch('conversations')} onInspect={() => void openInspector(selectedConversationId)} />}<button className="icon-button" aria-label="打开资源面板" title="打开资源面板" onClick={() => { closeInspector(); setArtifactOpen((value) => !value) }}><PanelRight size={16} /></button></div>
            </div>
            <div className={`conversation-scroll ${conversationEntering ? 'conversation-entering' : ''}`} ref={scrollRef} onScroll={onConversationScroll}>
              {turns.length === 0 ? <EmptyConversation onPickWorkspace={handlePickWorkspace} onAddAttachment={() => setAttachmentRequest((value) => value + 1)} onRunAgent={agentAvailable ? () => { setMode('agent'); applyDefaultPermission('ask'); setNotice('已切换到智能体模式') } : undefined} /> : <MessageList turns={turns} models={allModels} onCopy={handleCopyText} onDelete={handleDeleteTurn} onRetry={handleRerunTurn} onRegenerate={handleRerunTurn} onEdit={handleEditTurn} onContinue={handleContinueTurn} onShowContextMenu={showMessageContextMenu} todosByTurn={todosByTurn} />}
            </div>
            <div className="scroll-nav-anchor">{scrollNav !== 'none' && <button className="scroll-nav" onClick={() => jumpConversation(scrollNav === 'top' ? 'top' : 'bottom')} aria-label={scrollNavLabel[scrollNav]} title={scrollNavLabel[scrollNav]}>
              {scrollNav === 'top' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
            </button>}</div>
            {/* 本轮 Agent 对工作区的改动；与输入框同级，宽度和对齐都跟随 conversation-content */}
            <AgentRunBar turnId={latestTurnId} running={Boolean(runId)} />
            <ResumeBar conversationId={selectedConversationId} running={Boolean(runId)} onResume={handleResumeRun} />
            <Composer shortcuts={settings?.shortcuts} height={composerHeight} heightPinned={composerHeightPinned} onHeightChange={changeComposerHeight} contextHealth={contextHealth} compaction={selectedConversationCompaction} onCompact={handleCompact} onCancelCompaction={handleCancelCompaction} onNewChat={handleNewChatInContext} onSelectConversation={handleSelectConversation} onClearConversation={handleClearConversation} onInitProject={handleInitProject} currentProjectId={selectedProjectId} onManageModels={handleManageModels} onNotice={handleNotice} mode={mode} planMode={planMode} onTogglePlanMode={handleTogglePlanMode} agentAvailable={agentAvailable} setMode={handleSetMode} model={selectedModel} selectedModelId={selectedModelId} models={allModels} favoriteModelIds={favoriteModelIds} recentModelIds={recentModelIds} onSelectModel={handleSelectModel} thinkingLevel={thinkingLevel} onThinkingLevelChange={handleThinkingLevelChange} onToggleFavorite={handleToggleFavoriteModel} attachmentRequest={attachmentRequest} runId={runId} queue={queuedPrompts} onEnqueue={handleEnqueue} onRemoveQueued={handleRemoveQueued} quoteRequest={quoteRequest} onSend={handleSend} gitState={gitState} gitAnyRunActive={anyRunActive} onGitCheckout={handleGitCheckout} onGitCreate={handleGitCreate} onGitStopAndCheckout={handleGitStopAndCheckout} permission={mode === 'chat' ? null : permission} permissionProfiles={permissionProfiles} onPermissionChange={handlePermissionChange} onOpenPermissionSettings={handleOpenPermissionSettings} onCancel={handleCancelRun} />
          </> : <SectionView key={section} section={section} auth={auth} bootstrap={bootstrap} projects={projectItems} conversations={batchKind === 'conversations' ? batchConversationItems : scopedConversations} allConversations={conversationItems} conversationPage={batchConversationPage} conversationPageSize={batchConversationPageSize} conversationTotal={batchConversationTotal} onConversationPageChange={handleBatchConversationPageChange} onConversationPageSizeChange={handleBatchConversationPageSizeChange} batchConversationQuery={batchConversationQuery} batchConversationScope={batchConversationScope} onBatchConversationQueryChange={handleBatchConversationQueryChange} onBatchConversationScopeChange={handleBatchConversationScopeChange} selectedProjectId={selectedProjectId} selectedConversationId={selectedConversationId} batchKind={batchKind} batchSelectedIds={batchSelectedIds} onToggleBatch={handleToggleBatch} onToggleAllBatch={handleToggleAllBatch} onStartBatch={handleStartBatch} onDeleteProject={handleDeleteProject} onArchiveProject={handleArchiveProject} onOpenProjectFolder={handleOpenProjectFolder} onDeleteConversation={handleDeleteConversation} onArchiveConversation={handleArchiveConversation} onExitBatch={handleExitBatch} onFinishBatch={handleFinishBatch} onNavigate={handleNavigate} onPickWorkspace={handlePickWorkspace} onNewChat={handleNewChat} onSelectProject={handleSelectProject} onSelectConversation={handleSelectConversation} onNotice={handleNotice} onLock={handleLock} modePrompts={modePrompts} onModePromptChange={handleModePromptChange} onResetModePrompts={handleResetModePrompts} settings={settings} theme={theme} onSettingsChange={onSettingsChange} onThemeChange={onThemeChange} onOpenInspector={handleOpenInspector} settingsCategory={settingsCategory} settingsRequest={settingsRequest} selectedModelId={selectedModelId} defaultModelId={bootstrap?.default_model_id ?? null} favoriteModelIds={favoriteModelIds} localModels={localModels} onSelectModel={handleSelectModel} onCreateLocal={handleCreateLocalModel} onUpdateLocal={handleUpdateLocalModel} onDeleteLocal={handleDeleteLocalModel} onTestLocal={handleTestLocalModel} onToggleFavoriteModel={handleToggleFavoriteModel} />}
        </main>
        {artifactOpen && !inspector && <ResourcePanel workspaceRoot={workspaceRoot} conversationId={selectedConversationId} file={artifactFile} onPickWorkspace={handlePickWorkspace} onOpenFile={setArtifactFile} onCloseFile={handleCloseArtifactFile} onClose={handleCloseArtifactPanel} onNotice={handleNotice} onPickSuggestion={handlePickArtifactSuggestion} />}
        {inspector && <ConversationInspector data={inspector} compaction={inspectorId ? compactionStates[inspectorId] ?? null : null} onCancelCompaction={() => { if (inspectorId) { void window.fastAgent.conversations.cancelCompaction(inspectorId); setCompactionStates((current) => cancelCompaction(current, inspectorId)) } }} onClose={closeInspector} onRefresh={() => { if (inspectorId) void openInspector(inspectorId) }} onCompact={() => void compactConversationNow(inspectorId)} />}
        {Object.entries(compactionStates).filter(([, state]) => state.status === 'failed' || state.status === 'timed_out').map(([conversationId, state]) => <CompactionFallbackDialog key={`${conversationId}:${state.taskId}`} state={state} models={allModels} onRetry={(modelId) => void compactConversationNow(conversationId, modelId)} onCancel={() => { void window.fastAgent.conversations.cancelCompaction(conversationId); setCompactionStates((current) => cancelCompaction(current, conversationId)) }} onClose={() => setCompactionStates((current) => clearCompaction(current, conversationId))} />)}
      </div>
      {notice && <div className="toast" role="status"><span>{notice}</span>{undoTurn && <button className="toast-action" onClick={() => void restoreTurn()}>撤销</button>}{noticeAction && <button className="toast-action" onClick={noticeAction.run}>{noticeAction.label}</button>}</div>}
      {contextMenu && <MessageContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />}
      {approvals.filter((item) => item.conversationId === selectedConversationId).map((item) => <ApprovalDialog key={item.request.id} request={item.request} onRespond={(decision, answer) => void respondApproval(item.request.id, decision, answer)} />)}
    </div>
    </ResponseActionsContext.Provider>
  )
}
