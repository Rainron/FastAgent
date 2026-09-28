/**
 * 模型对话测试的响应解析。主进程测试通道只负责发送与基本错误归类，
 * 「这一轮是否真的对话起来了」由这里判断，因此要能宽容各家结构差异，
 * 只要求能取到第一段正文，避免把协议差异误判成空回复。
 */

/** 递归取第一段文本：字符串直接用，数组逐个拼，对象按常见正文键取第一个非空值。 */
function takeFirstText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = takeFirstText(item)
      if (picked) return picked
    }
    return ''
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['text', 'content', 'output_text']) {
      if (record[key] !== undefined) {
        const picked = takeFirstText(record[key])
        if (picked) return picked
      }
    }
  }
  return ''
}

/** 从三家协议响应取对话正文；取不到（结构异常或确实为空）返回 null。 */
export function extractDialogueReply(protocol: string, data: Record<string, unknown>): string | null {
  let root: unknown
  if (protocol === 'openai-responses') root = data.output
  else if (protocol === 'anthropic') root = data.content
  else root = (data.choices as { message?: unknown }[] | undefined)?.[0]?.message
  const text = takeFirstText(root)
  return text ? text : null
}
