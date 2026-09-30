import { describe, expect, it } from 'vitest'
import type { SkillCheckResult, SkillVersionRecord } from '../../../shared/types'
import { describeCheckResult, describeSkillVersion, describeToolRequirements, versionReasonLabel } from './skill-detail-view'

function version(patch: Partial<SkillVersionRecord> = {}): SkillVersionRecord {
  return { name: 'demo', revision: 2, version: '1.1.0', description: 'd', createdAt: 1, reason: 'edit', ...patch }
}

function check(patch: Partial<SkillCheckResult> = {}): SkillCheckResult {
  return { ok: true, requiredTools: [], missingTools: [], issues: [], ...patch }
}

describe('versionReasonLabel', () => {
  it('三种触发动作各有标签', () => {
    expect((['edit', 'import', 'revert'] as const).map((reason) => versionReasonLabel({ reason })))
      .toEqual(['编辑前', '覆盖导入前', '回退前'])
  })
})

describe('describeSkillVersion', () => {
  it('修订号 + 动作 + 标注版本', () => {
    expect(describeSkillVersion(version())).toBe('#2 · 编辑前 · v1.1.0')
  })

  it('没有标注版本时不编造', () => {
    expect(describeSkillVersion(version({ version: null }))).toBe('#2 · 编辑前')
  })
})

describe('describeToolRequirements', () => {
  it('未声明与全部可用是两句不同的话', () => {
    expect(describeToolRequirements({ requiredTools: [], missingTools: [] })).toBe('未声明 allowed-tools')
    expect(describeToolRequirements({ requiredTools: ['read'], missingTools: [] })).toBe('read（均可用）')
  })

  it('缺项要点名', () => {
    expect(describeToolRequirements({ requiredTools: ['read', 'grep'], missingTools: ['grep'] })).toBe('read、grep；缺少 grep')
  })
})

describe('describeCheckResult', () => {
  it('通过时明确说明未实际执行', () => {
    expect(describeCheckResult(check())).toContain('未实际执行')
  })

  it('有阻塞问题时先报阻塞数', () => {
    const result = check({ ok: false, issues: [{ level: 'error', message: 'a' }, { level: 'warning', message: 'b' }] })
    expect(describeCheckResult(result)).toBe('1 项阻塞问题，1 项提醒')
  })

  it('只有提醒时不说成失败', () => {
    expect(describeCheckResult(check({ issues: [{ level: 'warning', message: 'b' }] }))).toBe('配置可用，另有 1 项提醒')
  })
})
