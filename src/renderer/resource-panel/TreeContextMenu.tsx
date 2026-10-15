import React, { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDismiss } from '../use-dismiss'

/**
 * 树的右键菜单外壳：只管定位与关闭，菜单项由使用方给。
 * Workspace 与 Artifacts 两棵树的可用操作不同，但交互与外观必须一致。
 *
 * 挂到 body 而不是留在面板里：菜单用的是 position: fixed + 视口坐标，
 * 只要祖先链上出现 transform / filter / backdrop-filter（资源面板的入场动画就带 transform），
 * fixed 的包含块会变成那个祖先，菜单被整体平移到屏幕外——表现就是「右键没反应」。
 */
export function TreeContextMenu({ x, y, onDismiss, children }: { x: number; y: number; onDismiss: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(true, onDismiss, ref)
  return createPortal(
    <div className="tree-context-menu" style={{ left: x, top: y }} ref={ref} role="menu">{children}</div>,
    document.body
  )
}
