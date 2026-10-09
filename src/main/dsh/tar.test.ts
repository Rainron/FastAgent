import { describe, expect, it } from 'vitest'
import { gzipSync } from 'fflate'
import { extractNpmTarball, stripPackagePrefix } from './tar'

const BLOCK = 512
const encoder = new TextEncoder()

/** 造一条 tar 记录：ustar 头 + 512 对齐的内容。校验和留空，读取端不校验。 */
function tarEntry(name: string, content: string, typeFlag = '0', prefix = '') {
  const body = encoder.encode(content)
  const blocks = Math.ceil(body.length / BLOCK) * BLOCK
  const out = new Uint8Array(BLOCK + blocks)
  out.set(encoder.encode(name), 0)
  out.set(encoder.encode(body.length.toString(8).padStart(11, '0')), 124)
  out[156] = typeFlag.charCodeAt(0)
  out.set(encoder.encode('ustar\0'), 257)
  if (prefix) out.set(encoder.encode(prefix), 345)
  out.set(body, BLOCK)
  return out
}

function tarball(...entries: Uint8Array[]) {
  const end = new Uint8Array(BLOCK * 2)
  const total = entries.reduce((sum, entry) => sum + entry.length, 0) + end.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const entry of entries) {
    out.set(entry, offset)
    offset += entry.length
  }
  out.set(end, offset)
  return gzipSync(out)
}

describe('stripPackagePrefix', () => {
  it('剥掉 npm tarball 的顶层目录', () => {
    expect(stripPackagePrefix('package/lib/index.js')).toBe('lib/index.js')
    expect(stripPackagePrefix('./package/package.json')).toBe('package.json')
  })

  it('顶层目录本身不落盘', () => {
    expect(stripPackagePrefix('package/')).toBeNull()
    expect(stripPackagePrefix('package')).toBeNull()
  })

  it('挡掉路径穿越', () => {
    expect(stripPackagePrefix('package/../../evil')).toBeNull()
    expect(stripPackagePrefix('package/a/../../../evil')).toBeNull()
  })
})

describe('extractNpmTarball', () => {
  it('解出普通文件并剥前缀', () => {
    const files = extractNpmTarball(tarball(
      tarEntry('package/package.json', '{"name":"demo"}'),
      tarEntry('package/lib/index.js', 'export const a = 1')
    ))
    expect(Object.keys(files).sort()).toEqual(['lib/index.js', 'package.json'])
    expect(new TextDecoder().decode(files['package.json'])).toBe('{"name":"demo"}')
  })

  it('跳过目录与软链接条目', () => {
    const files = extractNpmTarball(tarball(
      tarEntry('package/lib/', '', '5'),
      tarEntry('package/link.js', '', '2'),
      tarEntry('package/real.js', 'ok')
    ))
    expect(Object.keys(files)).toEqual(['real.js'])
  })

  it('支持 ustar 的 prefix 字段拼长路径', () => {
    const files = extractNpmTarball(tarball(
      tarEntry('index.js', 'deep', '0', 'package/very/deep/path')
    ))
    expect(Object.keys(files)).toEqual(['very/deep/path/index.js'])
  })

  it('pax 扩展头里的 path 覆盖后一条目的名字', () => {
    const files = extractNpmTarball(tarball(
      tarEntry('PaxHeader', `${`30 path=package/from-pax.js\n`.length} path=package/from-pax.js\n`, 'x'),
      tarEntry('package/ignored.js', 'body')
    ))
    expect(Object.keys(files)).toEqual(['from-pax.js'])
  })

  it('条目数超限时抛错', () => {
    const entries = Array.from({ length: 3 }, (_, index) => tarEntry(`package/f${index}.js`, 'x'))
    expect(() => extractNpmTarball(tarball(...entries), { maxEntries: 2 })).toThrow(/条目数超过 2/)
  })

  it('单文件超限时抛错', () => {
    expect(() => extractNpmTarball(tarball(tarEntry('package/big.js', 'x'.repeat(100))), { maxEntryBytes: 10 }))
      .toThrow(/超过单文件 10/)
  })

  it('解压后总体积超限时抛错', () => {
    const entries = [tarEntry('package/a.js', 'x'.repeat(40)), tarEntry('package/b.js', 'x'.repeat(40))]
    expect(() => extractNpmTarball(tarball(...entries), { maxTotalBytes: 50 })).toThrow(/超过 50 字节/)
  })
})
