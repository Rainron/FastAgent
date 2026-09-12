export type LineBoundary = 'start' | 'end'

export function lineBoundary(value: string, caret: number, boundary: LineBoundary): number {
  const position = Math.max(0, Math.min(caret, value.length))
  if (boundary === 'start') {
    const newline = value.lastIndexOf('\n', position - 1)
    return newline === -1 ? 0 : newline + 1
  }
  const newline = value.indexOf('\n', position)
  return newline === -1 ? value.length : newline
}
