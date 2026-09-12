import { describe, expect, it } from 'vitest'
import { createPromptHistory, type PromptHistoryStorage } from './prompt-history'

function memoryStorage(): PromptHistoryStorage & { items: string[] } {
  let items: string[] = []
  return {
    get items() { return items },
    set items(next) { items = next },
    load() { return [...items] },
    save(next) { items = [...next] }
  }
}

describe('createPromptHistory record', () => {
  it('去除首尾空白，忽略空输入', () => {
    const history = createPromptHistory()
    history.record('  你好  ')
    history.record('   ')
    const first = history.up('')
    expect(first).toBe('你好')
    history.cancel()
    expect(history.up('')).toBe('你好')
  })

  it('相邻重复不重复记录', () => {
    const history = createPromptHistory()
    history.record('查一下')
    history.record('查一下')
    history.up('')
    expect(history.down()).toBe('')
  })

  it('超出上限时丢弃最旧条目', () => {
    const history = createPromptHistory({ limit: 3 })
    history.record('a'); history.record('b'); history.record('c'); history.record('d')
    // 最近一条是 d，最早的 a 已被挤出
    expect(history.up('')).toBe('d')
    expect(history.up('')).toBe('c')
    expect(history.up('')).toBe('b')
    history.cancel()
  })
})

describe('createPromptHistory browse', () => {
  it('按最近到最旧的顺序浏览，Down 逐条返回并最终恢复草稿', () => {
    const history = createPromptHistory()
    history.record('第一')
    history.record('第二')
    history.record('第三')
    expect(history.up('临时草稿')).toBe('第三')
    expect(history.isBrowsing()).toBe(true)
    expect(history.up('临时草稿')).toBe('第二')
    expect(history.up('临时草稿')).toBe('第一')
    // 已到最旧，继续 Up 停留
    expect(history.up('临时草稿')).toBe('第一')
    expect(history.down()).toBe('第二')
    expect(history.down()).toBe('第三')
    // 到底恢复草稿并退出浏览
    expect(history.down()).toBe('临时草稿')
    expect(history.isBrowsing()).toBe(false)
    expect(history.down()).toBeNull()
  })

  it('Up 后 Down 一步不退草稿也能退出：无历史时 Up 返回 null', () => {
    const history = createPromptHistory()
    expect(history.up('')).toBeNull()
    expect(history.down()).toBeNull()
    expect(history.cancel()).toBeNull()
  })

  it('取消浏览恢复草稿', () => {
    const history = createPromptHistory()
    history.record('历史 A')
    expect(history.up('我的草稿')).toBe('历史 A')
    expect(history.cancel()).toBe('我的草稿')
    expect(history.isBrowsing()).toBe(false)
  })

  it('浏览中手动编辑内容则退出浏览并丢弃草稿', () => {
    const history = createPromptHistory()
    history.record('历史 A')
    expect(history.up('草稿')).toBe('历史 A')
    history.previewEdited('历史 A')
    expect(history.isBrowsing()).toBe(true)
    history.previewEdited('我改了内容')
    expect(history.isBrowsing()).toBe(false)
    expect(history.cancel()).toBeNull()
  })
})

describe('createPromptHistory storage', () => {
  it('record 持久化，重新创建的实例能读到历史', () => {
    const storage = memoryStorage()
    const first = createPromptHistory({ storage })
    first.record('持久化条目')
    const second = createPromptHistory({ storage })
    expect(second.up('')).toBe('持久化条目')
    second.cancel()
  })
})