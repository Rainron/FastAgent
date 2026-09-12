export const MAX_RESULT_BYTES = 256 * 1024
export const MAX_STORED_SUMMARY_BYTES = 8 * 1024

const TRUNCATION_MARKER = '\n\n…[输出已截断]…\n\n'

/** 按 UTF-8 字节数截取前缀，不切断多字节字符。 */
function prefixBytes(text: string, maxBytes: number): string {
  let bytes = 0
  let index = 0
  for (; index < text.length; index++) {
    const charBytes = Buffer.byteLength(text[index], 'utf8')
    if (bytes + charBytes > maxBytes) break
    bytes += charBytes
  }
  return text.slice(0, index)
}

/** 按 UTF-8 字节数截取后缀，不切断多字节字符。 */
function suffixBytes(text: string, maxBytes: number): string {
  let bytes = 0
  let index = text.length
  while (index > 0) {
    const char = text[index - 1]
    const charBytes = Buffer.byteLength(char, 'utf8')
    if (bytes + charBytes > maxBytes) break
    bytes += charBytes
    index -= 1
  }
  return text.slice(index)
}

/** 超出上限保留头尾并标注 truncated。 */
export function truncateText(text: string, maxBytes = MAX_RESULT_BYTES): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, 'utf8')
  if (maxBytes <= markerBytes) return TRUNCATION_MARKER
  const headBytes = Math.floor((maxBytes - markerBytes) * 0.6)
  const tailBytes = maxBytes - markerBytes - headBytes
  return `${prefixBytes(text, headBytes)}${TRUNCATION_MARKER}${suffixBytes(text, tailBytes)}`
}

const KEY_VALUE_PATTERN = /(?:\b)(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd)(\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s"'&|;,]+)/gi
const PRIVATE_KEY_BLOCK = /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY)---[\s\S]*?-----END \1-----/g

/** 密钥脱敏：键值对与私钥块替换为掩码。传入 tool_result 钩子改写回模型的内容。 */
export function maskSecrets(text: string): string {
  let masked = text.replace(PRIVATE_KEY_BLOCK, '-----BEGIN $1-----[已脱敏]-----END $1-----')
  masked = masked.replace(KEY_VALUE_PATTERN, '$1$2******')
  return masked
}

export interface GuardedText {
  text: string
  truncated: boolean
}

export function guardToolText(text: string, maxBytes = MAX_RESULT_BYTES): GuardedText {
  const masked = maskSecrets(text)
  if (Buffer.byteLength(masked, 'utf8') <= maxBytes) return { text: masked, truncated: false }
  return { text: truncateText(masked, maxBytes), truncated: true }
}