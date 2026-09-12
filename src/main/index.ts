import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { homedir, hostname } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { ApiClient, ApiError } from './api-client'
import { createAbilitiesService } from './abilities-service'
import { createApprovalBridge, respondPendingApproval, settlePendingRequests } from './approval-bridge'
import { LocalStore } from './local-store'
import { ModelConnectionService } from './model-connections'
import { normalizeModelUsage } from './model-usage'
import { WORKSPACE_NAMESPACE } from './local-store/shared-workspace'
import { migrateConversationSessions } from './session-layout-migration'
import { conversationSessionDir as conversationSessionPath, sessionUserSegment } from './session-paths'
import { persistableEvent } from './turn-activity'
import type { PiSessionRuntime, RuntimeRunOptions } from './pi-runtime'
import type { SubAgentResult } from './agent/subagent/subagent-types'
import type { ScheduledSubAgentTask } from './agent/subagent/subagent-scheduler'
import { estimateTokens, heuristicSummary, projectCompactedState, resolvePolicy, shouldCompact, splitTurns, turnsAfterCoveredTurn } from './context-manager'
import { ContextMeter, type ContextMeasurement } from './context-meter'
import { createTray, destroyTray, handleWindowClose, hideToTray, isQuitting, setQuitting, setTrayClosePolicy, showWindow } from './tray'
import { startDoubleCtrlHook, type DoubleCtrlHook } from './double-key'
import { applyGlobalShortcuts, hasGlobalMouseBinding, startGlobalMouseShortcuts, unregisterAllGlobalShortcuts, type GlobalMouseHook, type MouseHookSource } from './global-shortcuts'
import { acquireUiohook, releaseUiohook } from './hook-lifecycle'
import { hideQuickWindow, sendQuickWindowEvent, showQuickWindow } from './quick-window'
import { createSplashWindow, destroySplashWindow, dismissSplashWindow, showSplashWindow, updateSplashWindow } from './splash-window'
import { createRevealCoordinator, splashUpdate, SPLASH_SLOW_DELAY_MS, SPLASH_STATUS_DELAY_MS, type RevealCoordinator, type RevealReason } from './startup-progress'
import { breadcrumb, initLogging, logAppError, logIntegrationError, writeCrashReport, type CrashKind } from './logging/logger'
import type { CrashProcessMetric, CrashRuntimeInfo } from './logging/crash-report'
import { appIcon } from './app-icon'
import { migrateLegacyData } from './data-migration'
import { moveManagedData } from './data-directory'
import { createDailyBackup, pruneBackups } from './backup-service'
import { defaultDataRoot, resolveAppPaths, writeDataRootLocator, type AppPaths } from './app-paths'
import { LocalSkillRegistry } from './skill-registry'
import type { LocalMcpManager, McpToolBinding } from './mcp-manager'
import { parseMcpImport } from './mcp-import'
import { emptyConnection, resolveAgentAbilities } from './abilities'
import { BuiltinCatalogProvider, listCategories, searchPlugins } from './plugins/catalog'
import { PluginInstaller } from './plugins/installer'
import { createHubService } from './hub/hub-service'
import { createBundleService } from './bundle/bundle-service'
import { registerHubIpc } from './ipc/hub'
import { registerBundleIpc } from './ipc/bundle'
import { redactSecrets } from './secret-redaction'
import { deleteWorkspaceEntry, listWorkspaceDirectory, normalizeWorkspaceRelative, readWorkspaceFile, readWorkspaceImage, resolveWorkspaceDirectory, resolveWorkspaceFile, searchWorkspaceFiles } from './workspace-files'
import { resolveToolPath } from './agent/safety/workspace-guard'
import { clearRunBaselines } from './agent/tool-runtime'
import { createArtifactId, inferArtifactType } from '../shared/artifact'
import { checkoutBranch, createBranch, execGit, listLocalBranches, parsePorcelain, resolveGitWorkspaceState, watchGitMetadata } from './git'
import { createDraft, draftFilePath, isDraftPath, launchConfiguredEditor, readDraft, removeDraft } from './external-editor'
import { AGENT_INIT_FILE_NAME, buildAgentInitTemplate, detectExistingAgentInitFile } from './agent-init'
import { buildFaDirectoryContext, mergeAgentContextFiles, readAgentContextFiles } from './agent-context'
import { restartApplication } from './app-restart'
import { isExternalHttpUrl } from '../renderer/ai-response/sanitize-url'
import type { Ability, AbilityType, AgentEvent, AppRuntimeInfo, AppSettings, ApprovalDecision, ArtifactQuery, AuthSnapshot, ConversationPageQuery, ConversationTurn, DoctorCheck, GitStatusEntry, GitWorkspaceState, LocalMcpServerInput, LocalModelInput, LocalModelTestResult, McpAbility, McpServerDetail, McpTestStatus, MemoryListQuery, MemoryScope, MemoryUpdateInput, ModelCredentials, PageQuery, PermissionPreset, PluginQuery, RendererErrorReport, SandboxSessionInfo, SkillAbility, SkillDetail, StartupPhase, StartupWarning, StartupWarnings, WorkspaceSnapshot } from '../shared/types'
import type { PermissionAction, PermissionRuleSet } from '../shared/permission-rules'
import type { StoredPermissionProfile } from '../shared/permission-profiles'
import { effectiveRuleSet, findProfile, mergeProfiles, sanitizeOverrides, validateProfileDraft } from '../shared/permission-profiles'
import { defaultSandboxSettings, normalizeSandboxSettings } from '../shared/sandbox'
import { normalizePageSize, pageOffset, resolvePage } from '../shared/pagination'
import { SandboxManager } from './agent/sandbox/sandbox-manager'
import { buildSandboxPolicy } from './agent/sandbox/sandbox-policy'
import { describeSandboxError, SANDBOX_DEGRADED_NOTICE } from './agent/sandbox/sandbox-errors'
import { describeSession, sandboxBlockedEvent, sandboxDegradedEvent } from './agent/sandbox/sandbox-events'
import { resolveSandboxPaths, WindowsSandboxProvider } from './agent/sandbox/providers/windows-native/windows-sandbox-provider'
import { resolveBashPath, resolveShellToolName } from './agent/sandbox/shell-resolver'
import { installBundledRuntime, prependPathEntries, resolveBundledRuntimeSource, resolveRuntimeInstallDir } from './runtime/bundled-tools'
import { buildRuntimeReport } from './runtime/runtime-report'
import type { SandboxSession } from './agent/sandbox/sandbox-types'
import { ConversationRunCoordinator, ConversationRuntimeCache } from './conversation-runtime-cache'
import { RunScheduler } from './run-scheduler'
import { createTokenEventBatcher } from './token-event-batcher'
import { createExecutionState, reduceExecutionState, syncExecutionSteps, type ExecutionInput } from './agent/execution-state'
import { projectRunState, resolveTurnWrite } from './agent/run-state'
import { classifyRunError } from './agent/run-error'
import { buildResumePrompt, isResumable } from './agent/run-resume'
import { buildDoctorReport, probeTools } from './doctor'
import { detectVerificationCommands, readWorkspaceManifests, type VerificationCommand } from './agent/verification'
import { createLazyModuleLoader } from './lazy-module'
import { normalizeCustomSubAgents, resolveSubAgentConfig } from './agent/subagent/subagent-config'
import { parseSubAgentHandoff, truncateSubAgentOutput } from './agent/subagent/subagent-handoff'
import { forwardSubAgentEvent, isSubAgentTerminalEvent } from './agent/subagent/subagent-events'
import { extractMemories, recallMemories } from './agent/memory/memory-service'
import { withMemoryPrompt } from './agent/memory/memory-prompt'
import { DEFAULT_RECALL } from './agent/memory/memory-rank'

const loadPiRuntime = createLazyModuleLoader(() => import('./pi-runtime'))
const loadMcpRuntime = createLazyModuleLoader(() => import('./mcp-manager'))

let mainWindow: BrowserWindow | null = null
let appPaths: AppPaths
let store: LocalStore
let modelConnectionService: ModelConnectionService
let skillRegistry: LocalSkillRegistry
let client: ApiClient | null = null
let backendUrl: string | null = null
let userId: string | null = null
let refreshToken: string | null = null
let authState: AuthSnapshot = { state: 'signed_out', user: null, backendUrl: null }
let workspaceRoot: string | null = null
const activeRuns = new Map<string, AbortController>()
let settings: AppSettings
/** 随包工具名 → 绝对路径；启动时同步一次，doctor 用它按真实路径探测（内置工具不在 PATH 上）。 */
let bundledTools: Record<string, string> = {}
const catalogProvider = new BuiltinCatalogProvider()
let pluginInstaller: PluginInstaller
let sandboxManager: SandboxManager
const conversationRuns = new ConversationRunCoordinator()
// 不同会话并行，同一会话仍由 conversationRuns 保证 Pi session 顺序。
const runScheduler = new RunScheduler({ maxConcurrent: 4 })
const activeRunCancels = new Map<string, () => void>()
const activeCompactions = new Map<string, AbortController>()

interface CachedConversationRuntime {
  pi: PiSessionRuntime
  mcpManager: LocalMcpManager | null
  mcpBindings: McpToolBinding[]
  sandboxSession: SandboxSession | null
  sessionOverrides: Map<string, ApprovalDecision>
  dispose(): Promise<void>
}

const conversationRuntimeCache = new ConversationRuntimeCache<CachedConversationRuntime>({ capacity: 8, idleMs: 10 * 60 * 1000 })
/**
 * 运行中被用户改过的权限档位，按 runId 存。
 * 规则集改成每次工具调用现取之后，这里就是「当前这一轮到底按哪档判」的唯一来源；
 * 没有条目表示沿用发送那一刻捕获的档位。run 结束时清掉，不跨轮泄漏。
 */
const runPermissionOverrides = new Map<string, import('../shared/types').PermissionPreset | null>()

function conversationRuntimeKey(namespace: string, conversationId: string) {
  return `${namespace}\t${conversationId}`
}
/** 窗口至少显示过一次后，后续 reveal 不再受「启动时隐藏」约束。 */
let hasShownWindow = false
let rendererRetried = false

/** 启动计时起点：启动页的信息密度按真实耗时分档，不按固定脚本播放。 */
const startupStartedAt = Date.now()
let startupPhase: StartupPhase = 'config'
/** 启动期的非致命失败：不阻塞进入主界面，进入后由渲染进程取回并以提示条呈现。 */
const startupWarnings: StartupWarning[] = []
/** 启动交接是否已经走完；走完之后每次重新加载渲染进程都要补发 reveal。 */
let startupCompleted = false
/** 主进程已经致命出错并正在退出：此后子进程的消失都是后果，不再单独记崩溃。 */
let fatalCrashReported = false
let revealCoordinator: RevealCoordinator | null = null
let verbosityTimers: Array<ReturnType<typeof setTimeout>> = []
let startupFallbackTimer: ReturnType<typeof setTimeout> | null = null

/** 档位生效规则集 + 用户 permission_rules（追加在后，优先级更高）。 */
function buildRuleSet(namespace: string, permission: PermissionPreset | null, allowSubAgent = true): PermissionRuleSet {
  // 档位可能已被删除（历史会话存的是旧 id），findProfile 会回落到第一档而不是让运行时 fail。
  const profile = findProfile(mergeProfiles(store.listPermissionProfiles(namespace)), permission)
  const merged: PermissionRuleSet = {}
  for (const [key, rules] of Object.entries(effectiveRuleSet(profile))) merged[key] = [...rules]
  for (const rule of store.listPermissionRules(namespace)) {
    merged[rule.toolKey] = [...(merged[rule.toolKey] ?? []), { pattern: rule.pattern, action: rule.action }]
  }
  merged.subagent = [{ pattern: '*', action: allowSubAgent ? 'allow' : 'deny' }]
  return merged
}

// 能力读取与 MCP 状态记录集中在 abilities-service；store / skillRegistry 启动后才就绪，用取值函数传入。
const abilitiesService = createAbilitiesService({ store: () => store, skillRegistry: () => skillRegistry, catalogProvider })
const { mcpRuntimeSecrets, listAbilities, requireAbility, recordMcpStatus, backfillAbilityMeta } = abilitiesService
// 同样的延后取值：Hub 与整包服务都要在 store / skillRegistry 就绪后才真正读它们。
const hubService = createHubService({ store: () => store, skillRegistry: () => skillRegistry, catalogProvider, listAbilities })
const bundleService = createBundleService({ store: () => store, skillRegistry: () => skillRegistry })

/** 首帧后再做可延后维护，避免把同步磁盘工作塞进首窗链路。 */
function scheduleDeferredStartupTasks() {
  const run = () => {
    setTimeout(() => {
      try {
        backfillAbilityMeta()
      } catch (error) {
        logStartup('能力元数据补全失败', error)
      }
      try {
        createDailyBackup({ backupsDir: appPaths.backupsDir, databasePath: appPaths.databasePath })
        pruneBackups(appPaths.backupsDir, 14)
      } catch (error) {
        logStartup('自动备份失败', error)
      }
      void sandboxManager.probe().catch((error) => logStartup('沙箱能力探测失败', error))
    }, 0)
  }
  const window = mainWindow
  if (!window || window.isDestroyed()) {
    run()
    return
  }
  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    clearTimeout(fallback)
    run()
  }
  window.once('ready-to-show', schedule)
  // 渲染异常时 ready-to-show 可能不到，维护任务仍需最终执行。
  const fallback = setTimeout(schedule, 8_000)
}

const defaultSettings: AppSettings = {
  startAtLogin: false,
  showOnStartup: true,
  closeToTray: true,
  theme: 'system',
  autoSummary: true,
  contextStrategy: 'auto',
  triggerRatio: null,
  keepRecentTurns: null,
  shellPreference: 'bash',
  bashPath: '',
  externalEditorPath: '',
  agentAbilityPolicy: { mode: 'all_enabled', agentAbilityIds: [] },
  subAgentEnabled: true,
  subAgents: [],
  memory: { enabled: true, autoExtract: true, maxRecall: DEFAULT_RECALL, extractModelId: null },
  sandbox: defaultSandboxSettings,
  quickDialogEnabled: true
}

/** 连按 Ctrl 唤起快速对话的全局钩子；按设置开关挂载/卸载。 */
let doubleCtrlHook: DoubleCtrlHook | null = null

/** 全局鼠标快捷键钩子；与连按 Ctrl 共用 uiohook 线程（引用计数） */
let globalMouseHook: GlobalMouseHook | null = null

const globalShortcutHandlers = {
  showMainWindow: () => { if (mainWindow && !mainWindow.isDestroyed()) showWindow(mainWindow) },
  quickChat: () => showQuickWindow()
}

function syncGlobalShortcuts(previous: AppSettings | undefined) {
  const result = applyGlobalShortcuts(globalShortcut, settings.shortcuts, previous?.shortcuts, globalShortcutHandlers)
  if (result.failed.length) console.error('[global-shortcuts] 全局快捷键注册失败（可能被其他应用占用）:', result.failed.join(', '))
  // 鼠标钩子每次设置变化都重建监听，保证绑定值与开关状态同步；线程由引用计数保底
  if (globalMouseHook) {
    globalMouseHook.stop()
    globalMouseHook = null
    releaseUiohook()
  }
  if (hasGlobalMouseBinding(settings.shortcuts)) {
    // uiohook 的事件重载与 MouseHookSource 结构兼容但类型系统认不出来，收口处断言一次
    startGlobalMouseShortcuts(async () => (await acquireUiohook()) as unknown as MouseHookSource, settings.shortcuts, globalShortcutHandlers)
      .then((hook) => { globalMouseHook = hook })
      .catch((error) => console.error('[global-shortcuts] 鼠标快捷键不可用:', error))
  }
}

async function syncQuickDialogShortcut() {
  if (settings.quickDialogEnabled && !doubleCtrlHook) {
    doubleCtrlHook = await startDoubleCtrlHook(() => showQuickWindow())
  } else if (!settings.quickDialogEnabled && doubleCtrlHook) {
    doubleCtrlHook.stop()
    doubleCtrlHook = null
    hideQuickWindow()
  }
}

function broadcastAuth(snapshot: AuthSnapshot) {
  if (snapshot.state !== authState.state) breadcrumb('auth', snapshot.state)
  authState = snapshot
  mainWindow?.webContents.send('auth:state', snapshot)
}

/** Git 元数据变化（checkout/commit 等）时通知渲染进程重新拉取工作区状态。 */
function broadcastGitChanged() {
  mainWindow?.webContents.send('git:changed')
}

// .git 元数据监听器：工作区切换时重建，回调统一走广播，渲染进程自行拉取最新状态。
let disposeGitWatcher: (() => void) | null = null
function setGitWatchRoot(root: string | null) {
  breadcrumb('workspace', root ?? '(未选择)')
  disposeGitWatcher?.()
  disposeGitWatcher = watchGitMetadata(root, () => broadcastGitChanged())
}

/** 启动期故障在打包版里没有控制台可看，落一份日志到 logs 目录，便于事后定位。 */
/** 随包 runtime 的安装位置：数据根下的 runtime，与安装目录无关。 */
function runtimeInstallDir() {
  return resolveRuntimeInstallDir(appPaths.dataRoot)
}

/**
 * 安装随包 runtime 并把它的 bin 目录前置进本进程 PATH。
 * 启动与设置页的「修复」共用一条路径，避免两处各写一份解析逻辑。
 * 只改本进程 PATH：shell 工具、沙箱、doctor 的子进程都继承它，系统 PATH 一个字节都不动。
 */
function applyBundledRuntime(force = false) {
  const runtime = installBundledRuntime({
    sourceDir: resolveBundledRuntimeSource({ resourcesPath: process.resourcesPath, projectRoot: app.getAppPath(), packaged: app.isPackaged }),
    installDir: runtimeInstallDir(),
    force
  })
  bundledTools = runtime.tools
  const withRuntime = prependPathEntries(process.env as Record<string, string>, runtime.pathEntries)
  for (const key of Object.keys(withRuntime)) {
    if (key.toUpperCase() === 'PATH') process.env[key] = withRuntime[key]
  }
  // 缺内置工具不是故障（开发态没跑 fetch:runtime 就会缺），不该弹启动警告条，只留面包屑。
  breadcrumb('runtime', `内置工具 可用=${Object.keys(runtime.tools).join(',') || '无'}${runtime.installed ? ' 本次已安装' : ''}`)
  return runtime
}

