import { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'

export interface MentionMenuItem {
  name: string
  description: string
  kind?: 'command' | 'skill' | 'cli'
}

/** 输入框 / 补全的候选列表（skill 与内置命令）。键盘导航由 Composer 负责，这里只管展示与点选。 */
export function SkillMentionMenu({ matches, activeIndex, onHover, onSelect }: {
  matches: MentionMenuItem[]
  activeIndex: number
  onHover: (index: number) => void
  onSelect: (item: MentionMenuItem) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)

  // 候选超出 max-height 后会滚动，选中项跟不上滚动就等于方向键「没反应」。
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, matches])

  return <div className="mention-menu" ref={listRef} role="listbox" aria-label="可用 skill">
    {matches.map((item, index) => (
      <button
        key={item.name}
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
        <Sparkles size={13} />
        <strong>{item.name}</strong>
        {item.kind && <small className="mention-kind">{item.kind === 'command' ? 'command' : item.kind === 'skill' ? 'Skill' : 'CLI'}</small>}
        <span>{item.description}</span>
      </button>
    ))}
  </div>
}
