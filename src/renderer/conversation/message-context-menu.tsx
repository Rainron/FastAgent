import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface ContextMenuItem {
  id: string
  label: string
  danger?: boolean
  onSelect: () => void
}

/** 菜单默认尺寸估算值：定位时若超出视口再按真实尺寸翻转。 */
const ESTIMATED_MENU_WIDTH = 180
const ESTIMATED_MENU_HEIGHT = 240

/**
 * 计算菜单左上角坐标：默认贴光标右下，越界时向上/向左翻转并夹回视口内。
 * 独立成纯函数方便单测。
 */
export function clampMenuPosition(x: number, y: number, viewportWidth: number, viewportHeight: number, menuWidth = ESTIMATED_MENU_WIDTH, menuHeight = ESTIMATED_MENU_HEIGHT): { x: number; y: number } {
  const maxX = Math.max(0, viewportWidth - menuWidth)
  const maxY = Math.max(0, viewportHeight - menuHeight)
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY)
  }
}

/**
 * 消息右键菜单：消息划选文本后右键弹出，提供复制/引用/编辑等上下文操作。
 * 点击菜单外、按 Escape 或滚动对话区都会关闭。
 */
export function MessageContextMenu({ x, y, items, onClose }: { x: number; y: number; items: ContextMenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(() => clampMenuPosition(x, y, window.innerWidth, window.innerHeight))

  // 渲染后按真实尺寸再校正一次，避免长菜单底部越界。
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    setPos(clampMenuPosition(x, y, window.innerWidth, window.innerHeight, node.offsetWidth, node.offsetHeight))
  }, [x, y])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    // 用 pointerdown 而非 click：消息区自己的 onClick 不受影响，菜单外按下即关闭。
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && event.target instanceof Node && ref.current.contains(event.target)) return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div ref={ref} className="context-menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((item) => (
        <button
          key={item.id}
          role="menuitem"
          className={item.danger ? 'danger-menu-item' : undefined}
          onClick={() => { onClose(); item.onSelect() }}
        >{item.label}</button>
      ))}
    </div>
  )
}

/** 从当前选区取纯文本；无选区返回空串。 */
export function selectionText(): string {
  return window.getSelection()?.toString().trim() ?? ''
}