function logStartup(scope: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const line = `[${new Date().toISOString()}] ${scope}: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  console.error(`[startup] ${scope}:`, error)
  // 日志用户看不见，同一条同时留给主界面提示条：非致命失败不该只是静静地被吞掉。
  // 只收启动交接完成之前的：这个函数运行期和退出清理也在用，不设边界会一直堆下去。
  if (!startupCompleted) startupWarnings.push({ scope, message })
  try {
    const dir = appPaths?.logsDir ?? app.getPath('logs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'startup.log'), line, 'utf8')
  } catch { /* 日志失败不能反过来阻断启动 */ }
}

function crashRuntimeInfo(): CrashRuntimeInfo {
  const memory = process.memoryUsage()
  let processes: CrashProcessMetric[] = []
  try {
    processes = app.getAppMetrics().map((metric) => ({
      type: metric.type,
      pid: metric.pid,
      cpuPercent: metric.cpu?.percentCPUUsage,
      workingSetKb: metric.memory?.workingSetSize
    }))
  } catch {
    // 取不到进程指标不影响报告主体，缺这一段也比没有报告强。
  }
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: `${process.platform} ${process.arch}`,
    uptimeSeconds: process.uptime(),
    memory: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external },
    processes
  }
}

function crashState() {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  return {
    authState: authState.state,
    backendUrl,
    workspaceRoot,
    activeRuns: activeRuns.size,
    windowVisible: window ? window.isVisible() : null,
    startupCompleted
  }
}

/** 只挑排查用得上的设置字段：整体 dump 会把 bashPath / externalEditorPath 这类本地路径也带进日志。 */
function crashSettings() {
  if (!settings) return null
  return {
    theme: settings.theme,
    contextStrategy: settings.contextStrategy,
    shellPreference: settings.shellPreference,
    sandboxEnabled: settings.sandbox?.enabled,
    quickDialogEnabled: settings.quickDialogEnabled,
    closeToTray: settings.closeToTray
  }
}

function reportCrash(kind: CrashKind, detail: string | null, error?: { message: string; stack?: string | null; componentStack?: string | null }) {
  const path = writeCrashReport({
    kind,
    at: new Date(),
    detail,
    error: error ?? null,
    runtime: crashRuntimeInfo(),
    state: crashState(),
    settings: crashSettings()
  })
  console.error(`[crash] ${kind}${detail ? ` ${detail}` : ''} -> ${path ?? '报告写入失败'}`)
  return path
}

function describeCrashError(value: unknown) {
  if (value instanceof Error) return { message: value.message, stack: value.stack ?? null }
  return { message: String(value), stack: null }
}

/**
 * 进程级崩溃是否值得记。
 * 退出过程中渲染进程与 GPU 进程本来就会被杀，照记的话每次正常关闭都会留下一份假崩溃报告，
 * 真正的崩溃反而被淹掉。主进程已经致命出错时同理：后续被带走的子进程只是它的后果。
 */
function shouldReportProcessCrash() {
  return !isQuitting() && !fatalCrashReported
}

/**
 * 崩溃处理器。
 * 主进程的两类未捕获错误在写完报告后仍按原语义退出——今天它们本来就会让进程挂掉
 * （Node 默认 --unhandled-rejections=throw），这里只是让它挂之前留下记录，
 * 不能顺手把进程救活：那会把一次显式崩溃变成之后难以解释的错乱状态。
 */
function installCrashHandlers() {
  process.on('uncaughtException', (error) => {
    reportCrash('main-uncaught', null, describeCrashError(error))
    fatalCrashReported = true
    app.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    reportCrash('main-rejection', null, describeCrashError(reason))
    fatalCrashReported = true
    app.exit(1)
  })
  app.on('child-process-gone', (_event, details) => {
    if (!shouldReportProcessCrash()) return
    const service = details.serviceName ? ` service=${details.serviceName}` : ''
    reportCrash('child-gone', `type=${details.type} reason=${details.reason} exitCode=${details.exitCode}${service}`)
  })
  // 收到终止信号是正常退出，不是崩溃。不先定态的话，被 kill 时渲染进程与 GPU 进程
  // 相继被杀，会各留下一份假崩溃报告。注册了处理器就得自己负责退出。
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      setQuitting(true)
      app.quit()
      // 清理链路万一卡住也必须退干净，否则单实例锁会挡住下一次启动。
      setTimeout(() => app.exit(0), 3000).unref()
    })
  }
}

/** 设置里的 system 要落到具体值才能用于建窗底色、标题栏与启动页。 */
function resolvedDarkMode() {
  return settings?.theme === 'dark' || ((settings?.theme ?? 'system') === 'system' && nativeTheme.shouldUseDarkColors)
}

/** 推进启动阶段并同步给启动页；档位由真实耗时决定。 */
function pushStartupPhase(phase: StartupPhase) {
  if (phase !== startupPhase) breadcrumb('startup', phase)
  startupPhase = phase
  updateSplashWindow(splashUpdate(phase, Date.now() - startupStartedAt))
}

/**
 * 阶段不变但耗时跨过 1.2 秒 / 5 秒阈值时也要重发一次。
 * 否则「卡在某一步」恰恰是最需要给用户交代的场景，状态文字却永远不会出现。
 */
function scheduleVerbosityRefresh() {
  verbosityTimers = [SPLASH_STATUS_DELAY_MS, SPLASH_SLOW_DELAY_MS].map((threshold) =>
    setTimeout(() => pushStartupPhase(startupPhase), Math.max(0, threshold - (Date.now() - startupStartedAt)))
  )
}

function clearStartupTimers() {
  for (const timer of verbosityTimers) clearTimeout(timer)
  verbosityTimers = []
  if (startupFallbackTimer) {
    clearTimeout(startupFallbackTimer)
    startupFallbackTimer = null
  }
}

/**
 * 显示主窗口并收掉启动页。三条触发来源（首屏就绪 / 等待上限 / 异常兜底）都汇到这里，
 * 由 revealCoordinator 保证只发生一次。
 */
function completeStartup(_reason: RevealReason) {
  clearStartupTimers()
  startupCompleted = true
  const window = mainWindow
  if (!window || window.isDestroyed()) {
    destroySplashWindow()
    return
  }
  // 无论窗口这次显不显示都要发：渲染进程的正文在收到之前是透明的。
  window.webContents.send('startup:reveal')
  const hidden = settings?.showOnStartup === false && !hasShownWindow
  if (window.isVisible() || hidden) {
    destroySplashWindow()
    return
  }
  hasShownWindow = true
  window.show()
  dismissSplashWindow()
}

function createWindow() {
  const dark = resolvedDarkMode()
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    // 960 下限太宽，窄屏自适应无从验证；720 与 body 的 min-width 对齐，再窄也不会出现横向滚动。
    minWidth: 720,
    minHeight: 640,
    title: 'FastAgent',
    icon: appIcon(),
    titleBarStyle: 'hidden',
    // 先隐藏，等渲染进程给出首帧再显示；否则重启瞬间会看到一块空白窗口。
    show: false,
    // 不给底色的话窗口首帧是 Electron 默认的白，深色主题下必然闪一下。
    backgroundColor: dark ? '#181817' : '#fafaf8',
    titleBarOverlay: dark
      ? { color: '#181817', symbolColor: '#F1F1ED', height: 44 }
      : { color: '#FAFAF8', symbolColor: '#20201E', height: 44 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 主题必须在首帧之前定死，走启动参数是唯一比渲染进程 IPC 更早的通道。
      additionalArguments: [`--fastagent-theme=${dark ? 'dark' : 'light'}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.setBounds({ x: 80, y: 60, width: 1440, height: 900 })
  mainWindow.center()
  revealCoordinator?.dispose()
  // 显示时机收口：首屏数据就绪优先，等不到就由 cap 放行，再不行由 8 秒兜底。
  revealCoordinator = createRevealCoordinator({ capMs: 2500, onReveal: completeStartup })
  // ready-to-show 依赖渲染进程首帧；加载卡住时兜底显示，避免「进程活着但没有任何窗口」。
  startupFallbackTimer = setTimeout(() => revealCoordinator?.forceReveal('fallback'), 8000)
  mainWindow.once('ready-to-show', () => revealCoordinator?.markWindowReady())
  mainWindow.on('closed', () => { clearStartupTimers(); revealCoordinator?.dispose() })
  // 重载 / 渲染进程崩溃重建后页面又是全新的一份，正文默认透明等着 reveal。
  // 这时候启动交接早就结束了，不补发的话界面要空等到渲染进程自己的兜底定时器。
  mainWindow.webContents.on('did-finish-load', () => {
    if (startupCompleted) mainWindow?.webContents.send('startup:reveal')
  })
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 是主动取消（例如重定向），不算失败。
    if (!isMainFrame || errorCode === -3) return
    logStartup('界面加载失败', `${errorDescription}（${errorCode}）${validatedURL}`)
    if (rendererRetried) {
      // 启动页不能陪着无限等：放行到主窗口，失败详情由提示条 + 日志承担。
      revealCoordinator?.forceReveal('fallback')
      return
    }
    rendererRetried = true
    loadRenderer()
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    // 退出流程中渲染进程本来就会被杀，此时重载会挡住退出。
    if (isQuitting()) return
    if (shouldReportProcessCrash()) reportCrash('renderer-gone', `reason=${details.reason} exitCode=${details.exitCode}`)
    if (details.reason !== 'clean-exit' && !mainWindow?.isDestroyed()) mainWindow?.webContents.reload()
  })
  // 无响应不一定致命，但用户体感就是卡死；留一份快照才能事后知道当时在跑什么。
  mainWindow.on('unresponsive', () => { if (shouldReportProcessCrash()) reportCrash('unresponsive', null) })
  mainWindow.on('close', (event) => handleWindowClose(event, mainWindow as BrowserWindow))
  mainWindow.on('closed', () => { mainWindow = null })
  // AI 输出里的链接一律不在应用内开窗：http/https 交给系统浏览器，其余协议直接丢弃。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === mainWindow?.webContents.getURL()) return
    event.preventDefault()
    if (isExternalHttpUrl(url)) void shell.openExternal(url)
  })
  loadRenderer()
}

function loadRenderer() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const load = process.env.ELECTRON_RENDERER_URL
    ? mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    : mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  load.catch((error) => logStartup('loadRenderer', error))
}

function applySettings(next: AppSettings) {
  const previous = settings
  // sandbox 是嵌套对象，浅合并会让旧库里缺字段的配置变成 undefined，这里单独归一化。
  settings = {
    ...defaultSettings,
    ...next,
    sandbox: normalizeSandboxSettings(next.sandbox).settings
  }
  setTrayClosePolicy(settings.closeToTray)
  void syncQuickDialogShortcut()
  syncGlobalShortcuts(previous)
  app.setLoginItemSettings({ openAtLogin: settings.startAtLogin, openAsHidden: !settings.showOnStartup })
  if (mainWindow) {
    const dark = resolvedDarkMode()
    mainWindow.setTitleBarOverlay({ color: dark ? '#181817' : '#FAFAF8', symbolColor: dark ? '#F1F1ED' : '#20201E', height: 44 })
    mainWindow.webContents.send('settings:changed', settings)
  }
}

function requireClient() {
  if (!client || !backendUrl || !userId || authState.state !== 'ready') throw new Error('当前账户未就绪')
  return client
}

function requireNamespace() {
  if (authState.state !== 'ready') throw new Error('当前工作区未就绪')
  return WORKSPACE_NAMESPACE
}

function preferenceNamespace() {
  return authState.state === 'ready' ? WORKSPACE_NAMESPACE : null
}

function accountNamespace() {
  return backendUrl && userId ? LocalStore.namespace(backendUrl, userId) : null
}

/** 模型真实 context window 只有取过凭据后才知道，按模型缓存供 Token 估算复用。 */
const modelContextWindows = new Map<number, number>()

function modelRuntimeIdentity(credentials: ModelCredentials) {
  return { provider: credentials.provider, modelId: credentials.id }
}

/**
 * 一个会话一份 session：pi 的 session 格式本身是 provider 中立的，换模型只需追加 model_change。
 * 按模型分目录会把上下文切断，复杂任务中途换更强的模型就接不上之前的历史。
 *
 * 目录按 用户/会话创建日期/会话 id 三层展开，便于人工在磁盘上定位；日期取创建日而非当天，
 * 跨天续聊与压缩后重开的 session 才会落在同一个会话目录里。
 */
function conversationSessionDir(namespace: string, conversationId: string) {
  const createdAt = store.getConversation(namespace, conversationId)?.createdAt ?? new Date().toISOString()
  const userSegment = sessionUserSegment(namespace, store.getAccountUsername(namespace))
  return conversationSessionPath(appPaths.sessionsDir, { userSegment, createdAt, conversationId })
}

/** 登录成功后补跑一次旧布局迁移：username 此刻才落库，迁出来的目录段才是用户名而不是 userId。 */
function migrateSessionLayout(namespace: string, userSegmentOverride?: string) {
  try {
    const userSegment = userSegmentOverride ?? sessionUserSegment(namespace, store.getAccountUsername(namespace))
    const result = migrateConversationSessions({ sessionsDir: appPaths.sessionsDir, store, namespace, userSegment })
    if (result.status !== 'not-needed') console.info('[session-layout]', result)
  } catch (error) {
    console.error('[session-layout] 迁移失败', error)
  }
}

/** 无状态，measure 是纯计算，不必每次调用都新建。 */
const contextMeter = new ContextMeter()

function contextWindowFor(namespace: string, conversationId: string, modelIdOverride?: number | null) {
  // 只要末轮绑定的模型，不必把整段历史读出来。
  const modelId = modelIdOverride ?? store.latestTurnRuntime(namespace, conversationId)?.runtimeConfig.modelId
  return (modelId !== null && modelId !== undefined ? modelContextWindows.get(modelId) : undefined) ?? store.getContextState(namespace, conversationId)?.contextWindow ?? 128_000
}

/**
 * contextWindow 省略时按最后一个回合的模型推断（与 contextWindowFor 同规则），
 * 但推断与整份估算都推迟到真正要用时：调用方带了 runtimeMeasurement 时全都用不上。
 */
function refreshContext(namespace: string, conversationId: string, contextWindow?: number, modelIdOverride?: number | null, runtimeMeasurement?: ContextMeasurement) {
  const modelId = modelIdOverride ?? store.latestTurnRuntime(namespace, conversationId)?.runtimeConfig.modelId ?? null
  const credentials = modelId === null ? null : (() => { try { return resolveModelCredentials(modelId) } catch { return null } })()
  const identity = credentials ? modelRuntimeIdentity(credentials) : null
  const modelRuntime = identity ? store.getModelRuntime(namespace, conversationId, identity.provider, identity.modelId) : null
  const state = modelRuntime ? {
    conversationId, contextWindow: modelRuntime.context_window, estimatedTokens: modelRuntime.estimated_tokens,
    messageTokens: modelRuntime.message_tokens, toolTokens: modelRuntime.tool_tokens, systemTokens: modelRuntime.system_tokens,
    summaryTokens: modelRuntime.summary_tokens, attachmentTokens: modelRuntime.attachment_tokens,
    modelId: identity?.modelId, provider: identity?.provider, countingMethod: modelRuntime.counting_method,
    compactionCount: modelRuntime.compaction_count, latestSummaryId: store.getContextState(namespace, conversationId)?.latestSummaryId ?? null, updatedAt: modelRuntime.updated_at
  } : store.getContextState(namespace, conversationId)

  // 活跃 Pi session 的真实消息分类优先；无运行时快照时才回落到应用回合估算。
  // 已持久化 provider 总量仅用于校准回落分类，避免界面刷新时把真实总量覆盖掉。
  const usageTokens = modelRuntime?.counting_method === 'provider-usage' ? modelRuntime.estimated_tokens : undefined
  const persistedMeasurement: ContextMeasurement | null = modelRuntime?.counting_method === 'provider-usage' ? {
    modelId: identity?.modelId ?? -1,
    provider: identity?.provider ?? 'unknown',
    contextWindow: modelRuntime.context_window,
    estimatedTokens: modelRuntime.estimated_tokens,
    messageTokens: modelRuntime.message_tokens,
    toolTokens: modelRuntime.tool_tokens,
    systemTokens: modelRuntime.system_tokens,
    summaryTokens: modelRuntime.summary_tokens,
    attachmentTokens: modelRuntime.attachment_tokens,
    countingMethod: 'provider-usage'
  } : null
  // 整份估算要遍历全部历史回合与工具事件，是这里最贵的一步；只有真的没有现成测量值时才做。
  const estimate = () => {
    // 全量历史只有走到这里才需要，前面的分支都用不上。
    const turns = store.listTurns(namespace, conversationId)
    // 被摘要覆盖的回合不再计入 token，避免压缩后计算虚高，反复触发下一轮压缩。
    const activeTurns = turnsAfterCoveredTurn(turns, state?.latestSummaryId ? store.getContextSummary(namespace, state.latestSummaryId)?.coveredTurnEnd ?? null : null)
    return contextMeter.measure({
      modelId: modelId ?? -1,
      provider: credentials?.provider ?? 'unknown',
      contextWindow: credentials?.context_window || (contextWindow ?? contextWindowFor(namespace, conversationId)),
      turns: activeTurns.map((turn) => ({
        user: turn.userMessage.text,
        assistant: turn.assistantMessage?.text,
        tools: (turn.activity?.events || [])
          .filter((event) => event.type === 'tool_started' || event.type === 'tool_result')
          .map((event) => ({ name: event.tool || event.type, input: event.input, result: event.detail }))
      })),
      summary: state?.latestSummaryId ? store.getContextSummary(namespace, state.latestSummaryId)?.summaryText ?? null : null,
      attachments: activeTurns.flatMap((turn) => turn.attachments.map((attachment) => attachment.name)),
      usage: usageTokens === undefined ? undefined : { inputTokens: usageTokens }
    })
  }
  const measured = runtimeMeasurement ?? persistedMeasurement ?? estimate()
  // 窗口大小以当前模型配置为准：切换模型或改过模型设置后，运行时快照里的旧窗口不能继续显示。
  const next = {
    conversationId, contextWindow: credentials?.context_window || measured.contextWindow, estimatedTokens: measured.estimatedTokens,
    messageTokens: measured.messageTokens, toolTokens: measured.toolTokens, systemTokens: measured.systemTokens,
    summaryTokens: measured.summaryTokens, attachmentTokens: measured.attachmentTokens, modelId: modelId === -1 ? null : modelId,
    provider: measured.provider, countingMethod: measured.countingMethod,
    compactionCount: Math.max(state?.compactionCount ?? 0, store.countCompactions(namespace, conversationId)),
    latestSummaryId: state?.latestSummaryId ?? null, updatedAt: new Date().toISOString()
  }
  if (identity) store.upsertModelRuntime(namespace, { conversationId, ...identity, context: next })
  return store.upsertContextState(namespace, next)
}

function latestSummaryText(namespace: string, conversationId: string) {
  const summaryId = store.getContextState(namespace, conversationId)?.latestSummaryId
  return summaryId ? store.getContextSummary(namespace, summaryId)?.summaryText ?? null : null
}

const COMPACTION_TIMEOUT_MS = 60_000

class CompactionError extends Error {
  constructor(public readonly code: 'COMPACTION_TIMEOUT' | 'COMPACTION_MODEL_ERROR' | 'COMPACTION_CANCELLED', message: string) {
    super(message)
    this.name = code
  }
}

