/**
 * 流式文本代理对修复：网关按字节/码元分块时，非 BMP 字符（如旗帜 emoji 🇪🇸）
 * 可能被从代理对中间切开，孤立代理项到达渲染层后显示为 U+FFFD 乱码。
 * 在主进程 token 流入口把跨增量的代理对拼回去，拼不上的孤立代理项替换为 U+FFFD。
 */

export interface StreamTextRepair {
  /** 输入一个增量，返回修复后可安全转发/落库的文本 */
  push(text: string): string
  /** 流结束时调用：返回末尾残留（不完整字符）对应的替换符 */
  flush(): string
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

export function createStreamTextRepair(): StreamTextRepair {
  let pending = ''

  function push(text: string): string {
    let out = pending + text
    pending = ''
    let result = ''
    let i = 0
    while (i < out.length) {
      const code = out.charCodeAt(i)
      if (isHighSurrogate(code)) {
        const next = out.charCodeAt(i + 1)
        if (isLowSurrogate(next)) {
          // 完整代理对：原样保留
          result += out.slice(i, i + 2)
          i += 2
          continue
        }
        if (i + 1 === out.length) {
          // 增量末尾的孤立高位代理：可能是被切开的代理对前半，暂存等下一个增量
          pending = out.slice(i)
          break
        }
        result += '\uFFFD'
        i += 1
        continue
      }
      if (isLowSurrogate(code)) {
        // 孤立低位代理：前半已丢失，无法恢复
        result += '\uFFFD'
        i += 1
        continue
      }
      result += out[i]
      i += 1
    }
    return result
  }

  function flush(): string {
    const rest = pending
    pending = ''
    return rest ? '\uFFFD' : ''
  }

  return { push, flush }
}
