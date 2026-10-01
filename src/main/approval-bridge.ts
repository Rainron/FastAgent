import { randomUUID } from 'node:crypto'
import type { AgentEvent, ApprovalDecision, ApprovalRequest, QuestionAnswer, QuestionItem } from '../shared/types'
import type { PermissionAction } from '../shared/permission-rules'

interface PendingRequest {
  runId: string
  request: ApprovalRequest
  resolve: (decision: ApprovalDecision, answer?: string) => void
  reject: (reason: unknown) => void
  cleanup: () => void
  recheck?: () => PermissionAction
}

const pendingRequests = new Map<string, PendingRequest>()

export function reevaluatePendingApprovals(runId: string): number {
  let settled = 0
  for (const pending of pendingRequests.values()) {
    if (pending.runId !== runId || pending.request.kind !== 'permission' || pending.recheck?.() !== 'allow') continue
    pending.resolve('once')
    settled += 1
  }
  return settled
}

/** 渲染进程的审批答复入口：id 不存在时静默忽略（run 可能已经结束）。 */
export function respondPendingApproval(input: { id: string; decision: ApprovalDecision; answer?: string; runId: string }) {
  const pending = pendingRequests.get(input.id)
  if (!pending) return
  if (input.runId !== pending.runId) throw new Error('Approval response does not belong to the active run')
  const decision = input.decision
  if (decision !== 'reject' && decision !== 'once' && decision !== 'session' && decision !== 'always') {
    throw new Error(`未知审批决定：${decision}`)
  }
  pending.resolve(decision, input.answer)
}

/**
 * 仍在等待用户答复的审批与提问。
 *
 * 这些请求只在发起那一刻推过一次事件，界面重载后渲染层的弹层就没了，
 * 而主进程这边还在 await——整轮会一直停在「准备中」，既没有弹窗也没有进展。
 * 重载后靠这个通道把它们重新取回来。
 */
export function listPendingApprovals(runIds?: ReadonlySet<string>): Array<{ runId: string; request: ApprovalRequest }> {
  return [...pendingRequests.values()]
    .filter((pending) => !runIds || runIds.has(pending.runId))
    .map((pending) => ({ runId: pending.runId, request: pending.request }))
}

/** run 被 cancel 或窗口关闭时，所有挂起审批/提问以 reject 结算，避免永久悬挂。 */
export function settlePendingRequests(reason: unknown) {
  for (const pending of pendingRequests.values()) pending.reject(reason)
  pendingRequests.clear()
}

export function createApprovalBridge(runId: string, emit: (event: Omit<AgentEvent, 'runId'>) => void, workspaceRoot: string | null) {
  const requestApproval = (input: Omit<ApprovalRequest, 'id'>, waitSignal: AbortSignal, recheck?: () => PermissionAction): Promise<ApprovalDecision> => {
    const id = `approval-${randomUUID()}`
    return new Promise((resolve, reject) => {
      const request: ApprovalRequest = { ...input, id }
      const onAbort = () => {
        pendingRequests.delete(id)
        reject(new DOMException('审批已取消', 'AbortError'))
      }
      const pending: PendingRequest = {
        runId,
        request,
        recheck,
        resolve: (decision) => {
          pendingRequests.delete(id)
          waitSignal.removeEventListener('abort', onAbort)
          emit({ type: 'approval_resolved', approval: request, permissionResult: decision })
          resolve(decision)
        },
        reject: (reason) => {
          pendingRequests.delete(id)
          waitSignal.removeEventListener('abort', onAbort)
          reject(reason)
        },
        cleanup: () => {
          waitSignal.removeEventListener('abort', onAbort)
        }
      }
      if (waitSignal.aborted) {
        reject(new DOMException('审批已取消', 'AbortError'))
        return
      }
      waitSignal.addEventListener('abort', onAbort, { once: true })
      pendingRequests.set(id, pending)
      emit({ type: input.kind === 'question' ? 'question_required' : 'approval_required', approval: request })
    })
  }
  const requestQuestion = (toolCallId: string, questions: QuestionItem[], waitSignal: AbortSignal): Promise<QuestionAnswer[]> => {
    return new Promise((resolve, reject) => {
      const id = `question-${randomUUID()}`
      const request: ApprovalRequest = { id, kind: 'question', tool: 'question', subject: '', cwd: String(workspaceRoot ?? ''), risk: false, options: { questions } }
      const onAbort = () => {
        pendingRequests.delete(id)
        reject(new DOMException('提问已取消', 'AbortError'))
      }
      const pending: PendingRequest = {
        runId,
        request,
        resolve: (decision, answer) => {
          pendingRequests.delete(id)
          waitSignal.removeEventListener('abort', onAbort)
          if (decision === 'reject') {
            reject(new DOMException('Question cancelled by user', 'AbortError'))
            return
          }
          try {
            const parsed = answer ? JSON.parse(answer) : []
            if (!Array.isArray(parsed)) throw new Error('回答格式错误')
            resolve(parsed as QuestionAnswer[])
          } catch (error) {
            reject(error)
          }
        },
        reject: (reason) => {
          pendingRequests.delete(id)
          waitSignal.removeEventListener('abort', onAbort)
          reject(reason)
        },
        cleanup: () => {
          waitSignal.removeEventListener('abort', onAbort)
        }
      }
      if (waitSignal.aborted) {
        reject(new DOMException('提问已取消', 'AbortError'))
        return
      }
      waitSignal.addEventListener('abort', onAbort, { once: true })
      pendingRequests.set(id, pending)
      emit({
        type: 'question_required',
        approval: request,
        toolCallId,
        tool: 'question',
        detail: `Agent 提问：${questions.length} 个问题`
      })
    })
  }
  return { requestApproval, requestQuestion }
}