async function compactConversation(namespace: string, conversationId: string, reason = 'manual', credentials?: ModelCredentials | null) {
  const started = Date.now()
  const compactionKey = `${namespace}:${conversationId}`
  const controller = new AbortController()
  let timedOut = false
  activeCompactions.set(compactionKey, controller)
  if (reason === 'manual') mainWindow?.webContents.send('chat:event', { runId: `compaction-${conversationId}`, conversationId, type: 'run_phase', phase: 'compacting', status: 'running', progress: 10, modelId: credentials?.id ?? null, detail: '正在读取会话历史', timestamp: started })
  const policy = resolvePolicy(settings, store.getContextPolicy(namespace, conversationId), conversationId)
  const before = refreshContext(namespace, conversationId, credentials?.context_window ?? contextWindowFor(namespace, conversationId, credentials?.id), credentials?.id)
  const { compressible } = splitTurns(store.listTurns(namespace, conversationId), policy.keepRecentTurns)
  if (!compressible.length) {
    activeCompactions.delete(compactionKey)
    return null
  }
  if (reason === 'manual') mainWindow?.webContents.send('chat:event', { runId: `compaction-${conversationId}`, conversationId, type: 'run_phase', phase: 'compacting', status: 'running', progress: 30, modelId: credentials?.id ?? null, detail: '正在准备摘要内容', timestamp: Date.now(), elapsedMs: Date.now() - started })
  const previousSummary = latestSummaryText(namespace, conversationId)
  let summaryText = heuristicSummary(compressible, previousSummary)
  if (credentials) {
    // 摘要质量优先走模型，但压缩绝不能因为一次网络失败而阻断发送。
    try {
      const { summarizeTurns } = await loadPiRuntime()
      if (reason === 'manual') mainWindow?.webContents.send('chat:event', { runId: `compaction-${conversationId}`, conversationId, type: 'run_phase', phase: 'compacting', status: 'running', progress: 45, modelId: credentials?.id ?? null, detail: '正在生成摘要', timestamp: Date.now(), elapsedMs: Date.now() - started })
      const timer = setTimeout(() => { timedOut = true; controller.abort() }, COMPACTION_TIMEOUT_MS)
      try {
        summaryText = await summarizeTurns({ credentials, turns: compressible, previousSummary, agentDir: appPaths.agentDir, signal: controller.signal, createModelRuntime: createModelRuntimeForCredentials })
      } catch (error) {
        if (controller.signal.aborted) throw new CompactionError(timedOut ? 'COMPACTION_TIMEOUT' : 'COMPACTION_CANCELLED', timedOut ? '压缩模型响应超时' : '压缩已取消')
        throw new CompactionError('COMPACTION_MODEL_ERROR', error instanceof Error ? error.message : '压缩模型调用失败')
      } finally {
        clearTimeout(timer)
        activeCompactions.delete(compactionKey)
      }
    } catch (error) {
      if (controller.signal.aborted) throw new CompactionError('COMPACTION_TIMEOUT', timedOut ? '压缩模型响应超时' : '压缩已取消')
      if (error instanceof CompactionError) throw error
      throw new CompactionError('COMPACTION_MODEL_ERROR', error instanceof Error ? error.message : '压缩模型调用失败')
    }
  }
  activeCompactions.delete(compactionKey)
  if (controller.signal.aborted) throw new CompactionError(timedOut ? 'COMPACTION_TIMEOUT' : 'COMPACTION_CANCELLED', timedOut ? '压缩模型响应超时' : '压缩已取消')
  const summary = store.createContextSummary(namespace, { conversationId, version: (store.listContextSummaries(namespace, conversationId).at(-1)?.version ?? 0) + 1, summaryText, coveredTurnStart: compressible[0]?.id ?? null, coveredTurnEnd: compressible.at(-1)?.id ?? null, inputTokens: before.estimatedTokens, outputTokens: estimateTokens(summaryText) })
  const projected = projectCompactedState(before, policy.strategy, summaryText)
  const after = store.upsertContextState(namespace, { ...projected, compactionCount: before.compactionCount + 1, latestSummaryId: summary.id, updatedAt: new Date().toISOString() })
  if (credentials) {
    const identity = modelRuntimeIdentity(credentials)
    store.upsertModelRuntime(namespace, { conversationId, ...identity, context: after })
  }
  const compaction = store.recordCompaction(namespace, { conversationId, strategy: policy.strategy, triggerReason: reason, beforeTokens: before.estimatedTokens, afterTokens: after.estimatedTokens, coveredTurnStart: summary.coveredTurnStart, coveredTurnEnd: summary.coveredTurnEnd, summaryId: summary.id, durationMs: Date.now() - started })
  // 摘要改变了请求上下文，作废该会话的 session，下一轮以摘要重开。
  store.setConversationSessionFile(namespace, conversationId, '')
  await conversationRuntimeCache.invalidate(conversationRuntimeKey(namespace, conversationId))
  if (reason === 'manual') mainWindow?.webContents.send('chat:event', { runId: `compaction-${conversationId}`, conversationId, type: 'compactionCompleted', phase: 'compacting', status: 'completed', progress: 100, modelId: credentials?.id ?? null, context: after, compaction, detail: '上下文压缩完成', timestamp: Date.now(), elapsedMs: Date.now() - started })
  return { context: after, summary, compaction }
}

/** 登录时下发的模型凭证；safeStorage 不可用时只有这份内存副本。 */
const modelCredentialCache = new Map<number, ModelCredentials>()

function cacheModelCredentials(credentials: ModelCredentials[]) {
  for (const credential of credentials) {
    modelCredentialCache.set(credential.id, credential)
    if (credential.context_window) modelContextWindows.set(credential.id, credential.context_window)
  }
}

/** 模型调用直连 provider，凭证只从登录时下发的本地副本取，不再逐轮请求后端。 */
function resolveModelCredentials(modelId: number): ModelCredentials {
  // 负数 id 是本地添加的模型：不依赖登录，直接从 local_models 表解密组装。
  if (modelId < 0) {
    const stored = store.modelConnections().runtimeConfig(-modelId) ?? store.getLocalModelRuntimeConfig(-modelId)
    if (!stored) throw new Error('本地模型不存在或已被删除')
    if (stored.context_window) modelContextWindows.set(modelId, stored.context_window)
    return { id: modelId, ...stored }
  }
  const cached = modelCredentialCache.get(modelId)
  if (cached) return cached
  const namespace = accountNamespace()
  if (namespace) {
    const stored = store.listModelCredentials(namespace)
    if (stored.length) {
      cacheModelCredentials(stored)
      const hit = modelCredentialCache.get(modelId)
      if (hit) return hit
    }
  }
  throw new Error('本地缺少该模型的凭证，请重新登录同步')
}

async function createModelRuntimeForCredentials(credentials: ModelCredentials) {
  if (credentials.authMode === 'oauth' && credentials.connectionId) {
    return modelConnectionService.createRuntime(credentials.connectionId, credentials.model_name)
  }
  const runtime = await loadPiRuntime()
  return runtime.createModelRuntime(credentials)
}

/** 所有后端客户端都从这里出，保证每一路请求失败都会落进 integration 日志。 */
function createApiClient(baseUrl: string) {
  const client = new ApiClient(baseUrl)
  client.setErrorReporter((report) => logIntegrationError({
    service: 'backend',
    endpoint: `${report.method} ${report.path}`,
    status: report.status,
    message: report.message,
    durationMs: report.durationMs
  }))
  return client
}

/**
 * 模型返回的错误里经常原样回显 api_key 或鉴权头，落盘前必须过一道脱敏。
 * 与 MCP 那边共用 secret-redaction 的替换规则。
 */
function redactModelMessage(modelId: number | null, message: string): string {
  if (modelId === null) return message
  try {
    const credentials = resolveModelCredentials(modelId)
    return redactSecrets(message, [credentials.api_key ?? '', ...Object.values(credentials.headers ?? {})]) ?? message
  } catch {
    return message
  }
}

/** 模型调用失败算外部服务问题，记进 integration 日志，不和应用自身错误混在一起。 */
function reportModelFailure(modelId: number | null, error: unknown, durationMs?: number) {
  const message = error instanceof Error ? error.message : String(error)
  logIntegrationError({
    service: 'model',
    endpoint: modelId === null ? '(未选择模型)' : `model#${modelId}`,
    message: redactModelMessage(modelId, message),
    durationMs
  })
}

/** 本地模型连通性测试：按协议发一个最小请求，只验证认证与基础连通，不消耗模型配额。 */
async function testLocalModel(id: number): Promise<LocalModelTestResult> {
  const credentials = resolveModelCredentials(id)
  const baseUrl = (credentials.base_url || '').replace(/\/+$/, '')
  if (!baseUrl) return { ok: false, error: '未配置 Base URL' }
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const headers: Record<string, string> = { ...(credentials.headers ?? {}) }
    let url: string
    let body: Record<string, unknown>
    const protocol = credentials.protocol ?? (credentials.provider === 'anthropic' || credentials.provider === 'openai-responses' || credentials.provider === 'openai' ? credentials.provider : 'openai')
    if (protocol === 'anthropic') {
      url = `${baseUrl}/messages`
      headers['x-api-key'] = credentials.api_key || ''
      headers['anthropic-version'] = '2023-06-01'
      headers['content-type'] = 'application/json'
      body = { model: credentials.model_name, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }
    } else if (protocol === 'openai-responses') {
      url = `${baseUrl}/responses`
      headers.authorization = `Bearer ${credentials.api_key || ''}`
      headers['content-type'] = 'application/json'
      body = { model: credentials.model_name, input: 'ping', max_output_tokens: 1 }
    } else {
      url = `${baseUrl}/chat/completions`
      headers.authorization = `Bearer ${credentials.api_key || ''}`
      headers['content-type'] = 'application/json'
      body = { model: credentials.model_name, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }
    }
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
    if (!response.ok) {
      let detail = `HTTP ${response.status}`
      try {
        const data = await response.json() as { error?: { message?: string } }
        if (data?.error?.message) detail = data.error.message
      } catch { /* 非 JSON 响应体不解析 */ }
      const latencyMs = Date.now() - startedAt
      logIntegrationError({ service: 'model', endpoint: `${credentials.provider}/${credentials.model_name}`, status: response.status, message: redactModelMessage(id, detail), durationMs: latencyMs })
      return { ok: false, error: detail, latencyMs }
    }
    return { ok: true, latencyMs: Date.now() - startedAt }
  } catch (error) {
    const detail = error instanceof DOMException && error.name === 'AbortError' ? '连接超时' : error instanceof Error ? error.message : String(error)
    const latencyMs = Date.now() - startedAt
    logIntegrationError({ service: 'model', endpoint: `${credentials.provider}/${credentials.model_name}`, message: redactModelMessage(id, detail), durationMs: latencyMs })
    return { ok: false, error: detail, latencyMs }
  } finally {
    clearTimeout(timer)
  }
}

/** 取会话最近一轮所用模型的凭据，用于生成摘要；不可用时返回 null 并回退到本地摘要。 */
function credentialsForConversation(namespace: string, conversationId: string, fallbackModelId: number | null = null) {
  const modelId = store.latestTurnRuntime(namespace, conversationId)?.runtimeConfig.modelId ?? fallbackModelId
  if (modelId === null || modelId === undefined) return null
  try {
    return resolveModelCredentials(modelId)
  } catch {
    return null
  }
}

function enableAutomaticRefresh(target: ApiClient) {
  target.setUnauthorizedHandler(async () => {
    if (!refreshToken || !backendUrl || !userId) throw new ApiError(401, '登录状态已失效')
    try {
      const pair = await target.refresh(refreshToken)
      refreshToken = pair.refresh_token
      store.saveAccount({ backendUrl, userId, refreshToken })
      return pair.access_token
    } catch (error) {
      await lockAccount('revoked')
      throw error
    }
  })
}

async function lockAccount(nextState: AuthSnapshot['state'] = 'locked') {
  for (const controller of activeRuns.values()) controller.abort()
  activeRuns.clear()
  await conversationRuntimeCache.disposeAll()
  if (backendUrl && userId) {
    const namespace = LocalStore.namespace(backendUrl, userId)
    store.lock(namespace)
    // 退出登录后本地不该再留着可直连 provider 的密钥；锁定只清内存，重新登录即可恢复。
    if (nextState === 'signed_out') store.clearModelCredentials(namespace)
  }
  modelCredentialCache.clear()
  client?.setAccessToken(null)
  client = null
  refreshToken = null
  broadcastAuth({ state: nextState, user: null, backendUrl })
}

/** 重启与退出会打断正在跑的任务，先让用户确认再执行。 */
async function confirmInterruptRuns(action: '重启' | '退出') {
  if (!activeRuns.size) return true
  const question = {
    type: 'warning' as const,
    buttons: [`继续${action}`, '取消'],
    defaultId: 1,
    cancelId: 1,
    message: `还有 ${activeRuns.size} 个任务在运行`,
    detail: `${action}会中断这些任务，未完成的回合会被标记为已取消。`
  }
  const result = mainWindow ? await dialog.showMessageBox(mainWindow, question) : await dialog.showMessageBox(question)
  return result.response === 0
}

function stopActiveWork() {
  for (const controller of activeRuns.values()) controller.abort()
  activeRuns.clear()
  settlePendingRequests(new DOMException('应用正在退出', 'AbortError'))
  void conversationRuntimeCache.disposeAll().catch((error) => console.error('[runtime-cache] disposeAll 失败:', error))
  void sandboxManager?.destroyAll().catch((error) => console.error('[sandbox] destroyAll 失败:', error))
}

/**
 * 所有 IPC 处理统一记面包屑、失败落盘。
 * 错误仍原样抛回渲染进程，界面上的提示行为完全不变——这里只是补一条磁盘记录，
 * 在此之前这类错误只经 IPC 回传成一句提示，事后什么都查不到。
 */
// 参数签名与 ipcMain.handle 原样对齐（含 any[]）：仓库里大量处理函数不写参数类型，
// 收紧成 unknown[] 会把它们全部打成类型错误——那是签名收紧带来的改动，不属于这次的范围。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleIpc<Result>(channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => Result) {
  ipcMain.handle(channel, async (event, ...args) => {
    breadcrumb('ipc', channel)
    try {
      return await listener(event, ...args)
    } catch (error) {
      logAppError(`ipc ${channel}`, error)
      throw error
    }
  })
}

