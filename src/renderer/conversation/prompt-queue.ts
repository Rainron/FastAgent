import type { Attachment } from '../../shared/types'

/**
 * 运行中提交的问题先进队列。
 *
 * 两种去向：
 * - `steer`：已经插进当前这一轮，主进程在下一次调模型前投递，界面只是等它被送达；
 * - `queued`：主进程那边没接住（运行时还在初始化、或走直连快问通道），等整轮结束后按顺序发出。
 */
export type QueuedPromptKind = 'steer' | 'queued'

export interface QueuedPrompt {
  id: string
  text: string
  attachments: Attachment[]
  kind: QueuedPromptKind
  createdAt: number
}

export function enqueuePrompt(queue: QueuedPrompt[], text: string, attachments: Attachment[], kind: QueuedPromptKind = 'queued'): QueuedPrompt[] {
  return [...queue, { id: crypto.randomUUID(), text, attachments, kind, createdAt: Date.now() }]
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

/**
 * 按主进程报来的待投递列表对齐插队项：不在列表里的说明已经进上下文了，从界面上摘掉。
 * 本地排队项不受影响——它们压根不在主进程的队列里。
 */
export function syncSteerQueue(queue: QueuedPrompt[], pending: string[] | undefined): QueuedPrompt[] {
  // 缺字段只可能来自异常事件或历史回放，拿它清队列会把已提交的插队从界面上抹掉
  if (pending === undefined) return queue
  const remaining = [...pending]
  return queue.filter((item) => {
    if (item.kind !== 'steer') return true
    const at = remaining.indexOf(item.text)
    if (at === -1) return false
    remaining.splice(at, 1)
    return true
  })
}

/** 某条插队消息已送达：只摘掉文本相同的第一条，同一句话连发两次时另一条还得等。 */
export function markSteerDelivered(queue: QueuedPrompt[], text: string): QueuedPrompt[] {
  const index = queue.findIndex((item) => item.kind === 'steer' && item.text === text)
  return index === -1 ? queue : [...queue.slice(0, index), ...queue.slice(index + 1)]
}
