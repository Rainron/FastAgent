// 输入框 ↑/↓ 浏览发送历史的纯逻辑：shell 式（最近一条先出现），
// 进入浏览时暂存当前草稿，翻到底或取消时恢复；持久化由调用方注入。

export interface PromptHistoryStorage {
  load(): string[]
  save(items: string[]): void
}

/** localStorage 持久化适配：损坏的旧数据直接丢弃，读写失败静默降级为内存。 */
export function createLocalStoragePromptHistory(key: string): PromptHistoryStorage {
  return {
    load() {
      try {
        const raw = window.localStorage.getItem(key)
        if (!raw) return []
        const parsed = JSON.parse(raw) as unknown
        return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : []
      } catch {
        return []
      }
    },
    save(items) {
      try {
        window.localStorage.setItem(key, JSON.stringify(items))
      } catch {
        /* 存储不可用（隐私模式配额等）时静默降级为仅内存 */
      }
    }
  }
}

export interface PromptHistory {
  /** 记录一条已发送的输入：去掉首尾空白、忽略与上一条相同的重复项、超出上限丢弃最旧。 */
  record(text: string): void
  /** 当前是否处于浏览历史状态（决定 ↓ / Esc / 编辑的默认行为）。 */
  isBrowsing(): boolean
  /** ↑：首次进入时暂存当前草稿并跳到最近一条，之后逐条向前；无历史返回 null。 */
  up(currentText: string): string | null
  /** ↓：向较新的条目翻，翻到底恢复暂存草稿并退出浏览；未在浏览时返回 null。 */
  down(): string | null
  /** 取消浏览（Esc），恢复暂存草稿并退出；未在浏览时返回 null。 */
  cancel(): string | null
  /** 浏览中用户手动编辑：内容与当前条目不同即退出浏览并丢弃草稿。 */
  previewEdited(text: string): void
}

export function createPromptHistory(options?: { limit?: number; storage?: PromptHistoryStorage }): PromptHistory {
  const limit = options?.limit ?? 100
  const storage = options?.storage ?? null
  const items: string[] = storage ? storage.load() : []
  let index = -1
  let draft: string | null = null

  function persist() {
    storage?.save(items)
  }

  return {
    record(text) {
      const value = text.trim()
      if (!value || value === items[items.length - 1]) return
      items.push(value)
      if (items.length > limit) items.shift()
      persist()
    },
    isBrowsing() {
      return index >= 0
    },
    up(currentText) {
      if (items.length === 0) return null
      if (index === -1) {
        draft = currentText
        index = items.length - 1
      } else if (index > 0) {
        index -= 1
      }
      // 已到最旧一条时停留原地（返回当前值，UI 统一 preventDefault）。
      return items[index] ?? null
    },
    down() {
      if (index === -1) return null
      if (index < items.length - 1) {
        index += 1
        return items[index] ?? null
      }
      const restored = draft
      index = -1
      draft = null
      return restored
    },
    cancel() {
      if (index === -1) return null
      const restored = draft
      index = -1
      draft = null
      return restored
    },
    previewEdited(text) {
      if (index === -1) return
      if (items[index] === text) return
      index = -1
      draft = null
    }
  }
}