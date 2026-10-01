import type { AppSettings, ContextPolicy, ContextStrategy } from './types'

/**
 * 上下文压缩的单一事实源：档位默认值、阈值归一化、生效判定。
 * 主进程（策略解析、Pi 参数换算）与渲染进程（设置页、压力提示）必须共用这一份，
 * 两边各写一份常量正是「设置里改了但运行时不认」的来源。
 *
 * 用户只有一个旋钮：触发占比。压缩后落到哪里不再让用户设——
 * 它曾经是 `targetRatio`，经由「窗口×目标 − 摘要预算」反推保留区，而摘要预算又由
 * 预留区反推，形成「触发点越低 → 摘要预算越大 → 压完必然越线」的反向耦合。
 * 现在保留区直接按窗口的固定比例给，落点由它加摘要预算算出来，只用于展示。
 */

export interface ContextStrategyPreset {
  value: ContextStrategy
  label: string
  /** 一句话说明这一档适合谁，设置页直接展示。 */
  description: string
  triggerRatio: number
}

/** 关闭档没有阈值概念，triggerRatio 取 1 表示「永不触发」。 */
export const CONTEXT_STRATEGY_PRESETS: ContextStrategyPreset[] = [
  { value: 'aggressive', label: '积极', description: '更早压缩、压得更狠。长聊天、文档讨论与成本敏感场景。', triggerRatio: 0.68 },
  { value: 'auto', label: '均衡', description: '推荐。兼顾上下文完整度与压缩频率，适合大多数任务。', triggerRatio: 0.78 },
  { value: 'conservative', label: '保守', description: '尽量晚压缩、多保留原文。Code、Debug 与长链路 Agent。', triggerRatio: 0.85 },
  { value: 'disabled', label: '关闭', description: '不自动压缩，接近上限时只提示，需要手动压缩。', triggerRatio: 1 }
]

const DEFAULT_PRESET = CONTEXT_STRATEGY_PRESETS.find((item) => item.value === 'auto') as ContextStrategyPreset

/** 触发阈值的可设范围：低于 30% 会压得比对话还勤，高于 95% 留不出压缩本身的预算。 */
export const TRIGGER_RATIO_RANGE = { min: 0.3, max: 0.95 } as const

export function contextStrategyPreset(strategy: ContextStrategy | null | undefined): ContextStrategyPreset {
  return CONTEXT_STRATEGY_PRESETS.find((item) => item.value === strategy) ?? DEFAULT_PRESET
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/** 只接受有限正小数，其余（NaN、Infinity、越界）一律按「未设置」处理。 */
function finiteRatio(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value <= 0 || value > 1) return null
  return value
}

export type ContextRatioSource = Pick<ContextPolicy, 'strategy' | 'triggerRatio'>

/** 自动压缩的触发占比，显式值优先于档位默认值。 */
export function resolveTriggerRatio(source: ContextRatioSource): number {
  return finiteRatio(source.triggerRatio) ?? contextStrategyPreset(source.strategy).triggerRatio
}

/**
 * 自动压缩是否生效。`autoSummary` 是历史遗留的第二个开关，
 * 归一化之后它恒等于 `strategy !== 'disabled'`；这里仍然两个都看，
 * 防止未经归一化的旧记录（会话级 policy 行）绕过关闭状态。
 */
export function isAutoCompactionEnabled(source: Pick<ContextPolicy, 'strategy' | 'autoSummary'>): boolean {
  return source.autoSummary !== false && source.strategy !== 'disabled'
}

export type ContextSettingsShape = Pick<AppSettings, 'autoSummary' | 'contextStrategy' | 'triggerRatio'>

/**
 * 读取旧记录时的一次性收敛：`autoSummary` 曾经是与档位并列的第二个开关，
 * 关掉它会让整组档位静默失效。把这种组合统一表达成「关闭」档，
 * 之后 `autoSummary` 只作为 `strategy !== 'disabled'` 的镜像存在。
 */
export function migrateLegacyContextSettings(stored: Partial<ContextSettingsShape>): Partial<ContextSettingsShape> {
  if (stored.autoSummary !== false) return stored
  return { ...stored, contextStrategy: 'disabled' }
}

/**
 * 设置层归一化，写入前必须过一遍：
 * - 档位是唯一事实源，`autoSummary` 按它回填；
 * - 触发占比裁进可用区间。
 */
