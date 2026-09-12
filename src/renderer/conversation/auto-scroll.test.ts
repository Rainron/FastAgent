import { describe, expect, it } from 'vitest'
import { isNearBottom, nextFollowState, scrollNavAction } from './auto-scroll'

describe('isNearBottom', () => {
  it('刚好贴底判为在底部', () => {
    expect(isNearBottom({ scrollTop: 900, scrollHeight: 1400, clientHeight: 500 })).toBe(true)
  })

  it('阈值内仍算在底部', () => {
    expect(isNearBottom({ scrollTop: 860, scrollHeight: 1400, clientHeight: 500 })).toBe(true)
  })

  it('往上翻超过阈值判为离开底部', () => {
    expect(isNearBottom({ scrollTop: 400, scrollHeight: 1400, clientHeight: 500 })).toBe(false)
  })

  it('内容不足一屏时算在底部', () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 500 })).toBe(true)
  })
})

describe('nextFollowState', () => {
  it('跟随中用户上翻则停止跟随', () => {
    expect(nextFollowState(true, { scrollTop: 100, scrollHeight: 1400, clientHeight: 500 })).toBe(false)
  })

  it('停止跟随后回到底部则恢复跟随', () => {
    expect(nextFollowState(false, { scrollTop: 900, scrollHeight: 1400, clientHeight: 500 })).toBe(true)
  })

  it('贴底时保持跟随', () => {
    expect(nextFollowState(true, { scrollTop: 900, scrollHeight: 1400, clientHeight: 500 })).toBe(true)
  })

  it('离底且未跟随时保持不跟随', () => {
    expect(nextFollowState(false, { scrollTop: 100, scrollHeight: 1400, clientHeight: 500 })).toBe(false)
  })
})

describe('scrollNavAction', () => {
  it('内容不足一屏时不显示按钮', () => {
    expect(scrollNavAction({ scrollTop: 0, scrollHeight: 400, clientHeight: 500 }, false)).toBe('none')
  })

  it('离开底部时给回到底部', () => {
    expect(scrollNavAction({ scrollTop: 100, scrollHeight: 4000, clientHeight: 500 }, false)).toBe('bottom')
  })

  it('流式输出中离开底部时换成回到最新消息', () => {
    expect(scrollNavAction({ scrollTop: 100, scrollHeight: 4000, clientHeight: 500 }, true)).toBe('latest')
  })

  it('贴底且离顶部够远时给回到顶部', () => {
    expect(scrollNavAction({ scrollTop: 3500, scrollHeight: 4000, clientHeight: 500 }, false)).toBe('top')
  })

  it('贴底但离顶部不远时不显示按钮', () => {
    expect(scrollNavAction({ scrollTop: 400, scrollHeight: 900, clientHeight: 500 }, false)).toBe('none')
  })

  it('贴底时不受流式状态影响', () => {
    expect(scrollNavAction({ scrollTop: 3500, scrollHeight: 4000, clientHeight: 500 }, true)).toBe('top')
  })
})
