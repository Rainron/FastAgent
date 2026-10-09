import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ArchiveEntry, ArchiveSelection } from './archive-selection'
import { entryState, setEntryModels, toggleEntry } from './archive-selection'
import { ModelPickList } from './ModelPickList'

/** 连接 + 连接内模型的两级勾选列表，导入与导出弹层共用。 */
export function ArchiveEntryList({ entries, selection, onChange }: {
  entries: ArchiveEntry[]
  selection: ArchiveSelection
  onChange: (selection: ArchiveSelection) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggleExpanded(key: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return <ul className="bundle-entry-list archive-entry-list">
    {entries.map((entry) => {
      const state = entryState(selection, entry)
      const picked = selection[entry.key] ?? []
      const open = expanded.has(entry.key)
      return <li key={entry.key}>
        <div className="archive-entry-row">
          <label>
            <input type="checkbox" checked={state !== 'none'} ref={(node) => { if (node) node.indeterminate = state === 'partial' }} onChange={() => onChange(toggleEntry(selection, entry))} />
            <strong>{entry.name}</strong>
            <span>{entry.meta}</span>
            {entry.note && <small>{entry.note}</small>}
          </label>
          {entry.models.length > 0 && <button type="button" className="small-control" aria-expanded={open} onClick={() => toggleExpanded(entry.key)}>
            <ChevronRight size={13} className={open ? 'open' : ''} />{picked.length}/{entry.models.length} 模型
          </button>}
        </div>
        {open && entry.models.length > 0 && <div className="archive-entry-models">
          <div className="archive-entry-model-actions">
            <button type="button" className="small-control" disabled={state === 'all'} onClick={() => onChange(setEntryModels(selection, entry, entry.models.map((model) => model.id)))}>全选模型</button>
            <button type="button" className="small-control" disabled={state === 'none'} onClick={() => onChange(setEntryModels(selection, entry, []))}>清空模型</button>
          </div>
          <ModelPickList
            items={entry.models.map((model) => ({ id: model.id, label: model.label }))}
            selected={new Set(picked)}
            onChange={(next) => onChange(setEntryModels(selection, entry, entry.models.map((model) => model.id).filter((id) => next.has(id))))}
          />
        </div>}
      </li>
    })}
  </ul>
}