export function normalizeContextSettings(input: Partial<ContextSettingsShape>): ContextSettingsShape {
  const declared = CONTEXT_STRATEGY_PRESETS.some((item) => item.value === input.contextStrategy)
  const contextStrategy: ContextStrategy = declared ? input.contextStrategy as ContextStrategy : DEFAULT_PRESET.value
  const rawTrigger = finiteRatio(input.triggerRatio)
  const triggerRatio = rawTrigger === null ? null : clamp(rawTrigger, TRIGGER_RATIO_RANGE.min, TRIGGER_RATIO_RANGE.max)
  return { autoSummary: contextStrategy !== 'disabled', contextStrategy, triggerRatio }
}

/**
 * 会话级覆盖同样要过归一化，否则单会话可以绕开上面那些不变量。
 * 只改写 patch 里真正出现过的键：`updateContextPolicy` 用 `undefined` 表示「保持原值」，
 * 顺手补齐缺省键会把用户此前设过的阈值清成「跟随档位」。
 */
export function normalizeContextPolicyPatch(patch: Partial<Omit<ContextPolicy, 'conversationId'>>, current?: Pick<ContextPolicy, 'strategy' | 'triggerRatio'> | null): Partial<Omit<ContextPolicy, 'conversationId'>> {
  const touched = patch.strategy !== undefined || patch.autoSummary !== undefined || patch.triggerRatio !== undefined
  if (!touched) return patch
  const normalized = normalizeContextSettings(migrateLegacyContextSettings({
    contextStrategy: patch.strategy ?? current?.strategy,
    autoSummary: patch.autoSummary,
    triggerRatio: patch.triggerRatio === undefined ? current?.triggerRatio ?? null : patch.triggerRatio
  }))
  const next: Partial<Omit<ContextPolicy, 'conversationId'>> = { ...patch }
  if (patch.strategy !== undefined || patch.autoSummary !== undefined) {
    next.strategy = normalized.contextStrategy
    next.autoSummary = normalized.autoSummary
  }
  if (patch.triggerRatio !== undefined) next.triggerRatio = normalized.triggerRatio
  return next
}

/**
 * 会话实际生效的策略。渲染层（压力提示、会话详情）必须和主进程 `resolvePolicy` 判一样，
 * 否则界面上说「82% 会压」而引擎按另一个阈值跑，用户看到的就是「设置没生效」。
 */
export function resolveEffectivePolicy(settings: ContextSettingsShape & Pick<AppSettings, 'keepRecentTurns' | 'forceCompaction'>, stored: ContextPolicy | null, conversationId = ''): ContextPolicy {
  if (stored && !stored.inheritGlobal) return stored
  return {
    conversationId: stored?.conversationId ?? conversationId,
    strategy: settings.contextStrategy,
    autoSummary: settings.autoSummary,
    triggerRatio: settings.triggerRatio,
    keepRecentTurns: settings.keepRecentTurns,
    forceCompaction: settings.forceCompaction,
    inheritGlobal: true
  }
}

/* -------------------------------------------------------------------------- *
 * 占比 → Pi 压缩参数的换算。整个应用只有这一份。
 * -------------------------------------------------------------------------- */

/** Pi 自带的压缩参数默认值，窗口未知时原样沿用，不做猜测。 */
const PI_DEFAULT_RESERVE_TOKENS = 16_384
const PI_DEFAULT_KEEP_RECENT_TOKENS = 20_000
/** 保留区与触发点的下限：再小就会压完立刻又触发。窗口很小时按占比退让，避免两者之和顶穿窗口。 */
const MIN_RESERVE_TOKENS = 8_192
const MIN_KEEP_RECENT_TOKENS = 4_096
/**
 * 压缩后保留多少原文，按窗口的固定比例给。
 *
 * 这个数以前由 targetRatio 反推，结果是触发点越低保留区越小、摘要预算越大，
 * 两头一起动，用户根本预测不了压完会落在哪。固定比例后只剩一个变量。
 */
