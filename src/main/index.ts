import { DEFAULT_KNOWLEDGE_SETTINGS } from '../shared/knowledge-settings'
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeTheme, session, shell } from 'electron'
import { EnvHttpProxyAgent, ProxyAgent, setGlobalDispatcher } from 'undici'
import { applyOutboundProxy } from './network-proxy'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { ApiClient, ApiError } from './api-client'
import { extractDialogueReply } from './model-dialogue'
import { createAbilitiesService } from './abilities-service'
import { settlePendingRequests } from './approval-bridge'
import { cancelAllShellCommands } from './shell-command'
import { buildEffectiveRules } from './agent/permission/effective-rules'
import { LocalStore } from './local-store'
import { ModelConnectionService } from './model-connections'
import { WORKSPACE_NAMESPACE } from './local-store/shared-workspace'
import { migrateConversationSessions } from './session-layout-migration'
import { conversationSessionDir as conversationSessionPath, sessionUserSegment } from './session-paths'
import type { PiSessionRuntime, SessionCompactionOutcome } from './pi-runtime'
import { estimateTokens, heuristicSummary, piCompactionSettings, piForcedCompactionSettings, projectCompactedState, resolvePolicy, splitTurns, turnsAfterCoveredTurn } from './context-manager'
import { ContextMeter, type ContextMeasurement } from './context-meter'
import { createTray, destroyTray, handleWindowClose, isQuitting, setQuitting, setTrayClosePolicy, showWindow } from './tray'
import { startDoubleCtrlHook, type DoubleCtrlHook } from './double-key'
import { applyGlobalShortcuts, hasGlobalMouseBinding, startGlobalMouseShortcuts, unregisterAllGlobalShortcuts, type GlobalMouseHook, type MouseHookSource } from './global-shortcuts'
import { acquireUiohook, releaseUiohook } from './hook-lifecycle'
import { hideQuickWindow, showQuickWindow } from './quick-window'
import { createSplashWindow, destroySplashWindow, dismissSplashWindow, showSplashWindow, updateSplashWindow } from './splash-window'
import { createRevealCoordinator, splashUpdate, SPLASH_SLOW_DELAY_MS, SPLASH_STATUS_DELAY_MS, type RevealCoordinator, type RevealReason } from './startup-progress'
import { breadcrumb, initLogging, logAppError, logIntegrationError, writeCrashReport, type CrashKind } from './logging/logger'
import { TerminalManager } from './terminal/pty-manager'
import { spawnPty } from './terminal/node-pty'
import { defaultShell } from './terminal/shell'
import type { CrashProcessMetric, CrashRuntimeInfo } from './logging/crash-report'
import { appIcon } from './app-icon'
import { migrateLegacyData, sweepMigrationResidue } from './data-migration'
import { createDailyBackup, pruneBackups } from './backup-service'
import { healAgentSettings, resolveAppPaths, writeDataRootLocator, type AppPaths } from './app-paths'
import { LocalSkillRegistry } from './skill-registry'
import type { LocalMcpManager, McpToolBinding } from './mcp-manager'
import { BuiltinCatalogProvider } from './plugins/catalog'
import { PluginInstaller } from './plugins/installer'
import { createHubService } from './hub/hub-service'
import { createBundleService } from './bundle/bundle-service'
import { registerAllIpc } from './ipc'
import type { MainContext } from './app-context'
import { redactSecrets } from './secret-redaction'
import { DEFAULT_ATTACHMENT_POLICY } from '../shared/attachment-policy'
import { canvasColor } from '../shared/surface-level'
import { DEFAULT_RUN_LIMITS } from './local-store/row-mappers'
import { watchGitMetadata } from './git'
import { CompactionError } from './compaction-error'
import { runLocalRun as runLocalRunWith } from './run/local-run'
import { runQuickChat as runQuickChatWith } from './run/quick-chat'
import type { RunContext } from './run/context'
import { registerArtifactForPath as registerArtifact, removeArtifactsUnderPath as removeArtifacts } from './artifact-registry'
import { environmentChecks as runEnvironmentChecks } from './doctor-environment'
import { isExternalHttpUrl } from '../renderer/ai-response/sanitize-url'
import type { AppRuntimeInfo, AppSettings, ApprovalDecision, AuthSnapshot, ContextStrategy, KbSource, LocalModelTestResult, ModelCredentials, PermissionPreset, StartupPhase, StartupWarning } from '../shared/types'
import type { PermissionRuleSet } from '../shared/permission-rules'
import { findProfile, mergeProfiles } from '../shared/permission-profiles'
import { DEFAULT_CONTEXT_WINDOW, resolveContextWindow } from '../shared/model-context-windows'
import { applyOverride, overrideKey } from '../shared/model-parameters'
import { defaultSandboxSettings, normalizeSandboxSettings } from '../shared/sandbox'
import { DEFAULT_SHELL_COMMAND_SETTINGS } from '../shared/shell-command'
import { SandboxManager } from './agent/sandbox/sandbox-manager'
import { SUBAGENT_LIMITS } from './agent/subagent/subagent-types'
import { resolveSandboxPaths, WindowsSandboxProvider } from './agent/sandbox/providers/windows-native/windows-sandbox-provider'
import { installBundledRuntime, prependPathEntries, resolveBundledRuntimeSource, resolveRuntimeInstallDir } from './runtime/bundled-tools'
import type { SandboxSession } from './agent/sandbox/sandbox-types'
import { ConversationRunCoordinator, ConversationRuntimeCache } from './conversation-runtime-cache'
import { RunScheduler } from './run-scheduler'
import { RateLimitMonitor } from './rate-limit-monitor'
import { installRateLimitTap, withRateLimitTap } from './rate-limit-dispatcher'
import { attributeRateLimits } from './rate-limit-attribution'
import { createLazyModuleLoader } from './lazy-module'
import { PauseGate } from './agent/pause-gate'
import { indexSource } from './knowledge/kb-indexer'
import { DEFAULT_RECALL } from './agent/memory/memory-rank'
import { relocateArtifactsUnderPath } from './artifact-registry'
import { PreviewService, registerPreviewScheme } from './preview/preview-service'
import { PreviewRootRegistry } from './preview/preview-files'

const loadPiRuntime = createLazyModuleLoader(() => import('./pi-runtime'))
const loadMcpRuntime = createLazyModuleLoader(() => import('./mcp-manager'))
// pdfjs 体量大且只有导入 PDF 时用得上，与运行时模块一样按需加载。
const loadPdfText = createLazyModuleLoader(() => import('./knowledge/pdf-text'))

