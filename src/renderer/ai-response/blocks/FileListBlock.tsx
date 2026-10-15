import { memo, useState } from 'react'
import { alignStartIfAbove, useHeightAnimation } from '../../motion'
import { ChevronDown, File, Folder } from 'lucide-react'
import type { FileListBlock as FileListBlockData } from '../blocks'
import { parseFileReference } from '../file-reference'
import { useResponseActions } from '../response-context'

const COLLAPSE_ROWS = 16

/** 目录/查找结果：一行一个条目，文件能直接点开预览，目录只做展示。 */
function FileListBlockView({ block }: { block: FileListBlockData }) {
  const actions = useResponseActions()
  const [expanded, setExpanded] = useState(false)
  // 展开 / 收起是原地换内容，高度从旧值补间到新值，不再一下跳变
  const height = useHeightAnimation<HTMLDivElement>()
  const collapsible = block.entries.length > COLLAPSE_ROWS
  const visible = collapsible && !expanded ? block.entries.slice(0, COLLAPSE_ROWS) : block.entries

  return (
    <div className="file-list-block" ref={height.ref}>
      <div className="file-list-head">
        <span className="file-list-base">{block.base || '工作区根目录'}</span>
        <span className="file-list-count">{block.entries.length} 项</span>
      </div>
      <div className="file-list-body">
        {visible.map((entry) => {
          const reference = entry.kind === 'file' ? parseFileReference(entry.path) : null
          const content = <>{entry.kind === 'dir' ? <Folder size={13} /> : <File size={13} />}<span>{entry.name}</span></>
          return reference
            ? <button type="button" className="file-list-row" key={entry.path} title={`预览 ${entry.path}`} onClick={() => actions.openFile(reference)}>{content}</button>
            : <div className="file-list-row static" key={entry.path} title={entry.path}>{content}</div>
        })}
      </div>
      {block.note && <p className="file-list-note">{block.note}</p>}
      {collapsible && <button type="button" className="block-expand" onClick={() => { if (expanded) alignStartIfAbove(height.ref.current); height.capture(); setExpanded((value) => !value) }} aria-expanded={expanded}>
        <ChevronDown size={13} />{expanded ? '收起' : `展开全部 ${block.entries.length} 项`}
      </button>}
    </div>
  )
}

export const FileListBlockRenderer = memo(FileListBlockView)
