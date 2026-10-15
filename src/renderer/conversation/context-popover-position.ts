export function contextPopoverPosition(anchor: { left: number; top: number; bottom: number }, viewport: { width: number; height: number }, height: number) {
  const margin = 12
  const gap = 8
  const width = Math.min(320, Math.max(0, viewport.width - margin * 2))
  const above = Math.max(0, anchor.top - gap - margin)
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin)
  const upwards = above >= Math.min(height, 240) || above >= below
  const maxHeight = Math.min(620, upwards ? above : below)
  return {
    left: Math.max(margin, Math.min(anchor.left, viewport.width - width - margin)),
    top: upwards ? Math.max(margin, anchor.top - gap - Math.min(height, maxHeight)) : anchor.bottom + gap,
    width,
    maxHeight
  }
}
