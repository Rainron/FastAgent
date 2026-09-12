/**
 * 旗帜 emoji 显示降级：Windows 字体栈没有区域指示符（🇪🇸 等）的字形，
 * 渲染成方框/乱码；且网关分块损坏后可能残留 U+FFFD 与孤立区域指示符。
 * 仅用于显示层：成对区域指示符转 ISO 国家代码字母，孤立的转单个字母，
 * 替换符 U+FFFD 剔除。复制、落库仍用原始文本。
 */

const RI_BASE = 0x1f1e6

function regionalIndicatorLetter(codePoint: number): string {
  // 调用方保证 codePoint 落在区域指示符区间内
  return String.fromCharCode('A'.charCodeAt(0) + (codePoint - RI_BASE))
}

export function normalizeFlagEmoji(text: string): string {
  let result = ''
  let i = 0
  while (i < text.length) {
    const codePoint = text.codePointAt(i) as number
    const width = codePoint > 0xffff ? 2 : 1
    const nextCodePoint = i + width < text.length ? text.codePointAt(i + width) as number : NaN
    if (codePoint >= RI_BASE && codePoint <= RI_BASE + 25) {
      if (nextCodePoint >= RI_BASE && nextCodePoint <= RI_BASE + 25) {
        // 成对区域指示符：旗帜 emoji，转两国代码字母
        result += regionalIndicatorLetter(codePoint) + regionalIndicatorLetter(nextCodePoint)
        i += width + (nextCodePoint > 0xffff ? 2 : 1)
        continue
      }
      // 孤立区域指示符：本就渲染不出，转单个字母
      result += regionalIndicatorLetter(codePoint)
      i += width
      continue
    }
    if (codePoint === 0xfffd) {
      // 替换符：上游损坏残留，显示层剔除
      i += width
      continue
    }
    result += String.fromCodePoint(codePoint)
    i += width
  }
  return result
}
