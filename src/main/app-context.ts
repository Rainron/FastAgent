import type { BrowserWindow } from 'electron'
import type { ApiClient } from './api-client'
import type { AppPaths } from './app-paths'
import type { LocalStore } from './local-store'
import type { LocalSkillRegistry } from './skill-registry'
import type { ModelConnectionService } from './model-connections'
import type { PluginInstaller } from './plugins/installer'
import type { BuiltinCatalogProvider } from './plugins/catalog'
import type { SandboxManager } from './agent/sandbox/sandbox-manager'
import type { ConversationRunCoordinator, ConversationRuntimeCache } from './conversation-runtime-cache'
import type { RunScheduler } from './run-scheduler'
import type { PauseGate } from './agent/pause-gate'
import type { RevealCoordinator } from './startup-progress'
import type { PiSessionRuntime } from './pi-runtime'
import type { LocalMcpManager, McpToolBinding } from './mcp-manager'
import type { SandboxSession } from './agent/sandbox/sandbox-types'
import type { createAbilitiesService } from './abilities-service'
import type { createHubService } from './hub/hub-service'
import type { createBundleService } from './bundle/bundle-service'
import type { ContextMeasurement } from './context-meter'
import type { CrashKind } from './logging/logger'
import type { createModelRuntime } from './pi-runtime'
import type {
  AppRuntimeInfo, AppSettings, AuthSnapshot, ApprovalDecision, CompactionHistory,
  Attachment, ContextState, ContextSummary, ConversationMode, DoctorCheck, ThinkingLevel,
  KbSource, ModelCredentials, LocalModelTestResult, PermissionPreset, StartupWarning
} from '../shared/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IpcRegistrar = (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) => void

/** 活跃 run 的归属信息：界面重载后要靠它接回运行，也用来挡同一会话的第二个 run。 */
export interface ActiveRun {
  controller: AbortController
  namespace: string
  conversationId: string
  turnId: string
}

export interface CachedConversationRuntime {
  pi: PiSessionRuntime
  mcpManager: LocalMcpManager | null
  mcpBindings: McpToolBinding[]
  sandboxSession: SandboxSession | null
  sessionOverrides: Map<string, ApprovalDecision>
  dispose(): Promise<void>
}

type AbilitiesService = ReturnType<typeof createAbilitiesService>

/** 一次压缩的结果：压缩后的用量、生成的摘要、落库的压缩记录；没什么可压时为 null。 */
export interface CompactionResult {
  context: ContextState
  summary: ContextSummary
  compaction: CompactionHistory
}

/**
 * IPC handler 需要的主进程状态与协作方。
 *
 * 可变单例（store、settings、mainWindow 等）一律走 getter：它们在 app.whenReady 之后才赋值，
 * 而 IPC 在此之前就注册完了，按值传会永久捕获 undefined。函数与集合本身引用不变，直接传。
 */
export interface MainContext {
  readonly store: LocalStore
  readonly settings: AppSettings
  readonly client: ApiClient | null
  readonly mainWindow: BrowserWindow | null
  readonly workspaceRoot: string | null
  readonly appPaths: AppPaths
  readonly skillRegistry: LocalSkillRegistry
  readonly modelConnectionService: ModelConnectionService
  readonly pluginInstaller: PluginInstaller
  readonly sandboxManager: SandboxManager
  readonly bundledTools: Record<string, string>
  readonly authState: AuthSnapshot
  readonly backendUrl: string | null
  readonly userId: string | null
  readonly revealCoordinator: RevealCoordinator | null

  readonly catalogProvider: BuiltinCatalogProvider
  readonly hubService: ReturnType<typeof createHubService>
  readonly bundleService: ReturnType<typeof createBundleService>
  readonly listAbilities: AbilitiesService['listAbilities']
  readonly requireAbility: AbilitiesService['requireAbility']
  readonly recordMcpStatus: AbilitiesService['recordMcpStatus']
  readonly mcpRuntimeSecrets: AbilitiesService['mcpRuntimeSecrets']

