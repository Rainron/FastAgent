import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  needsRuntimeInstall,
  parseRuntimeManifest,
  prependPathEntries,
  resolveBundledRuntimeSource,
  resolveRuntimeInstallDir,
  runtimePathEntries,
  runtimePlatformKey,
  type RuntimeManifest
} from './bundled-tools'

const manifest: RuntimeManifest = {
  runtimeVersion: '2026.09',
  tools: {
    rg: { version: '15.2.0', path: 'bin/rg.exe', sha256: 'a'.repeat(64) },
    jq: { version: '1.8.2', path: 'bin/jq.exe', sha256: 'b'.repeat(64) },
    git: { version: '2.55.0.5', path: 'git/cmd/git.exe', sha256: 'c'.repeat(64) }
  }
}

describe('路径解析', () => {
  it('随包源目录按打包态区分', () => {
    expect(resolveBundledRuntimeSource({ resourcesPath: '/app/resources', projectRoot: '/src', packaged: true, platformKey: 'win32-x64' }))
      .toBe(join('/app/resources', 'runtime', 'win32-x64'))
    expect(resolveBundledRuntimeSource({ resourcesPath: '/app/resources', projectRoot: '/src', packaged: false, platformKey: 'win32-x64' }))
      .toBe(join('/src', 'resources', 'runtime', 'win32-x64'))
  })

  it('安装位置只依赖数据根，不依赖安装目录', () => {
    expect(resolveRuntimeInstallDir('C:\\Users\\me\\.fa')).toBe(join('C:\\Users\\me\\.fa', 'runtime'))
  })

  it('平台目录名由 platform 与 arch 拼成', () => {
    expect(runtimePlatformKey('win32', 'x64')).toBe('win32-x64')
    expect(runtimePlatformKey('darwin', 'arm64')).toBe('darwin-arm64')
  })
})

describe('parseRuntimeManifest', () => {
  it('解析正常清单', () => {
    expect(parseRuntimeManifest(JSON.stringify(manifest))?.tools.git)
      .toEqual({ version: '2.55.0.5', path: 'git/cmd/git.exe', sha256: 'c'.repeat(64) })
  })

  it('损坏或结构不符时返回 null，让调用方回落到 pi 原有解析链', () => {
    expect(parseRuntimeManifest('{')).toBeNull()
    expect(parseRuntimeManifest('null')).toBeNull()
    expect(parseRuntimeManifest('{"runtimeVersion":"1"}')).toBeNull()
  })

  it('单个工具字段缺失只丢这一项，不整份作废', () => {
    const parsed = parseRuntimeManifest('{"tools":{"rg":{"version":"1","path":"bin/rg.exe","sha256":"x"},"fd":{"version":"1"}}}')
    expect(Object.keys(parsed?.tools ?? {})).toEqual(['rg'])
    expect(parsed?.runtimeVersion).toBe('unknown')
  })
})

describe('needsRuntimeInstall', () => {
  it('没装过要装', () => {
    expect(needsRuntimeInstall(manifest, null, false)).toBe(true)
  })

  it('runtime 版本变了整份换掉', () => {
    expect(needsRuntimeInstall(manifest, { ...manifest, runtimeVersion: '2026.08' }, true)).toBe(true)
  })

  it('单个工具版本落后也要重装', () => {
    const stale = { ...manifest, tools: { ...manifest.tools, jq: { ...manifest.tools.jq, version: '1.7' } } }
    expect(needsRuntimeInstall(manifest, stale, true)).toBe(true)
  })

  it('版本一致且文件都在就跳过', () => {
    expect(needsRuntimeInstall(manifest, manifest, true)).toBe(false)
  })

  it('版本一致但可执行文件被删（杀软误杀）要重装', () => {
    expect(needsRuntimeInstall(manifest, manifest, false)).toBe(true)
  })
})

describe('runtimePathEntries', () => {
  it('按工具所在目录去重，bin 与 git/cmd 各出现一次', () => {
    expect(runtimePathEntries(manifest, '/fa/runtime')).toEqual([
      join('/fa/runtime', 'bin'),
      join('/fa/runtime', 'git', 'cmd')
    ])
  })

  it('pathEntry 为 false 的工具不进 PATH：bash 所在的 git/usr/bin 会遮蔽 Windows 的 find/sort', () => {
    const withBash: RuntimeManifest = {
      ...manifest,
      tools: { ...manifest.tools, bash: { version: '2.55.0.5', path: 'git/usr/bin/bash.exe', sha256: 'd'.repeat(64), pathEntry: false } }
    }
    expect(runtimePathEntries(withBash, '/fa/runtime')).not.toContain(join('/fa/runtime', 'git', 'usr', 'bin'))
  })

  it('清单里的 pathEntry 字段能被解析出来', () => {
    const parsed = parseRuntimeManifest('{"tools":{"bash":{"version":"1","path":"git/usr/bin/bash.exe","sha256":"x","pathEntry":false}}}')
    expect(parsed?.tools.bash.pathEntry).toBe(false)
  })
})

describe('prependPathEntries', () => {
  it('前置到已有 PATH 前面', () => {
    expect(prependPathEntries({ PATH: '/usr/bin' }, ['/fa/runtime/bin'], ':'))
      .toEqual({ PATH: '/fa/runtime/bin:/usr/bin' })
  })

  it('沿用已有键的大小写，不新增第二个 Path 键', () => {
    const result = prependPathEntries({ Path: 'C:\\Windows' }, ['C:\\fa\\bin'], ';')
    expect(result).toEqual({ Path: 'C:\\fa\\bin;C:\\Windows' })
    expect(Object.keys(result)).toEqual(['Path'])
  })

  it('已经在 PATH 里的目录不重复插入', () => {
    expect(prependPathEntries({ PATH: '/fa/bin:/usr/bin' }, ['/fa/bin'], ':'))
      .toEqual({ PATH: '/fa/bin:/usr/bin' })
  })

  it('原本没有 PATH 时直接建一个', () => {
    expect(prependPathEntries({}, ['/fa/bin'], ':')).toEqual({ PATH: '/fa/bin' })
  })

  it('没有要加的目录时原样返回', () => {
    const env = { PATH: '/usr/bin' }
    expect(prependPathEntries(env, [], ':')).toBe(env)
  })
})
