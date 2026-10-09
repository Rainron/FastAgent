import { describe, expect, it, vi } from 'vitest'
import { dropNextQueuedPrompt, enqueuePrompt, markSteerDelivered, removeQueuedPrompt, syncSteerQueue, takeNextQueuedPrompt } from './prompt-queue'

vi.stubGlobal('crypto', { randomUUID: () => `id-${Math.random().toString(36).slice(2)}` })

describe('prompt-queue', () => {
  it('入队保持提交顺序', () => {
    let queue = enqueuePrompt([], '第一问', [])
    queue = enqueuePrompt(queue, '第二问', [])
    expect(queue.map((item) => item.text)).toEqual(['第一问', '第二问'])
  })

  it('入队保留附件', () => {
    const attachments = [{ id: 'a1', name: 'f.txt', type: 'text/plain', size: 3, localPath: 'C:/f.txt' }]
    const queue = enqueuePrompt([], '带附件', attachments)
    expect(queue[0].attachments).toHaveLength(1)
  })

  it('撤销按 id 移除指定项', () => {
    let queue = enqueuePrompt([], 'A', [])
    queue = enqueuePrompt(queue, 'B', [])
    queue = removeQueuedPrompt(queue, queue[0].id)
    expect(queue.map((item) => item.text)).toEqual(['B'])
  })

  it('出队取队首并返回剩余', () => {
    let queue = enqueuePrompt([], 'A', [])
    queue = enqueuePrompt(queue, 'B', [])
    expect(takeNextQueuedPrompt(queue)?.text).toBe('A')
    queue = dropNextQueuedPrompt(queue)
    expect(takeNextQueuedPrompt(queue)?.text).toBe('B')
    queue = dropNextQueuedPrompt(queue)
    expect(takeNextQueuedPrompt(queue)).toBeNull()
  })

  it('空队列取队首返回 null', () => {
    expect(takeNextQueuedPrompt([])).toBeNull()
  })

  it('入队默认是本地排队，插队项显式标记', () => {
    const queue = enqueuePrompt(enqueuePrompt([], 'A', []), 'B', [], 'steer')
    expect(queue.map((item) => item.kind)).toEqual(['queued', 'steer'])
  })

  it('对齐待投递列表时只摘掉已送达的插队项', () => {
    let queue = enqueuePrompt([], '本地排队', [])
    queue = enqueuePrompt(queue, '已送达', [], 'steer')
    queue = enqueuePrompt(queue, '还在等', [], 'steer')
    const next = syncSteerQueue(queue, ['还在等'])
    expect(next.map((item) => item.text)).toEqual(['本地排队', '还在等'])
  })

  it('同一句话插队两次时，一次送达只摘掉一条', () => {
    let queue = enqueuePrompt([], '继续', [], 'steer')
    queue = enqueuePrompt(queue, '继续', [], 'steer')
    expect(syncSteerQueue(queue, ['继续'])).toHaveLength(1)
    expect(markSteerDelivered(queue, '继续')).toHaveLength(1)
  })

  it('送达事件不动本地排队项', () => {
    const queue = enqueuePrompt([], '继续', [])
    expect(markSteerDelivered(queue, '继续')).toHaveLength(1)
  })
})
