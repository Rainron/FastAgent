/** 执行轨迹的展示偏好：只影响渲染，不改变轨迹本身的数据与切分。 */

/** 用时与 token 的位置：底部一行、顶部状态行、或两处都要。 */
export type TraceTimerPlacement = 'bottom' | 'top' | 'both'

/**
 * 动作摘要与工具行的文案风格。
 * - `zh`：中文自然语句（读取 2 个文件，运行 3 条命令）
 * - `en`：英文自然语句（Read 2 files, ran 3 commands）
 * - `compact`：紧凑计数式（Read ×2 · Command ×3）
 */
export type TraceLabelStyle = 'zh' | 'en' | 'compact'

export interface TraceDisplaySettings {
  timerPlacement: TraceTimerPlacement
  labelStyle: TraceLabelStyle
  /** 用时那一行是否带本轮 token 用量 */
  showTokens: boolean
  /** 动作摘要与工具行是否带增删行数 */
  showDiffStats: boolean
  /** 展开工具卡时入参直接平铺，不再嵌一层「入参 N 项」按钮 */
  flatToolArgs: boolean
  /** 读图片时在展开区内联缩略图 */
  inlineImagePreview: boolean
  /** 读文本文件时在展开区给出内容节选 */
  textExcerpt: boolean
  /** 节选保留的行数 */
  textExcerptLines: number
  /** 轨迹里的文件名可点击，点了在右侧资源面板打开 */
  openFileFromTrace: boolean
}
