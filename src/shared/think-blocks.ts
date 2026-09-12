/**
 * 部分模型把推理内联写进正文的 `<think>…</think>` 里。流式增量由主进程的切分器分流到思考通道，
 * 但最终回答是从模型消息的文本块重新取的，那份仍是原文——不剥掉的话思考会跟着回答一起显示在折叠层外面。
 * 只剥完整的成对标签：没闭合的那段留着当正文，宁可多显示也不吞内容。
 */
const THINK_BLOCK = /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/g

export function stripThinkBlocks(text: string): string {
  if (!text.includes('<think')) return text
  const stripped = text.replace(THINK_BLOCK, '')
  // 全是思考时不要把正文擦成空字符串以外的东西：调用方据此判定「模型没产出内容」。
  return stripped.trim()
}
