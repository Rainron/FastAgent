import type { Attachment } from '../../shared/types'

/** 运行中提交的问题先进队列，回合结束后按顺序自动发出。 */
export interface QueuedPrompt {
  id: string
  text: string
  attachments: Attachment[]
  createdAt: number
}

export function enqueuePrompt(queue: QueuedPrompt[], text: string, attachments: Attachment[]): QueuedPrompt[] {
  return [...queue, { id: crypto.randomUUID(), text, attachments, createdAt: Date.now() }]
}

export function removeQueuedPrompt(queue: QueuedPrompt[], id: string): QueuedPrompt[] {
  return queue.filter((item) => item.id !== id)
}

/** 取出队首；队列为空返回 null。 */
export function takeNextQueuedPrompt(queue: QueuedPrompt[]): QueuedPrompt | null {
  return queue[0] ?? null
}

/** 出队队首，返回剩余队列。 */
export function dropNextQueuedPrompt(queue: QueuedPrompt[]): QueuedPrompt[] {
  return queue.slice(1)
}
