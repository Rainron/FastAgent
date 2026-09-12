import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeToolInfo } from '../../shared/types'
import { buildRuntimeReport, classifyRuntimeTool, sortRuntimeTools } from './runtime-report'

const entry = { version: '1.0.0', path: 'bin/tool.exe', sha256: 'a'.repeat(64) }

describe('classifyRuntimeTool', () => {
  it('文件不在记 missing，并且不给出路径', () => {
    const info = classifyRuntimeTool('rg', entry, { exists: false, sha256: null }, '/fa/runtime/bin/rg.exe')
    expect(info).toMatchObject({ status: 'missing', source: 'missing', path: null })
    expect(info.detail).toContain('修复')
  })

  it('未校验时只要文件在就算就绪', () => {
    expect(classifyRuntimeTool('rg', entry, { exists: true, sha256: null }, '/p')).toMatchObject({ status: 'ready', source: 'bundled', path: '/p' })
  })

  it('校验后哈希对不上记 mismatch，与「没装」区分开', () => {
    expect(classifyRuntimeTool('rg', entry, { exists: true, sha256: 'b'.repeat(64) }, '/p')).toMatchObject({ status: 'mismatch', source: 'bundled' })
  })

  it('校验通过仍是就绪', () => {
    expect(classifyRuntimeTool('rg', entry, { exists: true, sha256: entry.sha256 }, '/p').status).toBe('ready')
  })
})

describe('sortRuntimeTools', () => {
  it('有问题的排前面，就绪的保持原有相对顺序', () => {
    const tools = [
      { id: 'a', status: 'ready' }, { id: 'b', status: 'missing' }, { id: 'c', status: 'ready' }, { id: 'd', status: 'mismatch' }
    ] as RuntimeToolInfo[]
    expect(sortRuntimeTools(tools).map((tool) => tool.id)).toEqual(['b', 'd', 'a', 'c'])
  })
})

describe('buildRuntimeReport', () => {
  const roots: string[] = []
  const makeInstall = (manifest: unknown, files: Record<string, string> = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'fa-runtime-report-'))
    roots.push(root)
    if (manifest !== undefined) writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest), 'utf-8')
    for (const [path, content] of Object.entries(files)) {
      const target = join(root, ...path.split('/'))
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, content, 'utf-8')
    }
    return root
  }

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('没有清单时返回空列表，而不是报错', () => {
    const report = buildRuntimeReport({ installDir: makeInstall(undefined), now: 1 })
    expect(report).toMatchObject({ runtimeVersion: null, tools: [], verified: false, checkedAt: 1 })
  })

  it('列清单时不算哈希，文件在就算就绪', () => {
    const root = makeInstall({ runtimeVersion: '2026.09', tools: { rg: entry } }, { 'bin/tool.exe': '内容不对也无所谓' })
    const report = buildRuntimeReport({ installDir: root })
    expect(report.runtimeVersion).toBe('2026.09')
    expect(report.tools[0]).toMatchObject({ id: 'rg', status: 'ready' })
    expect(report.verified).toBe(false)
  })

  it('校验时哈希不符记 mismatch', () => {
    const root = makeInstall({ runtimeVersion: '2026.09', tools: { rg: entry } }, { 'bin/tool.exe': 'x' })
    const report = buildRuntimeReport({ installDir: root, verify: true })
    expect(report.verified).toBe(true)
    expect(report.tools[0]).toMatchObject({ status: 'mismatch' })
  })

  it('校验时哈希相符记 ready', () => {
    // sha256('x') 的真实值，避免用占位串把校验分支绕过去
    const real = { ...entry, sha256: '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881' }
    const root = makeInstall({ runtimeVersion: '2026.09', tools: { rg: real } }, { 'bin/tool.exe': 'x' })
    expect(buildRuntimeReport({ installDir: root, verify: true }).tools[0]).toMatchObject({ status: 'ready' })
  })

  it('文件缺失时即使要求校验也只记 missing', () => {
    const root = makeInstall({ runtimeVersion: '2026.09', tools: { rg: entry } })
    expect(buildRuntimeReport({ installDir: root, verify: true }).tools[0]).toMatchObject({ status: 'missing', path: null })
  })

  it('第三方声明存在时给出路径，缺失时为 null', () => {
    const withNotices = makeInstall({ runtimeVersion: '2026.09', tools: {} }, { 'THIRD-PARTY-NOTICES.md': '# 声明' })
    expect(buildRuntimeReport({ installDir: withNotices }).noticesFile).toBe(join(withNotices, 'THIRD-PARTY-NOTICES.md'))
    expect(buildRuntimeReport({ installDir: makeInstall({ runtimeVersion: '2026.09', tools: {} }) }).noticesFile).toBeNull()
  })
})
