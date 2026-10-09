import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useDismiss } from '../use-dismiss'
import { useDelayedUnmount } from '../use-delayed-unmount'
import { MOTION_DURATIONS } from '../motion'

/**
 * 自绘下拉框。
 *
 * 原生 `<select>` 的弹出列表由操作系统画，CSS 完全管不到：Windows 上是一整块系统蓝高亮，
 * 与应用其余部分的圆角、配色、间距全对不上。这里只保留原生的键盘语义，外观自己画。
 */

export interface SelectOption {
  value: string
  label: string
  /** 第二行说明；挡位含义不明显时用它交代，例如「0.7（常用）」之外的补充。 */
  description?: string
}

function optionLabel(options: SelectOption[], value: string, placeholder: string): string {
  return options.find((option) => option.value === value)?.label ?? placeholder
}

export function Select({ value, options, placeholder = '请选择', disabled, ariaLabel, className, onChange }: {
  value: string
  options: SelectOption[]
  /** 值为空串时显示的文案；同时作为列表里「不设置」那一项的标题。 */
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
  className?: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, rootRef)
  const mounted = useDelayedUnmount(open, MOTION_DURATIONS.popoverClose)

  // 空串（跟随默认/留空）始终是第一项：它是一个真实取值，不能只当占位文字。
  const items = useMemo<SelectOption[]>(() => [{ value: '', label: placeholder }, ...options], [options, placeholder])
  const selectedIndex = Math.max(0, items.findIndex((item) => item.value === value))

  useEffect(() => {
    if (open) setActiveIndex(selectedIndex)
  }, [open, selectedIndex])

  // 打开时把选中项滚进视野：挡位列表可能比弹层高，否则看不到当前值在哪。
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  function commit(next: string) {
    onChange(next)
    setOpen(false)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (disabled) return
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setOpen(true)
      }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((current) => (current + step + items.length) % items.length)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActiveIndex(event.key === 'Home' ? 0 : items.length - 1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      commit(items[activeIndex]?.value ?? '')
    }
  }

  return <div className={`ui-select${open ? ' open' : ''}${disabled ? ' disabled' : ''}${className ? ` ${className}` : ''}`} ref={rootRef}>
    <button
      type="button"
      className="ui-select-trigger"
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={ariaLabel}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={onKeyDown}
    >
      <span className={`ui-select-value${value ? '' : ' placeholder'}`}>{optionLabel(options, value, placeholder)}</span>
      <ChevronDown size={14} className="ui-select-caret" />
    </button>
    {mounted && <div className={`ui-select-menu${open ? '' : ' closing'}`} role="listbox" aria-label={ariaLabel} ref={listRef}>
      {items.map((item, index) => {
        const selected = item.value === value
        return <button
          key={item.value || '__empty__'}
          type="button"
          role="option"
          aria-selected={selected}
          data-active={index === activeIndex}
          className={`ui-select-option${selected ? ' selected' : ''}`}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => commit(item.value)}
        >
          <span className="ui-select-option-body">
            <span className="ui-select-option-label">{item.label}</span>
            {item.description && <span className="ui-select-option-desc">{item.description}</span>}
          </span>
          {selected && <Check size={13} className="ui-select-check" />}
        </button>
      })}
    </div>}
  </div>
}
