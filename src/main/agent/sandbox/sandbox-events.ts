import type { AgentEvent, SandboxNotice } from '../../../shared/types'
import type { SandboxSession } from './sandbox-types'

/** 沙箱事件名；当前用于主进程日志与后续审计日志。 */
export const SANDBOX_EVENTS = {
  sessionCreated: 'sandbox.session.created',
  commandStarted: 'sandbox.command.started',
  commandCompleted: 'sandbox.command.completed',
  commandBlocked: 'sandbox.command.blocked',
  filesystemDenied: 'sandbox.filesystem.denied',
  networkDenied: 'sandbox.network.denied',
  sessionDestroyed: 'sandbox.session.destroyed',
  error: 'sandbox.error'
} as const

export type SandboxEventName = typeof SANDBOX_EVENTS[keyof typeof SANDBOX_EVENTS]

export function sandboxBlockedEvent(notice: SandboxNotice): Omit<AgentEvent, 'runId'> {
  return {
    type: 'sandbox_blocked',
    status: 'failed',
    detail: notice.target ? `${notice.title}：${notice.target}` : notice.title,
    sandbox: notice
  }
}

export function sandboxDegradedEvent(notice: SandboxNotice): Omit<AgentEvent, 'runId'> {
  return { type: 'sandbox_degraded', detail: notice.title, sandbox: notice }
}

/** 会话摘要：写日志与 IPC 回传共用，不包含策略细节。 */
export function describeSession(session: SandboxSession) {
  return {
    id: session.id,
    workspacePath: session.workspacePath,
    accountMode: session.accountMode,
    isolation: session.isolation,
    networkMode: session.policy.network.mode,
    createdAt: session.createdAt
  }
}
