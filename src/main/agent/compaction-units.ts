/**
 * Pi 的会话内压缩按「字符数 / 4」估算每条消息的 token，用它来决定保留区（keepRecentTokens）留多少条。
 * 这个口径对中文严重偏低：一个汉字在主流分词器里接近 1 token，Pi 却只算 0.25。
 * 结果是中文会话里保留区实际留下的内容是设定值的近 4 倍，小窗口模型压完仍在触发线之上，
 * 表现为「自动压缩压不动、水位一直贴顶」。
 *
 * 这里按会话里 CJK 字符的占比，把要交给 Pi 的 keepRecentTokens 换算成 Pi 自己的口径：
 * 设定的是真实 token，Pi 看到的是缩小后的数，二者折算后保留区才接近设定值。
 * 判定 CJK 的范围与 ContextMeter 一致（基本汉字区），两边估算才对得上。
 */
export function cjkKeepRecentScale(text: string): number {
  if (!text) return 1
  let cjk = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0x4e00 && code <= 0x9fff) cjk += 1
  }
  if (cjk === 0) return 1
  const length = [...text].length
  const piUnits = length / 4
  const realUnits = cjk + (length - cjk) / 4
  // 下限 0.25 对应全中文；只做缩小，不放大。
  return Math.min(1, Math.max(0.25, piUnits / realUnits))
}

/** 按 CJK 占比缩小保留区；没有设定值时原样返回。保底 1024，避免把最近一轮也压进摘要。 */
export function scaleKeepRecentTokens(keepRecentTokens: number | undefined, scale: number): number | undefined {
  if (keepRecentTokens === undefined) return undefined
  return Math.max(1024, Math.round(keepRecentTokens * scale))
}
