import { gunzipSync } from 'fflate'

/**
 * 极简 tar 读取器。只为 npm tarball 服务：npm 打出来的包结构固定，
 * 不需要支持硬链接、稀疏文件、设备节点这些。
 * 不引第三方 tar 依赖，理由同 registry/fetcher 用 fflate 解 zip。
 */

const BLOCK = 512

export interface TarLimits {
  maxEntries: number
  maxEntryBytes: number
  maxTotalBytes: number
}

export const DEFAULT_TAR_LIMITS: TarLimits = {
  maxEntries: 5_000,
  maxEntryBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024
}

function readString(data: Uint8Array, offset: number, length: number): string {
  let end = offset
  const limit = offset + length
  while (end < limit && data[end] !== 0) end += 1
  return new TextDecoder('utf8').decode(data.subarray(offset, end))
}

/** tar 的数值字段是 0 补齐的八进制字符串。空字段按 0 处理。 */
function readOctal(data: Uint8Array, offset: number, length: number): number {
  const text = readString(data, offset, length).trim()
  if (!text) return 0
  const parsed = Number.parseInt(text, 8)
  return Number.isFinite(parsed) ? parsed : 0
}

/** pax 扩展头是 `长度 键=值\n` 的连写，这里只取需要的 path。 */
function parsePaxPath(block: Uint8Array): string | undefined {
  const text = new TextDecoder('utf8').decode(block)
  for (const line of text.split('\n')) {
    const match = /^\d+ path=(.*)$/.exec(line)
    if (match) return match[1]
  }
  return undefined
}

/**
 * 解开 .tgz。返回条目路径到内容的映射，npm tarball 统一的 `package/` 前缀会被剥掉。
 * 与 extractArchive 一样在展开过程中累计体积，挡住解压炸弹。
 */
export function extractNpmTarball(gzipped: Uint8Array, limits: Partial<TarLimits> = {}): Record<string, Uint8Array> {
  const bounds = { ...DEFAULT_TAR_LIMITS, ...limits }
  const data = gunzipSync(gzipped)
  const files: Record<string, Uint8Array> = {}
  let offset = 0
  let entries = 0
  let total = 0
  // pax / GNU 长名头把真实路径放在下一条目里，这里暂存
  let overrideName: string | undefined

  while (offset + BLOCK <= data.length) {
    const header = data.subarray(offset, offset + BLOCK)
    // 连续两个空块是归档结束标记；单个空块也当结束，npm 包不会有空洞。
    if (header.every((byte) => byte === 0)) break

    const rawName = readString(header, 0, 100)
    const size = readOctal(header, 124, 12)
    const typeFlag = String.fromCharCode(header[156] || 0x30)
    const prefix = readString(header, 345, 155)
    offset += BLOCK

    const contentBlocks = Math.ceil(size / BLOCK) * BLOCK
    const content = data.subarray(offset, offset + size)
    offset += contentBlocks

    if (typeFlag === 'x' || typeFlag === 'L') {
      overrideName = typeFlag === 'L' ? readString(content, 0, content.length) : parsePaxPath(content)
      continue
    }

    const name = overrideName ?? (prefix ? `${prefix}/${rawName}` : rawName)
    overrideName = undefined
    // 只要普通文件；目录、软链接、全局 pax 头一律跳过
    if (typeFlag !== '0' && typeFlag !== '\0') continue
    if (!name || name.endsWith('/')) continue

    entries += 1
    if (entries > bounds.maxEntries) throw new Error(`压缩包条目数超过 ${bounds.maxEntries} 上限`)
    if (size > bounds.maxEntryBytes) throw new Error(`压缩包内 ${name} 超过单文件 ${bounds.maxEntryBytes} 字节上限`)
    total += size
    if (total > bounds.maxTotalBytes) throw new Error(`压缩包解压后超过 ${bounds.maxTotalBytes} 字节上限`)

    const stripped = stripPackagePrefix(name)
    if (!stripped) continue
    files[stripped] = content
  }

  return files
}

/**
 * 剥掉 npm tarball 的顶层目录并挡住路径穿越。
 * 返回 null 表示这条目不该落盘。
 */
export function stripPackagePrefix(name: string): string | null {
  const normalized = name.replace(/\\/g, '/').replace(/^\.\//, '')
  const slash = normalized.indexOf('/')
  const inner = slash >= 0 ? normalized.slice(slash + 1) : ''
  if (!inner) return null
  if (inner.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(inner)) return null
  return inner
}
