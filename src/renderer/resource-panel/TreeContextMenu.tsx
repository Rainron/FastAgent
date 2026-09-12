import React, { useRef } from 'react'
import { useDismiss } from '../use-dismiss'

/**
 * 树的右键菜单外壳：只管定位与关闭，菜单项由使用方给。
 * Workspace 与 Artifacts 两棵树的可用操作不同，但交互与外观必须一致。
 */
export function TreeContextMenu({ x, y, onDismiss, children }: { x: number; y: number; onDismiss: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(true, onDismiss, ref)
  return <div className="tree-context-menu" style={{ left: x, top: y }} ref={ref} role="menu">{children}</div>
}