function registerIpc() {
  const handle = handleIpc
  handle('auth:snapshot', () => authState)
  handle('auth:enter-workspace', (_event, modelId?: number) => {
    if (!store.modelConnections().list().some((connection) => connection.models.some((model) => model.id === modelId)) && !store.listLocalModels().some((model) => model.id === modelId)) {
      throw new Error('请先配置一个可用的模型连接')
    }
    broadcastAuth({ state: 'ready', user: null, backendUrl: null })
    return authState
  })
  handle('model-connections:providers', () => modelConnectionService.providers())
  handle('model-connections:list', () => modelConnectionService.list())
  handle('model-connections:save', (_event, input) => modelConnectionService.save(input))
  handle('model-connections:remove', (_event, id: string) => modelConnectionService.remove(id))
  handle('model-connections:models', (_event, input) => modelConnectionService.models(input))
  handle('model-connections:test', (_event, input) => modelConnectionService.test(input))
  handle('model-connections:start-login', (_event, providerId: string, connectionId?: string) => modelConnectionService.startLogin(providerId, connectionId))
  handle('model-connections:auth-state', (_event, sessionId: string) => modelConnectionService.authState(sessionId))
  handle('model-connections:answer-login', (_event, sessionId: string, value: string) => modelConnectionService.answerLogin(sessionId, value))
  handle('model-connections:cancel-login', (_event, sessionId: string) => modelConnectionService.cancelLogin(sessionId))
  handle('model-connections:logout', (_event, id: string) => modelConnectionService.logout(id))
  handle('app:info', (): AppRuntimeInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: `${process.platform} ${process.arch}`,
    dataRoot: appPaths.dataRoot,
    backendUrl
  }))
  handle('app:restart', async () => {
    return restartApplication({
      confirm: () => confirmInterruptRuns('重启'),
      stop: stopActiveWork,
      markQuitting: () => setQuitting(true),
      relaunch: () => app.relaunch(),
      quit: () => app.quit()
    })
  })
  handle('app:reload', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false
    // 两点：一是在 invoke 处理函数里同步销毁当前文档会和这次调用的回复抢时序，界面可能停在空白页，
    // 所以推到下一个 tick 再导航；二是 webContents.reload() 沿用当前 URL，页面此前若已经加载失败
    // 或崩到错误页，重载只是把失败态原样再放一遍，改走 loadRenderer 回到规范入口并放开重试名额。
    setImmediate(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      rendererRetried = false
      loadRenderer()
    })
    return true
  })
  // 渲染进程报告首屏数据已备齐并绘制过一帧；主窗口在这之前一直是隐藏的。
  handle('startup:ready', () => { revealCoordinator?.markRendererReady() })
  handle('diagnostics:renderer-error', (_event, report: RendererErrorReport) => {
    reportCrash(
      'renderer-error',
      report.afterPaint ? '界面已渲染后发生' : '首屏渲染阶段发生',
      { message: report.message, stack: report.stack ?? null, componentStack: report.componentStack ?? null }
    )
  })
  handle('startup:warnings', (): StartupWarnings => ({
    warnings: [...startupWarnings],
    logPath: join(appPaths?.logsDir ?? app.getPath('logs'), 'startup.log')
  }))
  handle('app:hideToTray', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false
    return hideToTray(mainWindow)
  })
  handle('app:quit', async () => {
    if (!await confirmInterruptRuns('退出')) return false
    stopActiveWork()
    // 绕开「关闭到托盘」，这里是用户显式要求彻底退出。
    setQuitting(true)
    app.quit()
    return true
  })
  handle('storage:info', () => ({
    dataRoot: appPaths.dataRoot,
    databasePath: appPaths.databasePath,
    cacheDir: appPaths.cacheDir,
    logsDir: appPaths.logsDir,
    tempDir: appPaths.tempDir,
    sessionsDir: appPaths.sessionsDir,
    agentDir: appPaths.agentDir,
    skillsDir: appPaths.skillsDir,
    mcpDir: appPaths.mcpDir,
    pluginsDir: appPaths.pluginsDir,
    attachmentsDir: appPaths.attachmentsDir,
    backupsDir: appPaths.backupsDir,
    exportsDir: appPaths.exportsDir,
    defaultRoot: defaultDataRoot(homedir()),
    isDefault: appPaths.dataRoot === defaultDataRoot(homedir())
  }))
  handle('storage:open-data-directory', () => shell.openPath(appPaths.dataRoot))
  handle('storage:open-path', (_event, key: string) => {
    const allowed = new Set(['dataRoot', 'databasePath', 'sessionsDir', 'agentDir', 'skillsDir', 'mcpDir', 'pluginsDir', 'attachmentsDir', 'backupsDir', 'exportsDir', 'cacheDir', 'logsDir', 'tempDir'])
    if (!allowed.has(key)) return '不允许打开该路径'
    return shell.openPath(appPaths[key as keyof AppPaths] as string)
  })
  handle('storage:move-data-directory', async () => {
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, { title: '选择新的 FastAgent 数据目录', properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ title: '选择新的 FastAgent 数据目录', properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return { moved: false, cancelled: true }
    const targetRoot = result.filePaths[0]
    if (targetRoot === appPaths.dataRoot) return { moved: false }
    for (const controller of activeRuns.values()) controller.abort()
    activeRuns.clear()
    settlePendingRequests(new DOMException('数据目录正在迁移', 'AbortError'))
    store.close()
    try {
      moveManagedData(appPaths.dataRoot, targetRoot)
      writeDataRootLocator(appPaths.platformUserDataDir, targetRoot)
      app.relaunch()
      app.exit(0)
      return { moved: true }
    } catch (error) {
      store = new LocalStore(appPaths.databasePath)
      throw error
    }
  })
  handle('preferences:get', () => store.getClientPreferences(preferenceNamespace()))
  handle('preferences:update', (_event, patch) => store.updateClientPreferences(preferenceNamespace(), patch))
  handle('settings:get', () => settings)
  handle('settings:update', (_event, patch: Partial<AppSettings>) => {
    settings = store.updateSettings({ ...settings, ...patch })
    applySettings(settings)
    return settings
  })
  // Shell 偏好：弹系统文件选择器挑 bash.exe，选择后直接写入设置。
  // 默认打开 Git Bash 可能所在的目录，省得用户从「此电脑」一层层点进去。
  handle('settings:pick-bash', async () => {
    const options = {
      title: '选择 bash.exe',
      properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'bash', extensions: ['exe'] }],
      defaultPath: ['ProgramFiles', 'ProgramFiles(x86)']
        .map((key) => process.env[key])
        .filter(Boolean)
        .flatMap((root) => [join(root!, 'Git', 'bin'), root!])
        .find((dir) => existsSync(dir))
    }
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
  // Ctrl+G 外部编辑器：弹系统文件选择器挑编辑器可执行文件，选择后直接写入设置。
  handle('settings:pick-editor', async () => {
    const options = {
      title: '选择编辑器程序',
      properties: ['openFile'] as Array<'openFile'>,
      ...(process.platform === 'win32' ? { filters: [{ name: '可执行文件', extensions: ['exe'] }] } : {})
    }
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
  handle('sandbox:status', (_event, force = false) => sandboxManager.probe(Boolean(force)))
  handle('sandbox:initialize', () => sandboxManager.initialize())
  handle('sandbox:session-info', (): SandboxSessionInfo | null => {
    const session = sandboxManager.activeSession()
    return session ? describeSession(session) : null
  })
  handle('conversation:listDetailed', () => store.listConversationsDetailed(requireNamespace()))
  handle('conversation:listDetailed-page', (_event, query: ConversationPageQuery = {}) => store.listConversationsDetailedPage(requireNamespace(), query, Boolean(query.includeArchived)))
  handle('conversations:stats', (_event, includeArchived = false) => store.conversationStats(requireNamespace(), includeArchived))
  handle('conversation:getInspector', (_event, conversationId: string) => store.getConversationInspector(requireNamespace(), conversationId))
  handle('conversation:updateContextPolicy', (_event, conversationId: string, patch) => store.updateContextPolicy(requireNamespace(), conversationId, patch))
  handle('conversation:compactNow', async (_event, conversationId: string, modelId?: number | null) => {
    const namespace = requireNamespace()
    const credentials = modelId === null || modelId === undefined ? credentialsForConversation(namespace, conversationId) : resolveModelCredentials(modelId)
    const key = `${namespace}:${conversationId}`
    if (activeCompactions.has(key)) throw new CompactionError('COMPACTION_MODEL_ERROR', '当前会话正在压缩')
    return conversationRuns.run(conversationRuntimeKey(namespace, conversationId), () => compactConversation(namespace, conversationId, 'manual', credentials))
  })
  handle('conversation:cancelCompaction', (_event, conversationId: string) => {
    activeCompactions.get(`${requireNamespace()}:${conversationId}`)?.abort()
  })
  handle('conversation:getCompactionHistory', (_event, conversationId: string) => store.listCompactionHistory(requireNamespace(), conversationId))
  // 切换模型后按目标模型重算：各模型的运行时快照与上下文窗口彼此独立。
  handle('conversation:refreshContext', (_event, conversationId: string, modelId: number | null) => {
    const namespace = requireNamespace()
    return refreshContext(namespace, conversationId, contextWindowFor(namespace, conversationId, modelId), modelId)
  })
  handle('conversation:model-usage', (_event, conversationId: string, turnId?: string) => store.getModelUsage(requireNamespace(), conversationId, turnId))
  handle('auth:captcha', async (_event, url: string) => {
    return createApiClient(url).captcha()
  })
  handle('auth:login', async (_event, input) => {
    broadcastAuth({ state: 'authenticating', user: null, backendUrl: input.backendUrl })
    try {
      const nextClient = createApiClient(input.backendUrl)
      const result = await nextClient.login({ ...input, deviceLabel: `FastAgent · ${hostname()}` })
      nextClient.setAccessToken(result.access_token)
      client = nextClient
      const normalizedUrl = input.backendUrl.replace(/\/$/, '')
      const nextUserId = String(result.user.id)
      backendUrl = normalizedUrl
      userId = nextUserId
      refreshToken = result.refresh_token
      enableAutomaticRefresh(nextClient)
      store.saveAccount({ backendUrl: normalizedUrl, userId: nextUserId, refreshToken, username: result.user.username })
      migrateSessionLayout(WORKSPACE_NAMESPACE, sessionUserSegment(LocalStore.namespace(normalizedUrl, nextUserId), result.user.username))
      // 与 restoreSession 同理：登录进来的账户也可能留着上次异常退出的运行。
      // 已在跑的运行必须排除，否则这次登录会把当前任务标成中断。
      store.markInterruptedAgentRuns(WORKSPACE_NAMESPACE, [...activeRuns.keys()])
      const snapshot = { state: 'ready' as const, user: result.user, backendUrl }
      broadcastAuth(snapshot)
      return snapshot
    } catch (error) {
      broadcastAuth({ state: 'signed_out', user: null, backendUrl: input.backendUrl })
      throw error
    }
  })
  handle('auth:lock', async () => { await lockAccount(); return authState })
  handle('auth:logout', async () => {
    try { if (client && refreshToken) await client.logout(refreshToken) } catch { /* 退出必须可用 */ }
    await lockAccount('signed_out')
    return authState
  })
  handle('skills:list', () => skillRegistry.list())
  handle('skills:get', (_event, name: string) => skillRegistry.read(name))
  handle('skills:create', (_event, input) => {
    const record = skillRegistry.create(input)
    store.upsertAbilityMeta({ abilityType: 'skill', abilityId: record.name, source: 'created', version: record.version })
    return record
  })
  handle('skills:update', (_event, name: string, patch) => skillRegistry.update(name, patch))
  handle('skills:set-enabled', (_event, name: string, enabled: boolean) => skillRegistry.setEnabled(name, enabled))
  handle('skills:remove', (_event, name: string) => {
    skillRegistry.remove(name)
    store.removeAbilityMeta('skill', name)
  })
  handle('skills:detail', (_event, name: string): SkillDetail => {
    const detail = skillRegistry.read(name)
    const meta = store.getAbilityMeta('skill', name)
    return {
      ...detail,
      files: skillRegistry.files(name),
      source: meta?.source ?? 'imported',
      pluginId: meta?.pluginId,
      installedAt: meta?.installedAt,
      builtin: meta?.source === 'builtin'
    }
  })
  handle('skills:import', async (_event, options: { format?: 'directory' | 'zip'; onConflict?: 'overwrite' | 'save-as' } = {}) => {
    const zip = options.format === 'zip'
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: zip ? '导入 Skill 压缩包' : '导入 Skill',
      properties: zip ? ['openFile'] : ['openDirectory', 'openFile'],
      filters: zip ? [{ name: 'ZIP 压缩包', extensions: ['zip'] }] : [{ name: 'Skill 文件', extensions: ['md', 'zip'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const record = skillRegistry.importFromPath(result.filePaths[0], { onConflict: options.onConflict })
    store.upsertAbilityMeta({ abilityType: 'skill', abilityId: record.name, source: 'imported', version: record.version })
    return record
  })
  handle('mcp:list', () => store.listMcpServers())
  handle('mcp:save', (_event, input) => {
    const previous = store.getAbilityMeta('mcp', input.id)
    const server = store.saveMcpServer(input)
    // 编辑已安装的市场 Server 时必须保留 plugin_id / version，否则会丢掉「打开能力」与更新检测。
    store.upsertAbilityMeta({
      abilityType: 'mcp',
      abilityId: server.id,
      source: previous?.source ?? 'created',
      pluginId: previous?.pluginId,
      version: previous?.version,
      installedAt: previous?.installedAt
    })
    return server
  })
  handle('mcp:set-enabled', (_event, id: string, enabled: boolean) => store.setMcpServerEnabled(id, enabled))
  handle('mcp:remove', (_event, id: string) => {
    store.removeMcpServer(id)
    store.removeMcpStatus(id)
    store.removeAbilityMeta('mcp', id)
  })
  handle('mcp:test', async (_event, id: string): Promise<McpTestStatus> => {
    const config = store.getMcpRuntimeConfig(id)
    if (!config) throw new Error(`MCP Server 不存在：${id}`)
    const { probeMcpServer } = await loadMcpRuntime()
    const snapshot = recordMcpStatus(id, await probeMcpServer(config))
    return { testedAt: snapshot.testedAt as string, ok: snapshot.state === 'connected', error: snapshot.error, toolCount: snapshot.toolCount, tools: snapshot.tools }
  })
  handle('mcp:test-config', async (_event, input: LocalMcpServerInput): Promise<McpTestStatus> => {
    // 草稿配置只做一次探测，不落库、不写状态缓存。
    const { probeMcpServer } = await loadMcpRuntime()
    const probe = await probeMcpServer(input)
    const secrets = [...Object.values(input.env ?? {}), ...Object.values(input.headers ?? {})]
    const redacted = redactSecrets(probe.error, secrets)
    // 草稿配置不落库，走不到 recordMcpStatus，这里单独记一次。
    if (!probe.ok) logIntegrationError({ service: 'mcp', endpoint: `${input.name || '(草稿)'} (未保存)`, message: redacted ?? '连接失败' })
    return {
      testedAt: new Date().toISOString(),
      ok: probe.ok,
      error: redacted,
      toolCount: probe.tools.length,
      tools: probe.tools.map((tool) => ({ name: tool.name, description: tool.description, annotations: tool.annotations }))
    }
  })
  handle('mcp:status', () => store.listMcpStatus().map(({ serverId, ...snapshot }) => ({
    id: serverId,
    testedAt: snapshot.testedAt ?? '',
    ok: snapshot.state === 'connected',
    error: snapshot.error,
    toolCount: snapshot.toolCount,
    tools: snapshot.tools
  })))
  handle('mcp:detail', (_event, id: string): McpServerDetail => {
    const server = store.listMcpServers().find((item) => item.id === id)
    if (!server) throw new Error(`MCP Server 不存在：${id}`)
    const meta = store.getAbilityMeta('mcp', id)
    const secrets = mcpRuntimeSecrets(id)
    // 只回传 key 与是否有值，密钥值一律不出主进程。
    const describe = (values: Record<string, string> | undefined) =>
      Object.entries(values ?? {}).map(([key, value]) => ({ key, hasValue: Boolean(value?.trim()) }))
    return {
      server,
      connection: store.getMcpStatus(id) ?? emptyConnection(),
      source: meta?.source ?? 'imported',
      pluginId: meta?.pluginId,
      installedAt: meta?.installedAt,
      envKeys: describe(secrets.env),
      headerKeys: describe(secrets.headers)
    }
  })
  handle('mcp:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '导入 MCP Server 配置',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const inputs = parseMcpImport(readFileSync(result.filePaths[0], 'utf8'))
    return inputs.map((input: LocalMcpServerInput) => {
      const server = store.saveMcpServer(input)
      store.upsertAbilityMeta({ abilityType: 'mcp', abilityId: server.id, source: 'imported' })
      return server
    })
  })
  handle('abilities:list', () => listAbilities())
  handle('abilities:list-page', async (_event, query: PageQuery = {}) => {
    const items = await listAbilities()
    const pageSize = normalizePageSize(query.pageSize)
    const page = resolvePage(query.page, items.length, pageSize)
    const offset = pageOffset(page, pageSize)
    return { items: items.slice(offset, offset + pageSize), total: items.length, page, pageSize }
  })
  handle('abilities:get', async (_event, type: AbilityType, id: string) =>
    (await listAbilities()).find((item) => item.type === type && item.id === id) ?? null)
  handle('abilities:set-enabled', async (_event, type: AbilityType, id: string, enabled: boolean) => {
    if (type === 'skill') skillRegistry.setEnabled(id, enabled)
    else store.setMcpServerEnabled(id, enabled)
    return requireAbility(type, id)
  })
  handle('abilities:open-location', async (_event, type: AbilityType, id: string) => {
    const ability = await requireAbility(type, id)
    if (type === 'skill') return shell.openPath((ability as SkillAbility).localPath ?? appPaths.skillsDir)
    return shell.openPath((ability as McpAbility).cwd ?? appPaths.mcpDir)
  })
  handle('plugins:list', async (_event, query: PluginQuery = {}) =>
    pluginInstaller.decorate(searchPlugins(await catalogProvider.list(), query), await listAbilities()))
  handle('plugins:list-page', async (_event, query: PluginQuery = {}) => {
    const items = pluginInstaller.decorate(searchPlugins(await catalogProvider.list(), query), await listAbilities())
    const pageSize = normalizePageSize(query.pageSize)
    const page = resolvePage(query.page, items.length, pageSize)
    const offset = pageOffset(page, pageSize)
    return { items: items.slice(offset, offset + pageSize), total: items.length, page, pageSize }
  })
  handle('plugins:get', async (_event, id: string) => {
    const entry = await pluginInstaller.entry(id)
    return entry ? pluginInstaller.decorate([entry], await listAbilities())[0] : null
  })
  handle('plugins:install', (_event, id: string, config?: Record<string, string>) => pluginInstaller.install(id, config))
  handle('plugins:uninstall', (_event, id: string) => pluginInstaller.uninstall(id))
  handle('plugins:categories', async () => listCategories(await catalogProvider.list()))
  // Hub 与整包的通道单独成模块注册：registerIpc 已经过长，新通道不再往这个闭包里堆。
  registerHubIpc(handle, hubService)
  registerBundleIpc(handle, { bundles: bundleService, mainWindow: () => mainWindow, exportsDir: () => appPaths.exportsDir })
  handle('resources:bootstrap', async () => {
    try {
      if (!client || authState.state !== 'ready') {
        if (authState.state !== 'ready') throw new Error('当前工作区未就绪')
        const models = store.modelConnections().listModels().map((model) => ({
          id: model.id, name: model.name, model_name: model.model_name, model_kind: model.model_kind,
          provider: model.provider, protocol: model.protocol, base_url: model.base_url,
          context_window: model.context_window ?? null, max_tokens: model.max_tokens ?? null,
          supports_thinking: model.supports_thinking, source: 'local' as const,
          connectionId: model.connectionId, authMode: model.authMode
        }))
        return { user: authState.user ?? { id: 'local', username: '本地工作区' }, models, default_model_id: models[0]?.id ?? null, default_thinking_level: null, schema_version: 'desktop-local' }
      }
      const { model_credentials: credentials = [], ...bootstrapped } = await requireClient().bootstrap()
      const sourceNamespace = accountNamespace()
      const modelIdMap = new Map<number, number>()
      if (sourceNamespace) for (const model of bootstrapped.models) modelIdMap.set(model.id, store.workspaceModelId(sourceNamespace, model.id))
      const mappedCredentials = credentials.map((credential) => ({ ...credential, id: modelIdMap.get(credential.id) ?? credential.id }))
      cacheModelCredentials(mappedCredentials)
      // 公开模型列表不带窗口与输出上限，这两项只在凭证里；不补齐的话设置页与上下文面板只能显示默认 128k。
      const data = { ...bootstrapped, default_model_id: bootstrapped.default_model_id === null || bootstrapped.default_model_id === undefined ? bootstrapped.default_model_id : modelIdMap.get(bootstrapped.default_model_id) ?? bootstrapped.default_model_id, models: bootstrapped.models.map((model) => {
        const id = modelIdMap.get(model.id) ?? model.id
        const credential = mappedCredentials.find((item) => item.id === id)
        if (!credential) return { ...model, id }
        return {
          ...model, id,
          context_window: model.context_window ?? credential.context_window ?? null,
          max_tokens: model.max_tokens ?? credential.max_tokens ?? null
        }
      }) }
      if (backendUrl && userId) {
        // 凭证走独立加密表，不进明文的 resource_cache。
        if (mappedCredentials.length) store.saveModelCredentials(LocalStore.namespace(backendUrl, userId), mappedCredentials)
        store.saveResources(backendUrl, userId, data as unknown as Record<string, unknown>)
      }
      return data
    }
    catch (error) {
      if (backendUrl && userId) {
        const cached = store.loadResources(backendUrl, userId)
        if (cached && authState.user && Array.isArray(cached.models)) {
          return { ...cached, user: authState.user, schema_version: 'desktop-cache' }
        }
      }
      if (error instanceof ApiError && error.status === 401) await lockAccount('revoked')
      throw error
    }
  })
  handle('models:localList', () => store.listLocalModels().filter((model) => !model.connectionId))
  handle('models:localCreate', (_event, input: LocalModelInput) => {
    const summary = store.saveLocalModel(null, input)
    modelContextWindows.delete(summary.id)
    return summary
  })
  handle('models:localUpdate', (_event, id: number, input: LocalModelInput) => {
    const summary = store.saveLocalModel(-id, input)
    modelContextWindows.delete(id)
    return summary
  })
  handle('models:localDelete', (_event, id: number) => {
    store.removeLocalModel(-id)
    modelContextWindows.delete(id)
  })
  handle('models:localTest', (_event, id: number) => testLocalModel(id))
  handle('run-states:list', () => {
    const namespace = requireNamespace()
    const states = store.listRunStates(namespace)
    for (const state of states) {
      if (state.status !== 'running') continue
      const conversation = store.getConversation(namespace, state.conversationId)
      const turn = conversation ? store.listTurns(namespace, state.conversationId).find((item) => item.status === 'working') : null
      if (turn?.activity?.execution) {
        const execution = { ...turn.activity.execution, status: 'failed' as const, activeStepId: null, activeEventId: null, activeThinkingId: null, steps: turn.activity.execution.steps.map((step) => step.status === 'running' ? { ...step, status: 'failed' as const } : step), events: turn.activity.execution.events.map((event) => event.status === 'running' ? { ...event, status: 'failed' as const, completedAt: event.completedAt ?? Date.now() } : event) }
        store.updateTurn(namespace, turn.id, { activity: { ...turn.activity, status: 'failed', finishedAt: new Date().toISOString(), execution }, status: 'failed' })
      }
      store.saveRunState(namespace, { ...state, status: 'failed', hasUnreadResult: true, updatedAt: Date.now() })
    }
    return store.listRunStates(namespace)
  })
  handle('run-states:save', (_event, state) => store.saveRunState(requireNamespace(), state))
  handle('run-states:read', (_event, conversationId: string) => store.markRunRead(requireNamespace(), conversationId))

  handle('chat:send', async (_event, input) => {
    const sendStartedAt = Date.now()
    const namespace = requireNamespace()
    if (!store.getConversation(namespace, input.conversationId)) throw new Error('会话不存在')
    const now = new Date().toISOString()
    const runtimeConfig = { modelId: input.modelId ?? null, thinkingLevel: input.thinkingLevel || 'auto', mode: input.mode, permission: input.permission || null, project: store.getConversationRoot(namespace, input.conversationId) }
    const turn = input.turnId
      ? store.updateTurn(namespace, input.turnId, { userMessage: { text: input.prompt, createdAt: now }, attachments: input.attachments || [], runtimeConfig, assistantMessage: null, activity: { status: 'working', startedAt: now, finishedAt: null, events: [] }, status: 'working' })
      : store.createTurn(namespace, input.conversationId, { userMessage: { text: input.prompt, createdAt: now }, attachments: input.attachments || [], runtimeConfig, activity: { status: 'working', startedAt: now, finishedAt: null, events: [] }, status: 'working', createdAt: now })
    if (!turn) throw new Error('会话轮记录不存在')
    // 绑定以实际发出的模型为准：新会话首轮在这里落库，之后重开会话才能还原成同一个模型。
    store.setConversationModelId(namespace, input.conversationId, input.modelId ?? null)
    const runId = randomUUID()
    store.saveRunState(namespace, { conversationId: input.conversationId, projectId: store.getConversation(namespace, input.conversationId)?.projectId ?? null, status: 'running', hasUnreadResult: false, updatedAt: Date.now() })
    const controller = new AbortController()
    activeRuns.set(runId, controller)
    breadcrumb('run', `start ${runId} conv=${input.conversationId} model=${input.modelId ?? 'default'}`)
    const acceptedAt = Date.now()
    console.info('[run-timing]', { runId, conversationId: input.conversationId, turnId: turn.id, phase: 'ack', sendMs: acceptedAt - sendStartedAt })
    // 下一事件循环才进入压缩与运行时初始化，保证 invoke ACK 先回到渲染层。
    setImmediate(() => {
      const credentials = input.modelId === null || input.modelId === undefined ? null : (() => { try { return resolveModelCredentials(input.modelId) } catch { return null } })()
      const scheduled = runScheduler.schedule({
        conversationId: conversationRuntimeKey(namespace, input.conversationId),
        provider: credentials?.provider ?? 'unknown',
        modelId: input.modelId ?? -1
      }, () => conversationRuns.run(conversationRuntimeKey(namespace, input.conversationId), () => runLocalRun(runId, turn.id, input.conversationId, namespace, input.prompt, input.mode, input.modelId, input.thinkingLevel || 'auto', input.permission || null, input.modePrompt || '', Boolean(input.planMode), input.attachments || [], controller.signal, acceptedAt)))
      activeRunCancels.set(runId, scheduled.cancel)
      void scheduled.promise.catch((error) => console.error('[chat:run]', error)).finally(() => activeRunCancels.delete(runId))
    })
    return { runId, turnId: turn.id, turn }
  })
  // 快速对话专用通道：直接调模型接口，不走 pi 运行时，首 token 最快。
  handle('chat:quick-send', async (_event, input: { conversationId: string; prompt: string; modelId: number | null; thinkingLevel: import('../shared/types').ThinkingLevel }) => {
    const sendStartedAt = Date.now()
    const namespace = requireNamespace()
    if (!store.getConversation(namespace, input.conversationId)) throw new Error('会话不存在')
    const now = new Date().toISOString()
    const runtimeConfig = { modelId: input.modelId ?? null, thinkingLevel: input.thinkingLevel || 'auto', mode: 'chat' as const, permission: null }
    const turn = store.createTurn(namespace, input.conversationId, { userMessage: { text: input.prompt, createdAt: now }, attachments: [], runtimeConfig, activity: { status: 'working', startedAt: now, finishedAt: null, events: [] }, status: 'working', createdAt: now })
    const runId = randomUUID()
    store.saveRunState(namespace, { conversationId: input.conversationId, projectId: store.getConversation(namespace, input.conversationId)?.projectId ?? null, status: 'running', hasUnreadResult: false, updatedAt: Date.now() })
    const controller = new AbortController()
    activeRuns.set(runId, controller)
    breadcrumb('run', `quick-start ${runId} conv=${input.conversationId} model=${input.modelId ?? 'default'}`)
    const acceptedAt = Date.now()
    // 下一事件循环才进入执行，保证 invoke ACK 先回到渲染层（与 chat:send 一致）。
    setImmediate(() => {
      const key = conversationRuntimeKey(namespace, input.conversationId)
      const scheduled = runScheduler.schedule({
        conversationId: key,
        provider: 'quick',
        modelId: input.modelId ?? -1
      }, () => conversationRuns.run(key, () => runQuickChat(runId, turn.id, input.conversationId, namespace, input.prompt, input.modelId, input.thinkingLevel || 'auto', controller.signal, acceptedAt)))
      activeRunCancels.set(runId, scheduled.cancel)
      void scheduled.promise.catch((error) => console.error('[chat:quick-run]', error)).finally(() => activeRunCancels.delete(runId))
    })
    console.info('[run-timing]', { runId, conversationId: input.conversationId, turnId: turn.id, phase: 'ack', sendMs: acceptedAt - sendStartedAt })
    return { runId, turnId: turn.id, turn }
  })
  handle('chat:cancel', (_event, runId: string) => {
    breadcrumb('run', `cancel ${runId}`)
    activeRunCancels.get(runId)?.()
    activeRunCancels.delete(runId)
    activeRuns.get(runId)?.abort()
    activeRuns.delete(runId)
  })
  handle('chat:approval-respond', (_event, input: { id: string; decision: ApprovalDecision; answer?: string; runId: string }) => {
    respondPendingApproval(input)
  })
  handle('workspace:pick-root', async () => {
    // 传父窗口，否则无边框窗口下选择框可能弹到主窗口后面，看着像「点了没反应」。
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    // 取消不应该清掉已经打开的工作区。
    if (result.canceled) return null
    workspaceRoot = result.filePaths[0] ?? workspaceRoot
    setGitWatchRoot(workspaceRoot)
    return workspaceRoot
  })
  // 传 null / 空串表示离开工作区：不清掉的话新建的快速对话仍然能 @ 到上一个项目的文件。
  handle('workspace:set-root', (_event, path: string | null) => {
    workspaceRoot = path || null
    setGitWatchRoot(workspaceRoot)
    return workspaceRoot
  })
  handle('workspace:init-project', (_event, options: { force?: boolean } = {}) => {
    if (!workspaceRoot) {
      return { status: 'error', path: '', message: '请先打开一个项目工作区再执行 /init' }
    }
    const existing = detectExistingAgentInitFile(readdirSync(workspaceRoot))
    if (existing && !options.force) {
      return { status: 'exists', path: join(workspaceRoot, existing) }
    }
    const target = join(workspaceRoot, AGENT_INIT_FILE_NAME)
    writeFileSync(target, buildAgentInitTemplate(basename(workspaceRoot)), 'utf8')
    return { status: 'created', path: target }
  })
  handle('projects:list', () => store.listProjects(requireNamespace()))
  handle('projects:list-page', (_event, query: PageQuery = {}) => store.listProjectsPage(requireNamespace(), query, Boolean(query.includeArchived)))
  handle('projects:add', (_event, input: { path: string; name?: string }) => {
    const namespace = requireNamespace()
    const existing = store.getProjectByPath(namespace, input.path)
    const color = existing?.color ?? (store.listProjects(namespace).length % 2 === 0 ? 'calm' : 'tech')
    const project = store.upsertProject(namespace, { id: existing?.id ?? `project-${randomUUID()}`, name: input.name || basename(input.path) || input.path, path: input.path, color })
    const contextFiles = readAgentContextFiles({ projectRoot: input.path }).files
      .filter((file) => file.source === 'project')
      .map((file) => file.name)
    return { ...project, agentContextFiles: contextFiles }
  })
  handle('projects:archive', (_event, id: string) => store.archiveProject(requireNamespace(), id))
  handle('projects:remove', (_event, id: string) => store.removeProject(requireNamespace(), id))
  handle('shell:open-path', (_event, path: string) => shell.openPath(path))
  // Ctrl+G 外部编辑：草稿写入系统临时目录，配置了编辑器就用它打开，否则交给系统默认应用。
  // 窗口重新聚焦时由渲染进程读回回填。
  handle('composer:external-edit-open', (_event, text: string) => {
    const path = draftFilePath()
    createDraft(typeof text === 'string' ? text : '', path)
    if (!launchConfiguredEditor(path, settings.externalEditorPath, () => void shell.openPath(path))) void shell.openPath(path)
    return { path }
  })
  handle('composer:external-edit-read', (_event, path: string) => {
    if (!isDraftPath(path)) return null
    const content = readDraft(path)
    removeDraft(path)
    return content
  })
  handle('workspace:snapshot', (): WorkspaceSnapshot => ({ rootPath: workspaceRoot, changes: [] }))
  handle('git:state', async (): Promise<GitWorkspaceState | null> => {
    if (!workspaceRoot) return null
    try {
      return await resolveGitWorkspaceState(workspaceRoot)
    } catch (error) {
      // 读取失败降级隐藏，并记录日志便于事后排查（git 缺失/仓库损坏/权限等）。
      console.warn('Failed to resolve Git workspace state', error)
      return null
    }
  })
  handle('git:branches', (): Promise<string[]> => {
    if (!workspaceRoot) return Promise.resolve([])
    return listLocalBranches(workspaceRoot)
  })
  handle('git:status', async (): Promise<GitStatusEntry[]> => {
    if (!workspaceRoot) return []
    const result = await execGit(workspaceRoot, ['status', '--porcelain'])
    if (result.code !== 0) return []
    return parsePorcelain(result.stdout)
  })
  handle('git:checkout', async (_event, branch: string) => {
    if (!workspaceRoot) return { ok: false, error: '尚未打开工作区' }
    const result = await checkoutBranch(workspaceRoot, branch)
    if (result.ok) broadcastGitChanged()
    return result
  })
  handle('git:create', async (_event, name: string) => {
    if (!workspaceRoot) return { ok: false, error: '尚未打开工作区' }
    const result = await createBranch(workspaceRoot, name)
    if (result.ok) broadcastGitChanged()
    return result
  })
  handle('quick:hide', () => { hideQuickWindow() })
  handle('workspace:read-file', (_event, path: string) => readWorkspaceFile(workspaceRoot, path))
  handle('workspace:read-image', (_event, path: string) => readWorkspaceImage(workspaceRoot, path))
  handle('workspace:list-directory', (_event, path: string) => listWorkspaceDirectory(workspaceRoot, path))
  handle('workspace:search-files', (_event, query: string) => searchWorkspaceFiles(workspaceRoot, query))
  // 右键菜单「在资源管理器中显示」：解析到绝对路径后定位文件；目录同样选中定位。
  // 空串表示根目录（文件树根节点），解析到工作区根路径本身；resolveWorkspaceFile 拒绝空串，所以根目录单独走 resolveWorkspaceDirectory。
  const resolveWorkspaceAbsolute = (path: string): string =>
    path ? resolveWorkspaceFile(workspaceRoot, path) : resolveWorkspaceDirectory(workspaceRoot, '')
  handle('workspace:reveal', (_event, path: string) => {
    if (!workspaceRoot) return '尚未打开工作区'
    try {
      shell.showItemInFolder(resolveWorkspaceAbsolute(path))
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : '无法定位文件'
    }
  })
  // 右键菜单「复制绝对路径」：与 reveal 同一套解析，空串表示根目录；返回绝对路径字符串供剪贴板写入。
  handle('workspace:absolute-path', (_event, path: string) => {
    if (!workspaceRoot) return '尚未打开工作区'
    try {
      return resolveWorkspaceAbsolute(path)
    } catch (error) {
      return error instanceof Error ? error.message : '无法解析路径'
    }
  })
  // 右键菜单「用本地应用打开」：解析到绝对路径后交给系统默认应用（文件用默认软件，目录开资源管理器窗口）。
  handle('workspace:open-external', async (_event, path: string) => {
    if (!workspaceRoot) return '尚未打开工作区'
    try {
      return await shell.openPath(resolveWorkspaceFile(workspaceRoot, path))
    } catch (error) {
      return error instanceof Error ? error.message : '无法打开'
    }
  })
  // 右键菜单「删除」：路径越界 / 不存在由 deleteWorkspaceEntry 返回错误，不抛异常；
  // 删除成功的文件若已登记为 Artifact，同步移除记录并广播刷新 Artifacts 面板。
  handle('workspace:delete', async (_event, path: string) => {
    const result = await deleteWorkspaceEntry(workspaceRoot, path)
    if (result.ok && workspaceRoot) {
      if (removeArtifactsUnderPath(requireNamespace(), workspaceRoot, path)) mainWindow?.webContents.send('artifacts:changed')
    }
    return result
  })
  // 产物是磁盘文件的登记，文件可能被应用外删掉（资源管理器 / rm / 切分支）。
  // 存在性现算不落库：切回分支文件回来了，条目自己就恢复正常，不需要用户手动收拾。
  handle('artifacts:list', (_event, query: ArtifactQuery = {}) => store.listArtifacts(requireNamespace(), query)
    .map((artifact) => (artifact.path ? { ...artifact, missing: !existsSync(join(artifact.workspaceId, artifact.path)) } : artifact)))
  handle('artifacts:remove', (_event, artifactId: string) => {
    store.removeArtifact(requireNamespace(), artifactId)
    mainWindow?.webContents.send('artifacts:changed')
  })
  // 台账只读：运行与任务由 runLocalRun / executeSubAgent 写入，界面不修改它们。
  handle('agent-runs:list', (_event, conversationId: string, limit?: number) => store.listAgentRunLedger(requireNamespace(), conversationId, limit ?? 20))
  handle('agent-tasks:list', (_event, query: { runId?: string; conversationId?: string; turnId?: string; limit?: number } = {}) => store.listAgentTasks(requireNamespace(), query))
  // 完整性校验要把上百 MB 的二进制全读一遍算 sha256，只在用户主动点「完整性校验」时做。
  handle('runtime:status', (_event, verify?: boolean) => buildRuntimeReport({ installDir: runtimeInstallDir(), verify: Boolean(verify) }))
  handle('runtime:repair', () => {
    applyBundledRuntime(true)
    return buildRuntimeReport({ installDir: runtimeInstallDir(), verify: true })
  })
  handle('doctor:run', async () => {
    const checks = await probeTools(undefined, bundledTools)
    checks.push(...await environmentChecks())
    return buildDoctorReport(checks)
  })
  handle('agent-runs:resumable', (_event, conversationId: string) => {
    const candidate = store.findResumableRun(requireNamespace(), conversationId)
    // 全做完之后才中断的运行没有续跑价值，不给入口
    return candidate && isResumable(candidate) ? candidate : null
  })
  handle('agent-runs:resume-prompt', (_event, runId: string) => {
    const namespace = requireNamespace()
    const run = store.getAgentRun(namespace, runId)
    if (!run || run.status !== 'interrupted') return null
    const candidate = store.findResumableRun(namespace, run.conversationId)
    if (!candidate || candidate.runId !== runId) return null
    return buildResumePrompt({
      goal: candidate.goal,
      reason: candidate.reason,
      todos: store.listTodos(namespace, run.conversationId),
      changedFiles: candidate.changedFiles
    })
  })
  handle('memories:list', (_event, query: MemoryListQuery = {}) => store.listMemories(requireNamespace(), query))
  handle('memories:update', (_event, id: string, patch: MemoryUpdateInput) => {
    const updated = store.updateMemory(requireNamespace(), id, patch)
    mainWindow?.webContents.send('memories:changed')
    return updated
  })
  handle('memories:remove', (_event, id: string) => {
    store.removeMemory(requireNamespace(), id)
    mainWindow?.webContents.send('memories:changed')
  })
  // 清空是物理删除，界面上已有二次确认；scope 缺省表示清掉当前账户的全部记忆。
  handle('memories:clear', (_event, scope?: MemoryScope, scopeId?: string | null) => {
    const removed = store.clearMemories(requireNamespace(), scope, scopeId ?? null)
    mainWindow?.webContents.send('memories:changed')
    return removed
  })
  handle('changes:list', (_event, turnId: string) => store.listFileChanges(requireNamespace(), turnId))
  handle('changes:diff', (_event, turnId: string, path: string) => store.getFileChangeDiff(requireNamespace(), turnId, path))
  // 只放行 http/https：javascript:/file:/data: 交给 shell.openExternal 会直接变成本机代码执行或任意文件打开。
  handle('shell:open-external', async (_event, url: string) => {
    if (!isExternalHttpUrl(url)) return '仅支持打开 http/https 链接'
    try {
      await shell.openExternal(url)
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : '打开链接失败'
    }
  })
  handle('conversations:list', () => store.listConversations(requireNamespace()))
  handle('conversations:list-page', (_event, query: ConversationPageQuery = {}) => store.listConversationsPage(requireNamespace(), query, Boolean(query.includeArchived)))
  handle('conversations:history', (_event, conversationId: string) => store.listTurns(requireNamespace(), conversationId))
  handle('turns:create', (_event, input) => {
    const namespace = requireNamespace()
    return store.createTurn(namespace, input.conversationId, { userMessage: { text: input.prompt, createdAt: input.createdAt }, attachments: input.attachments || [], runtimeConfig: { modelId: input.modelId ?? null, thinkingLevel: input.thinkingLevel || 'auto', mode: input.mode, permission: input.permission || null, project: store.getConversationRoot(namespace, input.conversationId) }, createdAt: input.createdAt })
  })
  handle('turns:update', (_event, turnId: string, patch) => store.updateTurn(requireNamespace(), turnId, patch))
  handle('turns:delete', (_event, turnId: string) => store.deleteTurn(requireNamespace(), turnId))
  handle('turns:restore', (_event, turn: ConversationTurn) => store.restoreTurn(requireNamespace(), turn))
  handle('conversations:listToolCalls', (_event, turnId: string) => store.listToolCalls(requireNamespace(), turnId))
  handle('conversations:listTodos', (_event, conversationId: string) => store.listTodos(requireNamespace(), conversationId))
  handle('conversations:listPermissionRules', () => store.listPermissionRules(requireNamespace()))
  handle('conversations:upsertPermissionRule', (_event, rule: { toolKey: string; pattern: string; action: PermissionAction }) => {
    const namespace = requireNamespace()
    store.upsertPermissionRule(namespace, rule)
    return store.listPermissionRules(namespace)
  })
  handle('conversations:removePermissionRule', (_event, toolKey: string, pattern: string) => store.removePermissionRule(requireNamespace(), toolKey, pattern))
  handle('conversations:listPermissionProfiles', () => mergeProfiles(store.listPermissionProfiles(requireNamespace())))
  handle('conversations:savePermissionProfile', (_event, profile: StoredPermissionProfile) => {
    const namespace = requireNamespace()
    const existing = mergeProfiles(store.listPermissionProfiles(namespace))
    const current = existing.find((item) => item.id === profile.id)
    // 新建档位才做重名与标识校验；改已有档位只要求名称非空。
    if (!current) {
      const error = validateProfileDraft({ id: profile.id, label: profile.label, hint: profile.hint, base: profile.base }, existing)
      if (error) throw new Error(error)
    } else if (!profile.label.trim()) {
      throw new Error('档位名称不能为空')
    }
    store.savePermissionProfile(namespace, {
      id: profile.id,
      label: profile.label.trim(),
      hint: profile.hint.trim(),
      // 内置档的 base 与 builtin 不接受改写，否则出厂规则就找不回来了。
      base: current?.builtin ? (current.base) : profile.base,
      builtin: current?.builtin ?? false,
      overrides: sanitizeOverrides(profile.overrides),
      position: current?.position ?? existing.length
    })
    return mergeProfiles(store.listPermissionProfiles(namespace))
  })
  handle('conversations:removePermissionProfile', (_event, profileId: string) => {
    const namespace = requireNamespace()
    store.removePermissionProfile(namespace, profileId)
    return mergeProfiles(store.listPermissionProfiles(namespace))
  })
  handle('conversations:create', (_event, input: { title: string; projectId?: string | null }) => {
    const namespace = requireNamespace()
    const id = `conversation-${randomUUID()}`
    return store.createConversation(namespace, { id, title: input.title, projectId: input.projectId ?? null })
  })
  handle('conversations:setModel', (_event, conversationId: string, modelId: number | null) => {
    store.setConversationModelId(requireNamespace(), conversationId, modelId)
  })
  handle('chat:set-permission', (_event, runId: string, preset: import('../shared/types').PermissionPreset | null) => {
    // 只对还在跑的 run 生效；已结束的 run 写进去只会变成永不清理的残留。
    if (!activeRuns.has(runId)) return false
    runPermissionOverrides.set(runId, preset)
    breadcrumb('run', `permission ${runId} -> ${preset ?? 'default'}`)
    return true
  })
  // 已有 session 文件时以它所在目录为准：迁移前的老会话仍指向旧布局，按计算值会打开一个空目录。
  handle('conversations:openSessionDirectory', (_event, conversationId: string) => {
    const namespace = requireNamespace()
    const sessionFile = store.getConversationSessionFile(namespace, conversationId)
    const directory = sessionFile ? dirname(sessionFile) : conversationSessionDir(namespace, conversationId)
    mkdirSync(directory, { recursive: true })
    return shell.openPath(directory)
  })
  handle('conversations:rename', (_event, conversationId: string, title: string) => store.renameConversation(requireNamespace(), conversationId, title))
  handle('conversations:archive', (_event, conversationId: string) => store.archiveConversation(requireNamespace(), conversationId))
  handle('conversations:remove', (_event, conversationId: string) => {
    const namespace = requireNamespace()
    store.deleteModelUsage(namespace, conversationId)
    store.removeConversation(namespace, conversationId)
  })
  handle('conversations:clear', (_event, conversationId: string) => {
    const namespace = requireNamespace()
    if (!store.getConversation(namespace, conversationId)) throw new Error('会话不存在')
    const deleted = store.clearConversationTurns(namespace, conversationId)
    // 清空后当前会话的运行时缓存立即失效，下次发送会重建全新上下文。
    void conversationRuntimeCache.invalidate(conversationRuntimeKey(namespace, conversationId))
    return { deleted }
  })
}

/** 移除某个工作区相对路径（及其子路径）上已登记的 Artifact，返回是否删掉了记录。 */
function removeArtifactsUnderPath(namespace: string, workspaceId: string, relative: string): boolean {
  const removed = store.listArtifacts(namespace, { workspaceId })
    .filter((artifact) => artifact.path === relative || (artifact.path ?? '').startsWith(`${relative}/`))
  for (const artifact of removed) store.removeArtifact(namespace, artifact.id)
  return removed.length > 0
}

/** 写文件工具成功时登记 Artifact 并广播面板刷新；工作区外 / 非法路径直接忽略。 */
function registerArtifactForPath(namespace: string, conversationId: string, turnId: string, runId: string, root: string | null, requested: string, source: string | undefined) {
  if (!root) return
  // 工具入参既可能是相对路径也可能是绝对路径（pi 的 write/edit schema 两者都收），
  // 必须用工具链同一套解析：resolveWorkspaceFile 只认相对路径，绝对路径会被它当越界抛掉。
  let resolved: ReturnType<typeof resolveToolPath>
  try {
    resolved = resolveToolPath(requested, root)
  } catch {
    return
  }
  if (resolved.external) return
  // path.relative 在 Windows 给的是 `docs\a.md`，落库必须是 `docs/a.md`，
  // 否则和文件树 / 预览用的相对路径形态对不上，点开就找不到文件。
  const relative = normalizeWorkspaceRelative(resolved.relativePath)
  if (!relative) return
  const name = relative.split('/').pop() || relative
  try {
    // 工具报告改动但文件已不在：补丁删文件的场景。登记一条点不开的产物只会误导，
    // 反过来把旧记录清掉。shell 目标是从命令行静态猜的（可能带 cd 换过目录），
    // 猜错时删掉别人的记录代价太大，只跳过不删。
    if (!existsSync(resolved.absolutePath)) {
      const speculative = source === 'bash' || source === 'powershell'
      if (!speculative && removeArtifactsUnderPath(namespace, root, relative)) mainWindow?.webContents.send('artifacts:changed')
      return
    }
    store.upsertArtifact(namespace, {
      id: createArtifactId(),
      workspaceId: root,
      conversationId,
      // 同一路径在一个会话里只有一条记录，turnId 记的是最近一次写入所属回合。
      turnId,
      agentRunId: runId,
      name,
      type: inferArtifactType(name),
      path: relative,
      size: statSync(resolved.absolutePath).size,
      source: source || 'write'
    })
    mainWindow?.webContents.send('artifacts:changed')
  } catch (error) {
    console.error('[artifact] 登记失败:', error)
  }
}

/**
 * 验证命令按工作区缓存：探测要读四个清单文件，而每轮 run 都会问一次。
 * 清单文件在会话进行中几乎不变，缓存到进程生命周期即可；改了 package.json 需要重开应用，
 * 这个代价远小于每轮四次同步读盘顶在 IPC 前面。
 */
const verificationCache = new Map<string, VerificationCommand[]>()

function verificationCommandsFor(root: string | null): VerificationCommand[] {
  if (!root) return []
  const cached = verificationCache.get(root)
  if (cached) return cached
  try {
    const manifests = readWorkspaceManifests(root)
    const commands = detectVerificationCommands(manifests, manifests.packageManager)
    verificationCache.set(root, commands)
    return commands
  } catch (error) {
    console.error('[verification] 探测验证命令失败:', error)
    return []
  }
}

/**
 * Doctor 里依赖主进程运行时状态的那几项：shell、沙箱、工作区、能力。
 * 与 probeTools 分开，因为它们读的是模块级单例而不是外部可执行文件，没法做成纯函数。
 */
async function environmentChecks(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = []

  const shellName = settings.shellPreference === 'powershell' ? 'powershell' : 'bash'
  if (shellName === 'bash' && process.platform === 'win32') {
    const bashPath = settings.bashPath?.trim()
    const found = bashPath ? existsSync(bashPath) : Boolean(resolveBashPath({ bundledPath: bundledTools.bash }))
    checks.push({
      id: 'shell', label: 'Shell（bash）', category: 'shell',
      status: found ? 'ok' : 'missing',
      detail: found ? (bashPath || (bundledTools.bash ? '使用内置 bash' : '已在 PATH 中找到')) : '未找到 bash',
      ...(found ? {} : { hint: '内置工具链缺失时可安装 Git for Windows，或在设置里改用 PowerShell' })
    })
  } else {
    checks.push({ id: 'shell', label: `Shell（${shellName}）`, category: 'shell', status: 'ok', detail: '可用' })
  }

  try {
    const capabilities = await sandboxManager.probe()
    const ready = capabilities.status === 'ready'
    const enabled = settings.sandbox?.enabled !== false
    checks.push({
      id: 'sandbox', label: 'Agent 沙箱', category: 'sandbox',
      // 沙箱关着就不是问题，只是状态；开着却不可用才要提示
      status: ready ? 'ok' : enabled ? 'error' : 'warn',
      detail: ready ? '已就绪' : capabilities.reason ?? '不可用',
      ...(ready || !enabled ? {} : { hint: '到设置 - 沙箱页执行一次初始化' })
    })
  } catch (error) {
    checks.push({ id: 'sandbox', label: 'Agent 沙箱', category: 'sandbox', status: 'error', detail: error instanceof Error ? error.message : '探测失败' })
  }

  const root = workspaceRoot
  if (!root) {
    checks.push({ id: 'workspace', label: '工作区', category: 'workspace', status: 'warn', detail: '未选择工作区', hint: '在输入框选择一个项目目录后 Agent 才能读写文件' })
  } else if (!existsSync(root)) {
    checks.push({ id: 'workspace', label: '工作区', category: 'workspace', status: 'error', detail: `目录不存在：${root}`, hint: '重新选择工作区目录' })
  } else {
    const git = await resolveGitWorkspaceState(root)
    checks.push({ id: 'workspace', label: '工作区', category: 'workspace', status: 'ok', detail: root })
    checks.push({
      id: 'git-repo', label: 'Git 仓库', category: 'workspace',
      status: git ? 'ok' : 'warn',
      detail: git ? `分支 ${git.branch}` : '当前工作区不是 Git 仓库',
      ...(git ? {} : { hint: '不是仓库时无法展示分支与改动，可在资源面板初始化' })
    })
  }

  try {
    const abilities = await abilitiesService.listAbilities()
    const enabled = abilities.filter((item) => item.enabled).length
    checks.push({ id: 'abilities', label: '已启用能力', category: 'abilities', status: 'ok', detail: `${enabled} / ${abilities.length} 项已启用` })
  } catch (error) {
    checks.push({ id: 'abilities', label: '已启用能力', category: 'abilities', status: 'error', detail: error instanceof Error ? error.message : '读取失败' })
  }

  return checks
}

function executionInputForEvent(event: Omit<AgentEvent, 'runId'>, timestamp: number, current: ReturnType<typeof createExecutionState>): ExecutionInput | null {
  const terminalType = event.type === 'completed' ? 'run_completed' : event.type === 'failed' ? 'run_failed' : event.type === 'cancelled' || event.type === 'interrupted' ? 'run_cancelled' : null
  if (terminalType) return { type: terminalType, timestamp }
  if (event.type === 'token' && current.activeThinkingId) return { type: 'assistant_content_started', eventId: `${current.runId}:assistant-content:${timestamp}`, stepId: current.activeStepId ?? undefined, thinkingId: current.activeThinkingId, timestamp }
  if (event.type === 'thinking_started' || event.type === 'thinking_ended' || event.type === 'tool_started' || event.type === 'tool_result') return { type: event.type, eventId: event.eventId ?? (event.toolCallId ? `tool:${event.toolCallId}` : event.type === 'thinking_started' ? `${current.runId}:thinking:${timestamp}` : event.type === 'thinking_ended' ? current.activeThinkingId ?? undefined : undefined), stepId: event.stepId ?? current.activeStepId ?? undefined, toolCallId: event.toolCallId, thinkingId: event.thinkingId ?? (event.type === 'thinking_started' ? `${current.runId}:thinking:${timestamp}` : event.type === 'thinking_ended' ? current.activeThinkingId ?? undefined : undefined), status: event.status === 'failed' ? 'failed' : event.status === 'cancelled' ? 'cancelled' : event.type === 'tool_result' ? 'completed' : undefined, timestamp }
  return null
}

async function runLocalRun(runId: string, turnId: string, conversationId: string, namespace: string, prompt: string, mode: import('../shared/types').ConversationMode, modelId: number | null, thinkingLevel: import('../shared/types').ThinkingLevel, permission: import('../shared/types').PermissionPreset | null, modePrompt: string, planMode: boolean, attachments: import('../shared/types').Attachment[], signal: AbortSignal, acceptedAt = Date.now()) {  // 主进程累积一份助手文本：渲染进程切走会话后流式状态就没了，只有这份能在
  // 终态时兜底落库。cancelled / failed 以及 completed 不带 text 的分支都靠它。
  let streamedText = ''
  // 思考全文：与回答正文分开累积，只落进 activity.thinking，不参与 textLength 与轨迹切分
  let thinkingText = ''
  // 再按思考轮次切一份：执行轨迹上每个 Thinked 组要能展开自己那一轮，靠全文只有第一个组有内容
  const thinkingSegments: string[] = []
  let sequence = 0
  let execution = createExecutionState(runId, store.listTodos(namespace, conversationId))
  let firstTokenAt: number | null = null
  // 本轮结束后从 Pi 当前有效消息树生成快照；总量用 provider usage，分类按真实 session 消息校准。
  let latestContextMeasurement: ContextMeasurement | undefined
  // 快速对话窗口与主窗口共用同一套会话管线，事件需要双端投递
  const sendEvent = (event: AgentEvent) => {
    mainWindow?.webContents.send('chat:event', event)
    sendQuickWindowEvent('chat:event', event)
  }
  const eventBatcher = createTokenEventBatcher(sendEvent, 16)
  const emit = (event: Omit<AgentEvent, 'runId'>) => {
    const timestamp = Date.now()
    // 分段与执行轨迹的 Thinking 动作一一对应：轨迹每收到一个 thinking_started 就新增一个动作。
    if (event.type === 'thinking_started') thinkingSegments.push('')
    if (event.type === 'thinking' && event.text) {
      if (!thinkingSegments.length) thinkingSegments.push('')
      thinkingSegments[thinkingSegments.length - 1] += event.text
    }
    if (event.type === 'usageUpdated' && event.usageRecord) {
      store.recordModelUsage(namespace, event.usageRecord)
      event.usage = store.getModelUsage(namespace, conversationId, turnId)
    }
    // 四处状态（会话列表 / 台账 / 回合 / activity）统一由 projectRunState 一次算出，调用点不再各自判断。
    const projection = projectRunState(event.type)
    if (projection.runStatus) store.saveRunState(namespace, { conversationId, projectId: store.getConversation(namespace, conversationId)?.projectId ?? null, status: projection.runStatus, hasUnreadResult: projection.hasUnreadResult, updatedAt: timestamp })
    // 非 token 事件携带「此刻已输出的可见正文长度」，执行轨迹按它在正文里切分文本段；
    // token 分支在下方累计 streamedText，进落库分支时已是当前值。
    if (event.type === 'todo_changed' && event.todos) execution = syncExecutionSteps(execution, event.todos)
    const executionInput = executionInputForEvent(event, timestamp, execution)
    if (executionInput) {
      execution = reduceExecutionState(execution, executionInput)
      event.eventId = executionInput.eventId
      event.stepId = executionInput.stepId
      event.thinkingId = executionInput.thinkingId
    }
    const fullEvent: AgentEvent = { runId, conversationId, turnId, timestamp, sequence: ++sequence, elapsedMs: timestamp - acceptedAt, textLength: streamedText.length, ...event, execution }
    // 终态正文以累计的流式全文为准：event.text 只含最后一条 assistant 消息，而 textLength
    // 与轨迹切分都按累计全文计算；完整轨迹与最终回答分开保存，避免执行过程污染最终回答。
    if (streamedText && projection.terminal && projection.terminal !== 'cancelled') fullEvent.transcriptText = streamedText
    // 终态带上思考全文：渲染进程的实时 turn 是自己拼的，拿不到主进程累积值，靠这个补齐
    if (thinkingText && projection.terminal) fullEvent.thinkingText = thinkingText
    if (thinkingSegments.length && projection.terminal) fullEvent.thinkingSegments = [...thinkingSegments]
    // 流式增量只推给渲染进程：逐 token 落库既是每字一次写盘，又让助手文本在
    // messageTokens 之外被 toolTokens 重复计一遍。完整文本由终态事件收尾。
    if (event.type === 'token' || event.type === 'thinking') {
      // 思考正文单独累积：不进 streamedText（不能混入回答），由后续落库分支写进 activity.thinking
      if (event.type === 'thinking' && event.text) thinkingText += event.text
      if (event.type === 'token' && event.text) {
        streamedText += event.text
        if (firstTokenAt === null) {
          firstTokenAt = timestamp
          console.info('[run-timing]', { runId, conversationId, turnId, phase: 'first_token', elapsedMs: timestamp - acceptedAt })
        }
      }
      eventBatcher.emit(fullEvent)
      return
    }
    // 本轮结束后基线快照没用了，留着只会一直占内存。
    if (projection.ledgerStatus) {
      clearRunBaselines(turnId)
      // 台账收尾与 turn 状态同源；finishAgentRun 只认第一次终态，重复调用不会覆盖结局。
      store.finishAgentRun(namespace, runId, projection.ledgerStatus, event.detail ?? null, timestamp, event.errorKind ?? null)
    }
    // 写文件工具成功后主进程登记 Artifact 并广播，Artifacts 面板实时刷新。
    if (event.type === 'file_changed' && event.path) {
      const root = store.getConversationRoot(namespace, conversationId)
      registerArtifactForPath(namespace, conversationId, turnId, runId, root, event.path, event.detail)
    }
    const turn = store.getTurn(namespace, turnId)
    if (turn) {
      const activity = turn.activity ?? { status: 'working' as const, startedAt: turn.createdAt, finishedAt: null, events: [] }
      const write = resolveTurnWrite(projection, { turnStatus: turn.status, activityStatus: activity.status })
      const finalText = projection.terminal ? (fullEvent.text || '') : ''
      store.updateTurn(namespace, turnId, {
        // 事件副本不带 execution：顶层已存一份最新快照，逐条再存一份会让 activity 体积随事件数平方增长。
        activity: { ...activity, status: write.activityStatus, finishedAt: projection.terminal ? new Date().toISOString() : activity.finishedAt, events: [...activity.events, persistableEvent(fullEvent)], thinking: thinkingText || activity.thinking, thinkingSegments: thinkingSegments.length ? [...thinkingSegments] : activity.thinkingSegments, transcript: fullEvent.transcriptText || activity.transcript, execution },
        status: write.turnStatus,
        assistantMessage: finalText ? { text: finalText, createdAt: new Date().toISOString() } : undefined
      }, turn)
    }
    eventBatcher.emit(fullEvent)
  }
  store.startAgentRun(namespace, { runId, conversationId, turnId, mode, startedAt: acceptedAt })
  emit({ type: 'run_started', phase: 'queued', detail: '请求已接收，正在排队', status: 'running' })
  try {
    if (!modelId) throw new Error('未选择可用模型')
    if (signal.aborted) throw new DOMException('已取消', 'AbortError')
    const credentials = resolveModelCredentials(modelId)
    // session 按会话共用，同 provider 换模型直接接着跑，完整历史（含工具调用）都在。
    // 跨 provider 才需要兜底：旧消息不保证能被新 provider 接受，先把既有回合固化为摘要再重开 session。
    const identity = modelRuntimeIdentity(credentials)
    const hasProviderRuntime = store.hasProviderRuntime(namespace, conversationId, identity.provider)
    // 只有换 provider 才要看历史。同 provider 续跑是常态，别为它每次都把整段历史读出来。
    if (!hasProviderRuntime) {
      const turns = store.listTurns(namespace, conversationId)
      const historyBeforeCurrentTurn = turns.filter((turn) => turn.id !== turnId)
      if (historyBeforeCurrentTurn.length && !latestSummaryText(namespace, conversationId)) {
        const switchPolicy = resolvePolicy(settings, store.getContextPolicy(namespace, conversationId), conversationId)
        const canCompact = splitTurns(turns, switchPolicy.keepRecentTurns).compressible.length > 0
        if (canCompact) {
          emit({ type: 'run_phase', phase: 'compacting', detail: '正在为新模型准备会话上下文', status: 'running' })
          const switched = await compactConversation(namespace, conversationId, 'model-switch', credentials)
          if (switched) emit({ type: 'compactionCompleted', context: switched.context, compaction: switched.compaction, detail: '新模型上下文已准备完成', status: 'completed' })
        }
      }
    }
    const context = refreshContext(namespace, conversationId, contextWindowFor(namespace, conversationId, modelId), modelId)
    const policy = resolvePolicy(settings, store.getContextPolicy(namespace, conversationId), conversationId)
    const recordRuntimeCompaction: NonNullable<RuntimeRunOptions['onCompaction']> = (event) => {
      const compaction = store.recordCompaction(namespace, {
        conversationId,
        strategy: policy.strategy,
        triggerReason: `pi-${event.reason}`,
        beforeTokens: event.tokensBefore,
        afterTokens: event.estimatedTokensAfter,
        // Pi 可在应用单个回合内部切分，无法准确映射到应用回合范围。
        coveredTurnStart: null,
        coveredTurnEnd: null,
        summaryId: null,
        durationMs: event.durationMs
      })
      const compactedContext = refreshContext(namespace, conversationId, event.measurement.contextWindow, modelId, event.measurement)
      emit({ type: 'compactionCompleted', context: compactedContext, compaction, detail: '会话内上下文压缩完成', status: 'completed' })
    }
    if (shouldCompact(policy, context)) {
      const canCompactHistory = splitTurns(store.listTurns(namespace, conversationId), policy.keepRecentTurns).compressible.length > 0
      if (canCompactHistory) {
        emit({ type: 'run_phase', phase: 'compacting', detail: '正在压缩较早的会话上下文', status: 'running' })
        const compacted = await compactConversation(namespace, conversationId, 'threshold', credentialsForConversation(namespace, conversationId, modelId))
        if (compacted) emit({ type: 'compactionCompleted', context: compacted.context, compaction: compacted.compaction, detail: '上下文压缩完成', status: 'completed' })
      } else {
        emit({ type: 'run_phase', phase: 'compacting', detail: '上下文主要来自当前长任务，将由会话内压缩处理', status: 'completed' })
      }
    }
    if (signal.aborted) throw new DOMException('已取消', 'AbortError')
    emit({ type: 'run_phase', phase: 'initializing', detail: '正在准备本地运行时', status: 'running' })
    // cwd 只由会话归属决定：未归属会话不得继承界面上「当前打开的工作区」。
    const conversationRoot = store.getConversationRoot(namespace, conversationId)
    const agentContext = mode === 'agent' ? readAgentContextFiles({ projectRoot: conversationRoot }) : { files: [], errors: [] }
    if (agentContext.errors.length) console.warn(`[agent-context] ${agentContext.errors.length} 个指令文件读取失败`)
    const agentContextPrompt = mode === 'agent'
      ? mergeAgentContextFiles(agentContext.files, buildFaDirectoryContext(appPaths))
      : ''
    // Windows 上 WSL stub 会让 bash 工具全线报错：这里先探测可用 bash，
    // 探测不到（或用户显式配置的路径不可用）就整轮降级到 powershell。
    // 记忆召回拼在本轮输入之前，绝不能并进 agentContextPrompt：那份内容参与下面的运行时缓存
    // signature，逐轮变化会让每一轮都重建运行时（重连 MCP、重建沙箱）。
    const memorySettings = settings.memory
    const memoryProjectId = store.getConversation(namespace, conversationId)?.projectId ?? null
    const recalled = memorySettings.enabled
      ? recallMemories(store, { namespace, workspaceId: memoryProjectId, text: prompt, maxRecall: memorySettings.maxRecall })
      : { hits: [], prompt: '' }
    const effectivePrompt = withMemoryPrompt(prompt, recalled.prompt)
    const bashPath = resolveBashPath({ explicitPath: settings.bashPath, bundledPath: bundledTools.bash }) ?? undefined
    const shellToolName = resolveShellToolName(settings.shellPreference, { explicitPath: settings.bashPath, bundledPath: bundledTools.bash })
    let allowedAbilities: Ability[] = []
    let mcpConfigs: ReturnType<LocalStore['listEnabledMcpRuntimeConfigs']> = []
    // skill 与 MCP 两种模式都加载（chat 只有 read/MCP，没有写类工具）；
    // Agent 可见能力统一从策略入口解析。
    allowedAbilities = resolveAgentAbilities(settings.agentAbilityPolicy, await listAbilities())
    const allowedMcpIds = new Set(allowedAbilities.filter((ability) => ability.type === 'mcp').map((ability) => ability.id))
    mcpConfigs = store.listEnabledMcpRuntimeConfigs().filter((config) => allowedMcpIds.has(config.id))
    const signature = createHash('sha256').update(JSON.stringify({
      namespace,
      conversationId,
      conversationRoot,
      mode,
      credentials,
      shellToolName,
      abilities: allowedAbilities.map((ability) => ({ type: ability.type, id: ability.id, enabled: ability.enabled, filePath: 'filePath' in ability ? ability.filePath : undefined })),
      mcpConfigs,
      abilityPolicy: settings.agentAbilityPolicy,
      subAgentEnabled: settings.subAgentEnabled,
      // 自定义角色进的是 subagent 工具描述（即系统提示），改了必须重建运行时，
      // 否则新角色在当前会话里一直不可见。
      subAgents: settings.subAgentEnabled ? normalizeCustomSubAgents(settings.subAgents) : [],
      contextPolicy: policy,
      sandbox: mode === 'agent' ? settings.sandbox : null,
      agentContext: agentContext.files.map((file) => ({ path: file.path, content: file.content, truncated: file.truncated }))
    })).digest('hex')
    const bridge = createApprovalBridge(runId, emit, conversationRoot)
    // 必须定义在本轮作用域：运行时缓存的工厂只在 miss 时执行一次，把它写在工厂里会让
    // 第二轮起的委派继续用首轮的 emit / runId / turnId / signal / bridge。
    // 子运行的 signal 在「用户停止」和「子任务超时」两种情况下都会 abort，
    // 只有父运行的 signal 能区分：与 subagent-scheduler 判定超时的口径保持一致。
    const abortedTaskStatus = () => signal.aborted ? 'cancelled' as const : 'timeout' as const
    const executeSubAgent = async (task: ScheduledSubAgentTask, childSignal: AbortSignal, parentToolCallId: string): Promise<SubAgentResult> => {
      const config = resolveSubAgentConfig(task.agentId, normalizeCustomSubAgents(settings.subAgents))
      if (!config) throw new Error(`未知 Sub-agent：${task.agentId}`)
      const childRunId = randomUUID()
      let output = ''
      let forwarded = 0
      const forwardContext = { taskId: task.taskId, agentId: config.id, agentName: config.name, parentToolCallId, parentRunId: runId, subAgentRunId: childRunId }
      const childRuntimeOptions: RuntimeRunOptions = {
        prompt: `${config.systemPrompt}\n\n${task.task}`,
        mode: 'agent', modePrompt: '', planMode: true, credentials, createModelRuntime: createModelRuntimeForCredentials, thinkingLevel: config.thinkingLevel,
        autoCompaction: false, permission: 'ask', attachments: [], workspaceRoot: conversationRoot,
        signal: childSignal, contextSummary: null, sessionFile: null, agentDir: appPaths.agentDir,
        namespace, conversationId, turnId, runId: childRunId, store, shellToolName, bashPath,
        resolveRuleSet: () => buildRuleSet(namespace, 'ask', false), sessionOverrides: new Map(), requestApproval: bridge.requestApproval,
        requestQuestion: bridge.requestQuestion, mcpBindings: [], sandbox: null,
        subAgentExecution: undefined,
        subAgentMetadata: { parentToolCallId, subAgentId: config.id, subAgentRunId: childRunId },
        customSubAgents: [],
        // 子 Agent 只读：planMode 只挡写文件与 shell，挡不住 todowrite —— 子运行与主运行共用
        // namespace/conversationId，不收窄工具就能覆盖主 Agent 的待办。
        toolAllowlist: config.tools,
        onEvent: (event) => {
          if (event.type === 'token' && event.text) output += event.text
          if (event.type === 'completed' && event.text) output = event.text
          // 逐 token 转发会让每个增量都触发一次整轮 activity 落库与 IPC，主进程直接被顶死。
          const next = forwardSubAgentEvent(event, forwardContext, forwarded)
          if (!next) return
          if (!isSubAgentTerminalEvent(event.type)) forwarded += 1
          emit(next)
        }
      }
      const startedAt = Date.now()
      // 委派落台账：turn.activity 里的 subagent 事件够渲染，但查询、统计与重启后的状态收敛都要靠这张表。
      store.startAgentTask(namespace, {
        taskId: task.taskId, runId, conversationId, turnId, parentToolCallId,
        subAgentRunId: childRunId, agentId: config.id, agentName: config.name,
        goal: task.task.slice(0, 2_000), startedAt
      })
      const { createPiSessionRuntime } = await loadPiRuntime()
      let child: Awaited<ReturnType<typeof createPiSessionRuntime>> | null = null
      try {
        child = await createPiSessionRuntime(childRuntimeOptions)
        await child.run(childRuntimeOptions)
      } catch (error) {
        store.finishAgentTask(namespace, task.taskId, {
          status: childSignal.aborted ? abortedTaskStatus() : 'failed',
          error: error instanceof Error ? error.message : String(error)
        })
        throw error
      } finally {
        await child?.dispose()
      }
      const bounded = truncateSubAgentOutput(output)
      const handoff = parseSubAgentHandoff(bounded.output)
      const status = childSignal.aborted ? abortedTaskStatus() : 'completed' as const
      store.finishAgentTask(namespace, task.taskId, { status, summary: handoff?.goal?.slice(0, 500) ?? null })
      return { taskId: task.taskId, agentId: config.id, agentName: config.name, status, output: bounded.output, handoff, truncated: bounded.truncated, startedAt, finishedAt: Date.now() }
    }
    const cacheKey = conversationRuntimeKey(namespace, conversationId)
    const cached = await conversationRuntimeCache.getWithStatus(cacheKey, signature, async () => {
      let mcpManager: LocalMcpManager | null = null
      let mcpBindings: McpToolBinding[] = []
      let sandboxSession: SandboxSession | null = null
      let pi: PiSessionRuntime | null = null
      const sessionOverrides = new Map<string, ApprovalDecision>()
      try {
        // MCP 两种模式都桥接；沙箱只在 agent 模式创建。
        const [{ LocalMcpManager }, { createPiSessionRuntime }] = await Promise.all([loadMcpRuntime(), loadPiRuntime()])
        mcpManager = new LocalMcpManager(mcpConfigs)
        mcpBindings = await mcpManager.connect()
        for (const diag of mcpManager.diagnostics) {
          recordMcpStatus(diag.serverId, { ok: false, error: diag.error, tools: [], resourceCount: 0, promptCount: 0 })
        }
        if (mode === 'agent') {
          const sandboxPolicy = buildSandboxPolicy(settings.sandbox, conversationRoot)
          try {
            sandboxSession = await sandboxManager.createSession({ workspacePath: conversationRoot, policy: sandboxPolicy, shell: shellToolName })
          } catch (error) {
            const notice = describeSandboxError(error)
            emit(sandboxBlockedEvent(notice))
            throw new Error(notice.title)
          }
          if (sandboxPolicy.enabled && sandboxSession.isolation === 'unsandboxed') emit(sandboxDegradedEvent(SANDBOX_DEGRADED_NOTICE))
        }
        const sessionFile = store.getConversationSessionFile(namespace, conversationId)
        const runtimeOptions: RuntimeRunOptions = {
          prompt: effectivePrompt,
          mode,
          modePrompt,
          planMode,
          credentials,
          createModelRuntime: createModelRuntimeForCredentials,
          thinkingLevel,
          autoCompaction: policy.autoSummary && policy.strategy !== 'disabled',
          permission,
          attachments,
          workspaceRoot: conversationRoot,
          signal,
          // agent 模式才探测：chat 模式没有 shell 工具，给了也用不上
          verificationCommands: mode === 'agent' ? verificationCommandsFor(conversationRoot) : undefined,
          contextSummary: sessionFile ? null : latestSummaryText(namespace, conversationId),
          sessionFile,
          sessionDir: conversationSessionDir(namespace, conversationId),
          agentDir: appPaths.agentDir,
          agentContextPrompt,
          skillPaths: allowedAbilities.filter((ability): ability is SkillAbility => ability.type === 'skill').map((ability) => ability.filePath),
          mcpBindings,
          onSessionFile: (path) => store.setConversationSessionFile(namespace, conversationId, path),
          onEvent: emit,
          onCompaction: recordRuntimeCompaction,
          onRetry: () => store.bumpAgentRunRetry(namespace, runId),
          namespace,
          conversationId,
          turnId,
          runId,
          store,
          shellToolName,
          bashPath,
          resolveRuleSet: () => buildRuleSet(namespace, runPermissionOverrides.get(runId) ?? permission, settings.subAgentEnabled),
          sessionOverrides,
          requestApproval: bridge.requestApproval,
          requestQuestion: bridge.requestQuestion,
          sandbox: sandboxSession ? { manager: sandboxManager, session: sandboxSession } : null,
          subAgentExecution: settings.subAgentEnabled ? { execute: executeSubAgent } : undefined,
          customSubAgents: settings.subAgentEnabled ? normalizeCustomSubAgents(settings.subAgents) : []
        }
        pi = await createPiSessionRuntime(runtimeOptions)
        const cachedRuntime: CachedConversationRuntime = {
          pi,
          mcpManager,
          mcpBindings,
          sandboxSession,
          sessionOverrides,
          async dispose() {
            await pi?.dispose()
            await mcpManager?.close()
            if (sandboxSession) await sandboxManager.destroySession(sandboxSession).catch((error) => console.error('[sandbox] destroySession 失败:', error))
          }
        }
        return cachedRuntime
      } catch (error) {
        await pi?.dispose().catch(() => undefined)
        await mcpManager?.close().catch(() => undefined)
        if (sandboxSession) await sandboxManager.destroySession(sandboxSession).catch(() => undefined)
        throw error
      }
    })
    conversationRuntimeCache.retain(cacheKey)
    emit({ type: 'run_phase', phase: 'initializing', cacheHit: cached.cacheHit, detail: cached.cacheHit ? '已复用会话运行时' : '会话运行时已就绪', status: 'completed' })
    // 运行时创建（MCP 连接、沙箱、扩展加载）耗时期间用户可能已点停止：
    // 此时 signal 已 abort，consumeSession 里的 abort 监听还来不及注册，必须在这里拦截。
    if (signal.aborted) throw new DOMException('已取消', 'AbortError')
    const sessionFile = store.getConversationSessionFile(namespace, conversationId)
    await cached.value.pi.run({
        prompt: effectivePrompt,
        mode,
        modePrompt,
        planMode,
        credentials,
        thinkingLevel,
        autoCompaction: policy.autoSummary && policy.strategy !== 'disabled',
        permission,
        attachments,
        workspaceRoot: conversationRoot,
        signal,
        contextSummary: sessionFile ? null : latestSummaryText(namespace, conversationId),
        sessionFile,
        sessionDir: conversationSessionDir(namespace, conversationId),
        agentDir: appPaths.agentDir,
        agentContextPrompt,
        skillPaths: allowedAbilities.filter((ability): ability is SkillAbility => ability.type === 'skill').map((ability) => ability.filePath),
        mcpBindings: cached.value.mcpBindings,
        onSessionFile: (path) => store.setConversationSessionFile(namespace, conversationId, path),
        onEvent: emit,
        onCompaction: recordRuntimeCompaction,
        onRetry: () => store.bumpAgentRunRetry(namespace, runId),
        namespace,
        conversationId,
        turnId,
        runId,
        store,
        shellToolName,
        bashPath,
        resolveRuleSet: () => buildRuleSet(namespace, runPermissionOverrides.get(runId) ?? permission, settings.subAgentEnabled),
        sessionOverrides: cached.value.sessionOverrides,
        requestApproval: bridge.requestApproval,
        requestQuestion: bridge.requestQuestion,
        sandbox: cached.value.sandboxSession ? { manager: sandboxManager, session: cached.value.sandboxSession } : null,
        // 复用缓存运行时时，subagent 工具从 toolRuntimeRef 现取执行桥与自定义列表：
        // 这两项必须逐轮下发，否则用的还是创建那一轮的闭包。
        subAgentExecution: settings.subAgentEnabled ? { execute: executeSubAgent } : undefined,
        customSubAgents: settings.subAgentEnabled ? normalizeCustomSubAgents(settings.subAgents) : []
      })
      // 压缩会改变有效消息树，必须从 Pi 当前 session 取快照，不能继续复用压缩前 usage。
      latestContextMeasurement = cached.value.pi.getContextMeasurement()
      // 记忆抽取：一次性模型调用，不进会话历史，也不等它完成——用户的回合到此已经结束，
      // 抽取失败只记日志。userText 用原始输入，不能带上这一轮注入的记忆片段。
      if (memorySettings.enabled && memorySettings.autoExtract && !signal.aborted && streamedText.trim()) {
        // 抽取模型可以与会话模型不同（通常挑个更便宜的）。配置的模型已被删除时回落到会话模型，
        // 不因为一条失效配置整轮不抽。
        const extractionCredentials = memorySettings.extractModelId === null
          ? credentials
          : (() => { try { return resolveModelCredentials(memorySettings.extractModelId) } catch { return credentials } })()
        void extractMemories(store, async (extractionPrompt) => {
          const { promptModelOnce } = await loadPiRuntime()
          return promptModelOnce({ credentials: extractionCredentials, prompt: extractionPrompt, agentDir: appPaths.agentDir, createModelRuntime: createModelRuntimeForCredentials })
        }, { namespace, conversationId, turnId, runId, workspaceId: memoryProjectId, userText: prompt, assistantText: streamedText })
          .then((result) => {
            if (result.created.length || result.refreshedIds.length || result.supersededIds.length) mainWindow?.webContents.send('memories:changed')
          })
          .catch((error) => console.error('[memory] 抽取失败:', error))
      }
    if (process.env.FASTAGENT_LEGACY_PLACEHOLDER === '1') {
    requireClient()
    if (signal.aborted) throw new DOMException('已取消', 'AbortError')
    emit({ type: 'failed', detail: 'Pi 运行时适配器将在后端桌面凭据接口就绪后启用。', status: 'failed' })
    }
  } catch (error) {
    const classified = classifyRunError(error)
    if (classified.kind === 'cancelled') emit({ type: 'cancelled', detail: '已取消' })
    else {
      reportModelFailure(modelId, error, Date.now() - acceptedAt)
      emit({ type: 'failed', detail: classified.message, status: 'failed', errorKind: classified.kind })
    }
  } finally {
    breadcrumb('run', `finish ${runId}`)
    await conversationRuntimeCache.release(conversationRuntimeKey(namespace, conversationId))
    activeRuns.delete(runId)
    runPermissionOverrides.delete(runId)
    emit({ type: 'run_phase', phase: 'cleanup', detail: '运行清理完成', status: 'completed' })
    // 一轮结束后重算并广播上下文用量：优先用 pi 会话基于 provider usage 的数字，
    // 而不是本地字符/4 估算，否则界面数字会一直远低于模型后台。
    emit({ type: 'contextUpdated', context: refreshContext(namespace, conversationId, undefined, undefined, latestContextMeasurement) })
    eventBatcher.dispose()
    console.info('[run-timing]', { runId, conversationId, turnId, phase: 'completed', elapsedMs: Date.now() - acceptedAt, firstTokenMs: firstTokenAt === null ? null : firstTokenAt - acceptedAt })
  }
}

/** 快速对话历史参与上下文的回合数上限：直接调接口不做压缩，超出的旧回合直接忽略。 */
const QUICK_HISTORY_TURNS = 20

/**
 * 快速对话执行体：直接调模型接口（runDirectChat），不创建 pi 运行时，
 * 无工具 / MCP / 沙箱 / 权限审批，上下文来自持久会话的最近若干回合。
 */
async function runQuickChat(runId: string, turnId: string, conversationId: string, namespace: string, prompt: string, modelId: number | null, thinkingLevel: import('../shared/types').ThinkingLevel, signal: AbortSignal, acceptedAt = Date.now()) {
  let streamedText = ''
  let thinkingText = ''
  // 与 Agent 路径一致地按思考轮次切分，折叠层展开时每一轮各自成段。
  const thinkingSegments: string[] = []
  let sequence = 0
  let execution = createExecutionState(runId, [])
  let quickContextMeasurement: ContextMeasurement | undefined
  const sendEvent = (event: AgentEvent) => {
    mainWindow?.webContents.send('chat:event', event)
    sendQuickWindowEvent('chat:event', event)
  }
  const eventBatcher = createTokenEventBatcher(sendEvent, 16)
  // 快速对话无工具无压缩，落库只写事件与终态文本；token 不落库（与运行时路径一致）。
  const emit = (event: Omit<AgentEvent, 'runId'>) => {
    const timestamp = Date.now()
    if (event.type === 'thinking_started') thinkingSegments.push('')
    if (event.type === 'thinking' && event.text) {
      if (!thinkingSegments.length) thinkingSegments.push('')
      thinkingSegments[thinkingSegments.length - 1] += event.text
    }
    if (event.type === 'usageUpdated' && event.usageRecord) {
      store.recordModelUsage(namespace, event.usageRecord)
      event.usage = store.getModelUsage(namespace, conversationId, turnId)
    }
    const projection = projectRunState(event.type)
    if (projection.runStatus) store.saveRunState(namespace, { conversationId, projectId: store.getConversation(namespace, conversationId)?.projectId ?? null, status: projection.runStatus, hasUnreadResult: projection.hasUnreadResult, updatedAt: timestamp })
    const executionInput = executionInputForEvent(event, timestamp, execution)
    if (executionInput) {
      execution = reduceExecutionState(execution, executionInput)
      event.eventId = executionInput.eventId
      event.stepId = executionInput.stepId
      event.thinkingId = executionInput.thinkingId
    }
    const fullEvent: AgentEvent = { runId, conversationId, turnId, timestamp, sequence: ++sequence, elapsedMs: timestamp - acceptedAt, textLength: streamedText.length, ...event, execution }
    if (streamedText && projection.terminal && projection.terminal !== 'cancelled') fullEvent.transcriptText = streamedText
    if (thinkingText && projection.terminal) fullEvent.thinkingText = thinkingText
    if (thinkingSegments.length && projection.terminal) fullEvent.thinkingSegments = [...thinkingSegments]
    if (event.type === 'token' || event.type === 'thinking') { eventBatcher.emit(fullEvent); return }
    // 快速对话同样结算台账：不写的话进程被 kill 后这些 run 永远停在 running，
    // markInterruptedAgentRuns 也看不到它们。
    if (projection.ledgerStatus) store.finishAgentRun(namespace, runId, projection.ledgerStatus, event.detail ?? null, timestamp, event.errorKind ?? null)
    const turn = store.getTurn(namespace, turnId)
    if (turn) {
      const activity = turn.activity ?? { status: 'working' as const, startedAt: turn.createdAt, finishedAt: null, events: [] }
      const write = resolveTurnWrite(projection, { turnStatus: turn.status, activityStatus: activity.status })
      const finalText = projection.terminal ? (fullEvent.text || '') : ''
      store.updateTurn(namespace, turnId, {
        // 事件副本不带 execution：顶层已存一份最新快照，逐条再存一份会让 activity 体积随事件数平方增长。
        activity: { ...activity, status: write.activityStatus, finishedAt: projection.terminal ? new Date().toISOString() : activity.finishedAt, events: [...activity.events, persistableEvent(fullEvent)], thinking: thinkingText || activity.thinking, thinkingSegments: thinkingSegments.length ? [...thinkingSegments] : activity.thinkingSegments, transcript: fullEvent.transcriptText || activity.transcript, execution },
        status: write.turnStatus,
        assistantMessage: finalText ? { text: finalText, createdAt: new Date().toISOString() } : undefined
      }, turn)
    }
    eventBatcher.emit(fullEvent)
  }
  store.startAgentRun(namespace, { runId, conversationId, turnId, mode: 'chat', startedAt: acceptedAt })
  emit({ type: 'run_started', phase: 'queued', detail: '请求已接收', status: 'running' })
  try {
    if (!modelId) throw new Error('未选择可用模型')
    if (signal.aborted) throw new DOMException('已取消', 'AbortError')
    const credentials = resolveModelCredentials(modelId)
    // 只取已完成的回合拼上下文：当前 turn 刚建只有用户消息，过滤掉；无回复的失败回合跳过。
    const priorTurns = store.listTurns(namespace, conversationId)
      .filter((turn) => turn.id !== turnId)
      .slice(-QUICK_HISTORY_TURNS)
    const history = priorTurns.flatMap((turn) => turn.assistantMessage
      ? [{ role: 'user' as const, text: turn.userMessage.text }, { role: 'assistant' as const, text: turn.assistantMessage.text }]
      : [{ role: 'user' as const, text: turn.userMessage.text }])
    emit({ type: 'run_phase', phase: 'initializing', detail: '正在连接模型', status: 'running' })
    const { runDirectChat, classifyRunOutcome } = await loadPiRuntime()
    const result = await runDirectChat({
      prompt,
      credentials,
      thinkingLevel,
      history,
      signal,
      createModelRuntime: createModelRuntimeForCredentials,
      onToken: (text) => { streamedText += text; emit({ type: 'token', text }) },
      onThinking: (text) => { thinkingText += text; emit({ type: 'thinking', text }) }
    })
    const usageRecord = result.usage
      ? normalizeModelUsage(
          { role: 'assistant', usage: result.usage, stopReason: result.stopReason, timestamp: Date.now() },
          { conversationId, turnId, runId, modelId, provider: credentials.provider, modelName: credentials.model_name, baseUrl: credentials.base_url },
          `${runId}:direct`
        )
      : null
    if (usageRecord) emit({ type: 'usageUpdated', usageRecord: { ...usageRecord, status: result.stopReason === 'error' ? 'failed' : result.stopReason === 'aborted' ? 'cancelled' : 'completed' } })
    quickContextMeasurement = contextMeter.measure({
      modelId,
      provider: credentials.provider,
      contextWindow: credentials.context_window || 128_000,
      turns: [...priorTurns.map((turn) => ({ user: turn.userMessage.text, assistant: turn.assistantMessage?.text })), { user: prompt, assistant: result.text }],
      usage: result.usageTokens === null ? undefined : { inputTokens: result.usageTokens }
    })
    if (result.stopReason === 'length') {
      const outcome = classifyRunOutcome({ content: [{ type: 'text', text: result.text }], stopReason: result.stopReason, usage: result.usage }, { contextWindow: credentials.context_window || 128_000, maxTokens: credentials.max_tokens || 8_192 })
      emit({ type: 'interrupted', text: result.text, detail: outcome.reason, status: 'interrupted' })
    } else emit({ type: 'completed', text: result.text, detail: '回答完成', status: 'completed' })
  } catch (error) {
    const classified = classifyRunError(error)
    if (classified.kind === 'cancelled') emit({ type: 'cancelled', detail: '已取消' })
    else {
      reportModelFailure(modelId, error, Date.now() - acceptedAt)
      emit({ type: 'failed', detail: classified.message, status: 'failed', errorKind: classified.kind })
    }
  } finally {
    breadcrumb('run', `quick-finish ${runId}`)
    activeRuns.delete(runId)
    emit({ type: 'contextUpdated', context: refreshContext(namespace, conversationId, undefined, modelId, quickContextMeasurement) })
    eventBatcher.dispose()
    console.info('[run-timing]', { runId, conversationId, turnId, phase: 'quick-completed', elapsedMs: Date.now() - acceptedAt })
  }
}

async function restoreSession() {
  const account = store.getLatestAccount()
  if (!account) return
  try {
    const nextClient = createApiClient(account.backendUrl)
    const pair = await nextClient.refresh(account.refreshToken!)
    nextClient.setAccessToken(pair.access_token)
    const user = await nextClient.me()
    client = nextClient
    backendUrl = account.backendUrl
    userId = account.userId
    refreshToken = pair.refresh_token
    enableAutomaticRefresh(nextClient)
    store.saveAccount({ backendUrl, userId, refreshToken, username: user.username })
    migrateSessionLayout(WORKSPACE_NAMESPACE, sessionUserSegment(LocalStore.namespace(backendUrl, userId), user.username))
    // 上个进程异常退出留下的 run/task 会永远停在 running，登录恢复时一次性收敛成「已中断」。
    // 此刻本进程还没有任何运行，不需要排除活跃 runId。
    const interrupted = store.markInterruptedAgentRuns(WORKSPACE_NAMESPACE)
    if (interrupted) console.info('[agent-ledger]', { interruptedRuns: interrupted })
    broadcastAuth({ state: 'ready', user, backendUrl })
  } catch {
    await lockAccount('revoked')
  }
}

Menu.setApplicationMenu(null)

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  // 重启时新进程可能先于旧进程退出而拿不到锁；旧进程此刻若已销毁窗口，要重新建一个，
  // 否则用户会看到「重启后什么都没有」。
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) showWindow(mainWindow)
    else if (app.isReady()) createWindow()
  })
}

