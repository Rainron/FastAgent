/**
 * 模型参数的常用挡位。
 *
 * 这些值都是主流模型真实在用的规格（上下文窗口一律取 2 的幂或厂商公布的整数），
 * 目的是让用户点一下就选中，而不是靠记忆敲 131072。挡位之外仍然可以自定义，
 * 所以这里只求覆盖常见值，不求穷举。
 */

export interface ParameterPreset {
  /** 写进草稿的字符串值；与输入框里的文本完全一致，便于回填时精确匹配。 */
  value: string
  label: string
}

/** 「自定义」在下拉里的哨兵值；选中它才露出输入框。 */
export const CUSTOM_PRESET = '__custom__'

export const CONTEXT_WINDOW_PRESETS: ParameterPreset[] = [
  { value: '8192', label: '8K' },
  { value: '16384', label: '16K' },
  { value: '32768', label: '32K' },
  { value: '65536', label: '64K' },
  { value: '131072', label: '128K' },
  { value: '200000', label: '200K' },
  { value: '262144', label: '256K' },
  { value: '524288', label: '512K' },
  { value: '1048576', label: '1M' },
  { value: '2097152', label: '2M' }
]

export const MAX_TOKENS_PRESETS: ParameterPreset[] = [
  { value: '1024', label: '1K' },
  { value: '2048', label: '2K' },
  { value: '4096', label: '4K' },
  { value: '8192', label: '8K' },
  { value: '16384', label: '16K' },
  { value: '32768', label: '32K' },
  { value: '65536', label: '64K' },
  { value: '131072', label: '128K' }
]

export const TEMPERATURE_PRESETS: ParameterPreset[] = [
  { value: '0', label: '0（确定性最高）' },
  { value: '0.2', label: '0.2' },
  { value: '0.3', label: '0.3' },
  { value: '0.5', label: '0.5' },
  { value: '0.7', label: '0.7（常用）' },
  { value: '1', label: '1' },
  { value: '1.2', label: '1.2（发散）' }
]

export const TIMEOUT_PRESETS: ParameterPreset[] = [
  { value: '60', label: '60 秒' },
  { value: '120', label: '2 分钟' },
  { value: '300', label: '5 分钟' },
  { value: '600', label: '10 分钟' },
  { value: '1800', label: '30 分钟' }
]

export const MAX_RETRIES_PRESETS: ParameterPreset[] = [
  { value: '0', label: '0（不重试）' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '5', label: '5' }
]

export const THINKING_DEFAULT_PRESETS: ParameterPreset[] = [
  { value: 'off', label: 'off（关闭思考）' },
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max' }
]

/**
 * 当前值在下拉里该选中哪一项。
 * 空串 = 跟随默认；命中挡位 = 该挡位；其余一律算自定义——包括用户手敲的 `131072.0`
 * 这种等值不等形的写法，硬做数值归一会在用户还没输完时把光标位置改掉。
 */
export function presetSelection(value: string, presets: ParameterPreset[]): string {
  if (!value.trim()) return ''
  return presets.some((preset) => preset.value === value.trim()) ? value.trim() : CUSTOM_PRESET
}

/** 选中挡位后写回草稿的值：自定义时保留已有输入，别把用户敲的清掉。 */
export function presetValue(selection: string, current: string): string {
  if (selection === '') return ''
  if (selection === CUSTOM_PRESET) return current
  return selection
}
