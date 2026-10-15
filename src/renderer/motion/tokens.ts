export type MotionPreference = 'system' | 'on' | 'off'

/**
 * 动效时长（毫秒）。这是整个渲染层动效的**单一来源**。
 *
 * CSS 侧的同名 token 在 styles.css 的 `:root { --motion-* }`，两处必须取同一个值：
 * JS 拿它算 Motion for React 的 duration，CSS 拿它驱动过渡与关键帧。
 * 改一项要同时改 styles.css，并确认该变量也在 `:root[data-motion="off"]` 的归零列表里。
 */
export const MOTION_DURATIONS = {
  hover: 120,
  press: 100,
  pageEnter: 180,
  conversationEnter: 160,
  sidebar: 220,
  /** 菜单 / 浮层的出现：贴着触发按钮，快一点才跟手。 */
  popoverOpen: 140,
  popoverClose: 100,
  /** 对话框与遮罩：面积大、内容多，比菜单慢一档才不生硬。 */
  dialog: 200,
  dialogClose: 140,
  expand: 180,
  newConversation: 200,
  focus: 140,
  newMessage: 160,
  status: 180,
  copyOrChange: 140
} as const

/**
 * 统一缓动：平滑减速，与 styles.css 的 `--motion-ease` 是同一条曲线。
 *
 * 历史上 JS 用 cubic-bezier(0.2, 0, 0, 1)、CSS 用 cubic-bezier(0.2, 0.8, 0.2, 1)，
 * 两条曲线让同一套交互的 JS 补间与 CSS 过渡对不齐（收尾速度明显不同）。
 * 这里以 CSS 既有取值为准收敛成单一来源——CSS 有上百处引用，改 JS 侧回归面最小。
 */
export const MOTION_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/**
 * 与 MOTION_EASING 同一条曲线的控制点：Motion for React 的 ease 不收 CSS 字符串。
 * 声明成可变元组，正好对上 Motion 的 BezierDefinition；readonly 元组赋不过去。
 */
export const MOTION_EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1]

/** Motion 的 duration 单位是秒，token 是毫秒。 */
export function motionSeconds(ms: number): number {
  return ms / 1000
}
