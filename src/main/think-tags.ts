/**
 * 部分 OpenAI 兼容通道不走 reasoning 字段，把推理直接写进正文的 `<think>…</think>` 里。
 * 这类内容不剥离就会原样出现在最终回答中，折叠层根本拿不到它。
 * 这里在流式增量上按标签切开：标签内的走 thinking 通道，标签外的才是正文。
 */

const OPEN_TAGS = ['<think>', '<thinking>']
const CLOSE_TAGS = ['</think>', '</thinking>']
const ALL_TAGS = [...OPEN_TAGS, ...CLOSE_TAGS]

export type ThinkPart = { kind: 'text' | 'thinking'; text: string }

export interface ThinkTagSplitter {
  /** 吃一段增量，按出现顺序返回正文段与思考段；标签被切开时尾巴留到下一段再判。 */
  push(chunk: string): ThinkPart[]
  /** 流结束：把没等到闭合标签的残留吐出来，不能吞内容。 */
  flush(): ThinkPart[]
  /** 当前是否停在思考标签内。 */
  readonly inThinking: boolean
}

function tagAt(source: string, at: number, tags: string[]): string | null {
  for (const tag of tags) if (source.startsWith(tag, at)) return tag
  return null
}

/** 尾部可能是被网关切开的标签前缀，留到下一块拼上再判，否则会把半截标签当正文放出去。 */
function isTagPrefix(rest: string): boolean {
  return ALL_TAGS.some((tag) => tag.startsWith(rest))
}

export function createThinkTagSplitter(): ThinkTagSplitter {
  let pending = ''
  let inThinking = false

  const consume = (buffer: string, final: boolean): ThinkPart[] => {
    const parts: ThinkPart[] = []
    const emit = (text: string) => {
      if (!text) return
      const kind: ThinkPart['kind'] = inThinking ? 'thinking' : 'text'
      const last = parts[parts.length - 1]
      if (last && last.kind === kind) last.text += text
      else parts.push({ kind, text })
    }
    let index = 0
    let start = 0
    while (index < buffer.length) {
      if (buffer[index] !== '<') { index += 1; continue }
      const open = tagAt(buffer, index, OPEN_TAGS)
      const close = tagAt(buffer, index, CLOSE_TAGS)
      if (open && !inThinking) {
        emit(buffer.slice(start, index))
        inThinking = true
        index += open.length
        start = index
        continue
      }
      if (close && inThinking) {
        emit(buffer.slice(start, index))
        inThinking = false
        index += close.length
        start = index
        continue
      }
      // 标签被切在块边界上：剩下的先扣住，别当正文放出去。收尾时没有下一块了，按普通文本处理。
      if (!final && !open && !close && isTagPrefix(buffer.slice(index))) {
        emit(buffer.slice(start, index))
        pending = buffer.slice(index)
        return parts
      }
      index += 1
    }
    emit(buffer.slice(start))
    return parts
  }

  return {
    push(chunk) {
      if (!chunk) return []
      const buffer = pending + chunk
      pending = ''
      return consume(buffer, false)
    },
    flush() {
      if (!pending) return []
      const buffer = pending
      pending = ''
      return consume(buffer, true)
    },
    get inThinking() { return inThinking }
  }
}

export type ThinkStreamEvent =
  | { type: 'token' | 'thinking'; text: string }
  | { type: 'thinking_started' | 'thinking_ended' }

export interface InlineThinkStream {
  /**
   * 吃一段正文增量，返回要发出的事件序列。
   * `thinkingOpen` 是调用方当前的思考通道状态：原生通道已经开着时不重复发 thinking_started。
   */
  push(chunk: string, thinkingOpen: boolean): ThinkStreamEvent[]
  /** 流结束：残留放出来，还开着的内联思考收掉。 */
  flush(thinkingOpen: boolean): ThinkStreamEvent[]
  /** 内联思考是否开着。调用方据此屏蔽原生通道那条与内联思考无关的 thinking_ended。 */
  readonly inThinking: boolean
}

/**
 * 把内联 `<think>` 的正文增量翻译成事件流。起止只跟着标签翻转：
 * 跟着调用方的 thinkingActive 走会出事——那个每来一块 text_delta 都被原生映射复位，
 * 于是每块增量都补一对 started/ended，一段思考被切成几十段，展开后每段之间多一个空行。
 */
export function createInlineThinkStream(): InlineThinkStream {
  const splitter = createThinkTagSplitter()
  let inThinking = false

  const translate = (parts: ThinkPart[], thinkingOpen: boolean): ThinkStreamEvent[] => {
    const events: ThinkStreamEvent[] = []
    let open = thinkingOpen
    for (const part of parts) {
      if (part.kind === 'thinking') {
        if (!inThinking) {
          inThinking = true
          if (!open) { open = true; events.push({ type: 'thinking_started' }) }
        }
        events.push({ type: 'thinking', text: part.text })
      } else {
        if (inThinking) {
          inThinking = false
          open = false
          events.push({ type: 'thinking_ended' })
        }
        events.push({ type: 'token', text: part.text })
      }
    }
    return events
  }

  return {
    push(chunk, thinkingOpen) {
      return translate(splitter.push(chunk), thinkingOpen)
    },
    flush(thinkingOpen) {
      const events = translate(splitter.flush(), thinkingOpen)
      if (inThinking) {
        inThinking = false
        events.push({ type: 'thinking_ended' })
      }
      return events
    },
    get inThinking() { return inThinking }
  }
}