/** Artifact 登记的依赖注入点：面板刷新广播只有主窗口知道。 */
const artifactRegistry = { get store() { return store }, notifyChanged: () => mainWindow?.webContents.send('artifacts:changed') }

/**
 * 订阅额度监听。包一层全局 fetch 只读响应头，不额外发请求——多打一次厂商接口就多扣一次额度。
 * 安装放在模块级：pi 运行时是懒加载的，等它加载完再装会漏掉第一次模型调用。
 */
const rateLimitMonitor = new RateLimitMonitor()
rateLimitMonitor.install()
installRateLimitTap(rateLimitMonitor)
rateLimitMonitor.onChange(() => {
  // 连接服务尚未就绪（启动早期）时静默跳过，下一次模型请求会再推一遍
  void Promise.resolve()
    .then(() => modelConnectionService?.list())
    .then((connections) => {
      if (!connections) return
      mainWindow?.webContents.send('usage:limits-changed', attributeRateLimits(rateLimitMonitor.list(), connections))
    })
    .catch(() => undefined)
})

function removeArtifactsUnderPath(namespace: string, workspaceId: string, relative: string): boolean {
  return removeArtifacts(store, namespace, workspaceId, relative)
}

function registerArtifactForPath(namespace: string, conversationId: string, turnId: string, runId: string, root: string | null, requested: string, source: string | undefined) {
  registerArtifact(artifactRegistry, namespace, conversationId, turnId, runId, root, requested, source)
}

function environmentChecks() {
  return runEnvironmentChecks({ settings, bundledTools, sandboxManager, workspaceRoot, listAbilities: () => abilitiesService.listAbilities() })
}

/** 索引一个知识来源；PDF 解析在这里注入，kb-indexer 本身不依赖 pdfjs。 */
async function runKbIndex(namespace: string, source: KbSource) {
  return indexSource(store.knowledgeBase, namespace, source, {
    extractPdfPages: async (data) => (await loadPdfText()).extractPdfPages(data)
  })
}

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
/** 活跃 run 的归属信息：界面重载后要靠它接回运行，也用来挡同一会话的第二个 run。 */
interface ActiveRun {
  controller: AbortController
  namespace: string
  conversationId: string
  turnId: string
}
const activeRuns = new Map<string, ActiveRun>()

/** 同一账户下该会话是否已有 run 在跑。 */
function hasActiveRun(namespace: string, conversationId: string): boolean {
  for (const run of activeRuns.values()) {
    if (run.namespace === namespace && run.conversationId === conversationId) return true
  }
  return false
}

function liveRunConversationIds(namespace: string): Set<string> {
  const ids = new Set<string>()
  for (const run of activeRuns.values()) {
    if (run.namespace === namespace) ids.add(run.conversationId)
  }
  return ids
}
let settings: AppSettings
/** 随包工具名 → 绝对路径；启动时同步一次，doctor 用它按真实路径探测（内置工具不在 PATH 上）。 */
let bundledTools: Record<string, string> = {}
const catalogProvider = new BuiltinCatalogProvider()
let pluginInstaller: PluginInstaller
let sandboxManager: SandboxManager
/**
 * 页面预览。协议主机名只能反查到这里列出的根：当前工作区、快速对话目录与已登记的项目，
 * 外加运行时显式登记过的 cwd；渲染进程借协议读不到这些根之外的任何文件。
 */
const previewService = new PreviewService({
  roots: new PreviewRootRegistry(() => {
    const namespace = preferenceNamespace()
    let projects: string[] = []
    try {
      projects = store && namespace ? store.listProjects(namespace).map((project) => project.path) : []
    } catch {
      // 库还没就绪或已关闭：只按当前工作区与快速对话目录反查。
    }
    return [workspaceRoot, appPaths?.quickWorkspaceDir, ...projects]
  }),
  screenshotDir: (conversationId) => join(appPaths.attachmentsDir, conversationId, 'previews'),
  // 开发态界面跑在 Vite 上；那个地址是 FastAgent 自己，不许被当成预览目标。
  blockedOrigins: () => process.env.ELECTRON_RENDERER_URL ? [process.env.ELECTRON_RENDERER_URL] : [],
  send: (channel, payload) => mainWindow?.webContents.send(channel, payload)
})
/**
 * 内嵌终端的 pty 会话。活得比面板长：面板关掉、界面重载都不结束 shell，
 * 用户再打开时看到的还是原来那个进程和它的历史输出。
 */
const terminalManager = new TerminalManager({
  spawn: spawnPty,
  resolveShell: () => defaultShell({
    platform: process.platform,
    env: process.env,
    prefer: settings.shellPreference,
    bashPath: settings.bashPath || bundledTools.bash || null
  }),
  defaultCwd: () => workspaceRoot || homedir(),
  env: () => process.env,
  onData: (chunk) => mainWindow?.webContents.send('terminal:data', chunk),
  onExit: (event) => mainWindow?.webContents.send('terminal:exit', event)
})
const conversationRuns = new ConversationRunCoordinator()
// 不同会话并行，同一会话仍由 conversationRuns 保证 Pi session 顺序。
const runScheduler = new RunScheduler({ maxConcurrent: 4 })
const activeRunCancels = new Map<string, () => void>()
/** 运行级暂停闸门；只在有人真的按过暂停时才建。 */
const runPauseGates = new Map<string, PauseGate>()
const activeCompactions = new Map<string, AbortController>()

interface CachedConversationRuntime {
  pi: PiSessionRuntime
  mcpManager: LocalMcpManager | null
  mcpBindings: McpToolBinding[]
  sandboxSession: SandboxSession | null
  sessionOverrides: Map<string, ApprovalDecision>
  setAbilityUsageSink(sink: ((type: 'skill' | 'mcp', id: string) => void) | null): void
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
  const merged = buildEffectiveRules(profile, store.listPermissionRules(namespace))
  merged.subagent = [{ pattern: '*', action: allowSubAgent ? 'allow' : 'deny' }]
  return merged
}

