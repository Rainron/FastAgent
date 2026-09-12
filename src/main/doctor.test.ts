import { describe, expect, it } from 'vitest'
import type { DoctorCheck } from '../shared/types'
import { buildDoctorReport, classifyToolProbe, parseToolVersion, probeTools, summarizeDoctor, TOOL_SPECS } from './doctor'

function check(patch: Partial<DoctorCheck>): DoctorCheck {
  return { id: 'x', label: 'X', category: 'toolchain', status: 'ok', detail: '', ...patch }
}

describe('parseToolVersion', () => {
  it('取第一行非空内容', () => {
    expect(parseToolVersion('git version 2.43.0\n')).toBe('git version 2.43.0')
    expect(parseToolVersion('\n\nPython 3.12.1')).toBe('Python 3.12.1')
  })

  it('多行输出只留第一行', () => {
    expect(parseToolVersion('openjdk 21\nOpenJDK Runtime\nOpenJDK 64-Bit')).toBe('openjdk 21')
  })

  it('超长行被截断', () => {
    expect(parseToolVersion('v'.repeat(200))).toHaveLength(81)
  })

  it('空输出返回 null', () => {
    expect(parseToolVersion('')).toBeNull()
    expect(parseToolVersion('   \n  ')).toBeNull()
  })
})

describe('classifyToolProbe', () => {
  const missing = { ok: false, stdout: '', missing: true, error: '' }

  it('必需工具缺失记 missing', () => {
    expect(classifyToolProbe({ result: missing, required: true })).toMatchObject({ status: 'missing', detail: '未安装或不在 PATH 中' })
  })

  it('可选工具缺失只记 warn', () => {
    expect(classifyToolProbe({ result: missing, required: false })).toMatchObject({ status: 'warn' })
  })

  it('装了但探不动记 error，与「没装」区分开', () => {
    const classified = classifyToolProbe({ result: { ok: false, stdout: '', missing: false, error: '探测超时（4000ms）' }, required: true })
    expect(classified).toMatchObject({ status: 'error', detail: '探测超时（4000ms）' })
  })

  it('探测成功时带上版本', () => {
    expect(classifyToolProbe({ result: { ok: true, stdout: 'git version 2.43.0', missing: false, error: '' }, required: true }))
      .toMatchObject({ status: 'ok', version: 'git version 2.43.0' })
  })
})

describe('summarizeDoctor', () => {
  it('整体结论取最严重的一档，不被大量 ok 稀释', () => {
    const result = summarizeDoctor([check({}), check({ id: 'b' }), check({ id: 'c', status: 'error' })])
    expect(result.overall).toBe('error')
    expect(result.summary).toEqual({ ok: 2, warn: 0, missing: 0, error: 1 })
  })

  it('missing 比 warn 严重', () => {
    expect(summarizeDoctor([check({ status: 'warn' }), check({ id: 'b', status: 'missing' })]).overall).toBe('missing')
  })

  it('只有 warn 时整体为 warn', () => {
    expect(summarizeDoctor([check({ status: 'warn' })]).overall).toBe('warn')
  })

  it('全部正常时整体为 ok', () => {
    expect(summarizeDoctor([check({}), check({ id: 'b' })])).toEqual({ summary: { ok: 2, warn: 0, missing: 0, error: 0 }, overall: 'ok' })
  })

  it('空清单不报错', () => {
    expect(summarizeDoctor([]).overall).toBe('ok')
  })
})

describe('buildDoctorReport', () => {
  it('带上时间戳与汇总', () => {
    const report = buildDoctorReport([check({ status: 'missing' })], 1_700_000_000_000)
    expect(report).toMatchObject({ checkedAt: 1_700_000_000_000, overall: 'missing' })
    expect(report.checks).toHaveLength(1)
  })
})

describe('TOOL_SPECS', () => {
  it('只有 git 是必需项：其余缺失不该把整体拉成红色', () => {
    expect(TOOL_SPECS.filter((spec) => spec.required).map((spec) => spec.id)).toEqual(['git'])
  })

  it('每个工具都给了缺失时的下一步建议', () => {
    for (const spec of TOOL_SPECS) expect(spec.hint, spec.id).toBeTruthy()
  })

  it('随包提供的 rg / fd 都在清单里，缺失时才有提示价值', () => {
    expect(TOOL_SPECS.map((spec) => spec.id)).toEqual(expect.arrayContaining(['rg', 'fd']))
  })
})

describe('probeTools 的内置工具解析', () => {
  it('内置工具按绝对路径探测，并在结论里标出来源', async () => {
    const checks = await probeTools(
      [{ id: 'rg', label: 'ripgrep', executable: 'rg', args: ['--version'], required: false, hint: 'x' }],
      { rg: process.execPath }
    )
    // 用 node 自身当替身：能跑通就说明探测走的是传入的绝对路径而不是 PATH 上的 rg
    expect(checks[0]).toMatchObject({ id: 'rg', status: 'ok' })
    expect(checks[0].detail).toContain('（内置）')
  })

  it('没有内置路径时仍按可执行文件名探测', async () => {
    const checks = await probeTools(
      [{ id: 'nope', label: 'Nope', executable: 'fastagent-not-a-real-tool', required: false, hint: 'x' }],
      {}
    )
    expect(checks[0]).toMatchObject({ status: 'warn' })
    expect(checks[0].detail).not.toContain('内置')
  })
})
