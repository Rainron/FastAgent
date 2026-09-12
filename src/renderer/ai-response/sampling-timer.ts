/** 仅流式消息需要周期采样；终态消息直接渲染完整内容，避免空闲定时器。 */
export function scheduleTextSampling(streaming: boolean, sample: () => void, intervalMs: number): () => void {
  if (!streaming) return () => undefined
  const timer = setInterval(sample, intervalMs)
  return () => clearInterval(timer)
}