app.whenReady().then(async () => {
  // Windows 任务栏按钮按 AUMID 归组并取图标，未设置时显示空白图标。
  if (process.platform === 'win32') app.setAppUserModelId('com.fastagent.desktop')
  // 日志优先落在安装目录，用户能在自己装程序的地方直接找到；装到 Program Files 这种
  // 不可写的位置时自动回落，回落原因会写进崩溃报告头部。必须最先做——后面每一步都可能报错。
  const logLocation = initLogging({
    packaged: app.isPackaged,
    execPath: app.getPath('exe'),
    projectRoot: app.getAppPath(),
    userDataLogs: app.getPath('logs')
  })
  installCrashHandlers()
  appPaths = resolveAppPaths({
    home: homedir(),
    userData: app.getPath('userData'),
    cache: app.getPath('sessionData'),
    logs: logLocation.dir,
    temp: app.getPath('temp')
  })
  // pi 的工具管理器（rg / fd 的解析与下载）只认全局 agentDir，默认是 ~/.pi/agent：
  // 既不在 FastAgent 数据根下，又在沙箱 strict 模式里整个 home 被 denyRead。
  // 指到自己的 agentDir 后，内置二进制才落在受控且沙箱可授权的目录里。
  process.env.PI_CODING_AGENT_DIR = appPaths.agentDir
  // 尽早开窗：下面几步是同步的，会把主进程阻塞住，而启动页在自己的渲染进程里照常动。
  // 此刻还读不到设置，所以先建不显示，等主题和「启动时是否显示窗口」定下来再决定露不露。
  createSplashWindow()
  pushStartupPhase('config')
  scheduleVerbosityRefresh()
  // 本地数据初始化整体兜底：任一步抛出都不能吞掉窗口创建，
  // 否则表现是「进程活着但没有界面」，用户看到的就是重启后白屏 / 点托盘无反应。
  try {
    migrateLegacyData(appPaths)
    writeDataRootLocator(appPaths.platformUserDataDir, appPaths.dataRoot)
    store = new LocalStore(appPaths.databasePath)
    modelConnectionService = new ModelConnectionService(store.modelConnections())
    skillRegistry = new LocalSkillRegistry(appPaths.skillsDir, store)
    pluginInstaller = new PluginInstaller(catalogProvider, skillRegistry, store)
  } catch (error) {
    logStartup('本地数据初始化失败', error)
  }
  // 内置工具链：安装到数据根下的 runtime，运行期只依赖 .fa，与安装目录无关。
  // 失败只是回落到 pi 的联网下载与系统 PATH，不该拦住启动。
  try {
    applyBundledRuntime()
  } catch (error) {
    logStartup('内置工具链安装失败', error)
  }
  try {
    settings = { ...defaultSettings, ...store.getSettings() }
  } catch (error) {
    settings = { ...defaultSettings }
    logStartup('读取设置失败', error)
  }
  applySettings(settings)
  // 到这一步主题和「启动时是否显示窗口」才有定论，启动页显示与否只能推到这里判。
  if (settings.showOnStartup === false) destroySplashWindow()
  else showSplashWindow(resolvedDarkMode() ? 'dark' : 'light')
  pushStartupPhase('abilities')
  sandboxManager = new SandboxManager(new WindowsSandboxProvider(
    resolveSandboxPaths({
      resourcesPath: process.resourcesPath,
      projectRoot: app.getAppPath(),
      packaged: app.isPackaged,
      programData: process.env.ProgramData || 'C:\\ProgramData',
      // 内置工具链装在数据根下，沙箱账户默认读不到，建会话时按只读+执行授权一次
      runtimePath: runtimeInstallDir()
    }),
    undefined,
    undefined,
    undefined,
    { onNotice: (message) => logStartup('sandbox-runtime', message) }
  ))
  try {
    registerIpc()
  } catch (error) {
    logStartup('注册 IPC 失败', error)
  }
  // 必须赶在 createWindow 之前定态：本地有账号时启动要等一次网络续期，这段时间既不是已登录
  // 也不是未登录。留着默认的 signed_out，渲染进程首帧就会画出登录界面，等续期回来再跳走，
  // 用户看到的就是一闪而过的登录页。
  try {
    if (store.getLatestAccount()) authState = { state: 'restoring', user: null, backendUrl: null }
  } catch (error) {
    logStartup('读取本地账号失败', error)
  }
  pushStartupPhase('interface')
  createWindow()
  scheduleDeferredStartupTasks()
  if (mainWindow) createTray(mainWindow, () => mainWindow?.webContents.send('tray:new-conversation'))
  // fatal 已经进了 startupWarnings，由主界面的提示条呈现。
  // 这里不能弹模态框：showErrorBox 是阻塞的，正好卡在启动链路上，启动页会当场僵住。
  app.on('activate', () => { if (mainWindow) showWindow(mainWindow); else createWindow() })
  pushStartupPhase('workspace')
  try {
    await restoreSession()
  } catch (error) {
    logStartup('恢复登录状态失败', error)
  } finally {
    // 状态不能停在 restoring，否则界面一直卡在启动屏，连登录入口都进不去
    if (authState.state === 'restoring') broadcastAuth({ state: 'signed_out', user: null, backendUrl: null })
  }
}).catch((error) => {
  logStartup('主进程启动失败', error)
  // 走到这里说明连窗口都没建起来，启动页留着只会是个动不了的壳。
  destroySplashWindow()
  dialog.showErrorBox('FastAgent 无法启动', error instanceof Error ? error.message : String(error))
})

