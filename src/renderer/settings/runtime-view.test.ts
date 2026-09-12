import { describe, expect, it } from 'vitest'
import type { RuntimeReport, RuntimeToolInfo } from '../../shared/types'
import { runtimeNeedsRepair, runtimeOverallLabel, runtimeToolDetail, runtimeToolLabel } from './runtime-view'

function report(tools: Array<Partial<RuntimeToolInfo>>, verified = false): RuntimeReport {
  return {
    runtimeVersion: '2026.09',
    installDir: 'C:\\Users\\me\\.fa\\runtime',
    checkedAt: 0,
    verified,
    noticesFile: null,
    tools: tools.map((tool) => ({ id: 'x', version: '1.0', source: 'bundled', status: 'ready', path: '/p', ...tool }) as RuntimeToolInfo)
  }
}

describe('runtimeOverallLabel', () => {
  it('没装过时说清楚会走系统 PATH，而不是报错', () => {
    expect(runtimeOverallLabel(report([]))).toContain('系统 PATH')
  })

  it('全部就绪时给出条数，校验过额外标注', () => {
    expect(runtimeOverallLabel(report([{ id: 'a' }, { id: 'b' }]))).toBe('全部就绪（2 项）')
    expect(runtimeOverallLabel(report([{ id: 'a' }], true))).toBe('全部就绪（1 项，已校验）')
  })

  it('缺失与不一致分别计数', () => {
    const label = runtimeOverallLabel(report([{ id: 'a', status: 'missing' }, { id: 'b', status: 'mismatch' }, { id: 'c' }]))
    expect(label).toBe('1 项缺失 · 1 项与清单不一致')
  })
})

describe('runtimeNeedsRepair', () => {
  it('只要有一项不就绪就该提示修复', () => {
    expect(runtimeNeedsRepair(report([{ id: 'a' }, { id: 'b', status: 'missing' }]))).toBe(true)
    expect(runtimeNeedsRepair(report([{ id: 'a' }]))).toBe(false)
    expect(runtimeNeedsRepair(report([]))).toBe(false)
  })
})

describe('runtimeToolDetail', () => {
  it('就绪显示版本，异常显示原因', () => {
    expect(runtimeToolDetail(report([{ version: '15.2.0' }]).tools[0])).toBe('15.2.0')
    expect(runtimeToolDetail(report([{ status: 'mismatch', detail: '内容与清单不一致，建议修复' }]).tools[0])).toContain('不一致')
  })

  it('异常但没给原因时回落到状态名', () => {
    expect(runtimeToolDetail(report([{ status: 'missing', detail: undefined }]).tools[0])).toBe('缺失')
  })
})

describe('runtimeToolLabel', () => {
  it('已知 id 用可读名，未知 id 原样显示', () => {
    expect(runtimeToolLabel('rg')).toBe('ripgrep')
    expect(runtimeToolLabel('7zz')).toBe('7-Zip')
    expect(runtimeToolLabel('unknown-tool')).toBe('unknown-tool')
  })
})
