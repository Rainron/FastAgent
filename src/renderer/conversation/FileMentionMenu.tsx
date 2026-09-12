import { useEffect, useRef } from 'react'
import { FileText, Folder } from 'lucide-react'
import type { WorkspaceFileMatch } from '../../shared/types'

/** 输入框 @ 补全的候选列表。键盘导航由 Composer 负责，这里只管展示与点选。 */
export function FileMentionMenu({ matches, activeIndex, onHover, onSelect }: {
  matches: WorkspaceFileMatch[]
  activeIndex: number
  onHover: (index: number) => void
  onSelect: (match: WorkspaceFileMatch) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)

  // 候选超出 max-height 后会滚动，选中项跟不上滚动就等于方向键「没反应」。
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, matches])

  return <div className="mention-menu" ref={listRef} role="listbox" aria-label="工作区文件">
    {matches.map((match, index) => (
      <button
        key={match.path}
        type="button"
        role="option"
        aria-selected={index === activeIndex}
        data-active={index === activeIndex}
        className={index === activeIndex ? 'active' : ''}
        // 用 mousemove 而不是 mouseenter：键盘滚动把候选滑到静止的指针下时不该抢走选中项。
        onMouseMove={() => onHover(index)}
        // textarea 的 blur 会先于 click 触发把菜单关掉，这里拦下默认的焦点转移。
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onSelect(match)}
      >
        <MatchIcon match={match} />
        <strong>{match.name}</strong>
        <span>{match.path}</span>
      </button>
    ))}
  </div>
}

/** 目录候选用文件夹图标区分；其余保持文件图标。 */
function MatchIcon({ match }: { match: WorkspaceFileMatch }) {
  return match.isDirectory ? <Folder size={13} /> : <FileText size={13} />
}