const KEEP_RECENT_RATIO = 0.25
/** 强压时的保留区占比：常规的一半多一点，保证切点一定能往后挪。 */
const FORCE_KEEP_RECENT_RATIO = 0.1
/**
 * Pi 给摘要调用的 maxTokens 是 `min(0.8 × reserveTokens, model.maxTokens)`。
 * 压缩后的上下文 ≈ 保留区 + 这段摘要，算「压到哪」必须扣掉它。
 */
const SUMMARY_BUDGET_RATIO = 0.8
/** 与 pi-runtime 的 DEFAULT_MAX_TOKENS 同值：调用方没给单次输出上限时按它估摘要预算。 */
const DEFAULT_SUMMARY_MAX_TOKENS = 8_192

function clampRange(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/** 一次压缩的实际预算：Pi 要的两个绝对量，以及它们反推回来的真实触发点与落点。 */
export interface CompactionBudget {
  enabled: boolean
  /** Pi 的判定是 `tokens > contextWindow - reserveTokens`，只认绝对量。 */
  reserveTokens: number
  keepRecentTokens: number
  /** 真正会触发压缩的绝对量。窗口未知时为 0。 */
  triggerTokens: number
  /** 压缩后预期落到的绝对量：保留区 + 摘要预算。窗口未知时为 0。 */
  targetTokens: number
  /** 上面两个数换算回占比。被下限/上限夹过之后，它们才是「实际生效」的比例。 */
  effectiveTriggerRatio: number
  effectiveTargetRatio: number
}

function budgetFor(
  source: Pick<ContextPolicy, 'strategy' | 'autoSummary' | 'triggerRatio'>,
  contextWindow: number,
  maxTokens: number | null | undefined,
  keepRecentRatio: number
): CompactionBudget {
  const enabled = isAutoCompactionEnabled(source)
  const triggerRatio = resolveTriggerRatio(source)
  const window = Number.isFinite(contextWindow) && contextWindow > 0 ? Math.round(contextWindow) : 0
  if (!window) {
    return {
      enabled,
      reserveTokens: PI_DEFAULT_RESERVE_TOKENS,
      keepRecentTokens: PI_DEFAULT_KEEP_RECENT_TOKENS,
      triggerTokens: 0,
      targetTokens: 0,
      effectiveTriggerRatio: triggerRatio,
      effectiveTargetRatio: keepRecentRatio
    }
  }
  const margin = Math.round(window * 0.05)
  const keepWanted = Math.round(window * keepRecentRatio)
  const reserveFloor = Math.min(MIN_RESERVE_TOKENS, Math.round(window * 0.1))
  const summaryCap = maxTokens && maxTokens > 0 ? maxTokens : DEFAULT_SUMMARY_MAX_TOKENS
  /**
   * 收敛约束：压完的落点必须真的低于触发点，否则压完立刻又越线，一轮接一轮压到烧光额度
   * （32k 窗口 + 30% 触发 + 模型 maxTokens 极大时实测连压 23 次不收敛，就是这里失守）。
   *
   * 要求 keep + summaryBudget < window − reserve − margin，而 summaryBudget = min(0.8×reserve, maxTokens)：
   * - 摘要被 maxTokens 封住时，约束退化成 reserve < room − maxTokens，很宽松；
   * - 摘要还在随 reserve 涨时，约束是 reserve < room / 1.8。
   * 两种情形取真正适用的那个，别拿最坏情况把整条滑杆的低段变成摆设。
   */
  const room = window - keepWanted - margin
  const capWhenSummaryCapped = room - summaryCap
  const reserveCap = Math.min(
    // 可设区间的下沿：设置页允许把触发点调到 TRIGGER_RATIO_RANGE.min，这里不能比它更严
    Math.round(window * (1 - TRIGGER_RATIO_RANGE.min)),
    capWhenSummaryCapped > summaryCap / SUMMARY_BUDGET_RATIO
      ? capWhenSummaryCapped
      : Math.floor(room / (1 + SUMMARY_BUDGET_RATIO))
  )
  const reserveTokens = clampRange(Math.round(window * (1 - triggerRatio)), reserveFloor, reserveCap)
  const summaryBudget = Math.min(Math.floor(reserveTokens * SUMMARY_BUDGET_RATIO), summaryCap)
  const keepRecentTokens = clampRange(
    keepWanted,
    Math.min(MIN_KEEP_RECENT_TOKENS, Math.round(window * 0.05)),
    window - reserveTokens - margin
  )
  const triggerTokens = window - reserveTokens
  const targetTokens = Math.min(keepRecentTokens + summaryBudget, triggerTokens)
  return {
    enabled,
    reserveTokens,
    keepRecentTokens,
    triggerTokens,
    targetTokens,
    effectiveTriggerRatio: triggerTokens / window,
    effectiveTargetRatio: targetTokens / window
  }
}

/**
 * 把策略里的触发占比翻译成 Pi 的会话内压缩参数，并算出它对应的真实触发点。
 *
 * 触发点会被两头夹：预留区不能小于摘要本身要用的量，也不能大到让压缩无法收敛。
 * 夹过之后用户设的 88% 未必还是 88%——所以这里同时把夹完的结果换算回占比，
 * 设置页照着它显示，不再出现「界面写 30% 而引擎按 50% 跑」。
 *
 * @param maxTokens 模型单次输出上限，用来估 Pi 给摘要的预算；缺省按 8192 算。
 */
export function compactionBudget(
  source: Pick<ContextPolicy, 'strategy' | 'autoSummary' | 'triggerRatio'>,
  contextWindow: number,
  maxTokens?: number | null
): CompactionBudget {
  return budgetFor(source, contextWindow, maxTokens, KEEP_RECENT_RATIO)
}

/**
 * 强压时的压缩参数：触发点（reserveTokens）不变，只把保留区收到最小。
 *
 * 触发点必须原样保留——它决定「什么时候压」，强压改的是「压多狠」。
 */
export function forcedCompactionBudget(
  source: Pick<ContextPolicy, 'strategy' | 'autoSummary' | 'triggerRatio'>,
  contextWindow: number,
  maxTokens?: number | null
): CompactionBudget {
  const normal = compactionBudget(source, contextWindow, maxTokens)
  const forced = budgetFor(source, contextWindow, maxTokens, FORCE_KEEP_RECENT_RATIO)
  // 保留区更小意味着 reserveCap 更宽松，触发点可能跟着往后挪；强压不许改触发时机。
  return {
    ...forced,
    reserveTokens: normal.reserveTokens,
    triggerTokens: normal.triggerTokens,
    effectiveTriggerRatio: normal.effectiveTriggerRatio,
    keepRecentTokens: Math.min(normal.keepRecentTokens, forced.keepRecentTokens)
  }
}

/** 设置页与会话详情共用的「当前生效值」，用于把换算结果直接摆给用户看。 */
export interface EffectiveContextPolicy {
  enabled: boolean
  strategy: ContextStrategy
  /** 用户设定的占比，滑杆位置照它显示。 */
  triggerRatio: number
  contextWindow: number
  /** 换算并夹过之后真正生效的绝对量与占比。与配置值不等时，界面要以这组为准。 */
  triggerTokens: number
  targetTokens: number
  effectiveTriggerRatio: number
  effectiveTargetRatio: number
  /** 夹过之后偏离了用户设定，界面据此提示「实际按 X% 触发」。 */
  clamped: boolean
  /** 阈值是显式设定还是跟随档位，设置页据此显示「跟随档位」占位符。 */
  triggerFollowsPreset: boolean
}

export function effectiveContextPolicy(source: Pick<ContextPolicy, 'strategy' | 'autoSummary' | 'triggerRatio'>, contextWindow: number, maxTokens?: number | null): EffectiveContextPolicy {
  const triggerRatio = resolveTriggerRatio(source)
  const window = Number.isFinite(contextWindow) && contextWindow > 0 ? Math.round(contextWindow) : 0
  const budget = compactionBudget(source, window, maxTokens)
  // 1 个百分点以内的偏差是取整造成的，不值得在界面上提示。
  const clamped = window > 0 && Math.abs(budget.effectiveTriggerRatio - triggerRatio) >= 0.01
  return {
    enabled: isAutoCompactionEnabled(source),
    strategy: source.strategy,
    triggerRatio,
    contextWindow: window,
    triggerTokens: budget.triggerTokens,
    targetTokens: budget.targetTokens,
    effectiveTriggerRatio: budget.effectiveTriggerRatio,
    effectiveTargetRatio: budget.effectiveTargetRatio,
    clamped,
    triggerFollowsPreset: finiteRatio(source.triggerRatio) === null
  }
}
