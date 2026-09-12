import { describe, expect, it } from 'vitest'
import type { HubSource } from '../../../shared/types'
import { draftFromSource, emptySourceDraft, failureSummary, isSourceSupported, normalizeSourceId, sourceStatusPresentation, validateSourceDraft } from './hub-view'

function source(overrides: Partial<HubSource> = {}): HubSource {
  return {
    id: 'team', kind: 'git', name: '团队源', url: 'https://github.com/acme/kit',
    enabled: true, builtin: false, sortOrder: 1, hasSecrets: false, status: 'ready', updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides
  }
}

describe('normalizeSourceId', () => {
  it('收敛成安全字符', () => {
    expect(normalizeSourceId(' Team Source! ')).toBe('team-source')
  })

  it('去掉首尾连字符', () => {
    expect(normalizeSourceId('///a///')).toBe('a')
  })

  it('保留中文源名而不是抹成空串', () => {
    expect(normalizeSourceId('团队源')).toBe('团队源')
  })

  it('全是标点时返回空串', () => {
    expect(normalizeSourceId('!!!')).toBe('')
  })
})

describe('validateSourceDraft', () => {
  const draft = { ...emptySourceDraft(), id: 'team', name: '团队源', url: 'https://github.com/acme/kit' }

  it('合法草稿通过', () => {
    expect(validateSourceDraft(draft, [])).toBeNull()
  })

  it('id 冲突时拒绝', () => {
    expect(validateSourceDraft(draft, ['team'])).toBe('已存在同名源：team')
  })

  it('id 为空时按名称推导，两者都空才报错', () => {
    expect(validateSourceDraft({ ...draft, id: '' }, [])).toBeNull()
    expect(validateSourceDraft({ ...draft, id: '', name: '' }, [])).toBe('请填写源名称')
  })

  it('Git 源必须填地址', () => {
    expect(validateSourceDraft({ ...draft, url: '' }, [])).toBe('请填写仓库地址')
  })

  it('非法 URL 被拒绝', () => {
    expect(validateSourceDraft({ ...draft, url: 'not a url' }, [])).toBe('地址不是合法 URL')
  })

  it('非 http(s) 协议被拒绝', () => {
    expect(validateSourceDraft({ ...draft, url: 'file:///etc/passwd' }, [])).toBe('地址必须是 http 或 https')
  })
})

describe('draftFromSource', () => {
  it('不回填密钥', () => {
    expect(draftFromSource(source({ hasSecrets: true })).apiKey).toBe('')
  })

  it('缺省字段回填成空串而不是 undefined', () => {
    expect(draftFromSource(source({ url: undefined, ref: undefined }))).toMatchObject({ url: '', ref: '' })
  })
})

describe('failureSummary', () => {
  it('没有失败时返回 null', () => {
    expect(failureSummary([], [source()])).toBeNull()
  })

  it('用源名而不是 id 提示', () => {
    expect(failureSummary([{ sourceId: 'team', message: '仓库 404' }], [source()])).toBe('1 个源没有返回结果：团队源（仓库 404）')
  })

  it('源已被删掉时回落到 id', () => {
    expect(failureSummary([{ sourceId: 'gone', message: '超时' }], [])).toBe('1 个源没有返回结果：gone（超时）')
  })
})

describe('isSourceSupported', () => {
  it('已落地的源类型为真', () => {
    expect(isSourceSupported('builtin')).toBe(true)
    expect(isSourceSupported('git')).toBe(true)
  })

  it('聚合站源类型也已落地', () => {
    expect(isSourceSupported('skillsmp')).toBe(true)
    expect(isSourceSupported('mcp-registry')).toBe(true)
  })

  it('只有 Git 源强制填地址，聚合站可留空用默认', () => {
    const base = { ...emptySourceDraft(), name: '官方 Registry', url: '' }
    expect(validateSourceDraft({ ...base, kind: 'mcp-registry' }, [])).toBeNull()
    expect(validateSourceDraft({ ...base, kind: 'skillsmp' }, [])).toBeNull()
    expect(validateSourceDraft({ ...base, kind: 'git' }, [])).toBe('请填写仓库地址')
  })
})

describe('sourceStatusPresentation', () => {
  it('连不上用错误色，未授权用警告色', () => {
    expect(sourceStatusPresentation('unreachable').tone).toBe('error')
    expect(sourceStatusPresentation('unauthorized').tone).toBe('warn')
  })
})
