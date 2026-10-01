/**
 * 模型上下文窗口的兜底推断。
 *
 * 真实窗口只有两个可靠来源：云端下发的 context_window，或用户在模型设置里手填。
 * 两者都为空时，界面此前一律显示 128,000——换任何模型数字都不变，用户无法判断
 * 还剩多少余量，压缩策略也照着错误的分母算。这里按模型名给出一个按厂商公开
 * 规格整理的近似值，只作为兜底：任何显式配置都优先于它，用户改了设置立刻生效。
 *
 * 与主进程和渲染层共用，不依赖 Node / Electron。
 */

/** 名字里带容量后缀时直接采信，这类命名（moonshot-v1-128k）本身就是厂商声明的窗口。 */
const SUFFIX_PATTERNS: Array<[RegExp, number]> = [
  [/(?:^|[^a-z0-9])2m(?:[^a-z0-9]|$)/, 2_097_152],
  [/(?:^|[^a-z0-9])1m(?:[^a-z0-9]|$)/, 1_048_576],
  [/(?:^|[^a-z0-9])1024k(?:[^a-z0-9]|$)/, 1_048_576],
  [/(?:^|[^a-z0-9])256k(?:[^a-z0-9]|$)/, 262_144],
  [/(?:^|[^a-z0-9])200k(?:[^a-z0-9]|$)/, 200_000],
  [/(?:^|[^a-z0-9])128k(?:[^a-z0-9]|$)/, 131_072],
  [/(?:^|[^a-z0-9])64k(?:[^a-z0-9]|$)/, 65_536],
  [/(?:^|[^a-z0-9])32k(?:[^a-z0-9]|$)/, 32_768],
  [/(?:^|[^a-z0-9])16k(?:[^a-z0-9]|$)/, 16_384],
  [/(?:^|[^a-z0-9])8k(?:[^a-z0-9]|$)/, 8_192]
]

/**
 * 按模型名片段匹配，顺序即优先级：先写具体型号，再写系列兜底。
 * 只收录常见系列；没命中的走 DEFAULT_CONTEXT_WINDOW，不猜。
 */
const NAME_PATTERNS: Array<[RegExp, number]> = [
  // Anthropic：Claude 全系列长期是 200K 窗口
  [/claude/, 200_000],
  // OpenAI：gpt-4.1 与 gpt-5 系列是长窗口，gpt-4o / gpt-4-turbo 仍是 128K
  [/gpt-4\.1/, 1_047_576],
  [/gpt-5/, 400_000],
  [/^o[1-9](?:-|$)/, 200_000],
  [/gpt-4o|gpt-4-turbo|gpt-4-1106|gpt-4-0125/, 128_000],
  [/gpt-3\.5/, 16_385],
  // Google Gemini
  [/gemini-1\.5-pro/, 2_097_152],
  [/gemini/, 1_048_576],
  // DeepSeek：官方 API 上下文 64K
  [/deepseek/, 65_536],
  // 智谱 GLM
  [/glm-4\.6|glm-4\.5/, 200_000],
  [/glm/, 128_000],
  // 月之暗面 Kimi
  [/kimi|moonshot/, 131_072],
  // 通义千问
  [/qwen-long/, 10_000_000],
  [/qwen/, 131_072],
  // 其余常见开源系列
  [/minimax/, 1_000_000],
  [/mistral|magistral|devstral/, 128_000],
  [/llama-?3|llama3/, 128_000],
  [/grok/, 131_072]
]

/** 所有推断都落空时的最后兜底，与历史行为一致。 */
export const DEFAULT_CONTEXT_WINDOW = 128_000

/** 只按模型名推断；返回 null 表示无法判断，由调用方决定是否用默认值。 */
export function inferContextWindow(modelName: string | null | undefined): number | null {
  if (!modelName) return null
  const name = modelName.toLowerCase()
  for (const [pattern, window] of SUFFIX_PATTERNS) if (pattern.test(name)) return window
  for (const [pattern, window] of NAME_PATTERNS) if (pattern.test(name)) return window
  return null
}

/**
 * 解析一个模型最终该用的窗口：显式配置 > 名字推断 > 默认值。
 * configured 传 0 / null / undefined 都算「未配置」——库里存 0 与没存是同一回事。
 */
export function resolveContextWindow(configured: number | null | undefined, modelName?: string | null): number {
  if (typeof configured === 'number' && configured > 0) return configured
  return inferContextWindow(modelName) ?? DEFAULT_CONTEXT_WINDOW
}