  readonly activeRuns: Map<string, ActiveRun>
  readonly activeRunCancels: Map<string, () => void>
  readonly runPauseGates: Map<string, PauseGate>
  readonly activeCompactions: Map<string, AbortController>
  readonly conversationRuns: ConversationRunCoordinator
  readonly conversationRuntimeCache: ConversationRuntimeCache<CachedConversationRuntime>
  readonly runScheduler: RunScheduler
  readonly runPermissionOverrides: Map<string, PermissionPreset | null>
  readonly modelContextWindows: Map<number, number>
  readonly startupWarnings: StartupWarning[]

  loadPiRuntime(): Promise<typeof import('./pi-runtime')>
  loadMcpRuntime(): Promise<typeof import('./mcp-manager')>

  accountNamespace(): string | null
  appRuntimeInfo(): AppRuntimeInfo
  applyBundledRuntime(force?: boolean): void
  broadcastAuth(snapshot: AuthSnapshot): void
  broadcastGitChanged(): void
  broadcastModelsChanged(): void
  cacheModelCredentials(credentials: ModelCredentials[]): void
  compactConversation(namespace: string, conversationId: string, reason?: string, credentials?: ModelCredentials | null): Promise<CompactionResult | null>
  confirmInterruptRuns(action: '重启' | '退出'): Promise<boolean>
  contextWindowFor(namespace: string, conversationId: string, modelIdOverride?: number | null): number
  /** 参数覆盖改动后作废凭证与窗口缓存，并广播 models:changed；不清就要重登才生效。 */
  invalidateModelCredentialCache(): void
  conversationRuntimeKey(namespace: string, conversationId: string): string
  conversationSessionDir(namespace: string, conversationId: string): string
  createApiClient(baseUrl: string): ApiClient
  createModelRuntimeForCredentials(credentials: ModelCredentials): ReturnType<typeof createModelRuntime>
  credentialsForConversation(namespace: string, conversationId: string, fallbackModelId?: number | null): ModelCredentials | null
  environmentChecks(): Promise<DoctorCheck[]>
  hasActiveRun(namespace: string, conversationId: string): boolean
  liveRunConversationIds(namespace: string): Set<string>
  lockAccount(nextState?: AuthSnapshot['state']): Promise<void>
  /** 设置写入的唯一入口；`settings` 只读，改设置一律走这里。 */
  patchSettings(patch: Partial<AppSettings>): AppSettings
  performLogin(input: { backendUrl: string; username: string; password: string; captchaId: string; captchaAngle: number; remember: boolean }): Promise<AuthSnapshot>
  performLogout(): Promise<AuthSnapshot>
  pickWorkspaceRoot(): Promise<string | null>
  preferenceNamespace(): string | null
  refreshContext(namespace: string, conversationId: string, contextWindow?: number, modelIdOverride?: number | null, runtimeMeasurement?: ContextMeasurement): ContextState
  /** app:reload 专用：重置渲染进程重试名额后回到规范入口，`rendererRetried` 不对外暴露。 */
  reloadRenderer(): void
  removeArtifactsUnderPath(namespace: string, workspaceId: string, relative: string): boolean
  reportCrash(kind: CrashKind, detail: string | null, error?: { message: string; stack?: string | null; componentStack?: string | null }): void
  /** 数据目录迁移失败后的回滚：库已 close，必须重开。 */
  reopenStore(): void
  requireClient(): ApiClient
  requireNamespace(): string
  resolveModelCredentials(modelId: number): ModelCredentials
  runKbIndex(namespace: string, source: KbSource): Promise<unknown>
  /** 完整实现在 run/local-run.ts；这里只声明签名，避免 app-context 反向依赖 run 层。 */
  runLocalRun(runId: string, turnId: string, conversationId: string, namespace: string, prompt: string, mode: ConversationMode, modelId: number | null, thinkingLevel: ThinkingLevel, permission: PermissionPreset | null, modePrompt: string, planMode: boolean, attachments: Attachment[], signal: AbortSignal, acceptedAt?: number): Promise<void>
  runQuickChat(runId: string, turnId: string, conversationId: string, namespace: string, prompt: string, modelId: number | null, thinkingLevel: ThinkingLevel, signal: AbortSignal, acceptedAt?: number): Promise<void>
  runtimeInstallDir(): string
  setWorkspaceRoot(path: string | null): string | null
  stopActiveWork(): void
  testModelDialogue(id: number): Promise<LocalModelTestResult>
}
