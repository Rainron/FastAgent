// 通配模式 → 锚定全串的正则。只支持 * 与 ?，其余正则元字符全部转义。

function escapeRegExpChar(char: string): string {
  return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char
}

export function patternToRegex(pattern: string): RegExp {
  let source = '^'
  for (const char of pattern) {
    if (char === '*') source += '.*'
    else if (char === '?') source += '.'
    else source += escapeRegExpChar(char)
  }
  return new RegExp(`${source}$`)
}

/** 锚定全串匹配；'*' 匹配任意内容（包括空串），'?' 匹配单个字符。 */
export function matchPattern(pattern: string, subject: string): boolean {
  return patternToRegex(pattern).test(subject)
}