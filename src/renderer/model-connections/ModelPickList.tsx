import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { groupByModelPrefix } from './model-grouping'

export interface ModelPickItem {
  id: string
  label: string
  /** 已在连接里的模型：显示为选中但不可改。 */
  disabled?: boolean
  note?: string
}

/** 按模型 id 前缀折成一层树的勾选列表，「获取模型」与导入导出弹层共用。 */
export function ModelPickList({ items, selected, onChange }: {
  items: ModelPickItem[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const groups = useMemo(() => groupByModelPrefix(items), [items])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  function setMany(ids: string[], select: boolean) {
    const next = new Set(selected)
    for (const id of ids) {
      if (select) next.add(id)
      else next.delete(id)
    }
    onChange(next)
  }

  function row(item: ModelPickItem) {
    return <label className="model-pick-row" key={item.id}>
      <input type="checkbox" checked={item.disabled || selected.has(item.id)} disabled={item.disabled} onChange={() => toggle(item.id)} />
      <strong>{item.label}</strong>
      {item.label !== item.id && <span>{item.id}</span>}
      {item.note && <small>{item.note}</small>}
    </label>
  }

  return <div className="model-pick-list">
    {groups.map((group, index) => {
      if (!group.prefix) return row(group.items[0])
      const selectable = group.items.filter((item) => !item.disabled)
      const picked = selectable.filter((item) => selected.has(item.id))
      const state = !selectable.length || picked.length === selectable.length ? 'all' : picked.length ? 'partial' : 'none'
      const open = !collapsed.has(group.prefix)
      return <div className="model-pick-group" key={`${group.prefix}-${index}`}>
        <div className="model-pick-group-head">
          <label>
            <input type="checkbox" checked={state !== 'none'} disabled={!selectable.length}
              ref={(node) => { if (node) node.indeterminate = state === 'partial' }}
              onChange={() => setMany(selectable.map((item) => item.id), state !== 'all')} />
            <strong>{group.prefix}</strong>
            <span>{picked.length + group.items.length - selectable.length}/{group.items.length}</span>
          </label>
          <button type="button" className="small-control" aria-expanded={open} aria-label={`${open ? '收起' : '展开'} ${group.prefix}`}
            onClick={() => setCollapsed((current) => {
              const next = new Set(current)
              if (next.has(group.prefix)) next.delete(group.prefix)
              else next.add(group.prefix)
              return next
            })}><ChevronRight size={13} className={open ? 'open' : ''} /></button>
        </div>
        {open && <div className="model-pick-group-body">{group.items.map(row)}</div>}
      </div>
    })}
    {!items.length && <p className="model-discovered-empty">没有匹配的模型</p>}
  </div>
}
