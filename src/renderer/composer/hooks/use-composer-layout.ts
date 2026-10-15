import { useLayoutEffect, useMemo, useState, type RefObject } from 'react'
import { composerLayout, type ComposerLayoutInput } from '../composer-layout'

export function useComposerLayout(ref: RefObject<HTMLElement | null>, input: Omit<ComposerLayoutInput, 'width' | 'fontScale'>) {
  const [measurement, setMeasurement] = useState({ width: 900, fontScale: 1, toolbarHeight: 0 })
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () => {
      const toolbar = node.querySelector<HTMLElement>('.composer-toolbar')
      const probe = node.querySelector<HTMLElement>('.composer-font-probe')
      const toolbarStyle = toolbar ? getComputedStyle(toolbar) : null
      const toolbarHeight = toolbar ? toolbar.offsetHeight + (parseFloat(toolbarStyle!.marginTop) || 0) + (parseFloat(toolbarStyle!.marginBottom) || 0) : 0
      const next = { width: node.clientWidth, fontScale: Math.max(1, (probe?.offsetWidth ?? 16) / 16), toolbarHeight }
      setMeasurement((current) => current.width === next.width && current.fontScale === next.fontScale && current.toolbarHeight === next.toolbarHeight ? current : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    const toolbar = node.querySelector('.composer-toolbar')
    const probe = node.querySelector('.composer-font-probe')
    if (toolbar) observer.observe(toolbar)
    if (probe) observer.observe(probe)
    return () => observer.disconnect()
  }, [ref])
  const layout = composerLayout({ ...input, ...measurement })
  return useMemo(() => ({ ...layout, toolbarHeight: measurement.toolbarHeight }), [layout.rows, layout.density, layout.overflow, layout.iconContext, measurement.toolbarHeight])
}
