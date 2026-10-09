import { useLayoutEffect, useRef, useState } from 'react'
import { MOTION_DURATIONS, motionEnabled } from '../../motion'

export type SidebarPhase = 'expanded' | 'collapsing' | 'collapsed' | 'expanding'

/**
 * 侧栏收起 / 展开的过渡阶段。
 *
 * 宽度一直有过渡，但文字原来是 collapsed 一上就 display: none：收起时文字当场消失、只剩宽度在缩，
 * 展开时文字在 52px 宽里挤成一团再慢慢撑开。中间插一个过渡阶段：这段时间里内容按展开宽度排版、
 * 被侧栏裁切，文字淡出 / 淡入，阶段结束才切到最终的收起布局。
 * 用 layout effect 切阶段：普通 effect 会先按旧阶段画一帧，展开时正好闪一下挤成一团的样子。
 */
export function useSidebarPhase(collapsed: boolean): SidebarPhase {
  const [phase, setPhase] = useState<SidebarPhase>(collapsed ? 'collapsed' : 'expanded')
  const first = useRef(true)
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return }
    if (!motionEnabled()) { setPhase(collapsed ? 'collapsed' : 'expanded'); return }
    setPhase(collapsed ? 'collapsing' : 'expanding')
    const timer = window.setTimeout(() => setPhase(collapsed ? 'collapsed' : 'expanded'), MOTION_DURATIONS.sidebar)
    return () => window.clearTimeout(timer)
  }, [collapsed])
  return phase
}
