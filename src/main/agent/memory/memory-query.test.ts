import { describe, expect, it } from 'vitest'
import { buildMemoryQueryPlan, isEmptyQueryPlan } from './memory-query'

describe('buildMemoryQueryPlan', () => {
  it('中文按 3 字滑窗切分，每个窗口都是一个 trigram token', () => {
    const plan = buildMemoryQueryPlan('数据库用什么')
    expect(plan.match).toContain('"数据库"')
    expect(plan.match).toContain(' OR ')
  })

  it('英文长词直接进 MATCH，短词退回 LIKE', () => {
    const plan = buildMemoryQueryPlan('should we use uv or poetry')
    expect(plan.match).toContain('"poetry"')
    expect(plan.match).not.toContain('"use"')
    expect(plan.likeTerms).toEqual(['uv'])
  })

  it('大小写归一，避免 PostgreSQL 与 postgresql 分成两个词', () => {
    expect(buildMemoryQueryPlan('PostgreSQL').match).toBe('"postgresql"')
  })

  it('纯停用词与纯数字不产生查询词', () => {
    expect(isEmptyQueryPlan(buildMemoryQueryPlan('the and 123'))).toBe(true)
    expect(isEmptyQueryPlan(buildMemoryQueryPlan('这个的了吗'))).toBe(true)
  })

  it('词元去重且受上限约束', () => {
    const plan = buildMemoryQueryPlan('数据库数据库数据库', { maxTerms: 2 })
    expect(plan.match?.split(' OR ')).toHaveLength(2)
  })

  it('标点算词边界，引号不会漏进 MATCH 表达式', () => {
    expect(buildMemoryQueryPlan('abc"def').match).toBe('"abc" OR "def"')
  })

  it('空输入给出空计划', () => {
    expect(isEmptyQueryPlan(buildMemoryQueryPlan('   '))).toBe(true)
  })
})
