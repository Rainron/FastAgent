import { useEffect, useRef } from 'react'
import { MessageSquare } from 'lucide-react'
import type { WorkspaceConversation } from '../workspace/workspace-types'

/** /resume 的最近会话列表：键盘导航由 Composer 负责，这里只管展示与点选。 */
export function ResumeMenu({ records, activeIndex, onHover, onSelect }: {
  records: WorkspaceConversation[]
  activeIndex: number
  onHover: (index: number) => void
  onSelect: (item: WorkspaceConversation) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  // 选中项超出可视高度时跟随滚动，避免方向键「没反应」。
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, records])
  return <div className="mention-menu" ref={listRef} role="listbox" aria-label="最近的会话">
    {records.map((item, index) => (
      <button
        key={item.id}
        type="button"
        role="option"
        aria-selected={index === activeIndex}
        data-active={index === activeIndex}
        className={index === activeIndex ? 'active' : ''}
        // 用 mousemove 而不是 mouseenter：键盘滚动把候选滑到静止的指针下时不该抢走选中项。
        onMouseMove={() => onHover(index)}
        // textarea 的 blur 会先于 click 触发把菜单关掉，这里拦下默认的焦点转移。
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onSelect(item)}
      >
        <MessageSquare size={13} />
        <strong>{item.title}</strong>
        <span>{new Date(item.meta).toLocaleString()}</span>
      </button>
    ))}
  </div>
}
