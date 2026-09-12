import { describe, expect, it } from 'vitest'
import { nextActivityRunStatus, resolveEventTurnId } from './activity'

describe('resolveEventTurnId', () => {
  it('优先使用事件携带的 turnId，避免计划进度归属到错误回合', () => {
    expect(resolveEventTurnId({ turnId: 'event-turn' }, 'mapped-turn', 'active-turn')).toBe('event-turn')
  })

  it('兼容缺少 turnId 的旧事件并依次回退映射和活动回合', () => {
    expect(resolveEventTurnId({}, 'mapped-turn', 'active-turn')).toBe('mapped-turn')
    expect(resolveEventTurnId({}, undefined, 'active-turn')).toBe('active-turn')
    expect(resolveEventTurnId({}, undefined, null)).toBeNull()
  })
})

describe('run status', () => {
  it('keeps a completed activity terminal when a late event arrives', () => {
    expect(nextActivityRunStatus('done', 'tool_result')).toBe('done')
  })

  it('treats interrupted as a terminal run state', () => {
    expect(nextActivityRunStatus('working', 'interrupted')).toBe('done')
  })

  it('stays working while the run is active', () => {
    expect(nextActivityRunStatus('working', 'tool_result')).toBe('working')
  })

  it('marks completed as terminal', () => {
    expect(nextActivityRunStatus('working', 'completed')).toBe('done')
  })
})
