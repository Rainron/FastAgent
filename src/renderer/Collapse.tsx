import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { MOTION_DURATIONS } from './motion'
import { useDelayedUnmount } from './use-delayed-unmount'

/**
 * 展开 / 折叠容器。
 *
 * 高度用 grid-template-rows 从 0fr 过渡到 1fr：内容高度未知也能真正「长出来」，
 * 不用先量一遍再写死 px，也就不会在内容变化时卡在旧高度上。
 * 收起时先播完过渡再卸载子节点，所以折叠不是一帧消失。
 *
 * appear=false 时首次挂载就处于展开态、不播展开动画：对话历史里默认展开的块
 * 一打开会话就齐刷刷往下长，既晃眼又白白触发整页重排。
 */
export function Collapse({ open, className, appear = true, children }: { open: boolean; className?: string; appear?: boolean; children: ReactNode }) {
  const mounted = useDelayedUnmount(open, MOTION_DURATIONS.sidebar)
  const [entered, setEntered] = useState(() => open && !appear)
  const nodeRef = useRef<HTMLDivElement>(null)
  // 过渡要有起点：节点先以 0fr 挂上，强制浏览器按 0fr 算一次样式，再切 1fr。
  // 不用 requestAnimationFrame 等一帧：窗口隐藏 / 最小化时 rAF 整个暂停，块会一直折着；
  // 只等一帧也常常赶在 0fr 那一帧绘制之前，展开就成了一下弹开。
  useLayoutEffect(() => {
    if (!open) { setEntered(false); return }
    if (!mounted || entered || !nodeRef.current) return
    void nodeRef.current.offsetHeight
    setEntered(true)
  // entered 只作为「已经展开过」的短路条件，变化时不需要重跑。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted])
  if (!mounted) return null
  return <div ref={nodeRef} className={`collapse${entered && open ? ' open' : ''}${className ? ` ${className}` : ''}`}>
    <div className="collapse-inner">{children}</div>
  </div>
}
