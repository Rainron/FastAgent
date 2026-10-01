import { describe, expect, it } from 'vitest'
import { toolLine } from './QuickChat'

describe('toolLine', () => {
  it('入参摘要优先于工具名，空白折叠成单行', () => {
    expect(toolLine({ tool: 'bash', input: 'winget  install\n  Git.Git' })).toBe('bash · winget install Git.Git')
  })

  it('没有入参时退回 detail，两者都没有只留工具名', () => {
    expect(toolLine({ tool: 'read', detail: 'C:\\tmp\\a.txt' })).toBe('read · C:\\tmp\\a.txt')
    expect(toolLine({ tool: 'read' })).toBe('read')
  })

  it('超长摘要截断，避免单行撑破小窗', () => {
    const line = toolLine({ tool: 'bash', input: 'x'.repeat(200) })
    expect(line.endsWith('…')).toBe(true)
    expect(line.length).toBe('bash · '.length + 81)
  })
})