/** 档位是否落在完全访问基线上；自定义档位以它继承的 base 为准。 */
function isFullAccessPermission(namespace: string, permission: PermissionPreset | null): boolean {
  return findProfile(mergeProfiles(store.listPermissionProfiles(namespace)), permission).base === 'full'
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
      try {
        sweepMigrationResidue(appPaths.dataDir)
      } catch (error) {
        logStartup('清理迁移残留失败', error)
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
  ...DEFAULT_ATTACHMENT_POLICY,
  knowledge: DEFAULT_KNOWLEDGE_SETTINGS,
  motionPreference: 'system',
  startAtLogin: false,
  showOnStartup: true,
  closeToTray: true,
  theme: 'system',
  accentColor: 'green',
  baseFontSize: 'medium',
  uiDensity: 'comfortable',
  surfaceLevel: 'standard',
  bodyTextContrast: 'standard',
  sidebarGlass: false,
  autoSummary: true,
  contextStrategy: 'auto',
  triggerRatio: null,
  keepRecentTurns: null,
  forceCompaction: false,
  shellPreference: 'bash',
  bashPath: '',
  shellCommand: DEFAULT_SHELL_COMMAND_SETTINGS,
  externalEditorPath: '',
  agentAbilityPolicy: { mode: 'all_enabled', agentAbilityIds: [] },
  subAgentEnabled: true,
  subAgentMaxToolCalls: SUBAGENT_LIMITS.defaultMaxToolCalls,
  subAgents: [],
  memory: { enabled: true, autoExtract: true, maxRecall: DEFAULT_RECALL, extractModelId: null },
  sandbox: defaultSandboxSettings,
  quickDialogEnabled: true,
  limits: DEFAULT_RUN_LIMITS
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

function broadcastModelsChanged() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('models:changed')
  }
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
    // 不挂 titleBarOverlay：系统画的按钮跟不上应用配色和圆角，窗口控制按钮改由渲染进程自绘。
    titleBarStyle: 'hidden',
    // 先隐藏，等渲染进程给出首帧再显示；否则重启瞬间会看到一块空白窗口。
    show: false,
    // 不给底色的话窗口首帧是 Electron 默认的白，深色主题下必然闪一下。深色底色档位可配，跟着设置走。
    backgroundColor: canvasColor(dark ? 'dark' : 'light', settings?.surfaceLevel),
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
    const detail = `${errorDescription}（${errorCode}）${validatedURL}`
    logStartup('界面加载失败', detail)
    if (rendererRetried) {
      // 不能只放行一个透明空窗口；即使 renderer 完全没启动，也要给出可操作的故障页。
      showRendererLoadError(detail, validatedURL)
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
  // 自绘的最大化按钮要换图标，状态只能由主进程告知：双击标题栏、系统快捷键也会改这个状态。
  const sendMaximized = () => mainWindow?.webContents.send('window:maximized-changed', mainWindow.isMaximized())
  mainWindow.on('maximize', sendMaximized)
  mainWindow.on('unmaximize', sendMaximized)
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
  const rendererUrl = process.env.ELECTRON_RENDERER_URL?.replace('://localhost:', '://127.0.0.1:')
  const load = rendererUrl
    ? mainWindow.loadURL(rendererUrl)
    : mainWindow.loadURL(pathToFileURL(join(__dirname, '../renderer/index.html')).href)
  load.catch((error) => logStartup('loadRenderer', error))
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' })[character] ?? character)
}

function showRendererLoadError(detail: string, targetUrl: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const logPath = join(appPaths?.logsDir ?? app.getPath('logs'), 'startup.log')
  const target = JSON.stringify(targetUrl).replace(/</g, '\\u003c')
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>FastAgent 启动失败</title><style>
    :root{color-scheme:light dark;font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;background:#fafaf8;color:#20201e}
    @media(prefers-color-scheme:dark){:root{background:#181817;color:#f1f1ed}}
    body{margin:0;min-height:100vh;display:grid;place-items:center}.card{box-sizing:border-box;width:min(680px,calc(100% - 48px));padding:30px;border:1px solid #d8d8d0;border-radius:14px;background:color-mix(in srgb,currentColor 4%,transparent);box-shadow:0 12px 40px #0001}h1{margin:0 0 12px;font-size:20px}p{line-height:1.7;color:#777;margin:8px 0}.steps{margin:20px 0;padding:14px 18px;border-radius:8px;background:#0000000a;line-height:1.9}.buttons{display:flex;gap:10px;margin-top:22px}button{cursor:pointer;border:0;border-radius:7px;padding:10px 16px;background:#2864d7;color:white;font:inherit}button.secondary{background:#00000012;color:inherit}details{margin-top:18px}pre{white-space:pre-wrap;overflow:auto;font:12px/1.5 monospace;color:#888}
  </style></head><body><main class="card"><h1>FastAgent 界面暂时无法启动</h1><p>应用进程仍在运行，但窗口页面加载失败。通常是开发服务未启动、被安全软件拦截，或本地缓存目录无访问权限。</p><div class="steps"><strong>建议按顺序处理：</strong><br>1. 确认终端中的 Vite 开发服务仍在运行，并使用 <code>npm run dev</code> 重新启动。<br>2. 若是安装版，请关闭 FastAgent 后重新打开；仍失败时检查日志目录权限。<br>3. 点击“打开日志目录”，将 <code>startup.log</code> 提供给开发人员。</div><div class="buttons"><button onclick="location.href=${target}">重新加载界面</button><button class="secondary" onclick="window.fastAgent?.shell.openPath(${JSON.stringify(logPath)})">打开日志目录</button></div><details><summary>错误详情</summary><pre>${escapeHtml(detail)}</pre></details></main></body></html>`
  void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

function appRuntimeInfo(): AppRuntimeInfo {
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: `${process.platform} ${process.arch}`,
    dataRoot: appPaths.dataRoot,
    backendUrl
  }
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
  runScheduler.setMaxConcurrent(settings.limits.maxConcurrentRuns)
  void syncQuickDialogShortcut()
  syncGlobalShortcuts(previous)
  app.setLoginItemSettings({ openAtLogin: settings.startAtLogin, openAsHidden: !settings.showOnStartup })
  if (mainWindow) {
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

/**
 * 最近一次基于 Pi session 的上下文测量，按会话缓存。
 *
 * Pi 的会话内压缩不产生 app 侧摘要边界（coveredTurnEnd 只能是 null），
 * 所以 refreshContext 的整份估算会把已经被 Pi 压掉的历史重新算一遍，数字虚高。
 * 只要还留着 Pi 那边算出来的测量值，就不要退回按回合历史重估。
 */
const latestRuntimeMeasurements = new Map<string, ContextMeasurement>()

function rememberRuntimeMeasurement(namespace: string, conversationId: string, measurement: ContextMeasurement | undefined) {
  if (measurement) latestRuntimeMeasurements.set(conversationRuntimeKey(namespace, conversationId), measurement)
}

/**
 * 某个模型在这条会话里该用的上下文窗口。
 *
 * 窗口缓存是登录同步时填的，冷启动后第一次换模型、或本地模型还没跑过时都是空的；
 * 只看缓存就会静默退回上一个模型留在库里的窗口，用户换了模型却看不出余量变化。
 * 缓存 miss 时按凭证现算一次（`resolveModelCredentials` 顺带把缓存补上）。
 */
function contextWindowFor(namespace: string, conversationId: string, modelIdOverride?: number | null) {
  // 只要末轮绑定的模型，不必把整段历史读出来。
  const modelId = modelIdOverride ?? store.latestTurnRuntime(namespace, conversationId)?.runtimeConfig.modelId
  if (modelId !== null && modelId !== undefined) {
    const cached = modelContextWindows.get(modelId)
    if (cached) return cached
    try {
      const credentials = resolveModelCredentials(modelId)
      return resolveContextWindow(credentials.context_window, credentials.model_name)
    } catch {
      // 凭证缺失（未登录同步、模型已删）时才让位给库里的旧值。
    }
  }
  return store.getContextState(namespace, conversationId)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
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
  // 窗口按「显式配置 > 按模型名推断 > 默认值」定，只要解析得到凭证就一定给出当前模型的窗口。
  // 推断落空时沿用运行时快照里的旧值，会把上一个模型的窗口留给新模型：
  // 换到一个名字认不出来的模型后，界面上的百分比仍按旧窗口算，压缩阈值也跟着错。
  const configuredWindow = credentials ? resolveContextWindow(credentials.context_window, credentials.model_name) : null
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
  // 有 session 时那份快照就是最后一次照着 Pi 消息树算出来的结果（压缩后是 fallback-estimate），
  // 必须优先于回合估算：Pi 的会话内压缩不留应用回合边界，重估会把已经压掉的历史重新算回来。
  const hasSession = Boolean(store.getConversationSessionFile(namespace, conversationId))
  const persistedMeasurement: ContextMeasurement | null = modelRuntime && (modelRuntime.counting_method === 'provider-usage' || hasSession) ? {
    modelId: identity?.modelId ?? -1,
    provider: identity?.provider ?? 'unknown',
    contextWindow: modelRuntime.context_window,
    estimatedTokens: modelRuntime.estimated_tokens,
    messageTokens: modelRuntime.message_tokens,
    toolTokens: modelRuntime.tool_tokens,
    systemTokens: modelRuntime.system_tokens,
    summaryTokens: modelRuntime.summary_tokens,
    attachmentTokens: modelRuntime.attachment_tokens,
    countingMethod: modelRuntime.counting_method
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
      contextWindow: configuredWindow ?? contextWindow ?? contextWindowFor(namespace, conversationId),
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
  // 模型不一致时这份缓存属于上一个 session，不能拿来充当当前模型的用量。
  const remembered = latestRuntimeMeasurements.get(conversationRuntimeKey(namespace, conversationId))
  const runtimeFallback = remembered && remembered.modelId === modelId ? remembered : null
  const measured = runtimeMeasurement ?? persistedMeasurement ?? runtimeFallback ?? estimate()
  // 窗口大小以当前模型配置为准：切换模型或改过模型设置后，运行时快照里的旧窗口不能继续显示。
  const next = {
    conversationId, contextWindow: configuredWindow ?? measured.contextWindow, estimatedTokens: measured.estimatedTokens,
    messageTokens: measured.messageTokens, toolTokens: measured.toolTokens, systemTokens: measured.systemTokens,
    summaryTokens: measured.summaryTokens, attachmentTokens: measured.attachmentTokens, modelId: modelId === -1 ? null : modelId,
    provider: measured.provider, countingMethod: measured.countingMethod,
    compactionCount: Math.max(state?.compactionCount ?? 0, store.countCompactions(namespace, conversationId)),
    latestSummaryId: state?.latestSummaryId ?? null, updatedAt: new Date().toISOString()
  }
  if (identity) store.upsertModelRuntime(namespace, { conversationId, ...identity, context: next })
  return store.upsertContextState(namespace, next)
}

/**
 * 重开 session 时当提示词种子的摘要，只认按回合切出来的那种。
 * Pi 会话内摘要之外还留着保留区消息，拿它当种子会把那部分上下文丢掉。
 */
function latestSummaryText(namespace: string, conversationId: string) {
  return store.latestTurnSummary(namespace, conversationId)?.summaryText ?? null
}

const COMPACTION_TIMEOUT_MS = 60_000

/**
 * Pi 会话内压缩的统一落库口径：自动（threshold/overflow）与手动都走这里。
 *
 * 摘要以 source='session' 存档，只供展示与审计，**不更新 latestSummaryId**——
 * 那个字段是「重开 session 时拿来当提示词种子的摘要」，而 Pi 摘要之外还有保留区消息，
 * 拿它当种子会把那部分上下文丢掉。覆盖回合同理留空：Pi 按消息切，映射不到应用回合。
 */
function recordSessionCompaction(namespace: string, conversationId: string, input: {
  triggerReason: string
  strategy: ContextStrategy
  outcome: SessionCompactionOutcome
  modelId: number | null
}) {
  const { outcome } = input
  const summary = store.createContextSummary(namespace, {
    conversationId,
    version: (store.listContextSummaries(namespace, conversationId).at(-1)?.version ?? 0) + 1,
    summaryText: outcome.summary,
    coveredTurnStart: null,
    coveredTurnEnd: null,
    inputTokens: outcome.tokensBefore,
    outputTokens: estimateTokens(outcome.summary),
    source: 'session'
  })
  // 先落压缩记录再刷新上下文：refreshContext 的 compactionCount 取自 COUNT(*)，
  // 顺序反了这一次压缩要等到下一次刷新才被算进去。
  const compaction = store.recordCompaction(namespace, {
    conversationId,
    strategy: input.strategy,
    triggerReason: input.triggerReason,
    beforeTokens: outcome.tokensBefore,
    afterTokens: outcome.estimatedTokensAfter,
    // 判定用的就是这个窗口（Pi 的 model.contextWindow），百分比也只能按它算。
    contextWindow: outcome.measurement.contextWindow,
    coveredTurnStart: null,
    coveredTurnEnd: null,
    summaryId: summary.id,
    durationMs: outcome.durationMs
  })
  rememberRuntimeMeasurement(namespace, conversationId, outcome.measurement)
  const context = refreshContext(namespace, conversationId, outcome.measurement.contextWindow, input.modelId, outcome.measurement)
  return { context, summary, compaction }
}

/** Pi 在没有可压缩内容时抛的是英文提示，对用户来说等同于「不需要压缩」，按 null 处理。 */
function isNothingToCompact(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  return /Already compacted|Nothing to compact/i.test(message)
}

/**
 * 手动压缩当前会话的 Pi session。
 * 活跃运行时优先：另开一份去压会让缓存里的 agent.state 与刚写入的 compaction entry 分叉。
 */
async function compactConversationSession(namespace: string, conversationId: string, sessionFile: string, credentials: ModelCredentials, reason = 'manual', force = false) {
  const started = Date.now()
  const compactionKey = `${namespace}:${conversationId}`
  const runtimeKey = conversationRuntimeKey(namespace, conversationId)
  const controller = new AbortController()
  let timedOut = false
  activeCompactions.set(compactionKey, controller)
  const policy = resolvePolicy(settings, store.getContextPolicy(namespace, conversationId), conversationId)
  // `??` 会把库里存的 0 当成有效窗口，piCompactionSettings 拿到 0 就整段退回 Pi 默认预留量，
  // 用户设的触发占比对这条路径完全失效。0 与未配置是同一回事，必须走同一套解析。
  const contextWindow = credentials.context_window || contextWindowFor(namespace, conversationId, credentials.id)
  const sendPhase = (progress: number, detail: string) => mainWindow?.webContents.send('chat:event', { runId: `compaction-${conversationId}`, conversationId, type: 'run_phase', phase: 'compacting', status: 'running', progress, modelId: credentials.id, detail, timestamp: Date.now(), elapsedMs: Date.now() - started })
  sendPhase(20, '正在压缩会话上下文')
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, COMPACTION_TIMEOUT_MS)
  try {
    // 强压只收缩保留区，触发点不动：改的是「压多狠」，不是「什么时候压」。
    const compaction = force
      ? piForcedCompactionSettings(policy, contextWindow, credentials.max_tokens)
      : piCompactionSettings(policy, contextWindow, credentials.max_tokens)
    const live = conversationRuntimeCache.peek(runtimeKey)
    let outcome: SessionCompactionOutcome
    if (live) {
      outcome = await live.pi.compact(controller.signal, force ? compaction : undefined)
    } else {
      const { compactSessionFile } = await loadPiRuntime()
      outcome = await compactSessionFile({
        credentials,
        sessionFile,
        sessionDir: conversationSessionDir(namespace, conversationId),
        agentDir: appPaths.agentDir,
        cwd: store.getConversationRoot(namespace, conversationId) ?? appPaths.quickWorkspaceDir,
        compaction,
        signal: controller.signal,
        createModelRuntime: createModelRuntimeForCredentials
      })
      // 旁路压缩改的是 session 文件，缓存里若之后又建起运行时必须重新读盘。
      await conversationRuntimeCache.invalidate(runtimeKey)
    }
    const recorded = recordSessionCompaction(namespace, conversationId, { triggerReason: reason, strategy: policy.strategy, outcome, modelId: credentials.id })
    mainWindow?.webContents.send('chat:event', { runId: `compaction-${conversationId}`, conversationId, type: 'compactionCompleted', phase: 'compacting', status: 'completed', progress: 100, modelId: credentials.id, context: recorded.context, compaction: recorded.compaction, detail: '上下文压缩完成', timestamp: Date.now(), elapsedMs: Date.now() - started })
    return recorded
  } catch (error) {
    if (isNothingToCompact(error)) return null
    if (controller.signal.aborted) throw new CompactionError(timedOut ? 'COMPACTION_TIMEOUT' : 'COMPACTION_CANCELLED', timedOut ? '压缩模型响应超时' : '压缩已取消')
    throw new CompactionError('COMPACTION_MODEL_ERROR', error instanceof Error ? error.message : '压缩模型调用失败')
  } finally {
    clearTimeout(timer)
    activeCompactions.delete(compactionKey)
  }
}

/**
 * 压缩入口。有 Pi session 就交给 Pi——它才是真正送进模型的上下文；
 * 跨 provider 换模型必须重开 session，只有那条路径（以及从没跑过 Agent、压根没有 session 的会话）
 * 才退回按应用回合切摘要。
 */
async function compactConversation(namespace: string, conversationId: string, reason = 'manual', credentials?: ModelCredentials | null) {
  const sessionFile = store.getConversationSessionFile(namespace, conversationId)
  if (reason !== 'model-switch' && credentials && sessionFile && existsSync(sessionFile)) {
    return compactConversationSession(namespace, conversationId, sessionFile, credentials, reason)
  }
  return compactConversationTurns(namespace, conversationId, reason, credentials)
}

/**
 * 强压：常规压缩已经压不动、且这条会话开了 forceCompaction 时才走这里。
 *
 * 两级降级，都复用现成路径，不引入第二套压缩实现：
 * 1. 收缩保留区重压一次 Pi session —— Pi 的切点按 keepRecentTokens 往回找，
 *    保留区比可压区间还大时切点落在开头，可摘要消息为空，compact() 静默返回。收小就一定切得动。
 * 2. 仍压不动（整段历史就是一个巨型回合、或上一条 entry 已经是压缩点）时，改按应用回合切摘要
 *    并作废 session —— 这条路不依赖 Pi 的消息树结构，只要会话回合数够就一定有可压缩内容。
 *
 * 两级都失败只可能是「整条会话只有两三个回合却已经撑满窗口」，那时压缩本来也救不了，
 * 返回 null 让调用方去提示用户换模型或开新会话。
 */
async function forceCompactConversation(namespace: string, conversationId: string, credentials: ModelCredentials) {
  const sessionFile = store.getConversationSessionFile(namespace, conversationId)
  if (sessionFile && existsSync(sessionFile)) {
    try {
      const shrunk = await compactConversationSession(namespace, conversationId, sessionFile, credentials, 'threshold-force', true)
      if (shrunk) return shrunk
    } catch (error) {
      // 用户按了取消就到此为止：接着跑第二级等于无视这次取消。
      if (error instanceof CompactionError && error.code === 'COMPACTION_CANCELLED') throw error
      // 其余失败不该吃掉第二级：回合摘要走的是完全不同的路径，很可能仍然成功。
      console.warn('[compaction] 收缩保留区强压失败，转按回合摘要:', error)
    }
    console.info('[compaction] 收缩保留区仍压不动，降级到回合摘要', { conversationId })
  }
  return compactConversationTurns(namespace, conversationId, 'threshold-force-turns', credentials)
}

/** 按应用回合切摘要并作废 session：只服务跨 provider 换模型与无 session 的会话。 */
async function compactConversationTurns(namespace: string, conversationId: string, reason = 'manual', credentials?: ModelCredentials | null) {
  const started = Date.now()
  const compactionKey = `${namespace}:${conversationId}`
  const controller = new AbortController()
  let timedOut = false
  activeCompactions.set(compactionKey, controller)
  // 换模型时 local-run 自己在发阶段事件，这里再发一遍会让界面出现两条压缩进度；
  // 其余原因（手动、阈值兜底）都必须发，否则自动压缩对用户是完全不可见的。
  const announce = reason !== 'model-switch'
  if (announce) mainWindow?.webContents.send('chat:event', { runId: `compaction-${conversationId}`, conversationId, type: 'run_phase', phase: 'compacting', status: 'running', progress: 10, modelId: credentials?.id ?? null, detail: '正在读取会话历史', timestamp: started })
  const policy = resolvePolicy(settings, store.getContextPolicy(namespace, conversationId), conversationId)
  const before = refreshContext(namespace, conversationId, credentials?.context_window || contextWindowFor(namespace, conversationId, credentials?.id), credentials?.id)
  const { compressible } = splitTurns(store.listTurns(namespace, conversationId), policy.keepRecentTurns)
  if (!compressible.length) {
    activeCompactions.delete(compactionKey)
    return null
  }
  if (announce) mainWindow?.webContents.send('chat:event', { runId: `compaction-${conversationId}`, conversationId, type: 'run_phase', phase: 'compacting', status: 'running', progress: 30, modelId: credentials?.id ?? null, detail: '正在准备摘要内容', timestamp: Date.now(), elapsedMs: Date.now() - started })
  const previousSummary = latestSummaryText(namespace, conversationId)
  let summaryText = heuristicSummary(compressible, previousSummary)
  if (credentials) {
    // 摘要质量优先走模型，但压缩绝不能因为一次网络失败而阻断发送。
    try {
      const { summarizeTurns } = await loadPiRuntime()
      if (announce) mainWindow?.webContents.send('chat:event', { runId: `compaction-${conversationId}`, conversationId, type: 'run_phase', phase: 'compacting', status: 'running', progress: 45, modelId: credentials?.id ?? null, detail: '正在生成摘要', timestamp: Date.now(), elapsedMs: Date.now() - started })
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
  const summary = store.createContextSummary(namespace, { conversationId, version: (store.listContextSummaries(namespace, conversationId).at(-1)?.version ?? 0) + 1, summaryText, coveredTurnStart: compressible[0]?.id ?? null, coveredTurnEnd: compressible.at(-1)?.id ?? null, inputTokens: before.estimatedTokens, outputTokens: estimateTokens(summaryText), source: 'turns' })
  const projected = projectCompactedState(before, policy, summaryText)
  const after = store.upsertContextState(namespace, { ...projected, compactionCount: before.compactionCount + 1, latestSummaryId: summary.id, updatedAt: new Date().toISOString() })
  if (credentials) {
    const identity = modelRuntimeIdentity(credentials)
    store.upsertModelRuntime(namespace, { conversationId, ...identity, context: after })
  }
  const compaction = store.recordCompaction(namespace, { conversationId, strategy: policy.strategy, triggerReason: reason, beforeTokens: before.estimatedTokens, afterTokens: after.estimatedTokens, contextWindow: before.contextWindow, coveredTurnStart: summary.coveredTurnStart, coveredTurnEnd: summary.coveredTurnEnd, summaryId: summary.id, durationMs: Date.now() - started })
  // 摘要改变了请求上下文，作废该会话的 session，下一轮以摘要重开。
  store.setConversationSessionFile(namespace, conversationId, '')
  // session 已作废，上一段 Pi 会话的测量值不再代表下一轮的上下文。
  latestRuntimeMeasurements.delete(conversationRuntimeKey(namespace, conversationId))
  await conversationRuntimeCache.invalidate(conversationRuntimeKey(namespace, conversationId))
  if (announce) mainWindow?.webContents.send('chat:event', { runId: `compaction-${conversationId}`, conversationId, type: 'compactionCompleted', phase: 'compacting', status: 'completed', progress: 100, modelId: credentials?.id ?? null, context: after, compaction, detail: '上下文压缩完成', timestamp: Date.now(), elapsedMs: Date.now() - started })
  return { context: after, summary, compaction }
}

/** 登录时下发的模型凭证；safeStorage 不可用时只有这份内存副本。 */
const modelCredentialCache = new Map<number, ModelCredentials>()

function cacheModelCredentials(credentials: ModelCredentials[]) {
  // 本地覆盖必须在入缓存前套上：窗口缓存与运行时都从这份缓存取，
  // 在取用处再套会漏掉 modelContextWindows 这条路径。
  const overrides = store.listModelOverrides()
  for (const raw of credentials) {
    const credential = applyOverride(raw, overrides.get(overrideKey(raw.provider, raw.model_name)))
    modelCredentialCache.set(credential.id, credential)
    modelContextWindows.set(credential.id, resolveContextWindow(credential.context_window, credential.model_name))
  }
}

/**
 * 覆盖改动后作废凭证缓存。不清的话要重新登录才生效——用户改完看不到任何变化，
 * 只会以为没保存。
 */
function invalidateModelCredentialCache() {
  modelCredentialCache.clear()
  modelContextWindows.clear()
  broadcastModelsChanged()
}

/** 模型调用直连 provider，凭证只从登录时下发的本地副本取，不再逐轮请求后端。 */
function resolveModelCredentials(modelId: number): ModelCredentials {
  // 负数 id 是本地添加的模型：不依赖登录，直接从 local_models 表解密组装。
  if (modelId < 0) {
    const stored = store.modelConnections().runtimeConfig(-modelId) ?? store.getLocalModelRuntimeConfig(-modelId)
    if (!stored) throw new Error('本地模型不存在或已被删除')
    modelContextWindows.set(modelId, resolveContextWindow(stored.context_window, stored.model_name))
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
  const { withDeclaredVision, createModelRuntime } = await loadPiRuntime()
  // 账号连接的模型定义直接取自 pi 目录，不经 modelDefinition，多模态标记必须在这里补齐，
  // 否则连接设置里勾了「多模态」对账号登录的模型完全不生效。
  if (credentials.authMode === 'oauth' && credentials.connectionId) {
    const resolved = await modelConnectionService.createRuntime(credentials.connectionId, credentials.model_name)
    return { ...resolved, model: withDeclaredVision(resolved.model, credentials) }
  }
  return createModelRuntime(credentials)
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

/** 单模型对话连通性测试：覆盖云端账号、本地模型服务连接与旧版独立本地模型。
 *  发送一句短对话并校验模型返回了正文，验证的是端到端可对话，不是只通网络。 */
async function testModelDialogue(id: number): Promise<LocalModelTestResult> {
  const credentials = resolveModelCredentials(id)
  const startedAt = Date.now()
  const fail = (detail: string, durationMs = Date.now() - startedAt): LocalModelTestResult => {
    logIntegrationError({ service: 'model', endpoint: `${credentials.provider}/${credentials.model_name}`, message: redactModelMessage(id, detail), durationMs })
    return { ok: false, error: detail, latencyMs: durationMs }
  }
  try {
    // OAuth 账号连接必须走运行时拿授权令牌，HTTP 直连只有 API Key。
    if (credentials.authMode === 'oauth' && credentials.connectionId) {
      const { runtime, model } = await modelConnectionService.createRuntime(credentials.connectionId, credentials.model_name)
      const result = await runtime.completeSimple(model, { messages: [{ role: 'user', content: 'Reply OK.', timestamp: Date.now() }] }, { maxTokens: 64, signal: AbortSignal.timeout(30_000) })
      if (result.stopReason === 'error' || result.stopReason === 'aborted') return fail('模型未返回对话结果')
      return { ok: true, latencyMs: Date.now() - startedAt }
    }
    const baseUrl = (credentials.base_url || '').replace(/\/+$/, '')
    if (!baseUrl) return fail('未配置 Base URL')
    const headers: Record<string, string> = { ...(credentials.headers ?? {}) }
    let url: string
    let body: Record<string, unknown>
    const protocol = credentials.protocol ?? (credentials.provider === 'anthropic' || credentials.provider === 'openai-responses' || credentials.provider === 'openai' ? credentials.provider : 'openai')
    if (protocol === 'anthropic') {
      url = `${baseUrl.replace(/\/v1$/, '')}/v1/messages`
      headers['x-api-key'] = credentials.api_key || ''
      headers['anthropic-version'] = '2023-06-01'
      headers['content-type'] = 'application/json'
      body = { model: credentials.model_name, max_tokens: 64, messages: [{ role: 'user', content: 'Reply OK.' }] }
    } else if (protocol === 'openai-responses') {
      url = `${baseUrl}/responses`
      headers.authorization = `Bearer ${credentials.api_key || ''}`
      headers['content-type'] = 'application/json'
      body = { model: credentials.model_name, input: 'Reply OK.', max_output_tokens: 64 }
    } else {
      url = `${baseUrl}/chat/completions`
      headers.authorization = `Bearer ${credentials.api_key || ''}`
      headers['content-type'] = 'application/json'
      body = { model: credentials.model_name, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 64 }
    }
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) })
    if (!response.ok) {
      let detail = `对话测试失败（HTTP ${response.status}）`
      try {
        const data = await response.json() as { error?: { message?: string } }
        if (data?.error?.message) detail = data.error.message
      } catch { /* 非 JSON 响应体不解析 */ }
      return fail(detail)
    }
    const data = await response.json() as Record<string, unknown>
    const text = extractDialogueReply(protocol, data)
    if (!text || !text.trim()) return fail('模型返回了空回复')
    return { ok: true, latencyMs: Date.now() - startedAt }
  } catch (error) {
    const detail = error instanceof DOMException && error.name === 'AbortError' ? '对话测试超时' : error instanceof Error ? error.message : String(error)
    return fail(detail)
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
  for (const run of activeRuns.values()) run.controller.abort()
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
  cancelAllShellCommands()
  for (const run of activeRuns.values()) run.controller.abort()
  activeRuns.clear()
  settlePendingRequests(new DOMException('应用正在退出', 'AbortError'))
  void conversationRuntimeCache.disposeAll().catch((error) => console.error('[runtime-cache] disposeAll 失败:', error))
  void sandboxManager?.destroyAll().catch((error) => console.error('[sandbox] destroyAll 失败:', error))
}

/**
 * 登录成功后一次性落定会话态。client / backendUrl / userId / refreshToken 四个模块级单例
 * 必须一起改，写操作收在这里，IPC 层只调用，不直接持有它们。
 */
async function performLogin(input: { backendUrl: string; username: string; password: string; captchaId: string; captchaAngle: number; remember: boolean }) {
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
}

async function performLogout() {
  try { if (client && refreshToken) await client.logout(refreshToken) } catch { /* 退出必须可用 */ }
  await lockAccount('signed_out')
  return authState
}

/** 设置写入的唯一入口：落库、刷新模块级快照、再跑副作用（主题、开机自启、全局快捷键等）。 */
function patchSettings(patch: Partial<AppSettings>): AppSettings {
  settings = store.updateSettings({ ...settings, ...patch })
  applySettings(settings)
  return settings
}

/** 数据目录迁移失败后的回滚：库已经 close 过，必须重开，否则后续查询全打在已关闭的句柄上。 */
function reopenStore() {
  store = new LocalStore(appPaths.databasePath)
}

/** 工作区根切换：赋值与 .git 监听重建必须同步，漏掉其一会让界面上的 Git 状态停在上一个项目。 */
function setWorkspaceRoot(path: string | null): string | null {
  workspaceRoot = path || null
  setGitWatchRoot(workspaceRoot)
  return workspaceRoot
}

async function pickWorkspaceRoot(): Promise<string | null> {
  // 传父窗口，否则无边框窗口下选择框可能弹到主窗口后面，看着像「点了没反应」。
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] })
    : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  // 取消不应该清掉已经打开的工作区。
  if (result.canceled) return null
  return setWorkspaceRoot(result.filePaths[0] ?? workspaceRoot)
}

/**
 * app:reload 的实际动作。webContents.reload() 沿用当前 URL，页面此前若已加载失败或崩到错误页，
 * 重载只是把失败态原样再放一遍；改走 loadRenderer 回到规范入口并放开重试名额。
 */
function reloadRenderer() {
  rendererRetried = false
  loadRenderer()
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

/**
 * IPC 层看到的主进程状态。可变单例一律用 getter：它们在 app.whenReady 之后才赋值，
 * 而 IPC 在此之前就注册完了，按值传会永久捕获 undefined。
 */
const mainContext: MainContext = {
  get store() { return store },
  get settings() { return settings },
  get client() { return client },
  get mainWindow() { return mainWindow },
  get workspaceRoot() { return workspaceRoot },
  get appPaths() { return appPaths },
  get skillRegistry() { return skillRegistry },
  get modelConnectionService() { return modelConnectionService },
  get pluginInstaller() { return pluginInstaller },
  get sandboxManager() { return sandboxManager },
  previewService,
  relocateArtifactsUnderPath: (namespace, workspaceId, from, to) => relocateArtifactsUnderPath(store, namespace, workspaceId, from, to),
  terminalManager,
  get bundledTools() { return bundledTools },
  get authState() { return authState },
  get backendUrl() { return backendUrl },
  get userId() { return userId },
  get revealCoordinator() { return revealCoordinator },

  catalogProvider,
  hubService,
  bundleService,
  listAbilities,
  requireAbility,
  recordMcpStatus,
  mcpRuntimeSecrets,

  activeRuns,
  activeRunCancels,
  runPauseGates,
  activeCompactions,
  conversationRuns,
  conversationRuntimeCache,
  runScheduler,
  runPermissionOverrides,
  modelContextWindows,
  startupWarnings,
  rateLimitMonitor,

  loadPiRuntime,
  loadMcpRuntime,

  accountNamespace,
  appRuntimeInfo,
  applyBundledRuntime,
  broadcastAuth,
  broadcastGitChanged,
  broadcastModelsChanged,
  cacheModelCredentials,
  compactConversation,
  forceCompactConversation,
  confirmInterruptRuns,
  contextWindowFor,
  invalidateModelCredentialCache,
  conversationRuntimeKey,
  conversationSessionDir,
  createApiClient,
  createModelRuntimeForCredentials,
  credentialsForConversation,
  environmentChecks,
  hasActiveRun,
  liveRunConversationIds,
  lockAccount,
  patchSettings,
  performLogin,
  performLogout,
  pickWorkspaceRoot,
  preferenceNamespace,
  refreshContext,
  reloadRenderer,
  removeArtifactsUnderPath,
  reopenStore,
  reportCrash,
  requireClient,
  requireNamespace,
  resolveModelCredentials,
  runKbIndex,
  runLocalRun,
  runQuickChat,
  runtimeInstallDir,
  setWorkspaceRoot,
  stopActiveWork,
  testModelDialogue
}

/** 运行编排层的上下文：MainContext 之外再补几项只有 run 用的协作方。 */
// 必须走原型链继承而不是 `{ ...mainContext }`：展开会当场触发全部 getter，
// 把此刻还是 undefined 的 store / settings 永久固化成快照。
const runContext: RunContext = Object.assign(Object.create(mainContext) as MainContext, {
  contextMeter,
  buildRuleSet,
  isFullAccessPermission,
  latestSummaryText,
  modelRuntimeIdentity,
  recordSessionCompaction,
  rememberRuntimeMeasurement,
  reportModelFailure,
  registerArtifactForPath
})

type RunLocalRunArgs = Parameters<typeof runLocalRunWith> extends [RunContext, ...infer Rest] ? Rest : never
type RunQuickChatArgs = Parameters<typeof runQuickChatWith> extends [RunContext, ...infer Rest] ? Rest : never

function runLocalRun(...args: RunLocalRunArgs) {
  return runLocalRunWith(runContext, ...args)
}

function runQuickChat(...args: RunQuickChatArgs) {
  return runQuickChatWith(runContext, ...args)
}

function registerIpc() {
  registerAllIpc(handleIpc, mainContext)
}

/** 快速对话历史参与上下文的回合数上限：直接调接口不做压缩，超出的旧回合直接忽略。 */

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
// 自定义协议的特权只能在 ready 之前声明。
registerPreviewScheme()

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
  // 出网代理要赶在第一次请求之前定下来：模型请求、OAuth 令牌交换都在主进程用 fetch 发，
  // 而 Node 侧的 fetch 默认不走系统代理。目标地址只用来让系统 PAC 规则给出结论，全局只取这一次。
  await applyOutboundProxy({
    env: process.env,
    resolveSystemProxy: () => session.defaultSession.resolveProxy('https://api.openai.com'),
    applyEnvProxy: () => setGlobalDispatcher(withRateLimitTap(new EnvHttpProxyAgent(), rateLimitMonitor)),
    applyProxy: (url) => setGlobalDispatcher(withRateLimitTap(new ProxyAgent(url), rateLimitMonitor)),
    log: (message) => breadcrumb('network', message)
  })
  pushStartupPhase('config')
  scheduleVerbosityRefresh()
  // 本地数据初始化整体兜底：任一步抛出都不能吞掉窗口创建，
  // 否则表现是「进程活着但没有界面」，用户看到的就是重启后白屏 / 点托盘无反应。
  try {
    migrateLegacyData(appPaths)
    healAgentSettings(appPaths)
    writeDataRootLocator(appPaths.platformUserDataDir, appPaths.dataRoot)
    store = new LocalStore(appPaths.databasePath)
    modelConnectionService = new ModelConnectionService(store.modelConnections(), {
      openExternal: (url) => isExternalHttpUrl(url) ? shell.openExternal(url) : undefined,
      onChanged: broadcastModelsChanged,
      onLoginFailed: ({ providerId, message, status }) => logIntegrationError({ service: 'model', endpoint: `oauth/${providerId}`, message, ...(status === undefined ? {} : { status }) })
    })
    skillRegistry = new LocalSkillRegistry(appPaths.skillsDir, store)
    pluginInstaller = new PluginInstaller(catalogProvider, skillRegistry, store)
    // 存量模型缺 context_window 时按 pi 目录补一次：窗口是自动压缩阈值的分母，
    // 缺了就按模型名推断，偏小十几倍的分母会让压缩在真实用量百分之几时就触发。
    // 只在后台跑，读目录失败或表里没有可补的都不影响启动。
    void modelConnectionService.list().then(broadcastModelsChanged).catch((error) => logStartup('模型窗口补齐失败', error))
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
  // 协议处理必须赶在开窗之前挂上，否则界面恢复出来的预览卡片首次加载会 404。
  try {
    previewService.install()
  } catch (error) {
    logStartup('预览协议安装失败', error)
  }
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
  try { cancelAllShellCommands() } catch (error) { logStartup('停止直接命令失败', error) }
  try { clearStartupTimers(); destroySplashWindow() } catch (error) { logStartup('清理启动页失败', error) }
  try { settlePendingRequests(new DOMException('窗口已关闭', 'AbortError')) } catch (error) { logStartup('结算挂起请求失败', error) }
  try { void sandboxManager?.destroyAll() } catch (error) { logStartup('清理沙箱会话失败', error) }
  try { terminalManager.disposeAll() } catch (error) { logStartup('关闭终端会话失败', error) }
  try { destroyTray() } catch (error) { logStartup('销毁托盘失败', error) }
  try {
    if (doubleCtrlHook) { doubleCtrlHook.stop(); doubleCtrlHook = null }
    unregisterAllGlobalShortcuts(globalShortcut, settings.shortcuts)
    if (globalMouseHook) { globalMouseHook.stop(); globalMouseHook = null; releaseUiohook() }
  } catch (error) { logStartup('清理全局快捷键失败', error) }
  try { modelConnectionService?.dispose() } catch (error) { logStartup('清理模型连接失败', error) }
  try { store?.close() } catch (error) { logStartup('关闭数据库失败', error) }
})
