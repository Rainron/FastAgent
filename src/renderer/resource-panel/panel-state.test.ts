import { describe, expect, it } from 'vitest'
import { defaultResourcePanelState, updateTabState, type ResourcePanelState } from './panel-state'

describe('updateTabState', () => {
  it('只改目标 Tab 的子状态，其余字段原样保留', () => {
    const base: ResourcePanelState = {
      activeTab: 'workspace',
      width: 390,
      workspace: { expanded: ['src'], scrollTop: 12, search: '', selected: null },
      artifacts: { expanded: [], scrollTop: 0, search: 'plan', selected: 'a1' }
    }
    const next = updateTabState(base, 'workspace', { expanded: ['src', 'docs'], search: 'app' })
    expect(next.workspace).toMatchObject({ expanded: ['src', 'docs'], scrollTop: 12, search: 'app', selected: null })
    // artifacts 不受影响
    expect(next.artifacts).toBe(base.artifacts)
    expect(next.activeTab).toBe('workspace')
    expect(next.width).toBe(390)
  })

  it('保持引用稳定：未改动的字段不被复制', () => {
    const base = defaultResourcePanelState()
    const next = updateTabState(base, 'artifacts', { selected: 'x' })
    expect(next.workspace).toBe(base.workspace)
    expect(next.artifacts.selected).toBe('x')
  })
})
