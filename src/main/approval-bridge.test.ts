import { afterEach, describe, expect, it } from 'vitest'
import { createApprovalBridge, reevaluatePendingApprovals, respondPendingApproval, settlePendingRequests } from './approval-bridge'
import type { AgentEvent, ApprovalRequest } from '../shared/types'
import type { PermissionAction } from '../shared/permission-rules'

afterEach(() => settlePendingRequests(new Error('测试结束')))

const request: Omit<ApprovalRequest, 'id'> = { kind: 'permission', tool: 'read', subject: '../.fa/skills/planning-with-files/SKILL.md', cwd: 'C:/Users/deep/daily', risk: true }

describe('权限改变后重新判定审批', () => {
  it('仅结算当前 run 中重新判定为允许的审批，并发出关闭事件', async () => {
    const events: Omit<AgentEvent, 'runId'>[] = []
    let action: PermissionAction = 'ask'
    const bridge = createApprovalBridge('run-1', (event) => events.push(event), request.cwd)
    const pending = bridge.requestApproval(request, new AbortController().signal, () => action)
    void pending.catch(() => undefined)
    expect(reevaluatePendingApprovals('run-2')).toBe(0)
    expect(reevaluatePendingApprovals('run-1')).toBe(0)
    action = 'allow'
    expect(reevaluatePendingApprovals('run-1')).toBe(1)
    await expect(pending).resolves.toBe('once')
    expect(events.at(-1)).toMatchObject({ type: 'approval_resolved', approval: { id: events[0].approval!.id } })
    expect(reevaluatePendingApprovals('run-1')).toBe(0)
  })

  it('不自动回答提问或放过重复操作，也不放行仍禁止的请求', async () => {
    const events: Omit<AgentEvent, 'runId'>[] = []
    const bridge = createApprovalBridge('run-1', (event) => events.push(event), request.cwd)
    const promises = [
      bridge.requestApproval({ ...request, kind: 'doom_loop' }, new AbortController().signal, () => 'allow'),
      bridge.requestApproval(request, new AbortController().signal, () => 'deny'),
      bridge.requestQuestion('tool-1', [], new AbortController().signal)
    ]
    for (const promise of promises) void promise.catch(() => undefined)
    expect(reevaluatePendingApprovals('run-1')).toBe(0)
    for (const event of [...events]) respondPendingApproval({ runId: 'run-1', id: event.approval!.id, decision: 'once', answer: '[]' })
    await Promise.all(promises)
  })

  it('取消后的请求不会因切换权限恢复', async () => {
    const controller = new AbortController()
    const bridge = createApprovalBridge('run-1', () => undefined, request.cwd)
    const pending = bridge.requestApproval(request, controller.signal, () => 'allow')
    controller.abort()
    await expect(pending).rejects.toThrow('审批已取消')
    expect(reevaluatePendingApprovals('run-1')).toBe(0)
  })
})
