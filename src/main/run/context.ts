import type { CompactionResult, MainContext } from '../app-context'
import type { ContextMeter, ContextMeasurement } from '../context-meter'
import type { SessionCompactionOutcome } from '../pi-runtime'
import type { ContextStrategy, ModelCredentials, PermissionPreset } from '../../shared/types'
import type { PermissionRuleSet } from '../../shared/permission-rules'

/**
 * 运行编排层需要的主进程状态。在 MainContext 之上补几项只有 run 用得到的协作方，
 * 它们仍闭包在 index.ts 的模块级单例上，所以照样按 getter / 函数引用传。
 */
export interface RunContext extends MainContext {
  readonly contextMeter: ContextMeter
  buildRuleSet(namespace: string, permission: PermissionPreset | null, allowSubAgent?: boolean): PermissionRuleSet
  isFullAccessPermission(namespace: string, permission: PermissionPreset | null): boolean
  latestSummaryText(namespace: string, conversationId: string): string | null
  modelRuntimeIdentity(credentials: ModelCredentials): { provider: string; modelId: number }
  recordSessionCompaction(namespace: string, conversationId: string, input: {
    triggerReason: string
    strategy: ContextStrategy
    outcome: SessionCompactionOutcome
    modelId: number | null
  }): CompactionResult
  rememberRuntimeMeasurement(namespace: string, conversationId: string, measurement: ContextMeasurement | undefined): void
  reportModelFailure(modelId: number | null, error: unknown, durationMs?: number): void
  registerArtifactForPath(namespace: string, conversationId: string, turnId: string, runId: string, root: string | null, requested: string, source: string | undefined): void
}