app.on('window-all-closed', () => { /* 托盘模式下保持后台运行 */ })
app.on('before-quit', () => {
  // 退出清理里任何一步抛出都会让进程卡住不退，下一次启动又被单实例锁挡住，
  // 于是表现成「重启后没反应」。逐步隔离，保证一定能退干净。
  setQuitting(true)
  try { clearStartupTimers(); destroySplashWindow() } catch (error) { logStartup('清理启动页失败', error) }
  try { settlePendingRequests(new DOMException('窗口已关闭', 'AbortError')) } catch (error) { logStartup('结算挂起请求失败', error) }
  try { void sandboxManager?.destroyAll() } catch (error) { logStartup('清理沙箱会话失败', error) }
  try { destroyTray() } catch (error) { logStartup('销毁托盘失败', error) }
  try {
    if (doubleCtrlHook) { doubleCtrlHook.stop(); doubleCtrlHook = null }
    unregisterAllGlobalShortcuts(globalShortcut, settings.shortcuts)
    if (globalMouseHook) { globalMouseHook.stop(); globalMouseHook = null; releaseUiohook() }
  } catch (error) { logStartup('清理全局快捷键失败', error) }
  try { modelConnectionService?.dispose() } catch (error) { logStartup('清理模型连接失败', error) }
  try { store?.close() } catch (error) { logStartup('关闭数据库失败', error) }
})
